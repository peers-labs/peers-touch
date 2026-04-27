import { create } from 'zustand';
import type { Post, PostAuthor } from '../gen/proto/domain/social/post_pb';
import type { Comment } from '../gen/proto/domain/social/comment_pb';

// ── Local placeholder types ────────────────────────────────────────
//
// These mirror the new proto messages added in P0
// (`Audience`, `ReactionKind`, `ReactionSummary`, `Mention`,
// `Circle`, `CircleMember`). The TS-side proto generator for the
// desktop has not been re-run yet — the existing `gen/proto/`
// snapshot still reflects the pre-P0 schema. Once the desktop TS
// gen pipeline is wired (separate tooling PR), the placeholder
// `MomentXxx` aliases below collapse to `import type { Xxx } from
// '../gen/proto/domain/social/...'` and every consumer keeps
// compiling unchanged.
//
// Keeping these here — and *not* re-defining `Post` / `Comment` /
// `PostAuthor` — is intentional: those messages already exist in
// the gen output, so importing them is the source-of-truth path.
// The aliases that follow are the *only* hand-written types in
// this scaffold, and they each carry a `// TODO P1: replace with
// generated import` comment so the swap is mechanical.

export type MomentAudienceKind =
  | 'public'
  | 'followers'
  | 'circle'
  | 'group'
  | 'self'
  | 'custom_allow'
  | 'custom_deny';

export type MomentReactionKind =
  | 'unspecified'
  | 'like'
  | 'love'
  | 'laugh'
  | 'wow'
  | 'celebrate';

// TODO P1: replace with generated import once `Audience` is in the
// desktop proto bundle.
export interface MomentAudience {
  kind: MomentAudienceKind;
  baseKind?: MomentAudienceKind;
  targetId?: string;
  actorDids?: string[];
}

// TODO P1: replace with generated import once `ReactionSummary` is
// in the desktop proto bundle.
export interface MomentReactionSummary {
  kind: MomentReactionKind;
  count: number;
  reactedByViewer: boolean;
}

// TODO P1: replace with generated import once `Mention` is in the
// desktop proto bundle.
export interface MomentMention {
  actorId: string;
  offset: number;
  length: number;
  display: string;
}

// TODO P1: replace with generated import once `Circle` is in the
// desktop proto bundle.
export interface MomentCircle {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  memberCount: number;
}

// TODO P1: replace with generated import once `CircleMember` is in
// the desktop proto bundle.
export interface MomentCircleMember {
  circleId: string;
  actorId: string;
  addedAt?: string;
}

// ── Store shape ────────────────────────────────────────────────────

/**
 * The five surface lists Moments cares about. `home` and `explore`
 * map 1:1 onto the proto-side `TimelineType.HOME / PUBLIC`. `user`
 * and `circle` are keyed feeds and live in `keyedFeeds`.
 */
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
  reactions: Record<string, MomentReactionSummary[]>;

  // Publisher's circles (publisher-private audience labels).
  circles: MomentCircle[];
  circleMembers: Record<string, MomentCircleMember[]>;

  // Composer draft — kept in store so navigation away keeps state.
  composerDraft: {
    text: string;
    audience: MomentAudience;
    mentions: MomentMention[];
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

  reactToPost: (postId: string, kind: MomentReactionKind) => Promise<void>;
  unreactToPost: (postId: string, kind: MomentReactionKind) => Promise<void>;

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
