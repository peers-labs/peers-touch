import { createDesktopStore } from './createDesktopStore';
import { Audience_Kind } from '../gen/proto/domain/social/post_pb';
import type {
  Audience,
  FeedObjectExplanation,
  Mention,
  Post,
  PostAuthor,
  ReactionKind,
  ReactionSummary,
} from '../gen/proto/domain/social/post_pb';
import type { Comment } from '../gen/proto/domain/social/comment_pb';
import type { Circle, CircleMember } from '../gen/proto/domain/social/circle_pb';
import {
  socialCreateMoment,
  socialDeleteMoment,
  socialGetComments,
  publicCommentFromResource,
  socialGetMomentResponse,
  socialGetTimeline,
  socialSyncMomentsProjection,
  socialListByAuthor,
  socialReact,
  socialUnreact,
  socialCreateComment,
  socialDeleteComment,
  socialCircleCreate,
  socialCircleDelete,
  socialCircleListMembers,
  socialCircleListMine,
  socialCircleRename,
  socialCircleAddMembers,
  socialCircleRemoveMembers,
  type MomentDraft,
  type TimelineSort,
} from '../services/social_api';
import type { PrivateMomentLocalFileIntent } from '../services/privateMomentsNative';
import { usePrivateMomentsStore } from './privateMoments';
import { log } from '../utils/logger';

const TAG = 'moments-store';
const EMPTY_COMMENTS: Comment[] = [];
let storeGeneration = 0;

// All proto-shaped types in this store come straight from the
// `apps/desktop/src/gen/proto/domain/social/*` bundle, which is a
// derived product produced by `model/build.sh`. If any of these
// imports drift out of sync with `model/domain/social/*.proto`,
// re-run `./model/build.sh` from the repo root.
//
// The store still owns three things that have no proto analogue and
// must stay hand-written:
//   1. `MomentFeedKind` — the desktop-side classification of feed
//      surfaces (`home` / `explore`). Keyed feeds (per-circle,
//      per-actor) live in their own records and are scoped by id
//      strings rather than this enum.
//   2. `MomentFeedState` — pagination / loading book-keeping that is
//      pure UI concern; the wire protocol returns `next_cursor` /
//      `has_more` but everything else here is local.
//   3. The composer draft container — kept in store so navigating
//      away from the composer doesn't lose work in progress.

export type MomentFeedKind = 'home' | 'explore';

export interface MomentFeedState {
  postIds: string[];
  nextCursor: string;
  hasMore: boolean;
  loading: boolean;
  /** Last successful fetch — drives the `pull-to-refresh` UI. */
  loadedAt?: number;
  /** Active sort for explore-style feeds; HOME stays on `recent`. */
  sort?: TimelineSort;
}

export interface MomentComposerDraft {
  draftId: string;
  revision: number;
  text: string;
  audience: Audience;
  mentions: Mention[];
  files: PrivateMomentLocalFileIntent[];
}

const emptyFeed = (): MomentFeedState => ({
  postIds: [],
  nextCursor: '',
  hasMore: false,
  loading: false,
});

function privateAudienceKind(kind: Audience_Kind) {
  switch (kind) {
    case Audience_Kind.FRIENDS:
      return 'FRIENDS' as const;
    case Audience_Kind.FOLLOWERS:
      return 'FOLLOWERS' as const;
    case Audience_Kind.CIRCLE:
      return 'CIRCLE' as const;
    case Audience_Kind.GROUP:
      return 'GROUP' as const;
    case Audience_Kind.SELF:
      return 'SELF' as const;
    case Audience_Kind.CUSTOM_ALLOW:
      return 'CUSTOM_ALLOW' as const;
    case Audience_Kind.CUSTOM_DENY:
      return 'CUSTOM_DENY' as const;
    default:
      throw new Error('PRIVATE_AUDIENCE_INVALID');
  }
}

function privateAudienceBaseKind(kind: Audience_Kind) {
  if (kind === Audience_Kind.PUBLIC) return 'PUBLIC' as const;
  if (kind === Audience_Kind.FOLLOWERS) return 'FOLLOWERS' as const;
  return undefined;
}

export function selectMomentComments(
  state: { comments: Record<string, Comment[]> },
  postId: string,
): Comment[] {
  return state.comments[postId] ?? EMPTY_COMMENTS;
}

interface MomentsState {
  // Posts indexed by id; every feed list stores ids only.
  postsById: Record<string, Post>;
  authorsById: Record<string, PostAuthor>;

  // Two non-keyed feeds: home (followed + circles) and explore (public).
  feeds: Record<MomentFeedKind, MomentFeedState>;
  // Keyed feeds: per-circle and per-actor profile.
  circleFeeds: Record<string, MomentFeedState>;
  userFeeds: Record<string, MomentFeedState>;

  // Per-post threads, indexed by post id.
  comments: Record<string, Comment[]>;
  commentsCursor: Record<string, string>;
  commentsHasMore: Record<string, boolean>;
  commentsLoading: Record<string, boolean>;

  // Per-post reaction summary list. Sourced from `Post.reactions` on
  // every refresh — the explicit map exists so optimistic toggles in
  // the UI can patch a single post without re-rendering the whole feed.
  reactions: Record<string, ReactionSummary[]>;
  // Per-post viewer-scoped explanation projection returned by Station.
  feedExplanations: Record<string, FeedObjectExplanation>;

  // Publisher's circles (publisher-private audience labels).
  circles: Circle[];
  circlesLoading: boolean;
  circleMembers: Record<string, CircleMember[]>;

  // Composer draft — kept in store so navigation away keeps state.
  composerDraft: MomentComposerDraft | null;

  // ── Actions ─────────────────────────────────────────────────────

  loadFeed: (
    kind: MomentFeedKind,
    options?: { refresh?: boolean; sort?: TimelineSort },
  ) => Promise<void>;
  syncProjection: (reason: string) => Promise<void>;
  loadCircleFeed: (circleId: string, refresh?: boolean) => Promise<void>;
  loadUserFeed: (actorPtid: string, refresh?: boolean) => Promise<void>;

  loadPost: (postId: string) => Promise<Post | undefined>;
  createPost: (draft: MomentDraft) => Promise<string>;
  deletePost: (postId: string) => Promise<void>;

  loadComments: (postId: string, refresh?: boolean) => Promise<void>;
  createComment: (
    postId: string,
    content: string,
    replyToCommentId?: string,
  ) => Promise<void>;
  deleteComment: (postId: string, commentId: string) => Promise<void>;

  reactToPost: (postId: string, kind: ReactionKind) => Promise<void>;
  unreactToPost: (postId: string, kind?: ReactionKind) => Promise<void>;

  listMyCircles: () => Promise<void>;
  createCircle: (name: string, description?: string) => Promise<string>;
  renameCircle: (circleId: string, name: string, description?: string) => Promise<void>;
  deleteCircle: (circleId: string) => Promise<void>;
  loadCircleMembers: (circleId: string) => Promise<void>;
  addCircleMember: (circleId: string, actorPtid: string) => Promise<void>;
  removeCircleMember: (circleId: string, actorPtid: string) => Promise<void>;

  setComposerDraft: (draft: MomentsState['composerDraft']) => void;
  clearComposerDraft: () => void;

  /** Clear actor-scoped in-memory data on identity switch. */
  reset: () => void;
}

const initialState: Pick<
  MomentsState,
  | 'postsById'
  | 'authorsById'
  | 'feeds'
  | 'circleFeeds'
  | 'userFeeds'
  | 'comments'
  | 'commentsCursor'
  | 'commentsHasMore'
  | 'commentsLoading'
  | 'reactions'
  | 'feedExplanations'
  | 'circles'
  | 'circlesLoading'
  | 'circleMembers'
  | 'composerDraft'
> = {
  postsById: {},
  authorsById: {},
  feeds: { home: emptyFeed(), explore: emptyFeed() },
  circleFeeds: {},
  userFeeds: {},
  comments: {},
  commentsCursor: {},
  commentsHasMore: {},
  commentsLoading: {},
  reactions: {},
  feedExplanations: {},
  circles: [],
  circlesLoading: false,
  circleMembers: {},
  composerDraft: null,
};

/**
 * Merge a freshly-fetched batch of posts into the normalised maps.
 * Returns the ordered list of ids the caller should append to whichever
 * feed it was loading. Author hydration is opportunistic: if the post
 * carries an embedded `author`, we record it for cheap re-render of
 * future timeline items — otherwise the UI falls back to "Unknown".
 */
function ingestPosts(
  state: Pick<MomentsState, 'postsById' | 'authorsById' | 'reactions' | 'feedExplanations'>,
  posts: Post[],
  explanations: FeedObjectExplanation[] = [],
): {
  postsById: typeof state.postsById;
  authorsById: typeof state.authorsById;
  reactions: typeof state.reactions;
  feedExplanations: typeof state.feedExplanations;
  ids: string[];
} {
  const postsById = { ...state.postsById };
  const authorsById = { ...state.authorsById };
  const reactions = { ...state.reactions };
  const feedExplanations = { ...state.feedExplanations };
  const ids: string[] = [];
  for (const p of posts) {
    if (!p.id) continue;
    postsById[p.id] = p;
    if (p.author && p.author.id) {
      authorsById[p.author.id] = p.author;
    }
    if (p.reactions && p.reactions.length) {
      reactions[p.id] = p.reactions;
    }
    ids.push(p.id);
  }
  for (const explanation of explanations) {
    if (explanation.objectId) {
      feedExplanations[explanation.objectId] = explanation;
    }
  }
  return { postsById, authorsById, reactions, feedExplanations, ids };
}

function refreshProjectionBestEffort(store: MomentsState, reason: string): void {
  void store.syncProjection(reason).catch((err) => {
    log.warn(TAG, 'best-effort projection refresh failed', { reason, err: String(err) });
  });
}

export const useMomentsStore = createDesktopStore<MomentsState>('moments', (set, get) => ({
  ...initialState,

  // -------------------------------------------------------------------------
  // Feeds
  // -------------------------------------------------------------------------

  loadFeed: async (kind, options) => {
    const generation = storeGeneration;
    const refresh = options?.refresh ?? false;
    const sort = options?.sort ?? get().feeds[kind].sort ?? 'recent';
    const current = get().feeds[kind];
    if (current.loading) return;
    set((s) => ({
      feeds: { ...s.feeds, [kind]: { ...current, loading: true } },
    }));

    const wireKind = kind === 'home' ? 'HOME' : 'PUBLIC';
    const cursor = refresh ? '' : current.nextCursor;
    try {
      const resp = await socialGetTimeline(wireKind, cursor || undefined, undefined, sort);
      if (generation !== storeGeneration) return;
      set((s) => {
        const merged = ingestPosts(s, resp.posts, resp.explanations);
        const prevIds = refresh ? [] : s.feeds[kind].postIds;
        const seen = new Set(prevIds);
        const nextIds = [...prevIds, ...merged.ids.filter((id) => !seen.has(id))];
        return {
          postsById: merged.postsById,
          authorsById: merged.authorsById,
          reactions: merged.reactions,
          feedExplanations: merged.feedExplanations,
          feeds: {
            ...s.feeds,
            [kind]: {
              postIds: nextIds,
              nextCursor: resp.nextCursor,
              hasMore: resp.hasMore,
              loading: false,
              loadedAt: Date.now(),
              sort,
            },
          },
        };
      });
    } catch (err) {
      if (generation !== storeGeneration) return;
      log.warn(TAG, 'loadFeed failed', { kind, err: String(err) });
      set((s) => ({
        feeds: { ...s.feeds, [kind]: { ...s.feeds[kind], loading: false } },
      }));
      throw err;
    }
  },

  syncProjection: async (reason) => {
    const generation = storeGeneration;
    const currentExploreSort = get().feeds.explore.sort ?? 'recent';
    try {
      const resp = await socialSyncMomentsProjection({
        limit: 20,
        publicSort: currentExploreSort,
        reason,
      });
      if (generation !== storeGeneration) return;
      set((s) => {
        const home = resp.homeTimeline;
        const explore = resp.publicTimeline;
        const mergedHome = ingestPosts(s, home?.posts ?? [], home?.explanations ?? []);
        const mergedExplore = ingestPosts(mergedHome, explore?.posts ?? [], explore?.explanations ?? []);
        return {
          postsById: mergedExplore.postsById,
          authorsById: mergedExplore.authorsById,
          reactions: mergedExplore.reactions,
          feedExplanations: mergedExplore.feedExplanations,
          feeds: {
            home: {
              postIds: mergedHome.ids,
              nextCursor: home?.nextCursor ?? '',
              hasMore: home?.hasMore ?? false,
              loading: false,
              loadedAt: Date.now(),
              sort: 'recent',
            },
            explore: {
              postIds: mergedExplore.ids,
              nextCursor: explore?.nextCursor ?? '',
              hasMore: explore?.hasMore ?? false,
              loading: false,
              loadedAt: Date.now(),
              sort: currentExploreSort,
            },
          },
        };
      });
    } catch (err) {
      if (generation !== storeGeneration) return;
      log.warn(TAG, 'syncProjection failed', { reason, err: String(err) });
      throw err;
    }
  },

  loadCircleFeed: async (circleId, refresh = false) => {
    // Backend support for per-circle feed reads ships in P3 — the
    // server-side ActorResolver / GroupMembershipChecker is required
    // to enforce membership. Until then we return an empty,
    // explicitly-loaded feed so the UI shows a "Coming in P3" stub
    // rather than a perpetual spinner.
    const current = get().circleFeeds[circleId] ?? emptyFeed();
    set((s) => ({
      circleFeeds: {
        ...s.circleFeeds,
        [circleId]: {
          ...current,
          postIds: refresh ? [] : current.postIds,
          loading: false,
          loadedAt: Date.now(),
          hasMore: false,
          nextCursor: '',
        },
      },
    }));
    log.info(TAG, 'loadCircleFeed: noop (P3)', { circleId });
  },

  loadUserFeed: async (actorPtid, refresh = false) => {
    const generation = storeGeneration;
    const current = get().userFeeds[actorPtid] ?? emptyFeed();
    if (current.loading) return;
    set((s) => ({
      userFeeds: {
        ...s.userFeeds,
        [actorPtid]: { ...current, loading: true },
      },
    }));
    const cursor = refresh ? '' : current.nextCursor;
    try {
      const resp = await socialListByAuthor(actorPtid, cursor || undefined);
      if (generation !== storeGeneration) return;
      set((s) => {
        const merged = ingestPosts(s, resp.posts, resp.explanations);
        const prevIds = refresh ? [] : (s.userFeeds[actorPtid]?.postIds ?? []);
        const seen = new Set(prevIds);
        const nextIds = [...prevIds, ...merged.ids.filter((id) => !seen.has(id))];
        return {
          postsById: merged.postsById,
          authorsById: merged.authorsById,
          reactions: merged.reactions,
          feedExplanations: merged.feedExplanations,
          userFeeds: {
            ...s.userFeeds,
            [actorPtid]: {
              postIds: nextIds,
              nextCursor: resp.nextCursor,
              hasMore: resp.hasMore,
              loading: false,
              loadedAt: Date.now(),
            },
          },
        };
      });
    } catch (err) {
      if (generation !== storeGeneration) return;
      log.warn(TAG, 'loadUserFeed failed', { actorPtid, err: String(err) });
      set((s) => ({
        userFeeds: {
          ...s.userFeeds,
          [actorPtid]: { ...(s.userFeeds[actorPtid] ?? emptyFeed()), loading: false },
        },
      }));
      throw err;
    }
  },

  // -------------------------------------------------------------------------
  // Single-post operations
  // -------------------------------------------------------------------------

  loadPost: async (postId) => {
    const generation = storeGeneration;
    try {
      const resp = await socialGetMomentResponse(postId);
      if (generation !== storeGeneration) return undefined;
      const post = resp.post;
      if (!post) return undefined;
      set((s) => {
        const merged = ingestPosts(s, [post], resp.explanation ? [resp.explanation] : []);
        return {
          postsById: merged.postsById,
          authorsById: merged.authorsById,
          reactions: merged.reactions,
          feedExplanations: merged.feedExplanations,
        };
      });
      return post;
    } catch (err) {
      if (generation !== storeGeneration) return undefined;
      log.warn(TAG, 'loadPost failed', { postId, err: String(err) });
      throw err;
    }
  },

  createPost: async (draft) => {
    const generation = storeGeneration;
    if (
      draft.audience.kind !== Audience_Kind.PUBLIC
      && draft.audience.kind !== Audience_Kind.KIND_UNSPECIFIED
    ) {
      if (draft.kind !== 'text' && draft.kind !== 'image') {
        throw new Error('PRIVATE_UNSUPPORTED');
      }
      if (!draft.draftId || draft.draftRevision === undefined) {
        throw new Error('PRIVATE_DRAFT_IDENTITY_REQUIRED');
      }
      const result = await usePrivateMomentsStore.getState().publishMoment({
        draftId: draft.draftId,
        draftRevision: draft.draftRevision,
        audienceKind: privateAudienceKind(draft.audience.kind),
        audienceTargetId: draft.audience.targetId > 0n
          ? draft.audience.targetId.toString()
          : undefined,
        audienceBaseKind: privateAudienceBaseKind(draft.audience.baseKind),
        audienceActorPtids: draft.audience.actorPtids,
        momentKind: draft.kind === 'image' ? 'IMAGE' : 'TEXT',
        text: draft.text,
        files: draft.kind === 'image' ? draft.localFiles ?? [] : [],
      });
      if (generation !== storeGeneration) {
        throw new Error('MOMENTS_SESSION_STALE');
      }
      const postId = result.postId ?? result.projection?.postId;
      if (result.state !== 'PUBLISHED' || !postId) {
        throw new Error('UNKNOWN_COMMIT');
      }
      refreshProjectionBestEffort(get(), 'action:createPrivatePost');
      return postId;
    }
    if (draft.audience.kind !== Audience_Kind.PUBLIC) {
      throw new Error('PRIVATE_UNSUPPORTED');
    }

    const post = await socialCreateMoment(draft);
    if (generation !== storeGeneration) {
      throw new Error('MOMENTS_SESSION_STALE');
    }
    if (!post || !post.id) {
      throw new Error('createPost: server returned no post');
    }
    set((s) => {
      const merged = ingestPosts(s, [post]);
      // New post lands at the head of HOME; explore will pick it up
      // on the next refresh (server-side audience may exclude it).
      const homeIds = [post.id, ...s.feeds.home.postIds.filter((id) => id !== post.id)];
      return {
        postsById: merged.postsById,
        authorsById: merged.authorsById,
        reactions: merged.reactions,
        feedExplanations: merged.feedExplanations,
        feeds: {
          ...s.feeds,
          home: { ...s.feeds.home, postIds: homeIds },
        },
      };
    });
    refreshProjectionBestEffort(get(), 'action:createPost');
    return post.id;
  },

  deletePost: async (postId) => {
    const generation = storeGeneration;
    await socialDeleteMoment(postId);
    if (generation !== storeGeneration) return;
    try {
      await usePrivateMomentsStore.getState().purgeMoment(postId);
    } catch (error) {
      log.warn(TAG, 'Native private Moment purge failed after delete', {
        postId,
        error: String(error),
      });
    }
    set((s) => {
      const { [postId]: _drop, ...rest } = s.postsById;
      const { [postId]: _dropExplanation, ...feedExplanations } = s.feedExplanations;
      const filterIds = (ids: string[]) => ids.filter((id) => id !== postId);
      return {
        postsById: rest,
        feedExplanations,
        feeds: {
          home: { ...s.feeds.home, postIds: filterIds(s.feeds.home.postIds) },
          explore: { ...s.feeds.explore, postIds: filterIds(s.feeds.explore.postIds) },
        },
        userFeeds: Object.fromEntries(
          Object.entries(s.userFeeds).map(([k, v]) => [
            k,
            { ...v, postIds: filterIds(v.postIds) },
          ]),
        ),
        circleFeeds: Object.fromEntries(
          Object.entries(s.circleFeeds).map(([k, v]) => [
            k,
            { ...v, postIds: filterIds(v.postIds) },
          ]),
        ),
      };
    });
  },

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------

  loadComments: async (postId, refresh = false) => {
    const generation = storeGeneration;
    const loading = get().commentsLoading[postId];
    if (loading) return;
    set((s) => ({
      commentsLoading: { ...s.commentsLoading, [postId]: true },
    }));
    const cursor = refresh ? '' : (get().commentsCursor[postId] ?? '');
    try {
      const resp = await socialGetComments(postId, cursor || undefined);
      if (generation !== storeGeneration) return;
      const page = resp.comments.map(publicCommentFromResource);
      set((s) => {
        const prev = refresh ? [] : (s.comments[postId] ?? []);
        const seen = new Set(prev.map((c) => c.id));
        const merged = [...prev, ...page.filter((c) => !seen.has(c.id))];
        return {
          comments: { ...s.comments, [postId]: merged },
          commentsCursor: { ...s.commentsCursor, [postId]: resp.nextCursor },
          commentsHasMore: { ...s.commentsHasMore, [postId]: resp.hasMore },
          commentsLoading: { ...s.commentsLoading, [postId]: false },
        };
      });
    } catch (err) {
      if (generation !== storeGeneration) return;
      log.warn(TAG, 'loadComments failed', { postId, err: String(err) });
      set((s) => ({
        commentsLoading: { ...s.commentsLoading, [postId]: false },
      }));
      throw err;
    }
  },

  createComment: async (postId, content, replyToCommentId) => {
    const generation = storeGeneration;
    const comment = await socialCreateComment(postId, content, replyToCommentId);
    if (generation !== storeGeneration) return;
    if (!comment) return;
    set((s) => ({
      comments: {
        ...s.comments,
        [postId]: [...(s.comments[postId] ?? []), comment],
      },
    }));
    // Optimistically bump the on-card count so the user sees feedback
    // before the next timeline refresh. The authoritative count is
    // overwritten on the next `loadFeed` / `loadPost`.
    set((s) => {
      const post = s.postsById[postId];
      if (!post || !post.stats) return s;
      const stats = { ...post.stats };
      stats.commentsCount = (stats.commentsCount ?? 0n) + 1n;
      return {
        postsById: { ...s.postsById, [postId]: { ...post, stats } as Post },
      };
    });
  },

  deleteComment: async (postId, commentId) => {
    const generation = storeGeneration;
    await socialDeleteComment(commentId);
    if (generation !== storeGeneration) return;
    set((s) => ({
      comments: {
        ...s.comments,
        [postId]: (s.comments[postId] ?? []).filter((c) => c.id !== commentId),
      },
    }));
  },

  // -------------------------------------------------------------------------
  // Reactions
  // -------------------------------------------------------------------------

  reactToPost: async (postId, kind) => {
    const generation = storeGeneration;
    try {
      const resp = await socialReact(postId, kind);
      if (generation !== storeGeneration) return;
      // The server returns the post-wide reaction summary list; trust
      // that as the new source of truth instead of doing a local diff.
      set((s) => ({
        reactions: { ...s.reactions, [postId]: resp.reactions ?? [] },
      }));
    } catch (err) {
      if (generation !== storeGeneration) return;
      log.warn(TAG, 'reactToPost failed', { postId, kind, err: String(err) });
      throw err;
    }
  },

  unreactToPost: async (postId, kind) => {
    const generation = storeGeneration;
    try {
      const resp = await socialUnreact(postId, kind);
      if (generation !== storeGeneration) return;
      set((s) => ({
        reactions: { ...s.reactions, [postId]: resp.reactions ?? [] },
      }));
    } catch (err) {
      if (generation !== storeGeneration) return;
      log.warn(TAG, 'unreactToPost failed', { postId, kind, err: String(err) });
      throw err;
    }
  },

  // -------------------------------------------------------------------------
  // Circles
  // -------------------------------------------------------------------------

  listMyCircles: async () => {
    const generation = storeGeneration;
    if (get().circlesLoading) return;
    set({ circlesLoading: true });
    try {
      const resp = await socialCircleListMine();
      if (generation !== storeGeneration) return;
      set({ circles: resp.circles ?? [], circlesLoading: false });
    } catch (err) {
      if (generation !== storeGeneration) return;
      log.warn(TAG, 'listMyCircles failed', { err: String(err) });
      set({ circlesLoading: false });
      throw err;
    }
  },

  createCircle: async (name, description) => {
    const generation = storeGeneration;
    const resp = await socialCircleCreate(name, description);
    if (generation !== storeGeneration) {
      throw new Error('MOMENTS_SESSION_STALE');
    }
    if (!resp.circle) {
      throw new Error('createCircle: server returned no circle');
    }
    set((s) => ({ circles: [resp.circle as Circle, ...s.circles] }));
    return String(resp.circle.id ?? '');
  },

  renameCircle: async (circleId, name, description) => {
    const generation = storeGeneration;
    await socialCircleRename(circleId, name, description);
    if (generation !== storeGeneration) return;
    set((s) => ({
      circles: s.circles.map((c) =>
        String(c.id) === circleId
          ? ({ ...c, name, description: description ?? c.description } as Circle)
          : c,
      ),
    }));
  },

  deleteCircle: async (circleId) => {
    const generation = storeGeneration;
    await socialCircleDelete(circleId);
    if (generation !== storeGeneration) return;
    set((s) => ({
      circles: s.circles.filter((c) => String(c.id) !== circleId),
      circleMembers: Object.fromEntries(
        Object.entries(s.circleMembers).filter(([k]) => k !== circleId),
      ),
    }));
  },

  loadCircleMembers: async (circleId) => {
    const generation = storeGeneration;
    const resp = await socialCircleListMembers(circleId);
    if (generation !== storeGeneration) return;
    set((s) => ({
      circleMembers: { ...s.circleMembers, [circleId]: resp.members ?? [] },
    }));
  },

  addCircleMember: async (circleId, actorPtid) => {
    const generation = storeGeneration;
    await socialCircleAddMembers(circleId, [actorPtid]);
    if (generation !== storeGeneration) return;
    // Refresh members so the UI reflects the canonical server state
    // (server may dedupe / reject already-present DIDs silently).
    await get().loadCircleMembers(circleId);
  },

  removeCircleMember: async (circleId, actorPtid) => {
    const generation = storeGeneration;
    await socialCircleRemoveMembers(circleId, [actorPtid]);
    if (generation !== storeGeneration) return;
    set((s) => ({
      circleMembers: {
        ...s.circleMembers,
        [circleId]: (s.circleMembers[circleId] ?? []).filter(
          (m) => m.actorPtid !== actorPtid,
        ),
      },
    }));
  },

  // -------------------------------------------------------------------------
  // Composer draft + reset
  // -------------------------------------------------------------------------

  setComposerDraft: (draft) => set({ composerDraft: draft }),
  clearComposerDraft: () => set({ composerDraft: null }),

  reset: () => {
    storeGeneration += 1;
    set({ ...initialState });
  },
}));
