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

import type { Post, ReactionSummary } from '../../gen/proto/domain/social/post_pb';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';
import type { MomentsGateway, MomentsFeedPage } from '../../services/gateways/momentsGateway';
import type { MomentsProjectionController } from '../../runtimes/momentsProjectionDescriptor';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum posts held in memory to prevent unbounded growth */
const MAX_FEED_POSTS = 200;

/** Default page size for feed requests */
const DEFAULT_PAGE_SIZE = 20;

/** Default page size for comment requests */
const DEFAULT_COMMENT_PAGE_SIZE = 15;

// ---------------------------------------------------------------------------
// Feed state types
// ---------------------------------------------------------------------------

export type FeedLoadState = 'idle' | 'loading' | 'refreshing' | 'loading-more' | 'error';

export interface MomentsFeedState {
  readonly posts: readonly Post[];
  readonly postIndex: ReadonlyMap<string, number>;
  readonly cursor: string;
  readonly hasMore: boolean;
  readonly loadState: FeedLoadState;
  readonly errorMessage: string;
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

  /** Load the initial feed page (or refresh) */
  loadFeed: () => Promise<void>;

  /** Load the next page of results */
  loadMore: () => Promise<void>;

  /** Refresh the feed from the beginning */
  refresh: () => Promise<void>;

  /** Apply a realtime post event (new post prepended) */
  prependPost: (post: Post) => void;

  /** Remove a post by ID (deleted event) */
  removePost: (postId: string) => void;

  /** Optimistically update a reaction on a post */
  updateReaction: (postId: string, reactions: readonly ReactionSummary[]) => void;

  /** Load comments for a post */
  loadComments: (postId: string) => Promise<CommentsState>;

  /** Load more comments for a post */
  loadMoreComments: (existing: CommentsState) => Promise<CommentsState>;

  /** Get the projection controller */
  projection: () => MomentsProjectionController;

  /** Teardown */
  teardown: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMomentsFeedStore(
  gateway: MomentsGateway,
  projection: MomentsProjectionController,
): MomentsFeedStoreController {
  let feedState: MomentsFeedState = {
    posts: [],
    postIndex: new Map(),
    cursor: '',
    hasMore: true,
    loadState: 'idle',
    errorMessage: '',
  };

  let torn = false;

  // -- Internal helpers --

  function rebuildIndex(posts: readonly Post[]): ReadonlyMap<string, number> {
    const index = new Map<string, number>();
    posts.forEach((post, idx) => {
      if (post.id) {
        index.set(post.id, idx);
      }
    });
    return index;
  }

  function applyFeedPage(page: MomentsFeedPage, append: boolean): void {
    const existing = append ? [...feedState.posts] : [];
    const existingIds = new Set(existing.map((p) => p.id));

    // Deduplicate by stable post ID
    const newPosts = page.posts.filter((p) => p.id && !existingIds.has(p.id));
    const combined = [...existing, ...newPosts];

    // Enforce bounded feed
    const bounded = combined.length > MAX_FEED_POSTS
      ? combined.slice(0, MAX_FEED_POSTS)
      : combined;

    feedState = {
      posts: bounded,
      postIndex: rebuildIndex(bounded),
      cursor: page.nextCursor || '',
      hasMore: page.hasMore,
      loadState: 'idle',
      errorMessage: '',
    };
  }

  // -- Public API --

  function state(): MomentsFeedState {
    return feedState;
  }

  async function loadFeed(): Promise<void> {
    if (torn) return;
    if (feedState.loadState === 'loading' || feedState.loadState === 'refreshing') return;

    feedState = { ...feedState, loadState: 'loading', errorMessage: '' };

    const result = await gateway.fetchFeed('', DEFAULT_PAGE_SIZE);
    if (torn) return;

    if (result.ok) {
      applyFeedPage(result.data, false);
    } else {
      feedState = {
        ...feedState,
        loadState: 'error',
        errorMessage: result.error.message,
      };
    }
  }

  async function loadMore(): Promise<void> {
    if (torn) return;
    if (!feedState.hasMore || feedState.loadState !== 'idle') return;

    feedState = { ...feedState, loadState: 'loading-more', errorMessage: '' };

    const result = await gateway.fetchFeed(feedState.cursor, DEFAULT_PAGE_SIZE);
    if (torn) return;

    if (result.ok) {
      applyFeedPage(result.data, true);
    } else {
      feedState = {
        ...feedState,
        loadState: 'error',
        errorMessage: result.error.message,
      };
    }
  }

  async function refresh(): Promise<void> {
    if (torn) return;
    feedState = { ...feedState, loadState: 'refreshing', errorMessage: '' };

    const result = await gateway.fetchFeed('', DEFAULT_PAGE_SIZE);
    if (torn) return;

    if (result.ok) {
      applyFeedPage(result.data, false);
      feedState = { ...feedState, loadState: 'idle' };
    } else {
      feedState = {
        ...feedState,
        loadState: 'error',
        errorMessage: result.error.message,
      };
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
    };
  }

  function removePost(postId: string): void {
    if (torn) return;
    const filtered = feedState.posts.filter((p) => p.id !== postId);
    if (filtered.length === feedState.posts.length) return;

    feedState = {
      ...feedState,
      posts: filtered,
      postIndex: rebuildIndex(filtered),
    };
  }

  function updateReaction(postId: string, reactions: readonly ReactionSummary[]): void {
    if (torn) return;
    const idx = feedState.postIndex.get(postId);
    if (idx === undefined) return;

    const updated = [...feedState.posts];
    const post = updated[idx];
    // Shallow clone the post with updated reactions
    updated[idx] = { ...post, reactions: [...reactions] } as Post;

    feedState = {
      ...feedState,
      posts: updated,
      // Index positions unchanged
    };
  }

  async function loadComments(postId: string): Promise<CommentsState> {
    const result = await gateway.fetchComments(postId, '', DEFAULT_COMMENT_PAGE_SIZE);

    if (result.ok) {
      return {
        postId,
        comments: result.data.comments,
        cursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
        loading: false,
        errorMessage: '',
      };
    }

    return {
      postId,
      comments: [],
      cursor: '',
      hasMore: false,
      loading: false,
      errorMessage: result.error.message,
    };
  }

  async function loadMoreComments(existing: CommentsState): Promise<CommentsState> {
    if (!existing.hasMore) return existing;

    const result = await gateway.fetchComments(
      existing.postId,
      existing.cursor,
      DEFAULT_COMMENT_PAGE_SIZE,
    );

    if (result.ok) {
      const existingIds = new Set(existing.comments.map((c) => c.id));
      const newComments = result.data.comments.filter((c) => !existingIds.has(c.id));

      return {
        ...existing,
        comments: [...existing.comments, ...newComments],
        cursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
        loading: false,
        errorMessage: '',
      };
    }

    return {
      ...existing,
      loading: false,
      errorMessage: result.error.message,
    };
  }

  function teardown(): void {
    torn = true;
    projection.teardown();
  }

  return {
    state,
    loadFeed,
    loadMore,
    refresh,
    prependPost,
    removePost,
    updateReaction,
    loadComments,
    loadMoreComments,
    projection: () => projection,
    teardown,
  };
}
