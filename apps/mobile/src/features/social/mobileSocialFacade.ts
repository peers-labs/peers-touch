import type { MobileAuthSession } from '../auth/authSession';
import {
  createMomentsFeedStore,
  type MomentsFeedStoreController,
} from './momentsFeedStore';
import type {
  MobileSocialScope,
  SocialExperienceProjection,
} from './socialExperienceProjection';
import type { SocialIntentPort } from './socialIntents';
import {
  createMomentsGateway,
  type MomentsGateway,
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
  storePrivateSocialRecoveryPhrase,
  submitPrivateComment,
  subscribePrivateMomentsRuntime,
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
  readonly feed: MomentsFeedStoreController;
  readonly intents: SocialIntentPort;
  /** Acceptance harness compatibility; product pages must use `intents`. */
  readonly gateway: MomentsGateway;
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
  const feed = createMomentsFeedStore(gateway);
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
  const releaseFeed = feed.subscribe(emit);
  const releaseMomentsProjection = momentsProjection.subscribe(emit);
  const releasePrivateProjection = subscribePrivateMomentsRuntime(emit);

  const controller: MobileSocialFacadeController = {
    scope,
    feed,
    intents: createIntentPort(),
    gateway,
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
    return Object.freeze({
      scope,
      revision,
      home: feed.state(),
      runtime: Object.freeze({
        availability: momentsProjection.state().availability,
        privateSocial: privateProjectionMatchesScope(privateSocial, scope)
          ? privateSocial
          : null,
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
    releaseFeed();
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
      publishPublic: async (draft) => {
        const result = await completeCurrent(() => gateway.createMoment(draft));
        if (result.ok && result.data.post) feed.prependPost(result.data.post);
        return result;
      },
      react: async (postId, reactionKind) => {
        assertCurrent();
        const transaction = feed.beginReaction(postId, reactionKind);
        if (!transaction) return false;
        const result = await completeCurrent(() => (
          transaction.operation === 'unreact'
            ? gateway.unreactToPost(postId, reactionKind)
            : gateway.reactToPost(postId, reactionKind)
        ));
        if (result.ok) {
          feed.commitReaction(transaction, result.data.reactions);
          return true;
        }
        feed.rollbackReaction(transaction, result.error.message);
        return false;
      },
      comment: async (postId, content, replyToCommentId) => {
        const result = await completeCurrent(
          () => gateway.createComment(postId, content, replyToCommentId),
        );
        return result.ok && await feed.refreshPost(postId);
      },
      deleteComment: async (postId, commentId) => {
        const result = await completeCurrent(
          () => gateway.deleteComment(commentId),
        );
        return result.ok && await feed.reloadMoment(postId);
      },
      retry: () => completeCurrent(dependencies.retry),
      publishPrivateText: (intent) => completeCurrent(
        () => publishPrivateTextMoment(intent),
      ),
      publishPrivate: (intent) => completeCurrent(
        () => publishPrivateMoment(intent),
      ),
      readPrivate: (postId) => completeCurrent(
        () => readPrivateMoment(postId),
      ),
      openPrivateMedia: (postId, objectId) => completeCurrent(
        () => openPrivateMomentMedia(postId, objectId),
      ),
      recoverPrivate: (postId) => completeCurrent(
        () => recoverPrivateMoment(postId),
      ),
      submitPrivateComment: (intent) => completeCurrent(
        () => submitPrivateComment(intent),
      ),
      readPrivateComments: (postId, cursor, limit) => completeCurrent(
        () => readPrivateComments(postId, cursor, limit),
      ),
      storeRecoveryPhrase: (recoveryPhrase, recoveryEpoch) => completeCurrent(
        () => storePrivateSocialRecoveryPhrase(recoveryPhrase, recoveryEpoch),
      ),
      reconcilePrivate: () => completeCurrent(reconcilePrivateMoments),
    };
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
