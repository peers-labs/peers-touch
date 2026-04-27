import { create } from 'zustand';
import type {
  Audience,
  Mention,
  Post,
  PostAuthor,
  ReactionKind,
  ReactionSummary,
} from '../gen/proto/domain/social/post_pb';
import type { Comment } from '../gen/proto/domain/social/comment_pb';
import type { Circle, CircleMember } from '../gen/proto/domain/social/circle_pb';

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
}

const emptyFeed = (): MomentFeedState => ({
  postIds: [],
  nextCursor: '',
  hasMore: false,
  loading: false,
});

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
  commentsHasMore: Record<string, boolean>;
  commentsLoading: Record<string, boolean>;

  // Per-post reaction summary list.
  reactions: Record<string, ReactionSummary[]>;

  // Publisher's circles (publisher-private audience labels).
  circles: Circle[];
  circleMembers: Record<string, CircleMember[]>;

  // Composer draft — kept in store so navigation away keeps state.
  composerDraft: {
    text: string;
    audience: Audience;
    mentions: Mention[];
  } | null;

  // ── Actions (all P2 stubs) ───────────────────────────────────────
  // The signatures are deliberately narrow and proto-shaped so the
  // P2 service-layer wiring is a fill-in-the-body exercise, not a
  // signature redesign.

  loadFeed: (kind: MomentFeedKind, refresh?: boolean) => Promise<void>;
  loadCircleFeed: (circleId: string, refresh?: boolean) => Promise<void>;
  loadUserFeed: (actorId: string, refresh?: boolean) => Promise<void>;

  loadPost: (postId: string) => Promise<void>;
  createPost: (draft: NonNullable<MomentsState['composerDraft']>) => Promise<string>;
  deletePost: (postId: string) => Promise<void>;

  loadComments: (postId: string, cursor?: string) => Promise<void>;
  createComment: (postId: string, content: string, replyToCommentId?: string) => Promise<void>;
  deleteComment: (postId: string, commentId: string) => Promise<void>;

  reactToPost: (postId: string, kind: ReactionKind) => Promise<void>;
  unreactToPost: (postId: string, kind: ReactionKind) => Promise<void>;

  listMyCircles: () => Promise<void>;
  createCircle: (name: string, description?: string) => Promise<string>;
  renameCircle: (circleId: string, name: string) => Promise<void>;
  deleteCircle: (circleId: string) => Promise<void>;
  loadCircleMembers: (circleId: string) => Promise<void>;
  addCircleMember: (circleId: string, actorId: string) => Promise<void>;
  removeCircleMember: (circleId: string, actorId: string) => Promise<void>;

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
  | 'commentsHasMore'
  | 'commentsLoading'
  | 'reactions'
  | 'circles'
  | 'circleMembers'
  | 'composerDraft'
> = {
  postsById: {},
  authorsById: {},
  feeds: { home: emptyFeed(), explore: emptyFeed() },
  circleFeeds: {},
  userFeeds: {},
  comments: {},
  commentsHasMore: {},
  commentsLoading: {},
  reactions: {},
  circles: [],
  circleMembers: {},
  composerDraft: null,
};

// All async actions are P2 stubs. Signatures must remain stable so
// the P2 service-layer wiring is a fill-in exercise. Each stub
// returns the right resolved type without side effects.

const notImplemented = (name: string): never => {
  throw new Error(`moments.${name} is a P0 scaffold stub — wire in P2`);
};

export const useMomentsStore = create<MomentsState>((set) => ({
  ...initialState,

  loadFeed: async () => notImplemented('loadFeed'),
  loadCircleFeed: async () => notImplemented('loadCircleFeed'),
  loadUserFeed: async () => notImplemented('loadUserFeed'),

  loadPost: async () => notImplemented('loadPost'),
  createPost: async () => notImplemented('createPost'),
  deletePost: async () => notImplemented('deletePost'),

  loadComments: async () => notImplemented('loadComments'),
  createComment: async () => notImplemented('createComment'),
  deleteComment: async () => notImplemented('deleteComment'),

  reactToPost: async () => notImplemented('reactToPost'),
  unreactToPost: async () => notImplemented('unreactToPost'),

  listMyCircles: async () => notImplemented('listMyCircles'),
  createCircle: async () => notImplemented('createCircle'),
  renameCircle: async () => notImplemented('renameCircle'),
  deleteCircle: async () => notImplemented('deleteCircle'),
  loadCircleMembers: async () => notImplemented('loadCircleMembers'),
  addCircleMember: async () => notImplemented('addCircleMember'),
  removeCircleMember: async () => notImplemented('removeCircleMember'),

  setComposerDraft: (draft) => set({ composerDraft: draft }),
  clearComposerDraft: () => set({ composerDraft: null }),

  reset: () => set({ ...initialState }),
}));
