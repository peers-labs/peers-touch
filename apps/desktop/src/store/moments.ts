import { create, equals } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { createDesktopStore } from './createDesktopStore';
import {
  AudienceSchema,
  Audience_Kind,
  PostAuthorSchema,
  PostSchema,
  PostType,
  ReactionKind,
} from '../gen/proto/domain/social/post_pb';
import type {
  Audience,
  FeedObjectExplanation,
  Mention,
  Post,
  PostAuthor,
  ReactionSummary,
  GetMyMomentsStatsResponse,
} from '../gen/proto/domain/social/post_pb';
import type { Comment } from '../gen/proto/domain/social/comment_pb';
import type { Circle, CircleMember } from '../gen/proto/domain/social/circle_pb';
import {
  socialCreateMoment,
  socialDeleteMoment,
  socialDeletePrivateMoment,
  socialUpdateMomentText,
  socialGetComments,
  publicCommentFromResource,
  socialGetMomentResponse,
  socialGetTimeline,
  socialGetMyStats,
  socialSyncMomentsProjection,
  socialListByAuthor,
  socialReact,
  socialUnreact,
  socialCreateComment,
  socialDeleteComment,
  socialSetCommentLike,
  socialVotePoll,
  socialCircleCreate,
  socialCircleDelete,
  socialCircleRename,
  socialCircleAddMembers,
  socialCircleRemoveMembers,
  type MomentDraft,
  type TimelineSort,
} from '../services/social_api';
import type { StructuralMention } from '../services/social_api';
import type {
  PrivateMomentAudience,
  PrivateMomentLocalFileIntent,
  PrivateMomentProjection,
  PrivateMomentPublishIntent,
} from '../services/privateMomentsNative';
import { isReadablePrivateMomentProjection } from '../services/privateMomentsNative';
import { usePrivateMomentsStore } from './privateMoments';
import { log } from '../utils/logger';
import { resetPublicFeed } from '../services/publicFeedNative';
import { useSessionStore } from './session';
import { commentDraftKey, useSocialCommentDraftsStore } from './socialCommentDrafts';
import { loadAllSocialCircleMembers, loadAllSocialCircles } from '../services/socialCirclePages';
import { PollResultSchema } from '../gen/proto/domain/social/poll_pb';
import { pollFailureState, type PollCommand } from '../services/pollCommandState';

const TAG = 'moments-store';
const EMPTY_COMMENTS: Comment[] = [];
const MAX_PROTO_UINT64 = 18_446_744_073_709_551_615n;
let storeGeneration = 0;
let circlesRead: Promise<void> | null = null;
const circleMemberReads = new Map<string, Promise<void>>();
let circleCatalogVersion = 0;
const circleMembershipVersions = new Map<string, number>();

function invalidateCircleMembership(circleId: string): void {
  circleCatalogVersion += 1;
  circleMembershipVersions.set(circleId, (circleMembershipVersions.get(circleId) ?? 0) + 1);
}
interface PublicCommentRead {
  generation: number;
  cursor: string;
  refresh: boolean;
  anchorCommentId?: string;
  completion: Promise<void>;
}
const commentReads = new Map<string, PublicCommentRead>();
let activeCommentTarget: { postId: string; commentId?: string } | null = null;

// Per-post/per-kind reaction flights. A second click on the same kind
// while an identical intent is in flight is fenced (deduped) instead of
// issuing another command; the operation id is logged for correlation
// and drives per-kind pending UI in SocialActionBar.
const reactionFlights = new Map<string, Promise<void>>();
const pollFlights = new Map<string, Promise<void>>();

function reactionFlightKey(postId: string, kind: ReactionKind, direction: 'add' | 'remove'): string {
  return `${direction}:${postId}:${kind}`;
}

function makeReactionOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `reaction-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function runFencedReaction(
  postId: string,
  kind: ReactionKind | undefined,
  direction: 'add' | 'remove',
  operationId: string | undefined,
  task: (operationId: string) => Promise<void>,
): Promise<void> {
  const effectiveKind = kind ?? ReactionKind.REACTION_UNSPECIFIED;
  const key = reactionFlightKey(postId, effectiveKind, direction);
  const existing = reactionFlights.get(key);
  if (existing) {
    log.info(TAG, 'reaction intent fenced', {
      explicitCommand: Boolean(operationId),
      kind: effectiveKind,
      direction,
    });
    return existing;
  }
  const opposite = reactionFlightKey(postId, effectiveKind, direction === 'add' ? 'remove' : 'add');
  if (reactionFlights.has(opposite)) return Promise.reject(new Error('FEED_PENDING_ACK'));
  const id = operationId ?? makeReactionOperationId();
  log.info(TAG, 'reaction intent', {
    explicitCommand: Boolean(operationId),
    kind: effectiveKind,
    direction,
  });
  const flight = task(id).finally(() => {
    if (reactionFlights.get(key) === flight) reactionFlights.delete(key);
  });
  reactionFlights.set(key, flight);
  return flight;
}

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
  poll?: PrivateMomentPublishIntent['poll'];
}

const emptyFeed = (): MomentFeedState => ({
  postIds: [],
  nextCursor: '',
  hasMore: false,
  loading: false,
});

function privateMomentAudience(audience: Audience): PrivateMomentAudience {
  const hasActorList = audience.actorPtids.length > 0;
  const hasBaseKind = audience.baseKind !== Audience_Kind.KIND_UNSPECIFIED;
  const hasTarget = audience.target.case !== undefined;

  switch (audience.kind) {
    case Audience_Kind.FRIENDS:
      if (hasTarget || hasActorList || hasBaseKind) break;
      return { kind: 'FRIENDS' };
    case Audience_Kind.FOLLOWERS:
      if (hasTarget || hasActorList || hasBaseKind) break;
      return { kind: 'FOLLOWERS' };
    case Audience_Kind.CIRCLE: {
      if (
        audience.target.case !== 'circleId'
        || audience.target.value <= 0n
        || audience.target.value > MAX_PROTO_UINT64
        || hasActorList
        || hasBaseKind
      ) {
        break;
      }
      return {
        kind: 'CIRCLE',
        circleId: audience.target.value.toString(),
      };
    }
    case Audience_Kind.GROUP: {
      if (
        audience.target.case !== 'groupConversationId'
        || !audience.target.value
        || audience.target.value.trim() !== audience.target.value
        || audience.target.value.includes('\0')
        || hasActorList
        || hasBaseKind
      ) {
        break;
      }
      return {
        kind: 'GROUP',
        groupConversationId: audience.target.value,
      };
    }
    case Audience_Kind.SELF:
      if (hasTarget || hasActorList || hasBaseKind) break;
      return { kind: 'SELF' };
    case Audience_Kind.CUSTOM_ALLOW:
      if (hasTarget || !hasActorList || hasBaseKind) break;
      return {
        kind: 'CUSTOM_ALLOW',
        actorPtids: [...audience.actorPtids],
      };
    case Audience_Kind.CUSTOM_DENY:
      if (audience.baseKind !== Audience_Kind.FOLLOWERS) {
        break;
      }
      if (
        hasTarget
        || !hasActorList
      ) {
        break;
      }
      return {
        kind: 'CUSTOM_DENY',
        actorPtids: [...audience.actorPtids],
        baseKind: 'FOLLOWERS',
      };
  }

  throw new Error('PRIVATE_AUDIENCE_INVALID');
}

function privateMomentKind(
  draft: MomentDraft,
): PrivateMomentPublishIntent['momentKind'] {
  switch (draft.kind) {
    case 'text':
      return 'TEXT';
    case 'image':
      return 'IMAGE';
    case 'video':
      return 'VIDEO';
    case 'link':
      return 'LINK';
    case 'poll':
      return 'POLL';
    case 'repost':
      return 'REPOST';
    case 'location':
      return 'LOCATION';
  }
}

function privateMomentText(draft: MomentDraft): string {
  return draft.kind === 'repost' ? draft.comment : draft.text;
}

function privateMomentFiles(
  draft: MomentDraft,
): PrivateMomentLocalFileIntent[] {
  return draft.kind === 'image' || draft.kind === 'video'
    ? draft.localFiles ?? []
    : [];
}

export function privateMomentPublishIntent(
  draft: MomentDraft,
): Omit<PrivateMomentPublishIntent, 'actorPtid' | 'rendererGeneration'> {
  if (!draft.draftId || draft.draftRevision === undefined) {
    throw new Error('PRIVATE_DRAFT_IDENTITY_REQUIRED');
  }
  return {
    draftId: draft.draftId,
    draftRevision: draft.draftRevision,
    audience: privateMomentAudience(draft.audience),
    momentKind: privateMomentKind(draft),
    text: privateMomentText(draft),
    mentions: (draft.mentions ?? []).map((mention) => ({
      actorPtid: mention.actorPtid,
      offset: mention.offset,
      length: mention.length,
      display: mention.display,
    })),
    files: privateMomentFiles(draft),
    link: draft.kind === 'link' ? draft.link : undefined,
    location: draft.kind === 'location' ? draft.location : undefined,
    poll: draft.kind === 'poll'
      ? {
          question: draft.poll.question,
          options: draft.poll.options,
          minChoices: draft.poll.minChoices,
          maxChoices: draft.poll.maxChoices,
          expiresAtSeconds: draft.poll.expiresAtSeconds,
        }
      : undefined,
    repost: draft.kind === 'repost'
      ? { sourcePostId: draft.originalPostId }
      : undefined,
  };
}

const PRIVATE_AUDIENCE_KINDS: Record<
  PrivateMomentProjection['audienceKind'],
  Audience_Kind
> = {
  FRIENDS: Audience_Kind.FRIENDS,
  FOLLOWERS: Audience_Kind.FOLLOWERS,
  CIRCLE: Audience_Kind.CIRCLE,
  GROUP: Audience_Kind.GROUP,
  SELF: Audience_Kind.SELF,
  CUSTOM_ALLOW: Audience_Kind.CUSTOM_ALLOW,
  CUSTOM_DENY: Audience_Kind.CUSTOM_DENY,
  UNKNOWN: Audience_Kind.KIND_UNSPECIFIED,
};

function privateMomentPostType(
  projection: PrivateMomentProjection,
): PostType {
  switch (projection.content?.kind) {
    case 'IMAGE':
      return PostType.IMAGE;
    case 'VIDEO':
      return PostType.VIDEO;
    case 'LINK':
      return PostType.LINK;
    case 'POLL':
      return PostType.POLL;
    case 'REPOST':
      return PostType.REPOST;
    case 'LOCATION':
      return PostType.LOCATION;
    case 'TEXT':
    default:
      return PostType.TEXT;
  }
}

function privateMomentTimestamp(value: number | undefined) {
  return value !== undefined && Number.isFinite(value)
    ? timestampFromDate(new Date(value))
    : undefined;
}

function privateMomentPostShell(
  projection: PrivateMomentProjection,
): Post {
  return create(PostSchema, {
    id: projection.postId,
    authorPtid: projection.authorPtid,
    type: privateMomentPostType(projection),
    createdAt: privateMomentTimestamp(projection.createdAtMillis),
    updatedAt: privateMomentTimestamp(projection.updatedAtMillis),
    author: create(PostAuthorSchema, { id: projection.authorPtid }),
    audience: create(AudienceSchema, {
      kind: PRIVATE_AUDIENCE_KINDS[projection.audienceKind],
    }),
    reactions: projection.reactions ?? [],
  });
}

function postCreatedAtMillis(post: Post | undefined): number {
  if (!post?.createdAt) return 0;
  return Number(post.createdAt.seconds) * 1000
    + Math.floor(post.createdAt.nanos / 1_000_000);
}

function isPrivateMomentMutation(postId: string, post: Post | undefined): boolean {
  if (usePrivateMomentsStore.getState().postsById[postId]) return true;
  const audienceKind = post?.audience?.kind;
  return audienceKind !== undefined
    && audienceKind !== Audience_Kind.PUBLIC
    && audienceKind !== Audience_Kind.KIND_UNSPECIFIED;
}

function projectPrivateMoments(
  state: MomentsState,
  actorPtid: string | null,
  projections: readonly PrivateMomentProjection[],
): Partial<MomentsState> {
  if (!actorPtid) return {};
  const visible = projections.filter((projection) => (
    isReadablePrivateMomentProjection(projection)
    && projection.audienceKind !== 'UNKNOWN'
  ));
  if (visible.length === 0) return {};

  const postsById = { ...state.postsById };
  const reactions = { ...state.reactions };
  for (const projection of visible) {
    const post = privateMomentPostShell(projection);
    if (!projection.reactionsHydrated) {
      post.reactions = reactions[post.id] ?? postsById[post.id]?.reactions ?? [];
    }
    postsById[post.id] = post;
    if (projection.reactionsHydrated) {
      reactions[post.id] = post.reactions;
    }
  }
  const postIds = [
    ...new Set([
      ...visible.map((projection) => projection.postId),
      ...state.feeds.home.postIds,
    ]),
  ];
  postIds.sort(
    (left, right) => (
      postCreatedAtMillis(postsById[right])
      - postCreatedAtMillis(postsById[left])
    ),
  );
  return {
    postsById,
    reactions,
    feeds: {
      ...state.feeds,
      home: {
        ...state.feeds.home,
        postIds,
      },
    },
  };
}

export function selectMomentComments(
  state: { comments: Record<string, Comment[]> },
  postId: string,
): Comment[] {
  return state.comments[postId] ?? EMPTY_COMMENTS;
}

interface MomentsState {
  timelineSort: TimelineSort;
  setTimelineSort: (sort: TimelineSort) => void;
  myStats?: GetMyMomentsStatsResponse;
  myStatsLoading: boolean;
  loadMyStats: () => Promise<void>;
  publicFeedReadError: string | null;
  publicFeedRecoveryError: string | null;
  setPublicFeedRecoveryError: (error: string | null) => void;
  // Posts indexed by id; every feed list stores ids only.
  postsById: Record<string, Post>;
  authorsById: Record<string, PostAuthor>;

  // Two non-keyed feeds: home (followed + circles) and explore (public).
  feeds: Record<MomentFeedKind, MomentFeedState>;
  // Keyed feeds: per-circle and per-actor profile.
  userFeeds: Record<string, MomentFeedState>;

  // Per-post threads, indexed by post id.
  comments: Record<string, Comment[]>;
  commentsCursor: Record<string, string>;
  commentsHasMore: Record<string, boolean>;
  commentsLoading: Record<string, boolean>;
  commentReactionCommands: Record<string, { pending: boolean; error?: string }>;
  pollCommands: Record<string, PollCommand>;

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
  circleMembersErrors: Record<string, string>;

  // Composer draft — kept in store so navigation away keeps state.
  composerDraft: MomentComposerDraft | null;

  // ── Actions ─────────────────────────────────────────────────────

  loadFeed: (
    kind: MomentFeedKind,
    options?: { refresh?: boolean; sort?: TimelineSort },
  ) => Promise<void>;
  syncProjection: (reason: string) => Promise<void>;
  hydratePrivateMoments: (projections: readonly PrivateMomentProjection[]) => void;
  loadUserFeed: (actorPtid: string, refresh?: boolean) => Promise<void>;

  loadPost: (postId: string) => Promise<Post | undefined>;
  createPost: (draft: MomentDraft) => Promise<string>;
  updatePostText: (postId: string, text: string, operationId: string) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
  /**
   * Pure local eviction driven by an authoritative delete/revoke
   * event. Unlike `deletePost` it issues NO write command: it just
   * removes the entity and every reference (all feed windows,
   * reactions, explanations, comments, read caches) so a deleted
   * moment disappears immediately regardless of pagination tail.
   */
  evictPost: (postId: string) => void;

  loadComments: (postId: string, refresh?: boolean, anchorCommentId?: string) => Promise<void>;
  setCommentTarget: (postId?: string, commentId?: string) => void;
  createComment: (
    postId: string,
    content: string,
    replyToCommentId?: string,
    mentions?: StructuralMention[],
  ) => Promise<void>;
  deleteComment: (postId: string, commentId: string) => Promise<void>;
  setCommentLike: (postId: string, commentId: string, liked: boolean) => Promise<void>;
  votePoll: (postId: string, options: readonly number[]) => Promise<void>;
  retryPoll: (postId: string) => Promise<void>;

  /** Re-fetch only one post's reaction projection. Used by post-scoped
   * realtime wakeups so a reaction event never reloads feeds/threads. */
  refreshPostReactions: (postId: string) => Promise<void>;
  reactToPost: (postId: string, kind: ReactionKind, operationId?: string) => Promise<void>;
  unreactToPost: (postId: string, kind?: ReactionKind, operationId?: string) => Promise<void>;

  listMyCircles: (refresh?: boolean) => Promise<void>;
  createCircle: (name: string, description?: string) => Promise<string>;
  renameCircle: (circleId: string, name: string, description?: string) => Promise<void>;
  deleteCircle: (circleId: string) => Promise<void>;
  loadCircleMembers: (circleId: string, refresh?: boolean) => Promise<void>;
  addCircleMember: (circleId: string, actorPtid: string) => Promise<void>;
  removeCircleMember: (circleId: string, actorPtid: string) => Promise<void>;
  saveCircle: (circleId: string, name: string, description: string, memberPtids: string[]) => Promise<void>;

  setComposerDraft: (draft: MomentsState['composerDraft']) => void;
  clearComposerDraft: () => void;

  /** Clear actor-scoped in-memory data on identity switch. */
  reset: () => void;
}

const initialState: Pick<
  MomentsState,
  | 'timelineSort'
  | 'myStats'
  | 'myStatsLoading'
  | 'postsById'
  | 'authorsById'
  | 'feeds'
  | 'userFeeds'
  | 'comments'
  | 'commentsCursor'
  | 'commentsHasMore'
  | 'commentsLoading'
  | 'commentReactionCommands'
  | 'pollCommands'
  | 'reactions'
  | 'feedExplanations'
  | 'circles'
  | 'circlesLoading'
  | 'circleMembers'
  | 'circleMembersErrors'
  | 'composerDraft'
  | 'publicFeedReadError'
  | 'publicFeedRecoveryError'
> = {
  timelineSort: 'recent',
  myStats: undefined,
  myStatsLoading: false,
  publicFeedReadError: null,
  publicFeedRecoveryError: null,
  postsById: {},
  authorsById: {},
  feeds: { home: emptyFeed(), explore: emptyFeed() },
  userFeeds: {},
  comments: {},
  commentsCursor: {},
  commentsHasMore: {},
  commentsLoading: {},
  commentReactionCommands: {},
  pollCommands: {},
  reactions: {},
  feedExplanations: {},
  circles: [],
  circlesLoading: false,
  circleMembers: {},
  circleMembersErrors: {},
  composerDraft: null,
};

/**
 * Merge a freshly-fetched batch of posts into the normalised maps.
 * Returns the ordered list of ids the caller should append to whichever
 * feed it was loading. Author hydration is opportunistic: if the post
 * carries an embedded `author`, we record it for cheap re-render of
 * future timeline items — otherwise the UI falls back to "Unknown".
 */
// Same content revision keeps the existing Post entity reference so
// decoded media and component state stay stable across projection
// refreshes. Content revision is the server updatedAt timestamp plus
// the content oneof case.
function samePostRevision(existing: Post | undefined, incoming: Post): boolean {
  if (!existing) return false;
  const sameTimestamp = (existing.updatedAt?.seconds ?? 0n) === (incoming.updatedAt?.seconds ?? 0n)
    && (existing.updatedAt?.nanos ?? 0) === (incoming.updatedAt?.nanos ?? 0);
  return sameTimestamp
    && (existing.content?.case ?? '') === (incoming.content?.case ?? '');
}

function mergePostEntity(existing: Post | undefined, incoming: Post): Post {
  if (existing && samePostRevision(existing, incoming)) {
    // Authored revision is immutable across ballots. A changed verified result
    // must still repaint; unchanged periodic reads retain the same card.
    if (existing.content.case === 'pollPost' && incoming.content.case === 'pollPost') {
      const oldResult = existing.content.value.result, nextResult = incoming.content.value.result;
      if (oldResult && nextResult ? !equals(PollResultSchema, oldResult, nextResult) : oldResult !== nextResult) {
        return { ...existing, content: incoming.content };
      }
    }
    return existing;
  }
  return incoming;
}

function sameReactionSummaries(
  previous: ReactionSummary[],
  next: ReactionSummary[],
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((reaction, index) => {
    const candidate = next[index];
    return Boolean(candidate)
      && reaction.kind === candidate.kind
      && reaction.count === candidate.count
      && reaction.reactedByViewer === candidate.reactedByViewer;
  });
}

function sameFeedExplanation(
  previous: FeedObjectExplanation,
  next: FeedObjectExplanation,
): boolean {
  if (previous === next) return true;
  // Explanations are small, append-only protocol objects; a structural
  // compare keeps the parent reference (and thus memo card props) stable
  // across refreshes that carry identical content.
  return JSON.stringify(previous) === JSON.stringify(next);
}

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
  // Seed from incoming snapshots so an authoritative empty reactions
  // array overwrites stale counts; legacy posts omitting the field
  // simply keep the previous projection.
  const reactions = { ...state.reactions };
  const feedExplanations = { ...state.feedExplanations };
  const ids: string[] = [];
  for (const p of posts) {
    if (!p.id) continue;
    postsById[p.id] = mergePostEntity(postsById[p.id], p);
    if (p.author && p.author.id) {
      authorsById[p.author.id] = p.author;
    }
    if (Array.isArray(p.reactions)) {
      const previousReactions = reactions[p.id];
      reactions[p.id] = previousReactions
        && sameReactionSummaries(previousReactions, p.reactions)
        ? previousReactions
        : p.reactions;
    }
    ids.push(p.id);
  }
  for (const explanation of explanations) {
    if (explanation.objectId) {
      const previousExplanation = feedExplanations[explanation.objectId];
      feedExplanations[explanation.objectId] = previousExplanation
        && sameFeedExplanation(previousExplanation, explanation)
        ? previousExplanation
        : explanation;
    }
  }
  return { postsById, authorsById, reactions, feedExplanations, ids };
}

// First-window reconciliation replaces ordering/content of the first
// page but MUST NOT truncate a tail the user already paginated: window
// ids lead in authoritative order, surviving tail ids keep their
// previous order as long as the resource still exists. When the
// authoritative response reports hasMore=false the window is complete
// (bounded tail verification), so stale tail ids are dropped. Delete,
// revoke, and membership events likewise remove ids through their
// own paths.
function reconcileFeedWindow(
  previousIds: readonly string[],
  windowIds: readonly string[],
  readable: (id: string) => boolean,
  windowComplete = false,
): string[] {
  if (windowComplete) {
    return [...windowIds];
  }
  const windowSet = new Set(windowIds);
  const tail = previousIds.filter(
    (id) => !windowSet.has(id) && readable(id),
  );
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of [...windowIds, ...tail]) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

function refreshProjectionBestEffort(store: MomentsState, reason: string): void {
  void store.syncProjection(reason).catch((err) => {
    log.warn(TAG, 'best-effort projection refresh failed', { reason, err: String(err) });
  });
}

export const useMomentsStore = createDesktopStore<MomentsState>('moments', (set, get) => ({
  ...initialState,
  setTimelineSort: (sort) => set({ timelineSort: sort }),
  loadMyStats: async () => {
    if (get().myStatsLoading) return;
    const generation = storeGeneration;
    set({ myStatsLoading: true });
    try {
      const myStats = await socialGetMyStats();
      if (generation === storeGeneration) set({ myStats, myStatsLoading: false });
    } catch (error) {
      if (generation === storeGeneration) set({ myStats: undefined, myStatsLoading: false });
      throw error;
    }
  },
  setPublicFeedRecoveryError: (error) => set({ publicFeedRecoveryError: error }),

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
        const privateState = usePrivateMomentsStore.getState();
        const stillReadable = (id: string): boolean => Boolean(
          mergedExplore.postsById[id] ?? privateState.postsById[id],
        );
        // First-window reconcile keeps the authoritative window
        // ordering but preserves already-paginated tails until a
        // delete/revoke event removes them.
        const reconciledHomeIds = reconcileFeedWindow(
          s.feeds.home.postIds,
          mergedHome.ids,
          stillReadable,
          home?.hasMore === false,
        );
        const reconciledExploreIds = reconcileFeedWindow(
          s.feeds.explore.postIds,
          mergedExplore.ids,
          stillReadable,
          explore?.hasMore === false,
        );
        const withPrivateMoments = projectPrivateMoments(
          {
            ...s,
            postsById: mergedExplore.postsById,
            authorsById: mergedExplore.authorsById,
            reactions: mergedExplore.reactions,
            feedExplanations: mergedExplore.feedExplanations,
            feeds: {
              home: {
                postIds: reconciledHomeIds,
                nextCursor: home?.nextCursor ?? '',
                hasMore: home?.hasMore ?? false,
                loading: false,
                loadedAt: Date.now(),
                sort: 'recent',
              },
              explore: {
                postIds: reconciledExploreIds,
                nextCursor: explore?.nextCursor ?? '',
                hasMore: explore?.hasMore ?? false,
                loading: false,
                loadedAt: Date.now(),
                sort: currentExploreSort,
              },
            },
          },
          privateState.scope.actorPtid,
          Object.values(privateState.postsById),
        );
        return {
          publicFeedReadError: null,
          postsById: mergedExplore.postsById,
          authorsById: mergedExplore.authorsById,
          reactions: mergedExplore.reactions,
          feedExplanations: mergedExplore.feedExplanations,
          feeds: {
            home: {
              postIds: reconciledHomeIds,
              nextCursor: home?.nextCursor ?? '',
              hasMore: home?.hasMore ?? false,
              loading: false,
              loadedAt: Date.now(),
              sort: 'recent',
            },
            explore: {
              postIds: reconciledExploreIds,
              nextCursor: explore?.nextCursor ?? '',
              hasMore: explore?.hasMore ?? false,
              loading: false,
              loadedAt: Date.now(),
              sort: currentExploreSort,
            },
          },
          ...withPrivateMoments,
        };
      });
    } catch (err) {
      if (generation !== storeGeneration) return;
      log.warn(TAG, 'syncProjection failed', { reason, err: String(err) });
      set({ publicFeedReadError: String(err) });
      throw err;
    }
  },

  hydratePrivateMoments: (projections) => {
    const privateState = usePrivateMomentsStore.getState();
    set((state) => projectPrivateMoments(
      state,
      privateState.scope.actorPtid,
      projections,
    ));
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
      log.warn(TAG, 'loadUserFeed failed', { err: String(err) });
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
      log.warn(TAG, 'loadPost failed', { err: String(err) });
      throw err;
    }
  },

  createPost: async (draft) => {
    const generation = storeGeneration;
    if (
      draft.audience.kind !== Audience_Kind.PUBLIC
      && draft.audience.kind !== Audience_Kind.KIND_UNSPECIFIED
    ) {
      const result = await usePrivateMomentsStore.getState().publishMoment(
        privateMomentPublishIntent(draft),
      );
      if (generation !== storeGeneration) {
        throw new Error('MOMENTS_SESSION_STALE');
      }
      const postId = result.postId ?? result.projection?.postId;
      if (
        ![
          'PUBLISHED',
          'REMOTE_DELIVERY_PENDING',
          'REMOTE_DELIVERY_RETRYING',
        ].includes(result.state)
        || !postId
      ) {
        throw new Error('UNKNOWN_COMMIT');
      }
      const projection = result.projection;
      if (projection) {
        set((state) => ({
          ...state,
          ...projectPrivateMoments(
            state,
            projection.authorPtid,
            [projection],
          ),
        }));
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

  updatePostText: async (postId, text, operationId) => {
    const generation = storeGeneration;
    const current = get().postsById[postId];
    if (!current || current.audience?.kind !== Audience_Kind.PUBLIC) {
      throw new Error('FEED_PROJECTION_UNVERIFIED');
    }
    const post = await socialUpdateMomentText(postId, text, operationId);
    if (generation !== storeGeneration) throw new Error('MOMENTS_SESSION_STALE');
    set((state) => {
      const merged = ingestPosts(state, [post]);
      return {
        postsById: merged.postsById,
        authorsById: merged.authorsById,
        reactions: merged.reactions,
        feedExplanations: merged.feedExplanations,
      };
    });
    refreshProjectionBestEffort(get(), 'action:updatePost');
  },

  deletePost: async (postId) => {
    const generation = storeGeneration;
    if (isPrivateMomentMutation(postId, get().postsById[postId])) {
      await socialDeletePrivateMoment(postId);
    } else await socialDeleteMoment(postId);
    if (generation !== storeGeneration) return;
    try {
      await usePrivateMomentsStore.getState().purgeMoment(postId);
    } catch (error) {
      log.warn(TAG, 'Native private Moment purge failed after delete', {
        error: String(error),
      });
    }
    // Local reference removal is shared with event-driven eviction.
    get().evictPost(postId);
  },

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------

  evictPost: (postId) => {
    postId = postId.trim();
    if (!postId) return;
    commentReads.delete(postId);
    if (activeCommentTarget?.postId === postId) activeCommentTarget = null;
    set((s) => {
      const { [postId]: _dropPost, ...postsById } = s.postsById;
      const { [postId]: _dropPoll, ...pollCommands } = s.pollCommands;
      const { [postId]: _dropReaction, ...reactions } = s.reactions;
      const { [postId]: _dropExplanation, ...feedExplanations } = s.feedExplanations;
      const { [postId]: _dropComments, ...comments } = s.comments;
      const { [postId]: _dropLoading, ...commentsLoadingState } = s.commentsLoading;
      const { [postId]: _dropCursor, ...commentsCursorState } = s.commentsCursor;
      const { [postId]: _dropHasMore, ...commentsHasMoreState } = s.commentsHasMore;
      void _dropPost; void _dropPoll; void _dropReaction; void _dropExplanation;
      void _dropComments; void _dropLoading; void _dropCursor; void _dropHasMore;
      const filterIds = (ids: string[]) => ids.filter((id) => id !== postId);
      return {
        postsById,
        pollCommands,
        reactions,
        feedExplanations,
        comments,
        commentsLoading: commentsLoadingState,
        commentsCursor: commentsCursorState,
        commentsHasMore: commentsHasMoreState,
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
      };
    });
  },

  setCommentTarget: (postId, commentId) => {
    const nextPostId = postId?.trim();
    const nextCommentId = commentId?.trim() || undefined;
    if (activeCommentTarget?.postId === nextPostId && activeCommentTarget?.commentId === nextCommentId) return;
    const previous = activeCommentTarget?.postId;
    activeCommentTarget = nextPostId ? { postId: nextPostId, commentId: nextCommentId } : null;
    for (const id of new Set([previous, nextPostId])) {
      if (!id) continue;
      commentReads.delete(id);
      set(state => state.commentsLoading[id]
        ? { commentsLoading: { ...state.commentsLoading, [id]: false } } : state);
    }
  },

  loadComments: async (postId, refresh = false, anchorCommentId) => {
    postId = postId.trim();
    if (!postId) return;
    const generation = storeGeneration;
    const anchor = anchorCommentId?.trim()
      || (refresh && activeCommentTarget?.postId === postId ? activeCommentTarget.commentId : undefined);
    const replace = refresh || !!anchor;
    const cursor = replace ? '' : (get().commentsCursor[postId] ?? '');
    const current = (read: PublicCommentRead) =>
      read.generation === storeGeneration && commentReads.get(postId) === read;
    const pending = commentReads.get(postId);
    if (pending && current(pending) && pending.cursor === cursor
      && pending.refresh === replace && pending.anchorCommentId === anchor) return pending.completion;
    const completion = Promise.resolve().then(async () => {
      if (!current(read)) return;
      try {
        const resp = await socialGetComments(postId, cursor || undefined, 20, anchor);
        if (!current(read)) return;
        const page = resp.comments.map(publicCommentFromResource);
        set((s) => {
          const prev = replace ? [] : (s.comments[postId] ?? []);
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
        if (!current(read)) return;
        log.warn(TAG, 'loadComments failed', { err: String(err) });
        set((s) => ({
          commentsLoading: { ...s.commentsLoading, [postId]: false },
        }));
        throw err;
      } finally {
        if (commentReads.get(postId) === read) commentReads.delete(postId);
      }
    });
    const read: PublicCommentRead = {
      generation, cursor, refresh: replace, anchorCommentId: anchor, completion,
    };
    // Register completion before notifying reentrant projection subscribers.
    commentReads.set(postId, read);
    set((s) => ({
      commentsLoading: { ...s.commentsLoading, [postId]: true },
    }));
    return completion;
  },

  createComment: async (postId, content, replyToCommentId, mentions = []) => {
    const generation = storeGeneration;
    const session = useSessionStore.getState();
    const retained = useSocialCommentDraftsStore.getState().drafts[
      commentDraftKey(session.currentUser?.actorPtid, session.sessionEpoch, postId)
    ];
    const operationId = retained?.draftId ? `comment:${retained.draftId}:${retained.revision ?? 0}` : undefined;
    const comment = await socialCreateComment(
      postId,
      content,
      replyToCommentId,
      mentions,
      operationId,
    );
    if (generation !== storeGeneration) return;
    if (!comment) return;
    if ((get().comments[postId] ?? []).some(existing => existing.id === comment.id)) return;
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
    refreshProjectionBestEffort(get(), 'action:createComment');
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

  setCommentLike: (postId, commentId, liked) => runFencedReaction(
    `comment:${postId}:${commentId}`, ReactionKind.REACTION_LIKE, liked ? 'add' : 'remove', undefined,
    async operationId => {
      const generation = storeGeneration;
      const target = (get().comments[postId] ?? []).find(comment => comment.id === commentId);
      if (!target || target.isDeleted) throw new Error('FEED_PROJECTION_UNVERIFIED');
      set(state => ({ commentReactionCommands: { ...state.commentReactionCommands, [commentId]: { pending: true } } }));
      try {
        const confirmed = await socialSetCommentLike(postId, commentId, liked, operationId);
        if (generation !== storeGeneration) return;
        set(state => ({
          comments: { ...state.comments, [postId]: (state.comments[postId] ?? [])
            .map(comment => comment.id === commentId ? { ...comment, ...confirmed } : comment) },
          commentReactionCommands: { ...state.commentReactionCommands, [commentId]: { pending: false } },
        }));
      } catch (error) {
        if (generation !== storeGeneration) return;
        set(state => ({ commentReactionCommands: { ...state.commentReactionCommands,
          [commentId]: { pending: false, error: String(error) } } }));
        throw error;
      }
    },
  ),

  // -------------------------------------------------------------------------
  // Reactions
  // -------------------------------------------------------------------------

  votePoll: (postId, options) => {
    if (isPrivateMomentMutation(postId, get().postsById[postId])) {
      return usePrivateMomentsStore.getState().votePoll(postId, options).then(() => undefined);
    }
    const retained = get().pollCommands[postId];
    const same = retained?.options.length === options.length
      && retained.options.every((option, index) => option === options[index]);
    const unresolved = retained && !['committed', 'rejected'].includes(retained.state);
    if (unresolved && !same) return Promise.reject(new Error('FEED_POLL_ADMISSION_PENDING'));
    const existing = pollFlights.get(postId);
    if (existing) return existing;
    const post = get().postsById[postId];
    if (!post || post.isDeleted || post.content.case !== 'pollPost' || !post.publicFeedRef) {
      return Promise.reject(new Error('FEED_POLL_NOT_POLL'));
    }
    const generation = storeGeneration;
    const command: PollCommand = {
      operationId: unresolved && same ? retained.operationId : makeReactionOperationId(),
      options: [...options], state: 'pending',
    };
    set(state => ({ pollCommands: { ...state.pollCommands, [postId]: command } }));
    const flight = socialVotePoll(postId, command.options, command.operationId).then(result => {
      if (generation !== storeGeneration) return;
      set(state => {
        const current = state.postsById[postId];
        if (!current || current.isDeleted || current.content.case !== 'pollPost') return {};
        return {
          postsById: { ...state.postsById, [postId]: { ...current,
            content: { case: 'pollPost', value: { ...current.content.value, result } } } },
          pollCommands: { ...state.pollCommands, [postId]: { ...command, state: 'committed' } },
        };
      });
    }).catch(error => {
      if (generation !== storeGeneration) return;
      if (!get().postsById[postId]) return;
      set(state => ({ pollCommands: { ...state.pollCommands, [postId]: {
        ...command, state: pollFailureState(error), error: String(error),
      } } }));
      throw error;
    }).finally(() => {
      if (pollFlights.get(postId) === flight) pollFlights.delete(postId);
    });
    pollFlights.set(postId, flight);
    return flight;
  },

  retryPoll: (postId) => {
    if (isPrivateMomentMutation(postId, get().postsById[postId])) {
      return usePrivateMomentsStore.getState().retryReaction(postId, '', ReactionKind.REACTION_UNSPECIFIED)
        .then(() => undefined);
    }
    const retained = get().pollCommands[postId];
    if (!retained) return Promise.reject(new Error('FEED_POLL_TARGET_UNAVAILABLE'));
    return get().votePoll(postId, retained.options);
  },

  refreshPostReactions: async (postId) => {
    const generation = storeGeneration;
    // Post-scoped wakeup: only this post's reaction summary is
    // re-fetched; feeds and comment threads stay untouched.
    const post = get().postsById[postId];
    if (isPrivateMomentMutation(postId, post)) {
      await usePrivateMomentsStore.getState().readMoment(postId);
      return;
    }
    await get().loadPost(postId);
    if (generation !== storeGeneration) return;
  },

  reactToPost: (postId, kind, operationId) => runFencedReaction(
    postId,
    kind,
    'add',
    operationId,
    async commandId => {
      const generation = storeGeneration;
      try {
        const post = get().postsById[postId];
        if (isPrivateMomentMutation(postId, post)) {
          const result = await usePrivateMomentsStore
            .getState()
            .setReaction(postId, kind, 'REACT');
          if (generation !== storeGeneration) return;
          set((state) => ({
            reactions: {
              ...state.reactions,
              [postId]: result.reactions,
            },
          }));
          return;
        }
        const resp = await socialReact(postId, kind, commandId);
        if (generation !== storeGeneration) return;
        // The server returns the post-wide reaction summary list; trust
        // that as the new source of truth instead of doing a local diff.
        set((s) => ({
          reactions: { ...s.reactions, [postId]: resp.reactions ?? [] },
        }));
      } catch (err) {
        if (generation !== storeGeneration) return;
        log.warn(TAG, 'reactToPost failed', { kind, err: String(err) });
        throw err;
      }
    },
  ),

  unreactToPost: (postId, kind, operationId) => runFencedReaction(
    postId,
    kind,
    'remove',
    operationId,
    async commandId => {
      const generation = storeGeneration;
      try {
        const post = get().postsById[postId];
        if (isPrivateMomentMutation(postId, post)) {
          const result = await usePrivateMomentsStore
            .getState()
            .setReaction(
              postId,
              kind ?? ReactionKind.REACTION_UNSPECIFIED,
              'UNREACT',
            );
          if (generation !== storeGeneration) return;
          set((state) => ({
            reactions: {
              ...state.reactions,
              [postId]: result.reactions,
            },
          }));
          return;
        }
        const resp = await socialUnreact(postId, kind, commandId);
        if (generation !== storeGeneration) return;
        set((s) => ({
          reactions: { ...s.reactions, [postId]: resp.reactions ?? [] },
        }));
      } catch (err) {
        if (generation !== storeGeneration) return;
        log.warn(TAG, 'unreactToPost failed', { kind, err: String(err) });
        throw err;
      }
    },
  ),

  // -------------------------------------------------------------------------
  // Circles
  // -------------------------------------------------------------------------

  listMyCircles: async (refresh = false) => {
    const generation = storeGeneration;
    if (circlesRead) {
      if (refresh) await circlesRead.catch(() => {});
      else await circlesRead;
      if (!refresh || generation !== storeGeneration) return;
    }
    const version = circleCatalogVersion;
    const assertScope = () => {
      if (generation !== storeGeneration) throw new Error('MOMENTS_SESSION_STALE');
      if (version !== circleCatalogVersion) throw new Error('CIRCLE_READ_SUPERSEDED');
    };
    set({ circlesLoading: true });
    const read = loadAllSocialCircles(assertScope).then(circles => {
      assertScope();
      const ids = new Set(circles.map(circle => String(circle.id)));
      set(s => ({
        circles, circlesLoading: false,
        circleMembers: Object.fromEntries(Object.entries(s.circleMembers).filter(([id]) => ids.has(id))),
        circleMembersErrors: Object.fromEntries(Object.entries(s.circleMembersErrors).filter(([id]) => ids.has(id))),
      }));
    }).catch(err => {
      if (generation === storeGeneration) {
        log.warn(TAG, 'listMyCircles failed', { err: String(err) });
        set({ circlesLoading: false });
      }
      throw err;
    }).finally(() => { if (circlesRead === read) circlesRead = null; });
    circlesRead = read;
    await read;
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
    circleCatalogVersion += 1;
    set((s) => ({ circles: [resp.circle as Circle, ...s.circles] }));
    return String(resp.circle.id ?? '');
  },

  renameCircle: async (circleId, name, description) => {
    const generation = storeGeneration;
    const response = await socialCircleRename(circleId, name, description);
    if (generation !== storeGeneration) return;
    if (!response.circle || String(response.circle.id) !== circleId) {
      throw new Error('CIRCLE_PROJECTION_INVALID');
    }
    circleCatalogVersion += 1;
    set((s) => ({
      circles: s.circles.map((c) =>
        String(c.id) === circleId ? response.circle as Circle : c,
      ),
    }));
  },

  deleteCircle: async (circleId) => {
    const generation = storeGeneration;
    await socialCircleDelete(circleId);
    if (generation !== storeGeneration) return;
    invalidateCircleMembership(circleId);
    set((s) => ({
      circles: s.circles.filter((c) => String(c.id) !== circleId),
      circleMembers: Object.fromEntries(
        Object.entries(s.circleMembers).filter(([k]) => k !== circleId),
      ),
    }));
  },

  loadCircleMembers: async (circleId, refresh = false) => {
    const generation = storeGeneration;
    const previous = circleMemberReads.get(circleId);
    if (previous) {
      if (refresh) await previous.catch(() => {});
      else await previous;
      if (!refresh) return;
    }
    const version = circleMembershipVersions.get(circleId) ?? 0;
    const assertScope = () => {
      if (generation !== storeGeneration) throw new Error('MOMENTS_SESSION_STALE');
      if (version !== (circleMembershipVersions.get(circleId) ?? 0)) throw new Error('CIRCLE_READ_SUPERSEDED');
    };
    assertScope();
    const read = loadAllSocialCircleMembers(circleId, assertScope).then(members => {
      assertScope();
      if (!get().circles.some(circle => String(circle.id) === circleId)) return;
      set(s => ({
        circleMembers: { ...s.circleMembers, [circleId]: members },
        circleMembersErrors: Object.fromEntries(Object.entries(s.circleMembersErrors).filter(([id]) => id !== circleId)),
      }));
    }).catch(error => {
      if (generation === storeGeneration && version === (circleMembershipVersions.get(circleId) ?? 0)) set(s => ({
        circleMembersErrors: { ...s.circleMembersErrors, [circleId]: String(error) },
      }));
      throw error;
    }).finally(() => { if (circleMemberReads.get(circleId) === read) circleMemberReads.delete(circleId); });
    circleMemberReads.set(circleId, read);
    await read;
  },

  addCircleMember: async (circleId, actorPtid) => {
    const generation = storeGeneration;
    await socialCircleAddMembers(circleId, [actorPtid]);
    if (generation !== storeGeneration) return;
    invalidateCircleMembership(circleId);
    // Refresh members so the UI reflects the canonical server state
    // (server may dedupe / reject already-present DIDs silently).
    await get().loadCircleMembers(circleId, true);
  },

  removeCircleMember: async (circleId, actorPtid) => {
    const generation = storeGeneration;
    await socialCircleRemoveMembers(circleId, [actorPtid]);
    if (generation !== storeGeneration) return;
    invalidateCircleMembership(circleId);
    await get().loadCircleMembers(circleId, true);
  },

  saveCircle: async (circleId, name, description, memberPtids) => {
    const generation = storeGeneration;
    const assertScope = () => {
      if (generation !== storeGeneration) throw new Error('MOMENTS_SESSION_STALE');
    };
    // Re-read the original membership before computing a retryable delta.
    // Each existing Circle command commits independently; a failure preserves
    // the editor draft and re-reads actual truth, never invents a full save.
    await get().loadCircleMembers(circleId);
    assertScope();
    const existing = new Set((get().circleMembers[circleId] ?? []).map(member => member.actorPtid));
    const wanted = new Set(memberPtids);
    const removed = [...existing].filter(id => !wanted.has(id));
    const added = [...wanted].filter(id => !existing.has(id));
    try {
      if (removed.length) {
        await socialCircleRemoveMembers(circleId, removed); assertScope(); invalidateCircleMembership(circleId);
      }
      if (added.length) {
        await socialCircleAddMembers(circleId, added); assertScope(); invalidateCircleMembership(circleId);
      }
      await get().renameCircle(circleId, name, description);
      assertScope();
    } finally {
      if (generation === storeGeneration) {
        await Promise.all([get().loadCircleMembers(circleId, true), get().listMyCircles(true)]);
      }
    }
    assertScope();
    const actual = new Set((get().circleMembers[circleId] ?? []).map(member => member.actorPtid));
    if (actual.size !== wanted.size || [...wanted].some(id => !actual.has(id))) {
      throw new Error('CIRCLE_MEMBERS_NOT_CONFIRMED');
    }
  },

  // -------------------------------------------------------------------------
  // Composer draft + reset
  // -------------------------------------------------------------------------

  setComposerDraft: (draft) => set({ composerDraft: draft }),
  clearComposerDraft: () => set({ composerDraft: null }),

  reset: () => {
    storeGeneration += 1;
    reactionFlights.clear();
    pollFlights.clear();
    circlesRead = null;
    circleMemberReads.clear();
    circleCatalogVersion += 1;
    circleMembershipVersions.clear();
    resetPublicFeed();
    commentReads.clear();
    activeCommentTarget = null;
    set({ ...initialState });
  },
}));
