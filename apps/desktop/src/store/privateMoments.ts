import { createDesktopStore } from './createDesktopStore';
import {
  PrivateMomentsNativeError,
  privateMomentsNative,
  privateReactionTargetKey,
  resolvePrivateMomentsPlatform,
  type PrivateMediaState,
  type PrivateMomentProjection,
  type PrivateMomentPublishIntent,
  type PrivateMomentPublishRejectionEvidence,
  type PrivateMomentPublishResult,
  type PrivateMomentsNativeSnapshot,
  type PrivateMomentsPlatform,
  type PrivatePublishState,
  type PrivateReactionCommandProjection,
  type PrivateReactionMutationResult,
  type PrivateReadState,
} from '../services/privateMomentsNative';
import { ReactionKind } from '../gen/proto/domain/social/post_pb';
import type { PrivateResourceRevocationReason } from '../kernel/events/types';
import { emitFrontendTelemetryEvent } from '../kernel/frontendTelemetry';
import { log } from '../utils/logger';
import { structuralEqual } from '../utils/structuralEqual';

const TAG = 'private-moments-store';

export interface PrivatePublishProjection {
  state: PrivatePublishState;
  draftId?: string;
  postId?: string;
  errorCode?: string;
  retryAfterSeconds?: number;
  rejectionEvidence?: PrivateMomentPublishRejectionEvidence;
}

interface PrivateMomentScope {
  actorPtid: string | null;
  rendererGeneration: number;
  nativeSessionGeneration: string | null;
}

export interface PrivateReactionStatusProjection
  extends Omit<PrivateReactionCommandProjection, 'commandId'> {
  commandId?: string;
}

interface PrivateMomentsState {
  platform: PrivateMomentsPlatform;
  scope: PrivateMomentScope;
  postsById: Record<string, PrivateMomentProjection>;
  reactionCommands: Record<string, PrivateReactionStatusProjection>;
  publish: PrivatePublishProjection;
  reconciling: boolean;

  activateActor: (actorPtid: string, rendererGeneration: number) => void;
  deactivate: (rendererGeneration: number) => void;
  // Explicitly destroy the native Secure Content runtime for an actor the
  // window has genuinely stopped authenticating. Never driven by projection
  // generation churn — same-actor re-bootstraps must leave the live lease
  // intact. Best-effort: a missing runtime is already the desired state.
  teardownNativeActor: (actorPtid: string, rendererGeneration: number) => Promise<void>;
  bootstrap: (rendererGeneration: number) => Promise<void>;
  reconcile: (
    postIds: string[],
    reason: string,
    rendererGeneration: number,
  ) => Promise<void>;
  admitMoment: (
    intent: Omit<PrivateMomentPublishIntent, 'actorPtid' | 'rendererGeneration'>,
    readinessState?: Extract<
      PrivatePublishState,
      'CHECKING_PRIVATE_READINESS' | 'CHECKING_REMOTE_READINESS'
    >,
  ) => Promise<PrivateMomentPublishResult>;
  publishMoment: (intent: Omit<PrivateMomentPublishIntent, 'actorPtid' | 'rendererGeneration'>) =>
    Promise<PrivateMomentPublishResult>;
  readMoment: (postId: string) => Promise<void>;
  recoverMoment: (postId: string) => Promise<void>;
  openMedia: (postId: string, objectId: string) => Promise<void>;
  setReaction: (
    postId: string,
    kind: ReactionKind,
    operation: 'REACT' | 'UNREACT',
    commentId?: string,
  ) => Promise<PrivateReactionMutationResult>;
  votePoll: (postId: string, options: readonly number[]) => Promise<PrivateReactionMutationResult>;
  retryReaction: (postId: string, commentId?: string, kind?: ReactionKind) => Promise<PrivateReactionMutationResult>;
  revokeMoment: (
    postId: string,
    reason: PrivateResourceRevocationReason,
  ) => Promise<void>;
  purgeMoment: (postId: string) => Promise<void>;
  removePost: (postId: string) => void;
  clearPublishState: () => void;
  reset: () => void;
}

const emptyScope = (rendererGeneration = 0): PrivateMomentScope => ({
  actorPtid: null,
  rendererGeneration,
  nativeSessionGeneration: null,
});

const initialData = () => ({
  platform: resolvePrivateMomentsPlatform(),
  scope: emptyScope(),
  postsById: {} as Record<string, PrivateMomentProjection>,
  reactionCommands: {} as Record<string, PrivateReactionStatusProjection>,
  publish: { state: 'IDLE' } as PrivatePublishProjection,
  reconciling: false,
});

let publishOperationSequence = 0;

function compareGeneration(left: string, right: string): number {
  try {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  } catch {
    return left.localeCompare(right);
  }
}

function isCurrentScope(
  scope: PrivateMomentScope,
  actorPtid: string,
  rendererGeneration: number,
): boolean {
  return (
    scope.actorPtid === actorPtid
    && scope.rendererGeneration === rendererGeneration
  );
}

/**
 * Structural equality for native moment projections. Periodic reconciles
 * re-emit brand-new object instances whose content is unchanged; deep comparing
 * the normalized projection shape lets the merge retain the existing reference
 * so memoized MomentCards do not repaint on a no-op refresh (mirrors
 * sameFeedExplanation in the public moments store).
 */
function samePrivateProjection(
  current: PrivateMomentProjection,
  next: PrivateMomentProjection,
): boolean {
  return structuralEqual(current, next);
}

function mergeProjection(
  current: PrivateMomentProjection | undefined,
  incoming: PrivateMomentProjection,
): PrivateMomentProjection {
  if (!current) return incoming;
  if (incoming.state !== 'CONTENT_READY' || current.state !== 'CONTENT_READY') {
    return incoming;
  }
  const generationOrder = compareGeneration(incoming.generation, current.generation);
  if (generationOrder < 0) return current;
  let next = incoming;
  if (!incoming.reactionsHydrated && current.reactionsHydrated) {
    next = {
      ...next,
      reactions: current.reactions ?? [],
      reactionRevision: current.reactionRevision ?? '0',
      reactionsHydrated: true,
    };
  } else if (
    compareGeneration(
      incoming.reactionRevision ?? '0',
      current.reactionRevision ?? '0',
    ) < 0
  ) {
    next = {
      ...next,
      reactions: current.reactions ?? [],
      reactionRevision: current.reactionRevision ?? '0',
      reactionsHydrated: current.reactionsHydrated,
    };
  }
  if (
    generationOrder === 0
    && current.postId === next.postId
    && current.contentId === next.contentId
    && current.content?.kind === 'POLL'
    && next.content?.kind === 'POLL'
    && Boolean(current.content.optionSetSha256)
    && current.content.optionSetSha256 === next.content.optionSetSha256
    && structuralEqual(current.content.opaqueOptionIds, next.content.opaqueOptionIds)
    && current.content.result
    && (!next.content.result || compareGeneration(
      next.content.result.projectionRevision,
      current.content.result.projectionRevision,
    ) < 0)
  ) {
    next = {
      ...next,
      content: { ...next.content, result: current.content.result },
    };
  }
  if (
    generationOrder === 0
    && (next.content?.kind === 'IMAGE' || next.content?.kind === 'VIDEO')
    && next.content.kind === current.content?.kind
  ) {
    const currentMedia = new Map(
      current.content.media.map((media) => [media.objectId, media]),
    );
    next = {
      ...next,
      content: {
        ...next.content,
        media: next.content.media.map((media) => {
          const existing = currentMedia.get(media.objectId);
          return existing?.state === 'MEDIA_READY' ? existing : media;
        }),
      },
    };
  }
  // Same generation and identical shape: keep the current reference so a
  // periodic read with no real change never triggers a card repaint.
  if (generationOrder === 0 && samePrivateProjection(current, next)) {
    return current;
  }
  return next;
}

function unsupportedProjection(
  postId: string,
  actorPtid: string,
): PrivateMomentProjection {
  return {
    postId,
    contentId: `unsupported:${postId}`,
    generation: '0',
    authorPtid: actorPtid,
    audienceKind: 'FRIENDS',
    state: 'PRIVATE_UNSUPPORTED_ON_DEVICE',
    mentions: [],
    reactions: [],
    reactionRevision: '0',
    reactionsHydrated: false,
    errorCode: 'PRIVATE_UNSUPPORTED_ON_DEVICE',
  };
}

function publishFailure(error: unknown): PrivatePublishProjection {
  if (error instanceof PrivateMomentsNativeError) {
    const state = isPublishState(error.state) ? error.state : 'PUBLISH_FAILED';
    return {
      state,
      errorCode: error.code,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return {
    state: 'PUBLISH_FAILED',
    errorCode: 'PRIVATE_NATIVE_COMMAND_FAILED',
  };
}

function readFailureState(error: unknown): PrivateReadState {
  if (error instanceof PrivateMomentsNativeError && isReadState(error.state)) {
    return error.state;
  }
  return 'INTEGRITY_FAILURE';
}

function mediaFailureState(error: unknown): PrivateMediaState {
  if (!(error instanceof PrivateMomentsNativeError)) return 'MEDIA_OFFLINE_RETRYABLE';
  if (isMediaState(error.state)) return error.state;
  if (error.state === 'INTEGRITY_FAILURE') return 'MEDIA_INTEGRITY_FAILURE';
  if (
    error.state === 'NOT_FOUND_OR_NOT_AUTHORIZED'
    || error.state === 'AUTHENTICATION_REQUIRED'
    || error.state === 'DELETED_OR_REVOKED'
  ) {
    return 'MEDIA_ACCESS_DENIED';
  }
  return 'MEDIA_OFFLINE_RETRYABLE';
}

function isMediaState(value: string): value is PrivateMediaState {
  return [
    'MEDIA_PLACEHOLDER',
    'MEDIA_GRANT_PENDING',
    'MEDIA_DOWNLOADING',
    'MEDIA_DECRYPTING',
    'MEDIA_READY',
    'MEDIA_ACCESS_DENIED',
    'MEDIA_INTEGRITY_FAILURE',
    'MEDIA_OFFLINE_RETRYABLE',
  ].includes(value);
}

type PrivateMediaMetricOutcome = 'accepted' | 'rejected' | 'interrupted' | 'retryable';
type PrivateMediaMetricReason =
  | 'none'
  | 'not_found'
  | 'range_invalid'
  | 'integrity'
  | 'dependency'
  | 'cancelled';

function mediaProjection(
  projection: PrivateMomentProjection,
  objectId: string,
) {
  if (
    projection.content?.kind !== 'IMAGE'
    && projection.content?.kind !== 'VIDEO'
  ) {
    return undefined;
  }
  return projection.content.media.find((media) => media.objectId === objectId);
}

function mediaMetricResult(
  state: PrivateMediaState,
  errorCode?: string,
): { outcome: PrivateMediaMetricOutcome; reason: PrivateMediaMetricReason } {
  if (state === 'MEDIA_READY') return { outcome: 'accepted', reason: 'none' };
  if (errorCode === 'MEDIA_CANCELLED') {
    return { outcome: 'interrupted', reason: 'cancelled' };
  }
  if (state === 'MEDIA_ACCESS_DENIED') {
    return { outcome: 'rejected', reason: 'not_found' };
  }
  if (state === 'MEDIA_INTEGRITY_FAILURE') {
    return {
      outcome: 'rejected',
      reason: errorCode === 'RANGE_INVALID' ? 'range_invalid' : 'integrity',
    };
  }
  return { outcome: 'retryable', reason: 'dependency' };
}

function emitRemoteMediaMetric(
  startedAt: number,
  state: PrivateMediaState,
  errorCode?: string,
): void {
  const { outcome, reason } = mediaMetricResult(state, errorCode);
  emitFrontendTelemetryEvent({
    kind: outcome === 'accepted' ? 'invoke.completed' : 'invoke.failed',
    source: 'store',
    module: 'social-private-media',
    phase: 'interaction',
    durationMs: Math.max(0, Date.now() - startedAt),
    tags: {
      stage: 'recipient_proxy',
      outcome,
      reason,
    },
  });
}

function isPublishState(value: string): value is PrivatePublishState {
  return [
    'IDLE',
    'AUDIENCE_REQUIRED',
    'CHECKING_PRIVATE_READINESS',
    'CHECKING_REMOTE_READINESS',
    'READY_PRIVATE',
    'PRIVATE_UNSUPPORTED',
    'RECIPIENT_KEY_UNAVAILABLE',
    'AUDIENCE_TOO_LARGE',
    'PUBLISHING',
    'UNKNOWN_COMMIT',
    'REMOTE_DELIVERY_PENDING',
    'REMOTE_DELIVERY_RETRYING',
    'PUBLISHED',
    'PUBLISH_FAILED',
  ].includes(value);
}

function isReadState(value: string): value is PrivateReadState {
  return [
    'LOADING_AUTHORIZED_RESOURCE',
    'WAITING_FOR_PRIVATE_KEY',
    'WAITING_FOR_REMOTE_DELIVERY',
    'REMOTE_SOURCE_UNAVAILABLE',
    'RECOVERY_REQUIRED',
    'RECOVERY_KEY_UNAVAILABLE',
    'DECRYPTING',
    'CONTENT_READY',
    'AUTHENTICATION_REQUIRED',
    'NOT_FOUND_OR_NOT_AUTHORIZED',
    'INTEGRITY_FAILURE',
    'PRIVATE_UNSUPPORTED_ON_DEVICE',
    'DELETED_OR_REVOKED',
  ].includes(value);
}

function patchMedia(
  projection: PrivateMomentProjection,
  objectId: string,
  state: PrivateMediaState,
  errorCode?: string,
): PrivateMomentProjection {
  if (
    projection.content?.kind !== 'IMAGE'
    && projection.content?.kind !== 'VIDEO'
  ) {
    return projection;
  }
  return {
    ...projection,
    content: {
      ...projection.content,
      media: projection.content.media.map((media) => (
        media.objectId === objectId
          ? {
              ...media,
              state,
              retryable: state === 'MEDIA_OFFLINE_RETRYABLE',
              errorCode,
            }
          : media
      )),
    },
  };
}

export const usePrivateMomentsStore = createDesktopStore<PrivateMomentsState>(
  'privateMoments',
  (set, get) => {
    let reactionMutationVersion = 0;
    const reactionMutationVersionByTarget = new Map<string, number>();
    const reactionFlights = new Map<string, {
      operation: PrivateReactionCommandProjection['operation'];
      options?: readonly number[];
      completion: Promise<PrivateReactionMutationResult>;
    }>();
    const revocationReasonByPost =
      new Map<string, PrivateResourceRevocationReason>();
    const markReactionMutation = (key: string): void => {
      reactionMutationVersion += 1;
      reactionMutationVersionByTarget.set(key, reactionMutationVersion);
    };
    const applySnapshot = (
      snapshot: PrivateMomentsNativeSnapshot,
      actorPtid: string,
      rendererGeneration: number,
      reactionMutationVersionAtStart: number,
    ): boolean => {
      const current = get();
      if (!isCurrentScope(current.scope, actorPtid, rendererGeneration)) return false;
      if (snapshot.actorPtid !== actorPtid) return false;

      const currentNativeGeneration = current.scope.nativeSessionGeneration;
      if (
        currentNativeGeneration
        && compareGeneration(snapshot.sessionGeneration, currentNativeGeneration) < 0
      ) {
        return false;
      }
      if (currentNativeGeneration
        && compareGeneration(snapshot.sessionGeneration, currentNativeGeneration) > 0) {
        reactionFlights.clear();
        reactionMutationVersionByTarget.clear();
      }

      set((state) => {
        if (!isCurrentScope(state.scope, actorPtid, rendererGeneration)) return state;
        const advancedGeneration = (
          state.scope.nativeSessionGeneration
          && compareGeneration(snapshot.sessionGeneration, state.scope.nativeSessionGeneration) > 0
        );
        const postsById = advancedGeneration ? {} : { ...state.postsById };
        for (const projection of snapshot.projections) {
          if (revocationReasonByPost.has(projection.postId)) continue;
          postsById[projection.postId] = mergeProjection(
            postsById[projection.postId],
            projection,
          );
        }
        const reactionCommands: Record<string, PrivateReactionStatusProjection> = {};
        for (const command of snapshot.reactionCommands) {
          if (revocationReasonByPost.has(command.postId)) continue;
          const key = privateReactionTargetKey(command.postId, command.commentId, command.kind);
          if (command.state !== 'REACTION_COMMITTED') {
            reactionCommands[key] = command;
          }
        }
        for (const [key, version] of reactionMutationVersionByTarget) {
          if (advancedGeneration) break;
          if (version <= reactionMutationVersionAtStart) continue;
          delete reactionCommands[key];
          const currentReaction = state.reactionCommands[key];
          if (currentReaction) {
            reactionCommands[key] = currentReaction;
          }
        }
        return {
          scope: {
            ...state.scope,
            nativeSessionGeneration: snapshot.sessionGeneration,
          },
          postsById,
          reactionCommands,
        };
      });
      return true;
    };

    const applyProjection = (
      projection: PrivateMomentProjection,
      actorPtid: string,
      rendererGeneration: number,
    ): boolean => {
      if (!isCurrentScope(get().scope, actorPtid, rendererGeneration)) return false;
      if (revocationReasonByPost.has(projection.postId)) return false;
      set((state) => {
        if (!isCurrentScope(state.scope, actorPtid, rendererGeneration)) return state;
        return {
          postsById: {
            ...state.postsById,
            [projection.postId]: mergeProjection(
              state.postsById[projection.postId],
              projection,
            ),
          },
        };
      });
      return true;
    };

    const applyReactionResult = (
      result: PrivateReactionMutationResult,
      actorPtid: string,
      rendererGeneration: number,
    ): void => {
      if (!isCurrentScope(get().scope, actorPtid, rendererGeneration)) return;
      let applied = false;
      set((state) => {
        if (!isCurrentScope(state.scope, actorPtid, rendererGeneration)) return state;
        applied = true;
        const postsById = { ...state.postsById };
        const current = postsById[result.command.postId];
        if (
          current
          && !result.command.commentId && result.command.operation !== 'VOTE_POLL'
          && compareGeneration(
            result.projectionRevision,
            current.reactionRevision ?? '0',
          ) >= 0
        ) {
          postsById[result.command.postId] = {
            ...current,
            reactions: result.reactions,
            reactionRevision: result.projectionRevision,
            reactionsHydrated: true,
          };
        }
        if (current?.content?.kind === 'POLL' && result.command.operation === 'VOTE_POLL' && result.poll
          && compareGeneration(result.poll.projectionRevision, current.content.result?.projectionRevision ?? '0') >= 0) {
          postsById[result.command.postId] = {
            ...current, content: { ...current.content, result: result.poll },
          };
        }
        const reactionCommands = { ...state.reactionCommands };
        const key = privateReactionTargetKey(
          result.command.postId, result.command.commentId, result.command.kind,
        );
        if (result.command.state === 'REACTION_COMMITTED') {
          delete reactionCommands[key];
        } else {
          reactionCommands[key] = result.command;
        }
        return { postsById, reactionCommands };
      });
      if (applied) markReactionMutation(privateReactionTargetKey(
        result.command.postId, result.command.commentId, result.command.kind,
      ));
    };

    const retryReaction = async (
      postId: string,
      commentId = '',
      kind: ReactionKind = ReactionKind.REACTION_LIKE,
    ): Promise<PrivateReactionMutationResult> => {
      const scope = get().scope;
      const actorPtid = scope.actorPtid;
      const key = privateReactionTargetKey(postId, commentId, kind);
      const pending = get().reactionCommands[key];
      if (
        !actorPtid
        || get().platform !== 'native'
        || !pending?.commandId
        || pending.state === 'REACTION_REJECTED'
      ) {
        throw new PrivateMomentsNativeError({
          code: 'REACTION_RETRY_UNAVAILABLE',
          state: 'REACTION_REJECTED',
        });
      }
      if (
        pending.retryNotBeforeUnixMs !== undefined
        && pending.retryNotBeforeUnixMs > Date.now()
      ) {
        throw new PrivateMomentsNativeError({
          code: 'REACTION_RETRY_NOT_READY',
          state: pending.state,
          retryAfterSeconds: Math.ceil(
            (pending.retryNotBeforeUnixMs - Date.now()) / 1_000,
          ),
        });
      }
      set((state) => ({
        reactionCommands: {
          ...state.reactionCommands,
          [key]: {
            ...pending,
            state: 'REACTION_RETRYING',
          },
        },
      }));
      markReactionMutation(key);
      try {
        const result = await privateMomentsNative.retryReaction({
          actorPtid,
          rendererGeneration: scope.rendererGeneration,
          commandId: pending.commandId,
        });
        if (!isCurrentScope(get().scope, actorPtid, scope.rendererGeneration)
          || get().scope.nativeSessionGeneration !== scope.nativeSessionGeneration) {
          throw new PrivateMomentsNativeError({ code: 'PRIVATE_SESSION_REPLACED', state: 'REACTION_REJECTED' });
        }
        if (result.command.postId !== postId || result.command.commentId !== commentId
          || result.command.kind !== kind || result.command.operation !== pending.operation
          || result.command.commandId !== pending.commandId) {
          throw new PrivateMomentsNativeError({
            code: 'PRIVATE_PROJECTION_INVALID', state: 'REACTION_PENDING',
          });
        }
        applyReactionResult(result, actorPtid, scope.rendererGeneration);
        return result;
      } catch (error) {
        if (isCurrentScope(get().scope, actorPtid, scope.rendererGeneration)
          && get().scope.nativeSessionGeneration === scope.nativeSessionGeneration) {
          set((state) => ({
            reactionCommands: {
              ...state.reactionCommands,
              [key]: {
                ...pending,
                state: error instanceof PrivateMomentsNativeError
                  && (error.state === 'REACTION_PENDING'
                    || error.state === 'REACTION_RETRYING')
                  ? error.state
                  : 'REACTION_REJECTED',
                errorCode: error instanceof PrivateMomentsNativeError
                  ? error.code
                  : 'REACTION_NATIVE_COMMAND_FAILED',
              },
            },
          }));
          markReactionMutation(key);
        }
        throw error;
      }
    };

    const runReaction = async (
      postId: string,
      kind: ReactionKind,
      operation: PrivateReactionCommandProjection['operation'],
      commentId = '',
      options?: readonly number[],
    ): Promise<PrivateReactionMutationResult> => {
      const scope = get().scope;
      const actorPtid = scope.actorPtid;
      if (!actorPtid || get().platform !== 'native') {
        throw new PrivateMomentsNativeError({
          code: 'PRIVATE_UNSUPPORTED_ON_DEVICE',
          state: 'REACTION_REJECTED',
        });
      }
      const current = get().postsById[postId];
      if (!current || current.state !== 'CONTENT_READY') {
        throw new PrivateMomentsNativeError({
          code: 'REACTION_PRIVATE_POST_REQUIRED',
          state: 'REACTION_REJECTED',
        });
      }
      const key = privateReactionTargetKey(postId, commentId, kind);
      const selectedOpaqueOptionIds = operation === 'VOTE_POLL' && current.content?.kind === 'POLL'
        ? options?.map(index => current.content?.kind === 'POLL' ? current.content.opaqueOptionIds?.[index] : undefined)
          .filter((id): id is string => Boolean(id)).sort()
        : [];
      if (operation === 'VOTE_POLL' && (!options || !selectedOpaqueOptionIds
        || selectedOpaqueOptionIds.length !== options.length || current.content?.kind !== 'POLL')) {
        throw new PrivateMomentsNativeError({ code: 'SOCIAL_PRIVATE_POLL_INVALID_SELECTION', state: 'REACTION_REJECTED' });
      }
      const existing = get().reactionCommands[key];
      if (
        existing?.commandId
        && existing.state !== 'REACTION_REJECTED'
      ) {
        if (existing.kind !== kind || existing.operation !== operation
          || (operation === 'VOTE_POLL' && JSON.stringify(existing.selectedOpaqueOptionIds) !== JSON.stringify(selectedOpaqueOptionIds))) {
          throw new PrivateMomentsNativeError({
            code: 'REACTION_COMMAND_PENDING',
            state: existing.state,
            retryable: true,
            retryAfterSeconds: existing.retryAfterSeconds,
          });
        }
        return retryReaction(postId, commentId, kind);
      }
      const pending: PrivateReactionStatusProjection = {
        postId,
        commentId,
        kind,
        operation,
        selectedOpaqueOptionIds,
        state: 'REACTION_PENDING',
        attemptCount: 0,
        projectionRevision: current.reactionRevision ?? '0',
      };
      set((state) => ({
        reactionCommands: {
          ...state.reactionCommands,
          [key]: pending,
        },
      }));
      markReactionMutation(key);
      try {
        const result = await (operation === 'VOTE_POLL'
          ? privateMomentsNative.votePoll({ actorPtid, rendererGeneration: scope.rendererGeneration, postId,
              selectedOptions: options! })
          : operation === 'REACT'
          ? privateMomentsNative.react({
              actorPtid,
              rendererGeneration: scope.rendererGeneration,
              postId,
              commentId,
              kind,
            })
          : privateMomentsNative.unreact({
              actorPtid,
              rendererGeneration: scope.rendererGeneration,
              postId,
              commentId,
              kind,
            }));
        if (!isCurrentScope(get().scope, actorPtid, scope.rendererGeneration)
          || get().scope.nativeSessionGeneration !== scope.nativeSessionGeneration) {
          throw new PrivateMomentsNativeError({ code: 'PRIVATE_SESSION_REPLACED', state: 'REACTION_REJECTED' });
        }
        if (result.command.postId !== postId || result.command.commentId !== commentId
          || result.command.kind !== kind || result.command.operation !== operation
          || (operation === 'VOTE_POLL'
            && (JSON.stringify(result.command.selectedOpaqueOptionIds) !== JSON.stringify(selectedOpaqueOptionIds)
              || (result.command.state === 'REACTION_COMMITTED' && !result.poll)))) {
          throw new PrivateMomentsNativeError({
            code: 'PRIVATE_PROJECTION_INVALID', state: 'REACTION_PENDING',
          });
        }
        applyReactionResult(result, actorPtid, scope.rendererGeneration);
        return result;
      } catch (error) {
        if (
          error instanceof PrivateMomentsNativeError
          && error.code === 'REACTION_COMMAND_PENDING'
          && error.state === 'REACTION_PENDING'
        ) {
          const snapshot = await privateMomentsNative.bootstrap({
            actorPtid,
            rendererGeneration: scope.rendererGeneration,
          });
          applySnapshot(
            snapshot,
            actorPtid,
            scope.rendererGeneration,
            reactionMutationVersion,
          );
          const durable = get().reactionCommands[key];
          if (
            durable?.commandId
            && durable.kind === kind
            && durable.operation === operation
            && (operation !== 'VOTE_POLL' || JSON.stringify(durable.selectedOpaqueOptionIds) === JSON.stringify(selectedOpaqueOptionIds))
          ) {
            return retryReaction(postId, commentId, kind);
          }
        }
        if (isCurrentScope(get().scope, actorPtid, scope.rendererGeneration)
          && get().scope.nativeSessionGeneration === scope.nativeSessionGeneration) {
          set((state) => ({
            reactionCommands: {
              ...state.reactionCommands,
              [key]: {
                ...pending,
                state: error instanceof PrivateMomentsNativeError
                  && error.state === 'REACTION_PENDING' ? 'REACTION_PENDING' : 'REACTION_REJECTED',
                errorCode: error instanceof PrivateMomentsNativeError
                  ? error.code
                  : 'REACTION_NATIVE_COMMAND_FAILED',
              },
            },
          }));
          markReactionMutation(key);
        }
        throw error;
      }
    };

    const setReaction = (
      postId: string, kind: ReactionKind, operation: PrivateReactionCommandProjection['operation'], commentId = '',
      options?: readonly number[],
    ): Promise<PrivateReactionMutationResult> => {
      const scope = get().scope;
      const key = privateReactionTargetKey(postId, commentId, kind);
      const existing = reactionFlights.get(key);
      if (existing) {
        return existing.operation === operation && JSON.stringify(existing.options) === JSON.stringify(options)
          ? existing.completion : Promise.reject(
          new PrivateMomentsNativeError({ code: 'REACTION_COMMAND_PENDING', state: 'REACTION_PENDING' }),
        );
      }
      // Defer execution so subscribers cannot re-enter before the flight is fenced.
      const completion = Promise.resolve().then(() => {
        if (!scope.actorPtid || !isCurrentScope(get().scope, scope.actorPtid, scope.rendererGeneration)
          || get().scope.nativeSessionGeneration !== scope.nativeSessionGeneration) {
          throw new PrivateMomentsNativeError({ code: 'AUTHENTICATION_REQUIRED', state: 'REACTION_REJECTED' });
        }
        return runReaction(postId, kind, operation, commentId, options);
      });
      const flight = { operation, completion, options: options ? [...options] : undefined };
      reactionFlights.set(key, flight);
      void completion.finally(() => {
        if (reactionFlights.get(key) === flight) reactionFlights.delete(key);
      }).catch(() => {});
      return completion;
    };

    return {
      ...initialData(),

      activateActor: (actorPtid, rendererGeneration) => {
        publishOperationSequence += 1;
        reactionMutationVersion += 1;
        reactionMutationVersionByTarget.clear();
        reactionFlights.clear();
        revocationReasonByPost.clear();
        set({
          ...initialData(),
          platform: resolvePrivateMomentsPlatform(),
          scope: {
            actorPtid,
            rendererGeneration,
            nativeSessionGeneration: null,
          },
        });
      },

      // Projection-only reset. It MUST NOT tear down the native Secure Content
      // runtime: deactivate also runs on every same-actor renderer-generation
      // churn (session/station identity resolving late), and an actor-wide
      // native teardown there would destroy the lease the runtime is about to
      // re-activate. Native runtime lifetime is owned by native identity
      // transitions and by explicit teardownNativeActor on deauthentication.
      deactivate: (rendererGeneration) => {
        publishOperationSequence += 1;
        reactionMutationVersion += 1;
        reactionMutationVersionByTarget.clear();
        reactionFlights.clear();
        revocationReasonByPost.clear();
        set({
          ...initialData(),
          platform: resolvePrivateMomentsPlatform(),
          scope: emptyScope(rendererGeneration),
        });
      },

      teardownNativeActor: async (actorPtid, rendererGeneration) => {
        if (!actorPtid) return;
        try {
          await privateMomentsNative.teardown({ actorPtid, rendererGeneration });
        } catch (error) {
          log.warn(TAG, 'Native private Moments teardown failed', {
            error: String(error),
          });
        }
      },

      bootstrap: async (rendererGeneration) => {
        const { actorPtid } = get().scope;
        if (!actorPtid || get().scope.rendererGeneration !== rendererGeneration) return;
        if (get().platform !== 'native') return;
        const reactionMutationVersionAtStart = reactionMutationVersion;
        const snapshot = await privateMomentsNative.bootstrap({
          actorPtid,
          rendererGeneration,
        });
        applySnapshot(
          snapshot,
          actorPtid,
          rendererGeneration,
          reactionMutationVersionAtStart,
        );
      },

      reconcile: async (postIds, reason, rendererGeneration) => {
        const uniquePostIds = [...new Set(postIds.map((id) => id.trim()).filter(Boolean))];
        const { actorPtid } = get().scope;
        if (!actorPtid || get().scope.rendererGeneration !== rendererGeneration) return;

        if (get().platform !== 'native') {
          set((state) => ({
            postsById: uniquePostIds.reduce<Record<string, PrivateMomentProjection>>(
              (next, postId) => {
                next[postId] = unsupportedProjection(postId, actorPtid);
                return next;
              },
              { ...state.postsById },
            ),
            reconciling: false,
          }));
          return;
        }

        set({ reconciling: true });
        const reactionMutationVersionAtStart = reactionMutationVersion;
        try {
          const snapshot = await privateMomentsNative.reconcile({
            actorPtid,
            rendererGeneration,
            postIds: uniquePostIds,
            reason,
          });
          applySnapshot(
            snapshot,
            actorPtid,
            rendererGeneration,
            reactionMutationVersionAtStart,
          );
        } finally {
          if (isCurrentScope(get().scope, actorPtid, rendererGeneration)) {
            set({ reconciling: false });
          }
        }
      },

      admitMoment: async (
        intent,
        readinessState = 'CHECKING_PRIVATE_READINESS',
      ) => {
        const operationSequence = ++publishOperationSequence;
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
        if (!actorPtid) {
          const error = new PrivateMomentsNativeError({
            code: 'AUTHENTICATION_REQUIRED',
            state: 'PUBLISH_FAILED',
          });
          set({ publish: publishFailure(error) });
          throw error;
        }
        if (get().platform !== 'native') {
          const error = new PrivateMomentsNativeError({
            code: 'PRIVATE_UNSUPPORTED',
            state: 'PRIVATE_UNSUPPORTED',
          });
          set({
            publish: {
              state: 'PRIVATE_UNSUPPORTED',
              draftId: intent.draftId,
              errorCode: error.code,
            },
          });
          throw error;
        }

        const rendererGeneration = scope.rendererGeneration;
        set({
          publish: {
            state: readinessState,
            draftId: intent.draftId,
          },
        });
        try {
          const result = await privateMomentsNative.admit({
            ...intent,
            actorPtid,
            rendererGeneration,
          });
          if (
            operationSequence !== publishOperationSequence
            || !isCurrentScope(get().scope, actorPtid, rendererGeneration)
          ) {
            return result;
          }
          if (result.state !== 'READY_PRIVATE') {
            throw new PrivateMomentsNativeError({
              code: 'PRIVATE_PROJECTION_INVALID',
              state: 'PUBLISH_FAILED',
            });
          }
          set({
            publish: {
              state: 'READY_PRIVATE',
              draftId: result.draftId,
            },
          });
          return result;
        } catch (error) {
          if (
            operationSequence === publishOperationSequence
            && isCurrentScope(get().scope, actorPtid, rendererGeneration)
          ) {
            set({
              publish: {
                ...publishFailure(error),
                draftId: intent.draftId,
              },
            });
          }
          throw error;
        }
      },

      publishMoment: async (intent) => {
        const operationSequence = ++publishOperationSequence;
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
        if (!actorPtid) {
          const error = new PrivateMomentsNativeError({
            code: 'AUTHENTICATION_REQUIRED',
            state: 'PUBLISH_FAILED',
          });
          set({ publish: publishFailure(error) });
          throw error;
        }
        if (get().platform !== 'native') {
          const error = new PrivateMomentsNativeError({
            code: 'PRIVATE_UNSUPPORTED',
            state: 'PRIVATE_UNSUPPORTED',
          });
          set({
            publish: {
              state: 'PRIVATE_UNSUPPORTED',
              draftId: intent.draftId,
              errorCode: error.code,
            },
          });
          throw error;
        }

        const rendererGeneration = scope.rendererGeneration;
        set({
          publish: {
            state: 'CHECKING_PRIVATE_READINESS',
            draftId: intent.draftId,
          },
        });

        try {
          const pending = privateMomentsNative.publish({
            ...intent,
            actorPtid,
            rendererGeneration,
          });
          set((state) => (
            isCurrentScope(state.scope, actorPtid, rendererGeneration)
              ? {
                  publish: {
                    state: 'PUBLISHING',
                    draftId: intent.draftId,
                  },
                }
              : state
          ));
          const result = await pending;
          if (
            operationSequence !== publishOperationSequence
            || !isCurrentScope(get().scope, actorPtid, rendererGeneration)
          ) {
            return result;
          }
          if (result.projection) {
            applyProjection(result.projection, actorPtid, rendererGeneration);
          }
          if (result.state === 'PRIVATE_UNSUPPORTED') {
            set({
              publish: {
                state: result.state,
                draftId: result.draftId,
                errorCode: result.errorCode,
                rejectionEvidence: result.evidence,
              },
            });
            return result;
          }
          set({
            publish: {
              state: result.state,
              draftId: result.draftId,
              postId: result.postId ?? result.projection?.postId,
            },
          });
          return result;
        } catch (error) {
          if (
            operationSequence === publishOperationSequence
            && isCurrentScope(get().scope, actorPtid, rendererGeneration)
          ) {
            set({
              publish: {
                ...publishFailure(error),
                draftId: intent.draftId,
              },
            });
          }
          throw error;
        }
      },

      readMoment: async (postId) => {
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
        if (!actorPtid) return;
        if (revocationReasonByPost.has(postId)) return;
        if (get().platform !== 'native') {
          applyProjection(
            unsupportedProjection(postId, actorPtid),
            actorPtid,
            scope.rendererGeneration,
          );
          return;
        }

        const existing = get().postsById[postId];
        set((state) => ({
          postsById: {
            ...state.postsById,
            [postId]: existing
              ? existing.content
                ? existing
                : { ...existing, state: 'LOADING_AUTHORIZED_RESOURCE', content: undefined }
              : {
                  postId,
                  contentId: `loading:${postId}`,
                  generation: '0',
                  authorPtid: actorPtid,
                  audienceKind: 'FRIENDS',
                  state: 'LOADING_AUTHORIZED_RESOURCE',
                  mentions: [],
                  reactions: [],
                  reactionRevision: '0',
                  reactionsHydrated: false,
                },
          },
        }));

        try {
          const projection = await privateMomentsNative.read({
            actorPtid,
            rendererGeneration: scope.rendererGeneration,
            postId,
          });
          applyProjection(projection, actorPtid, scope.rendererGeneration);
        } catch (error) {
          if (!isCurrentScope(get().scope, actorPtid, scope.rendererGeneration)) return;
          set((state) => {
            const current = state.postsById[postId];
            if (!current) return state;
            const failureState = readFailureState(error);
            return {
              postsById: {
                ...state.postsById,
                [postId]: {
                  ...current,
                  state: failureState,
                  content: failureState === 'REMOTE_SOURCE_UNAVAILABLE'
                    ? current.content
                    : undefined,
                  errorCode: error instanceof PrivateMomentsNativeError
                    ? error.code
                    : 'PRIVATE_NATIVE_COMMAND_FAILED',
                },
              },
            };
          });
        }
      },

      recoverMoment: async (postId) => {
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
        if (
          !actorPtid
          || revocationReasonByPost.has(postId)
          || get().platform !== 'native'
        ) return;
        try {
          const projection = await privateMomentsNative.recover({
            actorPtid,
            rendererGeneration: scope.rendererGeneration,
            postId,
          });
          applyProjection(projection, actorPtid, scope.rendererGeneration);
        } catch (error) {
          if (!isCurrentScope(get().scope, actorPtid, scope.rendererGeneration)) return;
          set((state) => {
            const current = state.postsById[postId];
            if (!current) return state;
            return {
              postsById: {
                ...state.postsById,
                [postId]: {
                  ...current,
                  state: readFailureState(error),
                  content: undefined,
                  errorCode: error instanceof PrivateMomentsNativeError
                    ? error.code
                    : 'PRIVATE_NATIVE_COMMAND_FAILED',
                },
              },
            };
          });
        }
      },

      openMedia: async (postId, objectId) => {
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
        if (
          !actorPtid
          || revocationReasonByPost.has(postId)
          || get().platform !== 'native'
        ) return;
        const projection = get().postsById[postId];
        if (!projection) return;
        const opensRemotePeerStream = mediaProjection(projection, objectId)?.accessPath
          === 'HOME_STATION_REMOTE_PEER_STREAM';
        const startedAt = Date.now();
        set((state) => ({
          postsById: {
            ...state.postsById,
            [postId]: patchMedia(projection, objectId, 'MEDIA_GRANT_PENDING'),
          },
        }));

        try {
          const next = await privateMomentsNative.openMedia({
            actorPtid,
            rendererGeneration: scope.rendererGeneration,
            postId,
            objectId,
          });
          if (opensRemotePeerStream) {
            const result = mediaProjection(next, objectId);
            emitRemoteMediaMetric(
              startedAt,
              result?.state ?? 'MEDIA_INTEGRITY_FAILURE',
              result?.errorCode,
            );
          }
          applyProjection(next, actorPtid, scope.rendererGeneration);
        } catch (error) {
          const failureState = mediaFailureState(error);
          if (opensRemotePeerStream) {
            emitRemoteMediaMetric(
              startedAt,
              failureState,
              error instanceof PrivateMomentsNativeError
                ? error.code
                : 'PRIVATE_NATIVE_COMMAND_FAILED',
            );
          }
          if (!isCurrentScope(get().scope, actorPtid, scope.rendererGeneration)) return;
          set((state) => {
            const current = state.postsById[postId];
            if (!current) return state;
            return {
              postsById: {
                ...state.postsById,
                [postId]: patchMedia(
                  current,
                  objectId,
                  failureState,
                  error instanceof PrivateMomentsNativeError
                    ? error.code
                    : 'PRIVATE_NATIVE_COMMAND_FAILED',
                ),
              },
            };
          });
        }
      },

      setReaction,
      votePoll: (postId, options) => setReaction(postId, ReactionKind.REACTION_UNSPECIFIED, 'VOTE_POLL', '', options),

      retryReaction,

      revokeMoment: async (postId, reason) => {
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
        revocationReasonByPost.set(postId, reason);
        markReactionMutation(postId);
        set((state) => {
          const current = state.postsById[postId];
          if (!current) return state;
          const reactionCommands = Object.fromEntries(
            Object.entries(state.reactionCommands).filter(([, command]) => command.postId !== postId),
          );
          return {
            postsById: {
              ...state.postsById,
              [postId]: {
                ...current,
                state: 'DELETED_OR_REVOKED',
                revocationReason: reason,
                content: undefined,
                errorCode: `SOCIAL_PRIVATE_${reason}`,
              },
            },
            reactionCommands,
          };
        });
        if (actorPtid && get().platform === 'native') {
          await privateMomentsNative.purge({
            actorPtid,
            rendererGeneration: scope.rendererGeneration,
            postId,
          });
        }
      },

      purgeMoment: async (postId) => {
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
        revocationReasonByPost.set(postId, 'RESOURCE_DELETED');
        markReactionMutation(postId);
        set((state) => {
          const current = state.postsById[postId];
          if (!current) return state;
          return {
            postsById: {
              ...state.postsById,
              [postId]: {
                ...current,
                state: 'DELETED_OR_REVOKED',
                content: undefined,
                errorCode: 'DELETED_OR_REVOKED',
              },
            },
          };
        });
        if (actorPtid && get().platform === 'native') {
          await privateMomentsNative.purge({
            actorPtid,
            rendererGeneration: scope.rendererGeneration,
            postId,
          });
        }
        if (!actorPtid || isCurrentScope(get().scope, actorPtid, scope.rendererGeneration)) {
          get().removePost(postId);
        }
      },

      removePost: (postId) => {
        set((state) => {
          const postsById = { ...state.postsById };
          delete postsById[postId];
          const reactionCommands = Object.fromEntries(
            Object.entries(state.reactionCommands).filter(([, command]) => command.postId !== postId),
          );
          return { postsById, reactionCommands };
        });
      },

      clearPublishState: () => {
        publishOperationSequence += 1;
        set({ publish: { state: 'IDLE' } });
      },

      reset: () => {
        publishOperationSequence += 1;
        reactionMutationVersion += 1;
        reactionMutationVersionByTarget.clear();
        reactionFlights.clear();
        revocationReasonByPost.clear();
        set(initialData());
      },
    };
  },
);
