import type { MobileAuthSession } from '../auth/authSession';
import {
  createMomentsFeedStore,
  type MomentsFeedStoreController,
} from './momentsFeedStore';
import { composeHomeFeedState } from './privateMomentFeedProjection';
import type {
  MobileSocialScope,
  SocialExperienceProjection,
} from './socialExperienceProjection';
import { createDeepImmutableSocialProjection } from './socialExperienceProjection';
import type { SocialIntentPort } from './socialIntents';
import {
  isPublicSocialAudience,
  toPrivateSocialAudience,
} from './socialAudience';
import {
  createMomentsGateway,
} from '../../services/gateways/momentsGateway';
import {
  openPrivateMomentMedia,
  publishPrivateMoment,
  publishPrivateTextMoment,
  readPrivateComments,
  readPrivateMoment,
  readPrivateMomentsSnapshot,
  reconcilePrivateMoments,
  recoverPrivateMoment,
  setPrivateMomentReaction,
  submitPrivateComment,
  subscribePrivateMomentsRuntime,
  trackPublicMomentPublish,
} from '../../runtimes/privateMomentsRuntime';
import {
  createMomentsProjection,
  type MomentsProjectionController,
} from '../../runtimes/momentsProjectionDescriptor';

export interface MobileSocialFacadeOwnerPort {
  readonly momentsProjection: MomentsProjectionController;
}

export interface MobileSocialFacadeController {
  readonly scope: MobileSocialScope;
  /** Compatibility owner used by runtime ingress; product pages use `feeds`. */
  readonly feed: MomentsFeedStoreController;
  readonly feeds: {
    readonly home: MomentsFeedStoreController;
    readonly explore: MomentsFeedStoreController;
  };
  readonly intents: SocialIntentPort;
  readonly owner: MobileSocialFacadeOwnerPort;
  state(): SocialExperienceProjection;
  subscribe(listener: () => void): () => void;
  activate(): void;
  teardown(): void;
}

export interface MobileSocialFacadeDependencies {
  readonly retry: () => Promise<boolean>;
}

const activeFacadeListeners = new Set<() => void>();
let activeFacade: MobileSocialFacadeController | null = null;

export function readActiveMobileSocialFacade(
  session?: MobileAuthSession | null,
): MobileSocialFacadeController | null {
  if (!activeFacade || !session) return session === undefined ? activeFacade : null;
  return scopeMatchesSession(activeFacade.scope, session) ? activeFacade : null;
}

export function subscribeActiveMobileSocialFacade(
  listener: () => void,
): () => void {
  activeFacadeListeners.add(listener);
  return () => activeFacadeListeners.delete(listener);
}

export function createMobileSocialFacade(
  session: MobileAuthSession,
  dependencies: MobileSocialFacadeDependencies,
): MobileSocialFacadeController {
  const scope = Object.freeze<MobileSocialScope>({
    stationPeerId: session.stationPeerId,
    actorPtid: session.actorRef.ptid,
    deviceId: session.deviceId,
    lifecycleGeneration: String(session.lifecycleGeneration),
  });
  const gateway = createMomentsGateway(session);
  const homeFeed = createMomentsFeedStore(gateway);
  const exploreFeed = createMomentsFeedStore(gateway, { scope: 'explore' });
  const feed: MomentsFeedStoreController = {
    ...homeFeed,
    reconcile: async () => {
      const [home, explore] = await Promise.all([
        homeFeed.reconcile(),
        exploreFeed.reconcile(),
      ]);
      if (home === false || explore === false) return false;
      if (home === null || explore === null) return null;
      return true;
    },
    prependPost: (post) => homeFeed.prependPost(post),
    removePost: (postId) => {
      homeFeed.removePost(postId);
      exploreFeed.removePost(postId);
    },
    teardown: () => {
      homeFeed.teardown();
      exploreFeed.teardown();
    },
  };
  const momentsProjection = createMomentsProjection();
  const listeners = new Set<() => void>();
  let revision = 0;
  let torn = false;
  let currentProjection = buildProjection();

  const emit = () => {
    if (torn) return;
    revision += 1;
    currentProjection = buildProjection();
    listeners.forEach((listener) => listener());
  };
  const releaseHomeFeed = homeFeed.subscribe(emit);
  const releaseExploreFeed = exploreFeed.subscribe(emit);
  const releaseMomentsProjection = momentsProjection.subscribe(emit);
  const releasePrivateProjection = subscribePrivateMomentsRuntime(emit);

  const controller: MobileSocialFacadeController = {
    scope,
    feed,
    feeds: { home: homeFeed, explore: exploreFeed },
    intents: createIntentPort(),
    owner: { momentsProjection },
    state,
    subscribe,
    activate,
    teardown,
  };

  function state(): SocialExperienceProjection {
    return currentProjection;
  }

  function buildProjection(): SocialExperienceProjection {
    const privateSocial = readPrivateMomentsSnapshot();
    const scopedPrivateSocial = privateProjectionMatchesScope(privateSocial, scope)
      ? privateSocial
      : null;
    return createDeepImmutableSocialProjection({
      scope,
      revision,
      home: composeHomeFeedState(homeFeed.state(), scopedPrivateSocial),
      explore: exploreFeed.state(),
      runtime: Object.freeze({
        availability: momentsProjection.state().availability,
        privateSocial: scopedPrivateSocial,
      }),
    });
  }

  function subscribe(listener: () => void): () => void {
    if (torn) return () => undefined;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function activate(): void {
    assertNotTorn();
    if (activeFacade && activeFacade !== controller) {
      throw new Error('mobile.social.facadeAlreadyActive');
    }
    if (activeFacade === controller) return;
    activeFacade = controller;
    activeFacadeListeners.forEach((listener) => listener());
  }

  function teardown(): void {
    if (torn) return;
    torn = true;
    releaseHomeFeed();
    releaseExploreFeed();
    releaseMomentsProjection();
    releasePrivateProjection();
    feed.teardown();
    momentsProjection.teardown();
    listeners.clear();
    if (activeFacade === controller) {
      activeFacade = null;
      activeFacadeListeners.forEach((listener) => listener());
    }
  }

  function assertCurrent(): void {
    assertNotTorn();
    if (activeFacade !== controller) {
      throw new Error('mobile.social.staleFacadeCompletion');
    }
  }

  function assertNotTorn(): void {
    if (torn) throw new Error('mobile.social.facadeTornDown');
  }

  async function completeCurrent<T>(operation: () => Promise<T>): Promise<T> {
    assertCurrent();
    const result = await operation();
    assertCurrent();
    return result;
  }

  function createIntentPort(): SocialIntentPort {
    return {
      refreshPublicFeed: (feedScope = 'home') => completeCurrent(
        () => (feedScope === 'explore' ? exploreFeed : homeFeed).refresh(),
      ),
      publishMoment: async (intent) => {
        const audience = intent.draft.audience;
        if (isPublicSocialAudience(audience)) {
          const outcome = await completeCurrent(() => trackPublicMomentPublish(
            () => gateway.createMoment(intent.draft),
            (result) => result.ok && Boolean(result.data.post),
          ));
          if (outcome.ok && outcome.data.post) {
            homeFeed.prependPost(outcome.data.post);
          }
          return { route: 'PUBLIC', outcome };
        }

        const privateAudience = toPrivateSocialAudience(audience);
        const base = {
          draftId: intent.draftId,
          draftRevision: intent.draftRevision,
          text: intent.draft.text,
          audience: privateAudience,
        };
        const projection = intent.draft.kind === 'image'
          ? await completeCurrent(() => publishPrivateMoment({
            ...base,
            momentKind: 'IMAGE',
            files: [...(intent.privateFiles ?? [])],
          }))
          : await completeCurrent(() => publishPrivateTextMoment(base));
        return { route: 'PRIVATE', projection };
      },
      setPublicReaction: async (postId, reactionKind, active) => {
        const result = await completeCurrent(() => (
          active
            ? gateway.reactToPost(postId, reactionKind)
            : gateway.unreactToPost(postId, reactionKind)
        ));
        if (result.ok) {
          feedForPost(postId).updateReaction(postId, result.data.reactions);
        }
        return result;
      },
      createPublicComment: async (postId, content, replyToCommentId) => {
        const result = await completeCurrent(
          () => gateway.createComment(postId, content, replyToCommentId),
        );
        if (result.ok) await feedForPost(postId).refreshPost(postId);
        return result;
      },
      readPublicComments: (postId, cursor = '', limit = 50) => completeCurrent(
        () => gateway.fetchComments(postId, cursor, limit),
      ),
      react: async (postId, reactionKind) => {
        assertCurrent();
        const privateSnapshot = readPrivateMomentsSnapshot();
        const privatePost = privateProjectionMatchesScope(privateSnapshot, scope)
          ? privateSnapshot.postsById[postId]
          : undefined;
        if (privatePost?.state === 'CONTENT_READY') {
          const active = privatePost.reactions?.some(
            (reaction) => reaction.kind === reactionKind && reaction.reactedByViewer,
          ) ?? false;
          const result = await completeCurrent(
            () => setPrivateMomentReaction(postId, reactionKind, !active),
          );
          return result.command.state === 'REACTION_COMMITTED';
        }
        const targetFeed = feedForPost(postId);
        const transaction = targetFeed.beginReaction(postId, reactionKind);
        if (!transaction) return false;
        const result = await completeCurrent(() => (
          transaction.operation === 'unreact'
            ? gateway.unreactToPost(postId, reactionKind)
            : gateway.reactToPost(postId, reactionKind)
        ));
        if (result.ok) {
          targetFeed.commitReaction(transaction, result.data.reactions);
          return true;
        }
        targetFeed.rollbackReaction(transaction, result.error.message);
        return false;
      },
      comment: async (postId, content, replyToCommentId) => {
        const result = await controller.intents.createPublicComment(
          postId,
          content,
          replyToCommentId,
        );
        return result.ok;
      },
      deleteComment: async (postId, commentId) => {
        const result = await completeCurrent(
          () => gateway.deleteComment(commentId),
        );
        return result.ok && await feedForPost(postId).reloadMoment(postId);
      },
      retry: () => completeCurrent(dependencies.retry),
      readPrivate: (postId) => completeCurrent(
        () => readPrivateMoment(postId),
      ),
      openPrivateMedia: (postId, objectId) => completeCurrent(
        () => openPrivateMomentMedia(postId, objectId),
      ),
      recoverPrivate: (postId, recoveryEpoch) => completeCurrent(
        () => recoverPrivateMoment(postId, recoveryEpoch),
      ),
      submitPrivateComment: (intent) => completeCurrent(
        () => submitPrivateComment(intent),
      ),
      readPrivateComments: (postId, cursor, limit) => completeCurrent(
        () => readPrivateComments(postId, cursor, limit),
      ),
      reconcilePrivate: () => completeCurrent(reconcilePrivateMoments),
    };
  }

  function feedForPost(postId: string): MomentsFeedStoreController {
    return exploreFeed.state().postIndex.has(postId) ? exploreFeed : homeFeed;
  }

  return controller;
}

function scopeMatchesSession(
  scope: MobileSocialScope,
  session: MobileAuthSession,
): boolean {
  return scope.stationPeerId === session.stationPeerId
    && scope.actorPtid === session.actorRef.ptid
    && scope.deviceId === session.deviceId
    && scope.lifecycleGeneration === String(session.lifecycleGeneration);
}

function privateProjectionMatchesScope(
  projection: ReturnType<typeof readPrivateMomentsSnapshot>,
  scope: MobileSocialScope,
): boolean {
  return projection.active
    && projection.stationPeerId === scope.stationPeerId
    && projection.actorPtid === scope.actorPtid
    && projection.deviceId === scope.deviceId
    && projection.lifecycleGeneration === scope.lifecycleGeneration;
}
