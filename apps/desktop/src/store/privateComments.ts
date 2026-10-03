import { createDesktopStore } from './createDesktopStore';
import {
  PrivateCommentsNativeError,
  privateCommentsNative,
  type PrivateCommentMention,
  type PrivateCommentDraftProjection,
  type PrivateCommentIntent,
  type PrivateCommentPage,
  type PrivateCommentProjection,
  type PrivateCommentsNativeSnapshot,
  type PrivateCommentState,
} from '../services/privateCommentsNative';
import { resolvePrivateMomentsPlatform } from '../services/privateMomentsNative';
import { log } from '../utils/logger';

const TAG = 'private-comments-store';
let fallbackDraftSequence = 0;

interface PrivateCommentScope {
  actorPtid: string | null;
  rendererGeneration: number;
  nativeSessionGeneration: string | null;
}

export interface PrivateCommentThread {
  comments: PrivateCommentProjection[];
  nextCursor: string;
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  state?: PrivateCommentState;
  errorCode?: string;
}

interface PrivateCommentsState {
  scope: PrivateCommentScope;
  draftsById: Record<string, PrivateCommentDraftProjection>;
  activeDraftByPost: Record<string, string>;
  threadsByPost: Record<string, PrivateCommentThread>;

  activateActor: (actorPtid: string, rendererGeneration: number) => void;
  deactivate: (rendererGeneration: number) => void;
  bootstrap: (rendererGeneration: number) => Promise<void>;
  reconcile: (
    postIds: string[],
    reason: string,
    rendererGeneration: number,
  ) => Promise<void>;
  loadComments: (postId: string, refresh?: boolean) => Promise<void>;
  submitComment: (
    postId: string,
    text: string,
    replyToCommentId?: string,
    mentions?: PrivateCommentMention[],
  ) => Promise<void>;
  retryComment: (postId: string) => Promise<void>;
  markParentUnavailable: (postId: string, errorCode?: string) => void;
  clearPost: (postId: string) => void;
  reset: () => void;
}

const emptyScope = (rendererGeneration = 0): PrivateCommentScope => ({
  actorPtid: null,
  rendererGeneration,
  nativeSessionGeneration: null,
});

const emptyThread = (): PrivateCommentThread => ({
  comments: [],
  nextCursor: '',
  hasMore: false,
  loading: false,
  loaded: false,
});

const initialData = (rendererGeneration = 0) => ({
  scope: emptyScope(rendererGeneration),
  draftsById: {} as Record<string, PrivateCommentDraftProjection>,
  activeDraftByPost: {} as Record<string, string>,
  threadsByPost: {} as Record<string, PrivateCommentThread>,
});

function isCurrentScope(
  scope: PrivateCommentScope,
  actorPtid: string,
  rendererGeneration: number,
): boolean {
  return (
    scope.actorPtid === actorPtid
    && scope.rendererGeneration === rendererGeneration
  );
}

function compareGeneration(left: string, right: string): number {
  try {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  } catch {
    return left.localeCompare(right);
  }
}

function newerComment(
  current: PrivateCommentProjection,
  incoming: PrivateCommentProjection,
): PrivateCommentProjection {
  return compareGeneration(incoming.generation, current.generation) >= 0
    ? incoming
    : current;
}

function createDraftId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  fallbackDraftSequence += 1;
  return `comment-draft-${Date.now()}-${fallbackDraftSequence}`;
}

function enforceRetryDeadline(draft: PrivateCommentDraftProjection): void {
  const deadline = draft.retryNotBeforeUnixMs;
  if (
    draft.state !== 'COMMENT_RATE_LIMITED'
    && draft.publicationState !== 'COMMITTED_PENDING_READBACK'
  ) {
    return;
  }
  if (
    (!deadline && draft.state === 'COMMENT_RATE_LIMITED')
    || (deadline !== undefined && !Number.isSafeInteger(deadline))
    || (deadline !== undefined && deadline > Date.now())
  ) {
    throw new PrivateCommentsNativeError({
      code: deadline
        ? 'COMMENT_RATE_LIMITED'
        : 'COMMENT_RETRY_DEADLINE_MISSING',
      state: 'COMMENT_RATE_LIMITED',
      retryNotBeforeUnixMs: deadline,
    });
  }
}

function errorProjection(
  current: PrivateCommentDraftProjection,
  error: unknown,
): PrivateCommentDraftProjection {
  if (error instanceof PrivateCommentsNativeError) {
    const committedPendingReadback = error.code === 'COMMENT_READBACK_PENDING';
    const terminalPublication = [
      'COMMENT_PARENT_UNAVAILABLE',
      'SOCIAL_PRIVATE_CONFLICT',
      'SOCIAL_PRIVATE_NOT_FOUND',
      'SOCIAL_PRIVATE_UNAUTHORIZED',
    ].includes(error.code);
    return {
      ...current,
      text: committedPendingReadback ? '' : current.text,
      state: error.state,
      errorCode: error.code,
      retryAfterSeconds: error.retryAfterSeconds,
      retryNotBeforeUnixMs: error.retryNotBeforeUnixMs,
      publicationState: committedPendingReadback
        ? 'COMMITTED_PENDING_READBACK'
        : terminalPublication
          ? 'TERMINAL'
          : current.publicationState,
    };
  }
  return {
    ...current,
    state: 'COMMENT_FAILED',
    errorCode: 'COMMENT_FAILED',
  };
}

function latestActiveDrafts(
  drafts: PrivateCommentDraftProjection[],
): {
  draftsById: Record<string, PrivateCommentDraftProjection>;
  activeDraftByPost: Record<string, string>;
} {
  const draftsById: Record<string, PrivateCommentDraftProjection> = {};
  const activeDraftByPost: Record<string, string> = {};
  for (const draft of drafts) {
    const current = draftsById[draft.draftId];
    if (current && current.draftRevision >= draft.draftRevision) continue;
    draftsById[draft.draftId] = draft;
  }
  for (const draft of Object.values(draftsById)) {
    if (draft.state === 'COMMENT_POSTED') continue;
    const currentId = activeDraftByPost[draft.postId];
    const current = currentId ? draftsById[currentId] : undefined;
    if (!current || draft.draftRevision > current.draftRevision) {
      activeDraftByPost[draft.postId] = draft.draftId;
    }
  }
  return { draftsById, activeDraftByPost };
}

function mergeBootstrapDrafts(
  current: Record<string, PrivateCommentDraftProjection>,
  currentActiveByPost: Record<string, string>,
  snapshot: PrivateCommentDraftProjection[],
  mutatedPostIds: Set<string>,
): {
  draftsById: Record<string, PrivateCommentDraftProjection>;
  activeDraftByPost: Record<string, string>;
} {
  const snapshotState = latestActiveDrafts(snapshot);
  const merged = { ...snapshotState.draftsById };
  for (const draft of Object.values(current)) {
    if (mutatedPostIds.has(draft.postId)) {
      merged[draft.draftId] = draft;
    }
  }
  const activeDraftByPost = { ...snapshotState.activeDraftByPost };
  for (const postId of mutatedPostIds) {
    delete activeDraftByPost[postId];
    const currentDraftId = currentActiveByPost[postId];
    const currentDraft = currentDraftId ? merged[currentDraftId] : undefined;
    if (currentDraft && currentDraft.state !== 'COMMENT_POSTED') {
      activeDraftByPost[postId] = currentDraftId;
    }
  }
  return { draftsById: merged, activeDraftByPost };
}

export function selectPrivateCommentThread(
  state: Pick<PrivateCommentsState, 'threadsByPost'>,
  postId: string,
): PrivateCommentThread {
  return state.threadsByPost[postId] ?? EMPTY_THREAD;
}

export function selectPrivateCommentDraft(
  state: Pick<PrivateCommentsState, 'draftsById' | 'activeDraftByPost'>,
  postId: string,
): PrivateCommentDraftProjection | undefined {
  const draftId = state.activeDraftByPost[postId];
  return draftId ? state.draftsById[draftId] : undefined;
}

const EMPTY_THREAD: PrivateCommentThread = Object.freeze(emptyThread());

export const usePrivateCommentsStore = createDesktopStore<PrivateCommentsState>(
  'privateComments',
  (set, get) => {
    let draftMutationVersion = 0;
    const draftMutationVersionByPost = new Map<string, number>();
    const markDraftMutation = (postId: string): void => {
      draftMutationVersion += 1;
      draftMutationVersionByPost.set(postId, draftMutationVersion);
    };
    const applyDraft = (
      draft: PrivateCommentDraftProjection,
      actorPtid: string,
      rendererGeneration: number,
    ): boolean => {
      if (!isCurrentScope(get().scope, actorPtid, rendererGeneration)) return false;
      let applied = false;
      set((state) => {
        if (!isCurrentScope(state.scope, actorPtid, rendererGeneration)) return state;
        applied = true;
        const activeDraftByPost = { ...state.activeDraftByPost };
        if (draft.state === 'COMMENT_POSTED') {
          if (activeDraftByPost[draft.postId] === draft.draftId) {
            delete activeDraftByPost[draft.postId];
          }
        } else {
          activeDraftByPost[draft.postId] = draft.draftId;
        }
        return {
          draftsById: {
            ...state.draftsById,
            [draft.draftId]: draft,
          },
          activeDraftByPost,
        };
      });
      if (applied) markDraftMutation(draft.postId);
      return applied;
    };

    const applyComment = (
      comment: PrivateCommentProjection,
      actorPtid: string,
      rendererGeneration: number,
    ): void => {
      if (!isCurrentScope(get().scope, actorPtid, rendererGeneration)) return;
      set((state) => {
        if (!isCurrentScope(state.scope, actorPtid, rendererGeneration)) return state;
        const thread = state.threadsByPost[comment.postId] ?? emptyThread();
        if (thread.state === 'COMMENT_PARENT_UNAVAILABLE') return state;
        const existingIndex = thread.comments.findIndex(
          (item) => item.commentId === comment.commentId,
        );
        const comments = [...thread.comments];
        if (existingIndex >= 0) {
          comments[existingIndex] = newerComment(comments[existingIndex]!, comment);
        } else {
          comments.push(comment);
        }
        return {
          threadsByPost: {
            ...state.threadsByPost,
            [comment.postId]: {
              ...thread,
              comments,
              loaded: true,
              state: undefined,
              errorCode: undefined,
            },
          },
        };
      });
    };

    const applyPage = (
      page: PrivateCommentPage,
      refresh: boolean,
      actorPtid: string,
      rendererGeneration: number,
    ): boolean => {
      if (!isCurrentScope(get().scope, actorPtid, rendererGeneration)) return false;
      let applied = false;
      set((state) => {
        if (!isCurrentScope(state.scope, actorPtid, rendererGeneration)) return state;
        const current = state.threadsByPost[page.postId] ?? emptyThread();
        if (current.state === 'COMMENT_PARENT_UNAVAILABLE') return state;
        applied = true;
        const comments = refresh ? [] : [...current.comments];
        const indexById = new Map(
          comments.map((comment, index) => [comment.commentId, index]),
        );
        for (const comment of page.comments) {
          const index = indexById.get(comment.commentId);
          if (index === undefined) {
            indexById.set(comment.commentId, comments.length);
            comments.push(comment);
          } else {
            comments[index] = newerComment(comments[index]!, comment);
          }
        }
        return {
          threadsByPost: {
            ...state.threadsByPost,
            [page.postId]: {
              comments,
              nextCursor: page.nextCursor,
              hasMore: page.hasMore,
              loading: false,
              loaded: true,
            },
          },
        };
      });
      return applied;
    };

    const submitDraft = async (
      draft: PrivateCommentDraftProjection,
      actorPtid: string,
      rendererGeneration: number,
    ): Promise<void> => {
      try {
        const submitting = {
          ...draft,
          state: 'COMMENT_SUBMITTING' as const,
          errorCode: undefined,
          retryAfterSeconds: undefined,
          retryNotBeforeUnixMs: undefined,
        };
        if (!applyDraft(submitting, actorPtid, rendererGeneration)) {
          throw new PrivateCommentsNativeError({
            code: 'COMMENT_SESSION_STALE',
            state: 'COMMENT_FAILED',
          });
        }
        const result = await privateCommentsNative.submit({
          actorPtid,
          rendererGeneration,
          draftId: draft.draftId,
          draftRevision: draft.draftRevision,
        });
        applyDraft(result.draft, actorPtid, rendererGeneration);
        if (result.comment) {
          applyComment(result.comment, actorPtid, rendererGeneration);
        }
      } catch (error) {
        if (isCurrentScope(get().scope, actorPtid, rendererGeneration)) {
          applyDraft(errorProjection(draft, error), actorPtid, rendererGeneration);
          if (
            error instanceof PrivateCommentsNativeError
            && error.state === 'COMMENT_PARENT_UNAVAILABLE'
          ) {
            get().markParentUnavailable(draft.postId, error.code);
          }
        }
        throw error;
      }
    };

    return {
      ...initialData(),

      activateActor: (actorPtid, rendererGeneration) => {
        set({
          ...initialData(rendererGeneration),
          scope: {
            actorPtid,
            rendererGeneration,
            nativeSessionGeneration: null,
          },
        });
      },

      deactivate: (rendererGeneration) => {
        set(initialData(rendererGeneration));
      },

      bootstrap: async (rendererGeneration) => {
        const { actorPtid } = get().scope;
        if (
          !actorPtid
          || get().scope.rendererGeneration !== rendererGeneration
          || resolvePrivateMomentsPlatform() !== 'native'
        ) {
          return;
        }
        const draftMutationVersionAtStart = draftMutationVersion;
        const snapshot: PrivateCommentsNativeSnapshot =
          await privateCommentsNative.bootstrap({ actorPtid, rendererGeneration });
        if (
          !isCurrentScope(get().scope, actorPtid, rendererGeneration)
          || snapshot.actorPtid !== actorPtid
        ) {
          return;
        }
        set((state) => {
          if (!isCurrentScope(state.scope, actorPtid, rendererGeneration)) return state;
          if (
            state.scope.nativeSessionGeneration
            && compareGeneration(
              snapshot.sessionGeneration,
              state.scope.nativeSessionGeneration,
            ) < 0
          ) {
            return state;
          }
          const threadsByPost = { ...state.threadsByPost };
          for (const comment of snapshot.comments) {
            const thread = threadsByPost[comment.postId] ?? emptyThread();
            if (thread.state === 'COMMENT_PARENT_UNAVAILABLE') continue;
            const existingIndex = thread.comments.findIndex(
              (item) => item.commentId === comment.commentId,
            );
            const comments = [...thread.comments];
            if (existingIndex >= 0) {
              comments[existingIndex] = newerComment(comments[existingIndex]!, comment);
            } else {
              comments.push(comment);
            }
            threadsByPost[comment.postId] = { ...thread, comments };
          }
          const mutatedPostIds = new Set(
            [...draftMutationVersionByPost.entries()]
              .filter(([, version]) => version > draftMutationVersionAtStart)
              .map(([postId]) => postId),
          );
          const draftState = draftMutationVersion === draftMutationVersionAtStart
            ? latestActiveDrafts(snapshot.drafts)
            : mergeBootstrapDrafts(
              state.draftsById,
              state.activeDraftByPost,
              snapshot.drafts,
              mutatedPostIds,
            );
          return {
            scope: {
              ...state.scope,
              nativeSessionGeneration: snapshot.sessionGeneration,
            },
            ...draftState,
            threadsByPost,
          };
        });
      },

      reconcile: async (postIds, reason, rendererGeneration) => {
        const scope = get().scope;
        if (
          !scope.actorPtid
          || scope.rendererGeneration !== rendererGeneration
          || resolvePrivateMomentsPlatform() !== 'native'
        ) {
          return;
        }
        const uniquePostIds = [...new Set(postIds.map((id) => id.trim()).filter(Boolean))];
        log.info(TAG, 'private Comment reconciliation started', {
          reason,
          postCount: uniquePostIds.length,
        });
        await Promise.allSettled(
          uniquePostIds.map((postId) => get().loadComments(postId, true)),
        );
      },

      loadComments: async (postId, refresh = false) => {
        const trimmedPostId = postId.trim();
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
        if (!trimmedPostId || !actorPtid) return;
        if (resolvePrivateMomentsPlatform() !== 'native') {
          set((state) => ({
            threadsByPost: {
              ...state.threadsByPost,
              [trimmedPostId]: {
                ...(state.threadsByPost[trimmedPostId] ?? emptyThread()),
                loading: false,
                loaded: true,
                state: 'COMMENT_FAILED',
                errorCode: 'PRIVATE_UNSUPPORTED_ON_DEVICE',
              },
            },
          }));
          return;
        }
        const current = get().threadsByPost[trimmedPostId] ?? emptyThread();
        if (current.loading) return;
        if (current.state === 'COMMENT_PARENT_UNAVAILABLE') return;
        set((state) => ({
          threadsByPost: {
            ...state.threadsByPost,
            [trimmedPostId]: {
              ...(state.threadsByPost[trimmedPostId] ?? emptyThread()),
              loading: true,
              state: undefined,
              errorCode: undefined,
            },
          },
        }));
        try {
          const page = await privateCommentsNative.list({
            actorPtid,
            rendererGeneration: scope.rendererGeneration,
            postId: trimmedPostId,
            cursor: refresh ? '' : current.nextCursor,
            limit: 20,
          });
          applyPage(page, refresh, actorPtid, scope.rendererGeneration);
        } catch (error) {
          if (!isCurrentScope(get().scope, actorPtid, scope.rendererGeneration)) return;
          const nativeError = error instanceof PrivateCommentsNativeError ? error : undefined;
          log.warn(TAG, 'private Comment list failed', {
            postId: trimmedPostId,
            state: nativeError?.state ?? 'COMMENT_FAILED',
            errorCode: nativeError?.code ?? 'COMMENT_FAILED',
          });
          set((state) => {
            const currentThread = state.threadsByPost[trimmedPostId] ?? emptyThread();
            if (currentThread.state === 'COMMENT_PARENT_UNAVAILABLE') return state;
            return {
              threadsByPost: {
                ...state.threadsByPost,
                [trimmedPostId]: {
                  ...currentThread,
                  comments: nativeError?.state === 'COMMENT_PARENT_UNAVAILABLE'
                    ? []
                    : currentThread.comments,
                  loading: false,
                  loaded: true,
                  hasMore: false,
                  state: nativeError?.state ?? 'COMMENT_FAILED',
                  errorCode: nativeError?.code ?? 'COMMENT_FAILED',
                },
              },
            };
          });
          throw error;
        }
      },

      submitComment: async (postId, text, replyToCommentId, mentions = []) => {
        const trimmedPostId = postId.trim();
        const trimmedText = text.trim();
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
        if (!actorPtid || !trimmedPostId || !trimmedText) {
          throw new PrivateCommentsNativeError({
            code: 'COMMENT_DRAFT_INVALID',
            state: 'COMMENT_FAILED',
          });
        }
        const thread = get().threadsByPost[trimmedPostId];
        if (thread?.state === 'COMMENT_PARENT_UNAVAILABLE') {
          throw new PrivateCommentsNativeError({
            code: thread.errorCode ?? 'COMMENT_PARENT_UNAVAILABLE',
            state: 'COMMENT_PARENT_UNAVAILABLE',
          });
        }
        const activeId = get().activeDraftByPost[trimmedPostId];
        const active = activeId ? get().draftsById[activeId] : undefined;
        if (active) {
          enforceRetryDeadline(active);
          if (active.publicationState === 'COMMITTED_PENDING_READBACK') {
            throw new PrivateCommentsNativeError({
              code: 'COMMENT_READBACK_PENDING',
              state: 'COMMENT_FAILED',
            });
          }
          if ([
            'COMMENT_EDITING',
            'COMMENT_ENCRYPTING',
            'COMMENT_SUBMITTING',
          ].includes(active.state)) {
            throw new PrivateCommentsNativeError({
              code: 'COMMENT_BUSY',
              state: 'COMMENT_FAILED',
            });
          }
        }
        const intent: PrivateCommentIntent = {
          actorPtid,
          rendererGeneration: scope.rendererGeneration,
          draftId: active?.draftId ?? createDraftId(),
          draftRevision: active ? active.draftRevision + 1 : 1,
          postId: trimmedPostId,
          replyToCommentId: replyToCommentId?.trim(),
          text: trimmedText,
          mentions,
        };
        const optimistic: PrivateCommentDraftProjection = {
          draftId: intent.draftId,
          draftRevision: intent.draftRevision,
          postId: intent.postId,
          replyToCommentId: intent.replyToCommentId ?? '',
          text: intent.text,
          mentions: intent.mentions ?? [],
          state: 'COMMENT_EDITING',
        };
        applyDraft(optimistic, actorPtid, scope.rendererGeneration);
        try {
          const staged = await privateCommentsNative.stage(intent);
          if (!applyDraft(staged, actorPtid, scope.rendererGeneration)) return;
          if (!applyDraft(
            { ...staged, state: 'COMMENT_ENCRYPTING' },
            actorPtid,
            scope.rendererGeneration,
          )) return;
          const prepared = await privateCommentsNative.prepare(intent);
          if (!applyDraft(prepared, actorPtid, scope.rendererGeneration)) return;
          await submitDraft(prepared, actorPtid, scope.rendererGeneration);
        } catch (error) {
          if (isCurrentScope(get().scope, actorPtid, scope.rendererGeneration)) {
            const current = get().draftsById[intent.draftId] ?? optimistic;
            applyDraft(errorProjection(current, error), actorPtid, scope.rendererGeneration);
          }
          throw error;
        }
      },

      retryComment: async (postId) => {
        const scope = get().scope;
        const actorPtid = scope.actorPtid;
        const trimmedPostId = postId.trim();
        const thread = get().threadsByPost[trimmedPostId];
        if (thread?.state === 'COMMENT_PARENT_UNAVAILABLE') {
          throw new PrivateCommentsNativeError({
            code: thread.errorCode ?? 'COMMENT_PARENT_UNAVAILABLE',
            state: 'COMMENT_PARENT_UNAVAILABLE',
          });
        }
        const draft = selectPrivateCommentDraft(get(), trimmedPostId);
        if (!actorPtid || !draft) {
          throw new PrivateCommentsNativeError({
            code: 'COMMENT_DRAFT_FAILED',
            state: 'COMMENT_FAILED',
          });
        }
        if (!['COMMENT_FAILED', 'COMMENT_RATE_LIMITED'].includes(draft.state)) {
          throw new PrivateCommentsNativeError({
            code: 'COMMENT_RETRY_INVALID',
            state: 'COMMENT_FAILED',
          });
        }
        enforceRetryDeadline(draft);
        if (draft.publicationState === 'COMMITTED_PENDING_READBACK') {
          await submitDraft(draft, actorPtid, scope.rendererGeneration);
          return;
        }
        if (draft.publicationState === 'TERMINAL') {
          await get().submitComment(
            draft.postId,
            draft.text,
            draft.replyToCommentId,
            draft.mentions,
          );
          return;
        }
        const intent: PrivateCommentIntent = {
          actorPtid,
          rendererGeneration: scope.rendererGeneration,
          draftId: draft.draftId,
          draftRevision: draft.draftRevision,
          postId: draft.postId,
          replyToCommentId: draft.replyToCommentId,
          text: draft.text,
          mentions: draft.mentions,
        };
        applyDraft(
          {
            ...draft,
            state: 'COMMENT_ENCRYPTING',
            errorCode: undefined,
            retryAfterSeconds: undefined,
            retryNotBeforeUnixMs: undefined,
          },
          actorPtid,
          scope.rendererGeneration,
        );
        try {
          const prepared = await privateCommentsNative.prepare(intent);
          if (!applyDraft(prepared, actorPtid, scope.rendererGeneration)) return;
          await submitDraft(prepared, actorPtid, scope.rendererGeneration);
        } catch (error) {
          if (isCurrentScope(get().scope, actorPtid, scope.rendererGeneration)) {
            const current = get().draftsById[draft.draftId] ?? draft;
            applyDraft(errorProjection(current, error), actorPtid, scope.rendererGeneration);
          }
          throw error;
        }
      },

      markParentUnavailable: (postId, errorCode = 'COMMENT_PARENT_UNAVAILABLE') => {
        set((state) => ({
          threadsByPost: {
            ...state.threadsByPost,
            [postId]: {
              ...(state.threadsByPost[postId] ?? emptyThread()),
              comments: [],
              loading: false,
              loaded: true,
              hasMore: false,
              state: 'COMMENT_PARENT_UNAVAILABLE',
              errorCode,
            },
          },
        }));
      },

      clearPost: (postId) => {
        set((state) => {
          const threadsByPost = { ...state.threadsByPost };
          const activeDraftByPost = { ...state.activeDraftByPost };
          delete threadsByPost[postId];
          delete activeDraftByPost[postId];
          return { threadsByPost, activeDraftByPost };
        });
        markDraftMutation(postId);
      },

      reset: () => {
        draftMutationVersion += 1;
        draftMutationVersionByPost.clear();
        set(initialData());
      },
    };
  },
);
