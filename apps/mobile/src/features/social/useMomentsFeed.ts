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

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  TimelinePageOutcome,
  type Post,
  type ReactionSummary,
} from '../../gen/proto/domain/social/post_pb';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';
import type {
  MomentsProjectionController,
  MomentsProjectionState,
} from '../../runtimes/momentsProjectionDescriptor';
import {
  type FeedFailure,
  type FeedLoadState,
  type MomentDetailReadback,
  type MomentsFeedState,
  type MomentsFeedStoreController,
} from './momentsFeedStore';

const LOADING_DETAIL: MomentDetailReadback = { kind: 'loading' };

function useMomentsStoreState(
  store: MomentsFeedStoreController | null,
): MomentsFeedState | null {
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(listener) ?? (() => undefined),
    [store],
  );
  const getSnapshot = useCallback(() => store?.state() ?? null, [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useMomentsProjectionState(
  projection: MomentsProjectionController | null,
): MomentsProjectionState | null {
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!projection) return;
    return projection.subscribe(() => forceRender((revision) => revision + 1));
  }, [projection]);
  return projection?.state() ?? null;
}

// ---------------------------------------------------------------------------
// Feed hook
// ---------------------------------------------------------------------------

export interface UseMomentsFeedResult {
  readonly posts: readonly Post[];
  readonly loadState: FeedLoadState;
  readonly hasMore: boolean;
  readonly pageOutcome: TimelinePageOutcome;
  readonly errorMessage: string;
  readonly failure: FeedFailure | null;
  readonly loadFeed: () => void;
  readonly loadMore: () => void;
  readonly refresh: () => void;
  readonly retryFailure: () => void;
  readonly prependPost: (post: Post) => void;
  readonly removePost: (postId: string) => void;
  readonly updateReaction: (postId: string, reactions: readonly ReactionSummary[]) => void;
}

export function retryMomentsFeedFailure(
  store: Pick<MomentsFeedStoreController, 'state' | 'loadFeed' | 'loadMore' | 'refresh'>,
): void {
  const failure = store.state().failure;
  if (!failure) return;
  if (failure.kind === 'load-more') {
    void store.loadMore();
    return;
  }
  if (failure.kind === 'refresh') {
    void store.refresh();
    return;
  }
  void store.loadFeed();
}

/**
 * Hook that subscribes a page to the runtime-owned moments feed projection.
 *
 * The Social runtime creates, refreshes, and tears down the feed store.
 * Mounting this hook only adds a render subscription.
 */
export function useMomentsFeed(
  store: MomentsFeedStoreController | null,
): UseMomentsFeedResult {
  const state = useMomentsStoreState(store);

  const loadFeed = useCallback(() => {
    void store?.loadFeed();
  }, [store]);

  const loadMore = useCallback(() => {
    void store?.loadMore();
  }, [store]);

  const refresh = useCallback(() => {
    void store?.refresh();
  }, [store]);

  const retryFailure = useCallback(() => {
    if (store) retryMomentsFeedFailure(store);
  }, [store]);

  const prependPost = useCallback(
    (post: Post) => {
      store?.prependPost(post);
    },
    [store],
  );

  const removePost = useCallback(
    (postId: string) => {
      store?.removePost(postId);
    },
    [store],
  );

  const updateReaction = useCallback(
    (postId: string, reactions: readonly ReactionSummary[]) => {
      store?.updateReaction(postId, reactions);
    },
    [store],
  );

  return {
    posts: state?.posts ?? [],
    loadState: state?.loadState ?? 'idle',
    hasMore: state?.hasMore ?? true,
    pageOutcome: state?.pageOutcome ?? TimelinePageOutcome.UNSPECIFIED,
    errorMessage: state?.errorMessage ?? '',
    failure: state?.failure ?? null,
    loadFeed,
    loadMore,
    refresh,
    retryFailure,
    prependPost,
    removePost,
    updateReaction,
  };
}

// ---------------------------------------------------------------------------
// Detail and comments hook
// ---------------------------------------------------------------------------

export interface UseMomentDetailResult {
  readonly detail: MomentDetailReadback;
  readonly comments: readonly Comment[];
  readonly loading: boolean;
  readonly hasMore: boolean;
  readonly errorMessage: string;
  readonly loadMore: () => void;
  readonly reloadMoment: () => Promise<boolean>;
}

/**
 * Subscribes to one runtime-owned Moment detail and comment projection.
 *
 * A page visit only dispatches an idempotent ensure command. Authoritative
 * state and overlapping-request fences remain in the session runtime store.
 */
export function useMomentDetail(
  store: MomentsFeedStoreController | null,
  postId: string,
): UseMomentDetailResult {
  const state = useMomentsStoreState(store);
  const selectedDetail = state?.selectedDetail;
  const detail = selectedDetail?.postId === postId
    ? selectedDetail.readback
    : LOADING_DETAIL;
  const commentsState = state?.commentsByPost.get(postId);

  useEffect(() => {
    if (!store || !postId) return;
    void store.ensureMoment(postId);
  }, [store, postId]);

  const loadMore = useCallback(() => {
    void store?.loadMoreComments(postId);
  }, [store, postId]);
  const reloadMoment = useCallback(
    () => store?.reloadMoment(postId) ?? Promise.resolve(false),
    [store, postId],
  );

  return {
    detail,
    comments: commentsState?.comments ?? [],
    loading: commentsState?.loading ?? detail.kind === 'available',
    hasMore: commentsState?.hasMore ?? true,
    errorMessage: commentsState?.errorMessage ?? '',
    loadMore,
    reloadMoment,
  };
}
