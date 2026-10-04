import { createDesktopStore } from './createDesktopStore';
import {
  PrivateMomentsNativeError,
  privateMomentsNative,
  resolvePrivateMomentsPlatform,
  type PrivateMediaState,
  type PrivateMomentProjection,
  type PrivateMomentPublishIntent,
  type PrivateMomentPublishRejectionEvidence,
  type PrivateMomentPublishResult,
  type PrivateMomentsNativeSnapshot,
  type PrivateMomentsPlatform,
  type PrivatePublishState,
  type PrivateReadState,
} from '../services/privateMomentsNative';
import { emitFrontendTelemetryEvent } from '../kernel/frontendTelemetry';
import { log } from '../utils/logger';

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

interface PrivateMomentsState {
  platform: PrivateMomentsPlatform;
  scope: PrivateMomentScope;
  postsById: Record<string, PrivateMomentProjection>;
  publish: PrivatePublishProjection;
  reconciling: boolean;

  activateActor: (actorPtid: string, rendererGeneration: number) => void;
  deactivate: (rendererGeneration: number) => void;
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
  if (
    generationOrder === 0
    && (incoming.content?.kind === 'IMAGE' || incoming.content?.kind === 'VIDEO')
    && incoming.content.kind === current.content?.kind
  ) {
    const currentMedia = new Map(
      current.content.media.map((media) => [media.objectId, media]),
    );
    return {
      ...incoming,
      content: {
        ...incoming.content,
        media: incoming.content.media.map((media) => {
          const existing = currentMedia.get(media.objectId);
          return existing?.state === 'MEDIA_READY' ? existing : media;
        }),
      },
    };
  }
  return incoming;
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
    'PUBLISHED',
    'PUBLISH_FAILED',
  ].includes(value);
}

function isReadState(value: string): value is PrivateReadState {
  return [
    'LOADING_AUTHORIZED_RESOURCE',
    'WAITING_FOR_PRIVATE_KEY',
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
    const applySnapshot = (
      snapshot: PrivateMomentsNativeSnapshot,
      actorPtid: string,
      rendererGeneration: number,
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

      set((state) => {
        if (!isCurrentScope(state.scope, actorPtid, rendererGeneration)) return state;
        const advancedGeneration = (
          state.scope.nativeSessionGeneration
          && compareGeneration(snapshot.sessionGeneration, state.scope.nativeSessionGeneration) > 0
        );
        const postsById = advancedGeneration ? {} : { ...state.postsById };
        for (const projection of snapshot.projections) {
          postsById[projection.postId] = mergeProjection(
            postsById[projection.postId],
            projection,
          );
        }
        return {
          scope: {
            ...state.scope,
            nativeSessionGeneration: snapshot.sessionGeneration,
          },
          postsById,
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

    return {
      ...initialData(),

      activateActor: (actorPtid, rendererGeneration) => {
        publishOperationSequence += 1;
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

      deactivate: (rendererGeneration) => {
        publishOperationSequence += 1;
        const previous = get().scope;
        set({
          ...initialData(),
          platform: resolvePrivateMomentsPlatform(),
          scope: emptyScope(rendererGeneration),
        });
        if (previous.actorPtid) {
          void privateMomentsNative.teardown({
            actorPtid: previous.actorPtid,
            rendererGeneration: previous.rendererGeneration,
          }).catch((error) => {
            log.warn(TAG, 'Native private Moments teardown failed', {
              error: String(error),
            });
          });
        }
      },

      bootstrap: async (rendererGeneration) => {
        const { actorPtid } = get().scope;
        if (!actorPtid || get().scope.rendererGeneration !== rendererGeneration) return;
        if (get().platform !== 'native') return;
        const snapshot = await privateMomentsNative.bootstrap({
          actorPtid,
          rendererGeneration,
        });
        applySnapshot(snapshot, actorPtid, rendererGeneration);
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
        try {
          const snapshot = await privateMomentsNative.reconcile({
            actorPtid,
            rendererGeneration,
            postIds: uniquePostIds,
            reason,
          });
          applySnapshot(snapshot, actorPtid, rendererGeneration);
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
              ? { ...existing, state: 'LOADING_AUTHORIZED_RESOURCE', content: undefined }
              : {
                  postId,
                  contentId: `loading:${postId}`,
                  generation: '0',
                  authorPtid: actorPtid,
                  audienceKind: 'FRIENDS',
                  state: 'LOADING_AUTHORIZED_RESOURCE',
                  mentions: [],
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

      recoverMoment: async (postId) => {
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
        if (!actorPtid || get().platform !== 'native') return;
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
        if (!actorPtid || get().platform !== 'native') return;
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

      purgeMoment: async (postId) => {
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
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
          return { postsById };
        });
      },

      clearPublishState: () => {
        publishOperationSequence += 1;
        set({ publish: { state: 'IDLE' } });
      },

      reset: () => {
        publishOperationSequence += 1;
        set(initialData());
      },
    };
  },
);
