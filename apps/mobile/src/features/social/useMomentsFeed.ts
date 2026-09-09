/**
 * useMomentsFeed.ts — React hooks for moments feed consumption
 *
 * Bridges the MomentsFeedStore controller to React component
 * lifecycle with proper cleanup and re-render triggers.
 *
 * The feed store is the single owner of feed state; hooks provide
 * read-only snapshots and dispatch functions that delegate to the
 * store controller.
 *
 * W6B: Initial implementation for MomentsPage pure-renderer pattern.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Post, ReactionSummary } from '../../gen/proto/domain/social/post_pb';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';
import type { MomentsGateway } from '../../services/gateways/momentsGateway';
import type { MomentsProjectionController } from '../../runtimes/momentsProjectionDescriptor';
import {
  createMomentsFeedStore,
  type CommentsState,
  type FeedLoadState,
  type MomentsFeedStoreController,
} from './momentsFeedStore';

// ---------------------------------------------------------------------------
// Feed hook
// ---------------------------------------------------------------------------

export interface UseMomentsFeedResult {
  readonly posts: readonly Post[];
  readonly loadState: FeedLoadState;
  readonly hasMore: boolean;
  readonly errorMessage: string;
  readonly loadFeed: () => void;
  readonly loadMore: () => void;
  readonly refresh: () => void;
  readonly prependPost: (post: Post) => void;
  readonly removePost: (postId: string) => void;
  readonly updateReaction: (postId: string, reactions: readonly ReactionSummary[]) => void;
}

/**
 * Hook that manages the moments feed lifecycle.
 *
 * Creates a feed store on mount, loads the initial page, and
 * provides pagination / mutation functions to the renderer.
 * The store is torn down when the component unmounts.
 */
export function useMomentsFeed(
  gateway: MomentsGateway | null,
  projection: MomentsProjectionController | null,
): UseMomentsFeedResult {
  const storeRef = useRef<MomentsFeedStoreController | null>(null);
  const [, forceRender] = useState(0);

  const triggerRender = useCallback(() => {
    forceRender((n) => n + 1);
  }, []);

  // Initialize store when gateway + projection become available
  useEffect(() => {
    if (!gateway || !projection) return;

    const store = createMomentsFeedStore(gateway, projection);
    storeRef.current = store;

    // Load initial feed page
    void store.loadFeed().then(triggerRender);

    return () => {
      store.teardown();
      storeRef.current = null;
    };
  }, [gateway, projection, triggerRender]);

  const store = storeRef.current;
  const state = store?.state();

  const loadFeed = useCallback(() => {
    void store?.loadFeed().then(triggerRender);
  }, [store, triggerRender]);

  const loadMore = useCallback(() => {
    void store?.loadMore().then(triggerRender);
  }, [store, triggerRender]);

  const refresh = useCallback(() => {
    void store?.refresh().then(triggerRender);
  }, [store, triggerRender]);

  const prependPost = useCallback(
    (post: Post) => {
      store?.prependPost(post);
      triggerRender();
    },
    [store, triggerRender],
  );

  const removePost = useCallback(
    (postId: string) => {
      store?.removePost(postId);
      triggerRender();
    },
    [store, triggerRender],
  );

  const updateReaction = useCallback(
    (postId: string, reactions: readonly ReactionSummary[]) => {
      store?.updateReaction(postId, reactions);
      triggerRender();
    },
    [store, triggerRender],
  );

  return {
    posts: state?.posts ?? [],
    loadState: state?.loadState ?? 'idle',
    hasMore: state?.hasMore ?? true,
    errorMessage: state?.errorMessage ?? '',
    loadFeed,
    loadMore,
    refresh,
    prependPost,
    removePost,
    updateReaction,
  };
}

// ---------------------------------------------------------------------------
// Comments hook
// ---------------------------------------------------------------------------

export interface UseMomentsCommentsResult {
  readonly comments: readonly Comment[];
  readonly loading: boolean;
  readonly hasMore: boolean;
  readonly errorMessage: string;
  readonly loadComments: () => void;
  readonly loadMore: () => void;
}

/**
 * Hook that manages comments for a single post.
 *
 * Loads comments on mount and provides pagination.
 */
export function useMomentsComments(
  gateway: MomentsGateway | null,
  postId: string,
): UseMomentsCommentsResult {
  const [commentsState, setCommentsState] = useState<CommentsState>({
    postId,
    comments: [],
    cursor: '',
    hasMore: true,
    loading: false,
    errorMessage: '',
  });

  const storeRef = useRef<MomentsFeedStoreController | null>(null);

  const loadComments = useCallback(() => {
    if (!gateway || !postId) return;

    setCommentsState((prev) => ({ ...prev, loading: true, errorMessage: '' }));

    // Use gateway directly for comments (no store needed for isolated load)
    void gateway.fetchComments(postId, '', 15).then((result) => {
      if (result.ok) {
        setCommentsState({
          postId,
          comments: result.data.comments,
          cursor: result.data.nextCursor,
          hasMore: result.data.hasMore,
          loading: false,
          errorMessage: '',
        });
      } else {
        setCommentsState((prev) => ({
          ...prev,
          loading: false,
          errorMessage: result.error.message,
        }));
      }
    });
  }, [gateway, postId]);

  const loadMore = useCallback(() => {
    if (!gateway || !commentsState.hasMore || commentsState.loading) return;

    setCommentsState((prev) => ({ ...prev, loading: true }));

    void gateway.fetchComments(postId, commentsState.cursor, 15).then((result) => {
      if (result.ok) {
        setCommentsState((prev) => {
          const existingIds = new Set(prev.comments.map((c) => c.id));
          const newComments = result.data.comments.filter((c) => !existingIds.has(c.id));
          return {
            ...prev,
            comments: [...prev.comments, ...newComments],
            cursor: result.data.nextCursor,
            hasMore: result.data.hasMore,
            loading: false,
            errorMessage: '',
          };
        });
      } else {
        setCommentsState((prev) => ({
          ...prev,
          loading: false,
          errorMessage: result.error.message,
        }));
      }
    });
  }, [gateway, postId, commentsState.hasMore, commentsState.loading, commentsState.cursor]);

  // Auto-load on mount
  useEffect(() => {
    loadComments();
  }, [loadComments]);

  return {
    comments: commentsState.comments,
    loading: commentsState.loading,
    hasMore: commentsState.hasMore,
    errorMessage: commentsState.errorMessage,
    loadComments,
    loadMore,
  };
}
