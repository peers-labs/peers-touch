// @ts-nocheck -- Vitest is supplied by the repository test runner.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAllScrollPositions,
  saveListAnchor,
} from '../app/navigation/scrollRestoration';
import { createMomentsFeedStore } from '../features/social/momentsFeedStore';
import {
  PostDetailOutcome,
  TimelinePageOutcome,
} from '../gen/proto/domain/social/post_pb';
import {
  MomentsPage,
  retryMomentsRuntime,
  submitInlineCommentToGateway,
} from './MomentsPage';

const pageMocks = vi.hoisted(() => ({
  feed: {
    posts: [],
    loadState: 'idle',
    hasMore: true,
    pageOutcome: 2,
    errorMessage: '',
    loadFeed: () => undefined,
    loadMore: () => undefined,
    refresh: () => undefined,
    prependPost: () => undefined,
    removePost: () => undefined,
    updateReaction: () => undefined,
  },
  runtimeFeedState: {
    feedExplanations: new Map(),
    reactionMutations: new Map(),
  },
  projectionAvailability: { available: true },
  runtimeOverride: null,
  inlineSubmit: null,
}));

vi.mock('../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../features/auth/authStore', () => ({
  useAuthStore: (selector: (state: object) => unknown) => selector({
    session: { stationPeerId: 'station-a', actorPtid: 'ptid:alice' },
  }),
}));

vi.mock('../features/social/useMomentsFeed', () => ({
  useMomentsFeed: () => pageMocks.feed,
  useMomentsProjectionState: () => ({
    availability: pageMocks.projectionAvailability,
  }),
}));

vi.mock('../runtimes/socialProjectionRuntime', () => ({
  readActiveMomentsRuntime: () => pageMocks.runtimeOverride ?? ({
    gateway: {},
    projection: {
      state: () => ({ availability: pageMocks.projectionAvailability }),
      subscribe: () => () => undefined,
    },
    feed: {
      state: () => pageMocks.runtimeFeedState,
      beginReaction: () => null,
      retry: async () => pageMocks.projectionAvailability.available,
    },
    retry: async () => pageMocks.projectionAvailability.available,
  }),
}));

vi.mock('./moments/MomentFeedItem', async () => {
  const { createElement } = await import('react');
  return {
    MomentFeedItem: ({ post, onSubmitComment }) => {
      pageMocks.inlineSubmit = onSubmitComment;
      return createElement('article', { 'data-moment-id': post.id });
    },
  };
});

function renderMomentsPage(): string {
  return renderToStaticMarkup(React.createElement(MomentsPage, {
    activePostId: null,
    onOpenMoment: () => undefined,
    onBack: () => undefined,
  }));
}

describe('Moments page inline comment gateway', () => {
  it('reads back the paginated target without resetting the feed or selecting another detail', async () => {
    const gateway = {
      fetchFeed: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            posts: [{ id: 'recent', reactions: [] }],
            nextCursor: 'page-2',
            hasMore: true,
            outcome: TimelinePageOutcome.ITEMS,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            posts: [{ id: 'older', reactions: [], commentsCount: 0n }],
            nextCursor: 'page-3',
            hasMore: true,
            outcome: TimelinePageOutcome.ITEMS,
          },
        })
        .mockResolvedValue({
          ok: true,
          data: {
            posts: [{ id: 'recent', reactions: [] }],
            nextCursor: 'page-2',
            hasMore: true,
            outcome: TimelinePageOutcome.ITEMS,
          },
        }),
      createComment: vi.fn(async () => ({ ok: true, data: { comment: { id: 'added' } } })),
      getPost: vi.fn(async (id: string) => ({
        ok: true,
        data: {
          post: { id, reactions: [], commentsCount: 1n },
          outcome: PostDetailOutcome.AVAILABLE,
        },
      })),
      fetchComments: vi.fn(async () => ({
        ok: true, data: { comments: [{ id: 'added' }], nextCursor: '', hasMore: false },
      })),
    };
    const store = createMomentsFeedStore(gateway);
    await store.loadFeed();
    await store.loadMore();
    pageMocks.feed.posts = [...store.state().posts];
    pageMocks.projectionAvailability = { available: true };
    pageMocks.runtimeOverride = { gateway, feed: store, projection: {} };
    try {
      renderMomentsPage();
      await expect(pageMocks.inlineSubmit('older', 'New comment')).resolves.toBe(true);
      expect(gateway.getPost).toHaveBeenCalledWith('older');
      expect(gateway.fetchComments).toHaveBeenCalledWith('older', '', 15);
      expect(gateway.fetchFeed).toHaveBeenCalledTimes(2);
      expect(store.state().cursor).toBe('page-3');
      expect(store.state().posts.find(({ id }) => id === 'older')?.commentsCount).toBe(1n);
      expect(store.state().selectedDetail).toBeNull();
    } finally {
      pageMocks.runtimeOverride = null;
      store.teardown();
    }
  });

  it('waits for authoritative runtime readback before returning success', async () => {
    const gateway = {
      createComment: vi.fn(async () => ({
        ok: true,
        data: { comment: { id: 'comment-1' } },
      })),
    };
    const refresh = vi.fn(async () => true);

    await expect(
      submitInlineCommentToGateway(
        gateway,
        'post-1',
        'Authoritative comment',
        { refreshPost: refresh },
      ),
    ).resolves.toBe(true);
    expect(gateway.createComment).toHaveBeenCalledWith(
      'post-1',
      'Authoritative comment',
    );
    expect(refresh).toHaveBeenCalledExactlyOnceWith('post-1');
  });

  it('preserves the draft when Station rejects the inline comment', async () => {
    const gateway = {
      createComment: vi.fn(async () => ({
        ok: false,
        error: { message: 'rejected' },
      })),
    };
    const refresh = vi.fn(async () => true);

    await expect(
      submitInlineCommentToGateway(
        gateway,
        'post-1',
        'Rejected comment',
        { refreshPost: refresh },
      ),
    ).resolves.toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('preserves the draft when authoritative readback fails after creation', async () => {
    const gateway = {
      createComment: vi.fn(async () => ({
        ok: true,
        data: { comment: { id: 'comment-1' } },
      })),
    };
    const refresh = vi.fn(async () => false);

    await expect(
      submitInlineCommentToGateway(
        gateway,
        'post-1',
        'Unconfirmed comment',
        { refreshPost: refresh },
      ),
    ).resolves.toBe(false);
    expect(refresh).toHaveBeenCalledExactlyOnceWith('post-1');
  });
});

describe('Moments retry availability', () => {
  it('marks the projection available only after successful runtime reconciliation', async () => {
    const failedRetry = vi.fn(async () => false);

    await expect(retryMomentsRuntime({
      retry: failedRetry,
    })).resolves.toBe(false);
    expect(failedRetry).toHaveBeenCalledOnce();

    const successfulRetry = vi.fn(async () => true);
    await expect(retryMomentsRuntime({
      retry: successfulRetry,
    })).resolves.toBe(true);
    expect(successfulRetry).toHaveBeenCalledOnce();

    await expect(retryMomentsRuntime({
      retry: vi.fn(async () => {
        throw new Error('offline');
      }),
    })).resolves.toBe(false);
  });
});

describe('Moments page bounded feed', () => {
  beforeEach(() => {
    clearAllScrollPositions();
    pageMocks.feed.posts = Array.from(
      { length: 200 },
      (_, index) => ({ id: `post-${index}`, reactions: [] }),
    );
    pageMocks.feed.loadState = 'idle';
    pageMocks.feed.hasMore = true;
    pageMocks.feed.pageOutcome = TimelinePageOutcome.ITEMS;
    pageMocks.runtimeFeedState.feedExplanations = new Map();
    pageMocks.runtimeFeedState.reactionMutations = new Map();
    pageMocks.projectionAvailability = { available: true };
  });

  it('does not render detail content while the Moments runtime is unavailable', () => {
    pageMocks.projectionAvailability = {
      available: false,
      reason: 'offline',
    };

    const markup = renderToStaticMarkup(React.createElement(MomentsPage, {
      activePostId: 'post-1',
      onOpenMoment: () => undefined,
      onBack: () => undefined,
    }));

    expect(markup).toContain('mobile.moments.unavailable.title');
    expect(markup).not.toContain('moments-comments-section');
  });

  it.each([
    [TimelinePageOutcome.EMPTY, 'mobile.moments.feed.empty'],
    [TimelinePageOutcome.FILTERED_EMPTY, 'mobile.moments.policy.violation'],
  ])('renders the owner-authored empty outcome %s', (outcome, expectedKey) => {
    pageMocks.feed.posts = [];
    pageMocks.feed.pageOutcome = outcome;

    const markup = renderMomentsPage();

    expect(markup).toContain(expectedKey);
    if (outcome === TimelinePageOutcome.EMPTY) {
      expect(markup).not.toContain('mobile.moments.policy.violation');
    } else {
      expect(markup).not.toContain('mobile.moments.feed.emptyHint');
    }
  });

  it('mounts one bounded window and exposes Station pagination only at its tail', () => {
    const initial = renderMomentsPage();

    expect(initial.match(/data-moment-id=/g)).toHaveLength(100);
    expect(initial).toContain('data-window-total="200"');
    expect(initial).toContain('data-scroll-anchor-id="post-0"');
    expect(initial).toContain('mobile.list.next');
    expect(initial).not.toContain('mobile.moments.feed.loadMore');

    saveListAnchor('moments:feed', 'post-100');
    const tail = renderMomentsPage();

    expect(tail.match(/data-moment-id=/g)).toHaveLength(100);
    expect(tail).toContain('data-scroll-anchor-id="post-199"');
    expect(tail).toContain('mobile.list.previous');
    expect(tail).toContain('mobile.moments.feed.loadMore');
  });

  it('keeps the overlapping identity window reachable when the retained cache slides', () => {
    saveListAnchor('moments:feed', 'post-100');
    const beforeSlide = renderMomentsPage();
    expect(beforeSlide).toContain('data-scroll-anchor-id="post-100"');
    expect(beforeSlide).toContain('data-scroll-anchor-id="post-199"');

    pageMocks.feed.posts = Array.from(
      { length: 200 },
      (_, index) => ({ id: `post-${index + 20}`, reactions: [] }),
    );
    const afterSlide = renderMomentsPage();

    expect(afterSlide.match(/data-moment-id=/g)).toHaveLength(100);
    expect(afterSlide).toContain('data-window-start="80"');
    expect(afterSlide).toContain('data-scroll-anchor-id="post-100"');
    expect(afterSlide).toContain('data-scroll-anchor-id="post-199"');
    expect(afterSlide).toContain('mobile.list.next');
    expect(afterSlide).not.toContain('mobile.moments.feed.loadMore');

    saveListAnchor('moments:feed', 'post-120');
    const fetchedTail = renderMomentsPage();
    expect(fetchedTail).toContain('data-scroll-anchor-id="post-219"');
    expect(fetchedTail).toContain('mobile.moments.feed.loadMore');
  });

  it('keeps visible posts mounted while a user-triggered refresh is running', () => {
    pageMocks.feed.loadState = 'refreshing';

    const markup = renderMomentsPage();

    expect(markup).toContain('aria-label="mobile.moments.feed.refresh"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/data-moment-id=/g)).toHaveLength(100);
    expect(markup).toContain('mobile.moments.feed.loading');
  });
});
