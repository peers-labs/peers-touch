/**
 * momentsFeedStore.ts — Runtime-owned moments feed state
 *
 * Manages feed state (posts, cursor, loading, errors) that the
 * MomentsPage consumes as a pure renderer. All mutations flow
 * through the gateway; realtime updates arrive via the projection
 * descriptor's ingress path.
 *
 * The store maintains stable anchors by keying posts on their
 * server-assigned IDs. Pagination uses opaque cursor strings
 * from the Station timeline endpoint.
 *
 * W6B: Initial implementation with cursor-based pagination,
 * reaction optimistic updates, and bounded feed (max 200 posts
 * in memory to prevent unbounded growth).
 */

import { create } from '@bufbuild/protobuf';

import {
  BlockExplanation_Kind,
  PostDetailOutcome,
  ReactionSummarySchema,
  TimelinePageOutcome,
  type FeedObjectExplanation,
  type Post,
  type ReactionKind,
  type ReactionSummary,
} from '../../gen/proto/domain/social/post_pb';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';
import type { MomentsGateway, MomentsFeedPage } from '../../services/gateways/momentsGateway';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum posts held in memory to prevent unbounded growth */
const MAX_FEED_POSTS = 200;

/** Default page size for feed requests */
const DEFAULT_PAGE_SIZE = 20;

/** Default page size for comment requests */
const DEFAULT_COMMENT_PAGE_SIZE = 15;

/**
 * Maximum authoritative comments retained for one post. This mirrors the
 * feed's 200-row ceiling while the UI presents a smaller virtual window.
 */
const MAX_COMMENTS_PER_POST = 200;

/** Maximum per-post comment projections retained by one session runtime. */
const MAX_COMMENT_THREADS = 20;

// ---------------------------------------------------------------------------
// Feed state types
// ---------------------------------------------------------------------------

export type FeedLoadState = 'idle' | 'loading' | 'refreshing' | 'loading-more' | 'error';
export type FeedFailureKind = 'initial' | 'refresh' | 'load-more';

export interface FeedFailure {
  readonly kind: FeedFailureKind;
  readonly message: string;
}

export type MomentPolicyState = 'visible' | 'hidden' | 'blocked';

export interface ReactionMutationState {
  readonly requestId: number;
  readonly reactionKind: number;
  readonly status: 'pending' | 'rolled-back';
  readonly errorMessage: string;
}

export interface ReactionMutationToken {
  readonly requestId: number;
  readonly postId: string;
  readonly reactionKind: number;
  readonly operation: 'react' | 'unreact';
  readonly previousReactions: readonly ReactionSummary[];
}

export type MomentDetailReadback =
  | { readonly kind: 'loading' }
  | { readonly kind: 'available'; readonly post: Post }
  | { readonly kind: 'deleted'; readonly post?: Post }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface SelectedMomentDetailState {
  readonly postId: string;
  readonly readback: MomentDetailReadback;
}

export interface MomentsFeedState {
  readonly posts: readonly Post[];
  readonly postIndex: ReadonlyMap<string, number>;
  readonly feedExplanations: ReadonlyMap<string, FeedObjectExplanation>;
  readonly reactionMutations: ReadonlyMap<string, ReactionMutationState>;
  readonly selectedDetail: SelectedMomentDetailState | null;
  readonly commentsByPost: ReadonlyMap<string, CommentsState>;
  readonly cursor: string;
  readonly hasMore: boolean;
  readonly pageOutcome: TimelinePageOutcome;
  readonly loadState: FeedLoadState;
  readonly errorMessage: string;
  readonly failure: FeedFailure | null;
}

export interface CommentsState {
  readonly postId: string;
  readonly comments: readonly Comment[];
  readonly cursor: string;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly errorMessage: string;
}

// ---------------------------------------------------------------------------
// Feed store controller
// ---------------------------------------------------------------------------

export interface MomentsFeedStoreController {
  /** Current feed state snapshot */
  state: () => MomentsFeedState;

  /** Subscribe to runtime-owned feed projection updates. */
  subscribe: (listener: () => void) => () => void;

  /** Load the initial feed page (or refresh) */
  loadFeed: () => Promise<void>;

  /** Load the next page of results */
  loadMore: () => Promise<void>;

  /** Refresh the feed from the beginning */
  refresh: () => Promise<boolean>;

  /** Null means superseded: do not change availability or acknowledge a cursor. */
  reconcile: () => Promise<boolean | null>;

  /** Read back an inline mutation without replacing pagination or detail selection. */
  refreshPost: (postId: string) => Promise<boolean>;

  /** Apply a realtime post event (new post prepended) */
  prependPost: (post: Post) => void;

  /** Remove a post by ID (deleted event) */
  removePost: (postId: string) => void;

  /** Apply an authoritative reaction projection to a post. */
  updateReaction: (postId: string, reactions: readonly ReactionSummary[]) => void;

  /** Start one explicit optimistic reaction transaction for a post. */
  beginReaction: (postId: string, reactionKind: number) => ReactionMutationToken | null;

  /** Commit an optimistic transaction with the authoritative response. */
  commitReaction: (
    token: ReactionMutationToken,
    reactions: readonly ReactionSummary[],
  ) => void;

  /** Restore the pre-mutation snapshot after an authoritative rejection. */
  rollbackReaction: (token: ReactionMutationToken, errorMessage: string) => void;

  /** Ensure authoritative detail and comments exist without replacing retained state. */
  ensureMoment: (postId: string) => Promise<void>;

  /** Force authoritative detail and comments reload after retry or mutation. */
  reloadMoment: (postId: string) => Promise<boolean>;

  /** Reload the authoritative first comment page for a post. */
  loadComments: (postId: string) => Promise<boolean>;

  /** Load the next authoritative comment page for a post. */
  loadMoreComments: (postId: string) => Promise<void>;

  /** Teardown */
  teardown: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

type FeedPageWithExplanations = MomentsFeedPage & {
  readonly explanations?: readonly FeedObjectExplanation[];
};

type FeedPageMode = 'replace' | 'refresh' | 'append';

export function resolveMomentPolicyState(
  explanation: FeedObjectExplanation | undefined,
): MomentPolicyState {
  if (!explanation) return 'visible';

  const blockKind = explanation.blockExplanation?.kind
    ?? BlockExplanation_Kind.BLOCK_STATE_UNSPECIFIED;
  if (
    blockKind !== BlockExplanation_Kind.BLOCK_STATE_UNSPECIFIED
    && blockKind !== BlockExplanation_Kind.BLOCK_STATE_NOT_BLOCKED
  ) {
    return 'blocked';
  }
  if (explanation.audienceExplanation?.policyFiltered) {
    return 'hidden';
  }
  return 'visible';
}

export async function readAuthoritativeMomentDetail(
  gateway: MomentsGateway,
  postId: string,
): Promise<MomentDetailReadback> {
  const result = await gateway.getPost(postId);
  if (!result.ok) {
    return { kind: 'unavailable', reason: result.error.message };
  }

  switch (result.data.outcome) {
    case PostDetailOutcome.AVAILABLE:
      return result.data.post
        ? { kind: 'available', post: result.data.post }
        : { kind: 'unavailable', reason: '' };
    case PostDetailOutcome.HIDDEN:
      return { kind: 'hidden' };
    case PostDetailOutcome.DELETED:
      return { kind: 'deleted' };
    case PostDetailOutcome.UNAVAILABLE:
    case PostDetailOutcome.UNSPECIFIED:
    default:
      return { kind: 'unavailable', reason: '' };
  }
}

export function createMomentsFeedStore(
  gateway: MomentsGateway,
): MomentsFeedStoreController {
  let feedState: MomentsFeedState = {
    posts: [],
    postIndex: new Map(),
    feedExplanations: new Map(),
    reactionMutations: new Map(),
    selectedDetail: null,
    commentsByPost: new Map(),
    cursor: '',
    hasMore: true,
    pageOutcome: TimelinePageOutcome.UNSPECIFIED,
    loadState: 'idle',
    errorMessage: '',
    failure: null,
  };

  let torn = false;
  let lifecycleRevision = 0;
  let feedRevision = 0;
  let feedRequestSequence = 0;
  let activeFeedRequestId = 0;
  let detailRequestSequence = 0;
  let activeDetailRequestId = 0;
  let reactionRequestSequence = 0;
  let commentRequestSequence = 0;
  let postRequestSequence = 0;
  const postRequestSequences = new Map<string, number>();
  const commentRequestSequences = new Map<string, number>();
  const listeners = new Set<() => void>();

  // -- Internal helpers --

  function emit(): void {
    if (torn) return;
    listeners.forEach((listener) => listener());
  }

  function isFeedRequestCurrent(
    requestLifecycle: number,
    requestRevision: number,
    requestId: number,
  ): boolean {
    return !torn
      && lifecycleRevision === requestLifecycle
      && feedRevision === requestRevision
      && activeFeedRequestId === requestId;
  }

  function isDetailRequestCurrent(
    requestLifecycle: number,
    requestId: number,
  ): boolean {
    return !torn
      && lifecycleRevision === requestLifecycle
      && activeDetailRequestId === requestId;
  }

  function isCommentRequestCurrent(
    postId: string,
    requestLifecycle: number,
    requestId: number,
  ): boolean {
    return !torn
      && lifecycleRevision === requestLifecycle
      && commentRequestSequences.get(postId) === requestId;
  }

  function rebuildIndex(posts: readonly Post[]): ReadonlyMap<string, number> {
    const index = new Map<string, number>();
    posts.forEach((post, idx) => {
      if (post.id) {
        index.set(post.id, idx);
      }
    });
    return index;
  }

  function retainFeedExplanations(
    explanations: ReadonlyMap<string, FeedObjectExplanation>,
    posts: readonly Post[],
  ): ReadonlyMap<string, FeedObjectExplanation> {
    const retainedIds = new Set(posts.map((post) => post.id));
    return new Map(
      [...explanations].filter(([postId]) => retainedIds.has(postId)),
    );
  }

  function retainReactionMutations(
    posts: readonly Post[],
    selectedPostId = feedState.selectedDetail?.postId,
  ): ReadonlyMap<string, ReactionMutationState> {
    const retainedIds = new Set(posts.map((post) => post.id));
    if (selectedPostId) retainedIds.add(selectedPostId);
    return new Map(
      [...feedState.reactionMutations].filter(
        ([postId, mutation]) => mutation.status === 'pending' || retainedIds.has(postId),
      ),
    );
  }

  function emptyCommentsState(postId: string): CommentsState {
    return {
      postId,
      comments: [],
      cursor: '',
      hasMore: true,
      loading: false,
      errorMessage: '',
    };
  }

  function publishCommentsState(next: CommentsState): void {
    const commentsByPost = new Map(feedState.commentsByPost);
    // Reinsert on access so the bounded map behaves as a small LRU.
    commentsByPost.delete(next.postId);
    commentsByPost.set(next.postId, next);
    while (commentsByPost.size > MAX_COMMENT_THREADS) {
      const oldestPostId = commentsByPost.keys().next().value as string | undefined;
      if (!oldestPostId) break;
      commentsByPost.delete(oldestPostId);
      commentRequestSequences.delete(oldestPostId);
    }
    feedState = { ...feedState, commentsByPost };
    emit();
  }

  function applyFeedPage(page: FeedPageWithExplanations, mode: FeedPageMode): void {
    const pageIds = new Set<string>();
    const pagePosts = page.posts.filter((post) => {
      if (!post.id || pageIds.has(post.id)) return false;
      pageIds.add(post.id);
      return true;
    });
    const feedExplanations = mode === 'replace'
      ? new Map<string, FeedObjectExplanation>()
      : new Map(feedState.feedExplanations);
    if (mode === 'refresh') {
      pageIds.forEach((postId) => feedExplanations.delete(postId));
    }
    for (const explanation of page.explanations ?? []) {
      if (explanation.objectId) {
        feedExplanations.set(explanation.objectId, explanation);
      }
    }

    let combined: readonly Post[];
    if (mode === 'replace') {
      combined = pagePosts;
    } else if (mode === 'refresh') {
      const refreshedPosts = pagePosts.map((post) => {
        const existingIndex = feedState.postIndex.get(post.id);
        const existingPost = existingIndex === undefined
          ? undefined
          : feedState.posts[existingIndex];
        return existingPost && feedState.reactionMutations.get(post.id)?.status === 'pending'
          ? { ...post, reactions: existingPost.reactions }
          : post;
      });
      combined = [
        ...refreshedPosts,
        ...feedState.posts.filter((post) => !pageIds.has(post.id)),
      ];
    } else {
      const existingIds = new Set(feedState.posts.map((post) => post.id));
      combined = [
        ...feedState.posts,
        ...pagePosts.filter((post) => !existingIds.has(post.id)),
      ];
    }

    // Initial and refreshed pages keep the newest rows. Forward pagination
    // keeps the fetched tail plus an overlap with the prior window, so
    // advancing the Station cursor never discards the page that cursor
    // produced.
    const bounded = combined.length > MAX_FEED_POSTS
      ? mode === 'append'
        ? combined.slice(-MAX_FEED_POSTS)
        : combined.slice(0, MAX_FEED_POSTS)
      : combined;

    feedState = {
      ...feedState,
      posts: bounded,
      postIndex: rebuildIndex(bounded),
      feedExplanations: retainFeedExplanations(feedExplanations, bounded),
      reactionMutations: retainReactionMutations(bounded),
      cursor: page.nextCursor || '',
      hasMore: page.hasMore,
      pageOutcome: page.outcome,
      loadState: 'idle',
      errorMessage: '',
      failure: null,
    };
    emit();
  }

  // -- Public API --

  function state(): MomentsFeedState {
    return feedState;
  }

  function subscribe(listener: () => void): () => void {
    if (torn) return () => undefined;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function loadFeed(): Promise<void> {
    if (torn) return;
    if (feedState.loadState === 'loading' || feedState.loadState === 'refreshing') return;

    const requestLifecycle = lifecycleRevision;
    const requestRevision = ++feedRevision;
    const requestId = ++feedRequestSequence;
    activeFeedRequestId = requestId;
    feedState = {
      ...feedState,
      loadState: 'loading',
      errorMessage: '',
      failure: null,
    };
    emit();

    const result = await gateway.fetchFeed('', DEFAULT_PAGE_SIZE);
    if (!isFeedRequestCurrent(requestLifecycle, requestRevision, requestId)) return;

    if (result.ok) {
      applyFeedPage(result.data, 'replace');
    } else {
      feedState = {
        ...feedState,
        loadState: 'error',
        errorMessage: result.error.message,
        failure: {
          kind: 'initial',
          message: result.error.message,
        },
      };
      emit();
    }
  }

  async function loadMore(): Promise<void> {
    if (torn) return;
    if (
      !feedState.hasMore
      || (
        feedState.loadState !== 'idle'
        && !(
          feedState.loadState === 'error'
          && feedState.failure?.kind === 'load-more'
        )
      )
    ) return;

    const requestLifecycle = lifecycleRevision;
    const requestRevision = feedRevision;
    const requestId = ++feedRequestSequence;
    const cursor = feedState.cursor;
    activeFeedRequestId = requestId;
    feedState = {
      ...feedState,
      loadState: 'loading-more',
      errorMessage: '',
      failure: null,
    };
    emit();

    const result = await gateway.fetchFeed(cursor, DEFAULT_PAGE_SIZE);
    if (!isFeedRequestCurrent(requestLifecycle, requestRevision, requestId)) return;

    if (result.ok) {
      applyFeedPage(result.data, 'append');
    } else {
      feedState = {
        ...feedState,
        loadState: 'error',
        errorMessage: result.error.message,
        failure: {
          kind: 'load-more',
          message: result.error.message,
        },
      };
      emit();
    }
  }

  async function refresh(): Promise<boolean> {
    return await refreshFeed() === true;
  }

  async function refreshFeed(): Promise<boolean | null> {
    if (torn) return null;
    const requestLifecycle = lifecycleRevision;
    const requestRevision = ++feedRevision;
    const requestId = ++feedRequestSequence;
    activeFeedRequestId = requestId;
    feedState = {
      ...feedState,
      loadState: 'refreshing',
      errorMessage: '',
      failure: null,
    };
    emit();

    const result = await gateway.fetchFeed('', DEFAULT_PAGE_SIZE);
    if (!isFeedRequestCurrent(requestLifecycle, requestRevision, requestId)) return null;

    if (result.ok) {
      applyFeedPage(result.data, 'refresh');
      return true;
    } else {
      feedState = {
        ...feedState,
        loadState: 'error',
        errorMessage: result.error.message,
        failure: {
          kind: 'refresh',
          message: result.error.message,
        },
      };
      emit();
      return false;
    }
  }

  async function reconcile(): Promise<boolean | null> {
    const selectedPostId = feedState.selectedDetail?.postId;
    const feedRequest = refreshFeed();
    const detailRequest = selectedPostId
      ? reloadMomentProjection(selectedPostId)
      : Promise.resolve(true);
    const feedRequestId = activeFeedRequestId;
    const detailRequestId = activeDetailRequestId;
    const [feedReady, detailReady] = await Promise.all([
      feedRequest,
      detailRequest,
    ]);
    if (
      torn
      || activeFeedRequestId !== feedRequestId
      || activeDetailRequestId !== detailRequestId
    ) return null;
    if (feedReady === false || detailReady === false) return false;
    if (feedReady === null || detailReady === null) return null;
    return true;
  }

  async function refreshPost(postId: string): Promise<boolean> {
    if (torn || !feedState.postIndex.has(postId)) return false;
    const requestLifecycle = lifecycleRevision;
    const requestRevision = feedRevision;
    const requestId = ++postRequestSequence;
    postRequestSequences.set(postId, requestId);
    const isCurrent = () => !torn
      && lifecycleRevision === requestLifecycle
      && feedRevision === requestRevision
      && postRequestSequences.get(postId) === requestId;

    try {
      const readback = await readAuthoritativeMomentDetail(gateway, postId);
      if (!isCurrent() || readback.kind !== 'available' || readback.post.id !== postId) {
        return false;
      }
      if (!await loadComments(postId) || !isCurrent()) return false;
      const index = feedState.postIndex.get(postId);
      if (index === undefined) return false;
      const posts = [...feedState.posts];
      posts[index] = feedState.reactionMutations.get(postId)?.status === 'pending'
        ? { ...readback.post, reactions: posts[index].reactions }
        : readback.post;
      feedState = { ...feedState, posts };
      emit();
      return true;
    } finally {
      if (postRequestSequences.get(postId) === requestId) {
        postRequestSequences.delete(postId);
      }
    }
  }

  function prependPost(post: Post): void {
    if (torn || !post.id) return;

    // Skip if already present (stable anchor dedup)
    if (feedState.postIndex.has(post.id)) return;

    const updated = [post, ...feedState.posts];
    const bounded = updated.length > MAX_FEED_POSTS
      ? updated.slice(0, MAX_FEED_POSTS)
      : updated;

    feedState = {
      ...feedState,
      posts: bounded,
      postIndex: rebuildIndex(bounded),
      feedExplanations: retainFeedExplanations(feedState.feedExplanations, bounded),
      reactionMutations: retainReactionMutations(bounded),
    };
    emit();
  }

  function removePost(postId: string): void {
    if (torn) return;
    const postIndex = feedState.postIndex.get(postId);
    const retainedPost = postIndex === undefined ? undefined : feedState.posts[postIndex];
    const filtered = feedState.posts.filter((p) => p.id !== postId);
    const priorSelectedDetail = feedState.selectedDetail;
    let selectedDetail = priorSelectedDetail;
    if (priorSelectedDetail?.postId === postId) {
      activeDetailRequestId = ++detailRequestSequence;
      postRequestSequences.delete(postId);
      commentRequestSequences.delete(postId);
      const selectedPost = priorSelectedDetail.readback.kind === 'available'
        || priorSelectedDetail.readback.kind === 'deleted'
        ? priorSelectedDetail.readback.post
        : priorSelectedDetail.readback.kind === 'loading'
          ? retainedPost
          : undefined;
      if (selectedPost) {
        selectedDetail = {
          postId,
          readback: {
            kind: 'deleted',
            post: { ...selectedPost, isDeleted: true },
          },
        };
      }
    }
    if (
      filtered.length === feedState.posts.length
      && selectedDetail === priorSelectedDetail
    ) return;

    feedState = {
      ...feedState,
      posts: filtered,
      postIndex: rebuildIndex(filtered),
      feedExplanations: retainFeedExplanations(feedState.feedExplanations, filtered),
      reactionMutations: retainReactionMutations(
        filtered,
        selectedDetail?.readback.kind === 'available' ? selectedDetail.postId : '',
      ),
      selectedDetail,
    };
    emit();
  }

  function updateReaction(postId: string, reactions: readonly ReactionSummary[]): void {
    if (torn) return;
    if (projectReactions(postId, reactions)) emit();
  }

  function reactionPost(postId: string): Post | undefined {
    const detail = feedState.selectedDetail;
    if (detail?.postId === postId) {
      return detail.readback.kind === 'available' ? detail.readback.post : undefined;
    }
    const idx = feedState.postIndex.get(postId);
    return idx === undefined ? undefined : feedState.posts[idx];
  }

  // One reaction command updates every retained representation of its post.
  function projectReactions(postId: string, reactions: readonly ReactionSummary[]): boolean {
    const idx = feedState.postIndex.get(postId);
    let posts = feedState.posts;
    let selectedDetail = feedState.selectedDetail;
    const detailPost = selectedDetail?.postId === postId
      && selectedDetail.readback.kind === 'available'
      ? selectedDetail.readback.post
      : undefined;
    if (idx === undefined && !detailPost) return false;

    if (idx !== undefined) {
      const updated = [...posts];
      updated[idx] = { ...posts[idx], reactions: [...reactions] };
      posts = updated;
    }
    if (detailPost) {
      selectedDetail = {
        postId,
        readback: {
          kind: 'available',
          post: { ...detailPost, reactions: [...reactions] },
        },
      };
    }
    feedState = { ...feedState, posts, selectedDetail };
    return true;
  }

  function beginReaction(
    postId: string,
    reactionKind: number,
  ): ReactionMutationToken | null {
    if (torn) return null;
    if (feedState.reactionMutations.get(postId)?.status === 'pending') return null;

    const post = reactionPost(postId);
    if (!post || post.id !== postId || post.isDeleted) return null;
    if (resolveMomentPolicyState(feedState.feedExplanations.get(postId)) !== 'visible') return null;
    const previousReactions = [...post.reactions];
    const current = previousReactions.find((reaction) => reaction.kind === reactionKind);
    const operation = current?.reactedByViewer ? 'unreact' : 'react';
    const optimisticReactions = current
      ? previousReactions.map((reaction) => {
        if (reaction.kind !== reactionKind) return reaction;
        const count = operation === 'unreact'
          ? (reaction.count > 0n ? reaction.count - 1n : 0n)
          : reaction.count + 1n;
        return create(ReactionSummarySchema, {
          kind: reaction.kind,
          count,
          reactedByViewer: operation === 'react',
        });
      })
      : [
        ...previousReactions,
        create(ReactionSummarySchema, {
          kind: reactionKind as ReactionKind,
          count: 1n,
          reactedByViewer: true,
        }),
      ];

    reactionRequestSequence += 1;
    const token: ReactionMutationToken = {
      requestId: reactionRequestSequence,
      postId,
      reactionKind,
      operation,
      previousReactions,
    };
    const reactionMutations = new Map(feedState.reactionMutations);
    reactionMutations.set(postId, {
      requestId: token.requestId,
      reactionKind,
      status: 'pending',
      errorMessage: '',
    });

    projectReactions(postId, optimisticReactions);
    feedState = {
      ...feedState,
      reactionMutations,
    };
    emit();
    return token;
  }

  function commitReaction(
    token: ReactionMutationToken,
    reactions: readonly ReactionSummary[],
  ): void {
    if (torn) return;
    const current = feedState.reactionMutations.get(token.postId);
    if (current?.status !== 'pending' || current.requestId !== token.requestId) return;

    const reactionMutations = new Map(feedState.reactionMutations);
    reactionMutations.delete(token.postId);
    projectReactions(token.postId, reactions);
    feedState = {
      ...feedState,
      reactionMutations,
    };
    emit();
  }

  function rollbackReaction(token: ReactionMutationToken, errorMessage: string): void {
    if (torn) return;
    const current = feedState.reactionMutations.get(token.postId);
    if (current?.status !== 'pending' || current.requestId !== token.requestId) return;

    const reactionMutations = new Map(feedState.reactionMutations);
    if (projectReactions(token.postId, token.previousReactions)) {
      reactionMutations.set(token.postId, {
        requestId: token.requestId,
        reactionKind: token.reactionKind,
        status: 'rolled-back',
        errorMessage,
      });
    } else {
      reactionMutations.delete(token.postId);
    }
    feedState = {
      ...feedState,
      reactionMutations,
    };
    emit();
  }

  async function loadMomentDetail(
    postId: string,
  ): Promise<MomentDetailReadback | null> {
    if (torn || !postId) return null;

    const requestLifecycle = lifecycleRevision;
    const requestId = ++detailRequestSequence;
    activeDetailRequestId = requestId;
    feedState = {
      ...feedState,
      reactionMutations: retainReactionMutations(feedState.posts, postId),
      selectedDetail: {
        postId,
        readback: { kind: 'loading' },
      },
    };
    emit();

    const readback = await readAuthoritativeMomentDetail(gateway, postId);
    if (!isDetailRequestCurrent(requestLifecycle, requestId)) return null;

    feedState = {
      ...feedState,
      selectedDetail: { postId, readback },
    };
    emit();
    return readback;
  }

  async function ensureMoment(postId: string): Promise<void> {
    if (torn || !postId) return;
    const selected = feedState.selectedDetail;
    if (selected?.postId === postId) {
      if (
        selected.readback.kind === 'available'
        && !feedState.commentsByPost.has(postId)
      ) {
        await loadComments(postId);
      }
      return;
    }

    const readback = await loadMomentDetail(postId);
    if (
      readback?.kind === 'available'
      && !feedState.commentsByPost.has(postId)
    ) {
      await loadComments(postId);
    }
  }

  async function reloadMoment(postId: string): Promise<boolean> {
    return await reloadMomentProjection(postId) === true;
  }

  async function reloadMomentProjection(postId: string): Promise<boolean | null> {
    if (torn || !postId) return null;
    const detailRequest = loadMomentDetail(postId);
    const requestId = activeDetailRequestId;
    const readback = await detailRequest;
    if (!readback) return null;
    if (readback.kind === 'unavailable') return false;
    if (readback?.kind === 'available') {
      const commentsReady = await reloadComments(postId);
      return !torn && activeDetailRequestId === requestId ? commentsReady : null;
    }
    return true;
  }

  async function loadComments(postId: string): Promise<boolean> {
    return await reloadComments(postId) === true;
  }

  async function reloadComments(postId: string): Promise<boolean | null> {
    if (torn || !postId) return null;
    const requestLifecycle = lifecycleRevision;
    const requestId = ++commentRequestSequence;
    commentRequestSequences.set(postId, requestId);
    const existing = feedState.commentsByPost.get(postId)
      ?? emptyCommentsState(postId);
    publishCommentsState({
      ...existing,
      loading: true,
      errorMessage: '',
    });

    const result = await gateway.fetchComments(postId, '', DEFAULT_COMMENT_PAGE_SIZE);
    if (!isCommentRequestCurrent(postId, requestLifecycle, requestId)) return null;
    commentRequestSequences.delete(postId);

    if (result.ok) {
      const seen = new Set<string>();
      const comments = result.data.comments.filter((comment) => {
        if (!comment.id || seen.has(comment.id)) return false;
        seen.add(comment.id);
        return true;
      }).slice(0, MAX_COMMENTS_PER_POST);
      publishCommentsState({
        postId,
        comments,
        cursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
        loading: false,
        errorMessage: '',
      });
      return true;
    }

    publishCommentsState({
      ...existing,
      loading: false,
      errorMessage: result.error.message,
    });
    return false;
  }

  async function loadMoreComments(postId: string): Promise<void> {
    if (torn || !postId) return;
    const existing = feedState.commentsByPost.get(postId);
    if (!existing?.hasMore || existing.loading) return;

    const requestLifecycle = lifecycleRevision;
    const requestId = ++commentRequestSequence;
    commentRequestSequences.set(postId, requestId);
    const cursor = existing.cursor;
    publishCommentsState({
      ...existing,
      loading: true,
      errorMessage: '',
    });

    const result = await gateway.fetchComments(
      postId,
      cursor,
      DEFAULT_COMMENT_PAGE_SIZE,
    );
    if (!isCommentRequestCurrent(postId, requestLifecycle, requestId)) return;
    commentRequestSequences.delete(postId);

    if (result.ok) {
      const current = feedState.commentsByPost.get(postId) ?? existing;
      const existingIds = new Set(current.comments.map((comment) => comment.id));
      const newComments = result.data.comments.filter((comment) => {
        if (!comment.id || existingIds.has(comment.id)) return false;
        existingIds.add(comment.id);
        return true;
      });
      const combined = [...current.comments, ...newComments];
      const comments = combined.length > MAX_COMMENTS_PER_POST
        ? combined.slice(-MAX_COMMENTS_PER_POST)
        : combined;
      publishCommentsState({
        ...current,
        comments,
        cursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
        loading: false,
        errorMessage: '',
      });
      return;
    }

    publishCommentsState({
      ...existing,
      loading: false,
      errorMessage: result.error.message,
    });
  }

  function teardown(): void {
    if (torn) return;
    torn = true;
    lifecycleRevision += 1;
    feedRevision += 1;
    activeFeedRequestId = ++feedRequestSequence;
    activeDetailRequestId = ++detailRequestSequence;
    commentRequestSequences.clear();
    postRequestSequences.clear();
    listeners.clear();
  }

  return {
    state,
    subscribe,
    loadFeed,
    loadMore,
    refresh,
    reconcile,
    refreshPost,
    prependPost,
    removePost,
    updateReaction,
    beginReaction,
    commitReaction,
    rollbackReaction,
    ensureMoment,
    reloadMoment,
    loadComments,
    loadMoreComments,
    teardown,
  };
}
