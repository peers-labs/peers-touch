// @ts-nocheck -- Vitest is supplied by the repository test runner.

import React from 'react';
import { readFileSync } from 'node:fs';
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
  submitInlineCommentIntent,
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
  privatePostsById: {},
  runtimeOverride: null,
}));

vi.mock('../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../features/auth/authStore', () => ({
  useAuthStore: (selector: (state: object) => unknown) =>
    selector({
      session: {
        stationPeerId: 'station-a',
        actorRef: { ptid: 'ptid:alice' },
      },
    }),
}));

vi.mock('../features/social/useMomentsFeed', () => ({
  useMomentsFeed: () => pageMocks.feed,
  useMomentsProjectionState: () => ({
    availability: pageMocks.projectionAvailability,
  }),
}));

vi.mock('../features/social/useSocialExperience', () => ({
  useSocialExperience: () => {
    const facade = pageMocks.runtimeOverride ?? {
      intents: {
        retry: async () => pageMocks.projectionAvailability.available,
      },
      feed: {
        state: () => pageMocks.runtimeFeedState,
        subscribe: () => () => undefined,
      },
    };
    return {
      facade,
      projection: {
        home: {
          ...facade.feed.state(),
          ...pageMocks.feed,
          ...pageMocks.runtimeFeedState,
        },
        runtime: {
          availability: pageMocks.projectionAvailability,
          privateSocial: {
            postsById: pageMocks.privatePostsById,
          },
        },
      },
    };
  },
}));

vi.mock('./moments/MomentFeedItem', async () => {
  const { createElement } = await import('react');
  return {
    MomentFeedItem: ({ post, children }) =>
      createElement('article', { 'data-moment-id': post.id }, children),
  };
});

describe('Moments feed-first interaction source contract', () => {
  const source = readFileSync(
    new URL('./MomentsPage.tsx', import.meta.url),
    'utf8',
  );
  const scopeHeaderSource = readFileSync(
    new URL('./moments/MomentsScopeHeader.tsx', import.meta.url),
    'utf8',
  );
  const sortSheetSource = readFileSync(
    new URL('./moments/ExploreSortSheet.tsx', import.meta.url),
    'utf8',
  );
  const moduleStyles = readFileSync(
    new URL('./moments/Moments.css', import.meta.url),
    'utf8',
  );
  const globalStyles = readFileSync(
    new URL('../styles.css', import.meta.url),
    'utf8',
  );

  it('keeps one selected inline thread without ordinary Detail navigation', () => {
    expect(source).toContain('selectedThreadPostId');
    expect(source).toContain('current === postId ? null : postId');
    expect(source).toContain('selectedThreadPostId === post.id');
    expect(source).not.toContain('if (activePostId)');
    expect(source).not.toContain('mobile-detail-page');
    expect(source).not.toContain('onOpenMoment(postId)');
  });

  it('owns one temporary media selection outside virtualized feed cards', () => {
    expect(source).toContain('const [mediaSelection, setMediaSelection]');
    expect(source).toContain('<MomentMediaOverlay');
    expect(source).toContain('onClose={() => setMediaSelection(null)}');
  });

  it('matches the confirmed header, scope, and bottom-sheet interaction model', () => {
    expect(scopeHeaderSource).toContain(
      'data-acceptance-id="social-circles-open"',
    );
    expect(scopeHeaderSource).toContain("t('mobile.moments.subtitle')");
    expect(scopeHeaderSource).toContain("t('mobile.social.circles.title')");
    expect(scopeHeaderSource).toContain("scope === 'explore' ? (");
    expect(scopeHeaderSource).toContain('className="moments-context-row"');
    expect(moduleStyles).toContain(
      'grid-template-columns: repeat(3, minmax(0, 1fr))',
    );
    expect(sortSheetSource).toContain(
      'className="moments-sheet-backdrop moments-sort-backdrop"',
    );
    expect(sortSheetSource).toContain(
      'className="moments-bottom-sheet moments-sort-sheet"',
    );
    expect(sortSheetSource).toContain('onPointerDown={onClose}');
    expect(sortSheetSource).toContain(
      'onPointerDown={(event) => event.stopPropagation()}',
    );
    expect(sortSheetSource).not.toContain('common.action.close');
    expect(source).toContain('onClose={() => setShowNewPost(false)}');
  });

  it('owns one prototype-derived Moments stylesheet without global legacy rules', () => {
    expect(source).toContain("import './moments/Moments.css'");
    expect(moduleStyles).toContain('.moments-author {');
    expect(moduleStyles).toContain('.moments-article-body {');
    expect(moduleStyles).toContain('.moments-comments-section--inline {');
    expect(moduleStyles).not.toContain('.moments-card {');
    expect(globalStyles).not.toMatch(
      /\.moments-(?:page|card|feed|scope|comments|sheet)/,
    );
  });

  it('keeps inline comments inside their owning article', () => {
    expect(source).toContain('className="moments-feed-entry"');
    expect(source).toContain('</MomentFeedItem>');
    expect(source).not.toMatch(
      /<\/MomentFeedItem>\s*\)\}\s*\{selectedThreadPostId === post\.id/,
    );
  });

  it('matches the prototype feed frame and native scroll ownership', () => {
    expect(moduleStyles).toMatch(
      /\.moments-feed\s*\{[\s\S]*?gap:\s*10px;[\s\S]*?padding:\s*10px 12px 20px;/,
    );
    expect(moduleStyles).toMatch(
      /\.moments-header-actions button,[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
    );
    expect(moduleStyles).toMatch(
      /\.page-container\.moments-page\s*\{[\s\S]*?padding-bottom:\s*0;/,
    );
    expect(moduleStyles).not.toContain(
      'padding-bottom: calc(var(--tabbar-height)',
    );
  });
});

function renderMomentsPage(): string {
  return renderToStaticMarkup(
    React.createElement(MomentsPage, {
      activePostId: null,
      onOpenProfile: () => undefined,
      onOpenSearch: () => undefined,
      onOpenCircles: () => undefined,
      onBack: () => undefined,
    }),
  );
}

describe('Moments page inline comment intent', () => {
  it('reads back the paginated target without resetting the feed or selecting another detail', async () => {
    const gateway = {
      fetchFeed: vi
        .fn()
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
      createComment: vi.fn(async () => ({
        ok: true,
        data: { comment: { id: 'added' } },
      })),
      getPost: vi.fn(async (id: string) => ({
        ok: true,
        data: {
          post: { id, reactions: [], commentsCount: 1n },
          outcome: PostDetailOutcome.AVAILABLE,
        },
      })),
      fetchComments: vi.fn(async () => ({
        ok: true,
        data: { comments: [{ id: 'added' }], nextCursor: '', hasMore: false },
      })),
    };
    const store = createMomentsFeedStore(gateway);
    await store.loadFeed();
    await store.loadMore();
    pageMocks.feed.posts = [...store.state().posts];
    pageMocks.projectionAvailability = { available: true };
    const intents = {
      retry: async () => true,
      comment: async (postId: string, content: string) => {
        const created = await gateway.createComment(postId, content);
        return created.ok && store.refreshPost(postId);
      },
    };
    pageMocks.runtimeOverride = { intents, feed: store };
    try {
      await expect(
        submitInlineCommentIntent(intents, 'older', 'New comment'),
      ).resolves.toBe(true);
      expect(gateway.getPost).toHaveBeenCalledWith('older');
      expect(gateway.fetchComments).toHaveBeenCalledWith('older', '', 15);
      expect(gateway.fetchFeed).toHaveBeenCalledTimes(2);
      expect(store.state().cursor).toBe('page-3');
      expect(
        store.state().posts.find(({ id }) => id === 'older')?.commentsCount,
      ).toBe(1n);
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
      submitInlineCommentIntent(
        {
          comment: async (postId, content) => {
            const result = await gateway.createComment(postId, content);
            return result.ok && refresh(postId);
          },
        },
        'post-1',
        'Authoritative comment',
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
      submitInlineCommentIntent(
        {
          comment: async (postId, content) => {
            const result = await gateway.createComment(postId, content);
            return result.ok && refresh(postId);
          },
        },
        'post-1',
        'Rejected comment',
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
      submitInlineCommentIntent(
        {
          comment: async (postId, content) => {
            const result = await gateway.createComment(postId, content);
            return result.ok && refresh(postId);
          },
        },
        'post-1',
        'Unconfirmed comment',
      ),
    ).resolves.toBe(false);
    expect(refresh).toHaveBeenCalledExactlyOnceWith('post-1');
  });
});

describe('Moments retry availability', () => {
  it('marks the projection available only after successful runtime reconciliation', async () => {
    const failedRetry = vi.fn(async () => false);

    await expect(
      retryMomentsRuntime({
        retry: failedRetry,
      }),
    ).resolves.toBe(false);
    expect(failedRetry).toHaveBeenCalledOnce();

    const successfulRetry = vi.fn(async () => true);
    await expect(
      retryMomentsRuntime({
        retry: successfulRetry,
      }),
    ).resolves.toBe(true);
    expect(successfulRetry).toHaveBeenCalledOnce();

    await expect(
      retryMomentsRuntime({
        retry: vi.fn(async () => {
          throw new Error('offline');
        }),
      }),
    ).resolves.toBe(false);
  });
});

describe('Moments private-state feed projection', () => {
  beforeEach(() => {
    pageMocks.feed.posts = [];
    pageMocks.feed.loadState = 'idle';
    pageMocks.feed.pageOutcome = TimelinePageOutcome.EMPTY;
    pageMocks.projectionAvailability = { available: true };
    pageMocks.privatePostsById = {};
  });

  it('does not render orphan deleted or revoked projections as feed cards', () => {
    pageMocks.privatePostsById = {
      'post-deleted': {
        postId: 'post-deleted',
        state: 'DELETED_OR_REVOKED',
        errorCode: 'RESOURCE_DELETED',
      },
      'post-revoked': {
        postId: 'post-revoked',
        state: 'DELETED_OR_REVOKED',
        errorCode: 'RELATIONSHIP_REVOKED',
      },
    };

    const markup = renderMomentsPage();

    expect(markup).not.toContain(
      'data-private-moment-state="DELETED_OR_REVOKED"',
    );
    expect(markup).not.toContain('post-deleted');
    expect(markup).not.toContain('post-revoked');
    expect(markup).toContain('mobile.moments.feed.empty');
  });

  it('keeps actionable orphan recovery state in the Home feed', () => {
    pageMocks.privatePostsById = {
      'post-recovery': {
        postId: 'post-recovery',
        state: 'RECOVERY_REQUIRED',
      },
    };

    const markup = renderMomentsPage();

    expect(markup).toContain('data-private-moment-state="RECOVERY_REQUIRED"');
    expect(markup).toContain('data-private-moment-post-id="post-recovery"');
    expect(markup).not.toContain('mobile.moments.feed.emptyHint');
  });
});

describe('Moments page bounded feed', () => {
  beforeEach(() => {
    clearAllScrollPositions();
    pageMocks.feed.posts = Array.from({ length: 200 }, (_, index) => ({
      id: `post-${index}`,
      reactions: [],
    }));
    pageMocks.feed.loadState = 'idle';
    pageMocks.feed.hasMore = true;
    pageMocks.feed.pageOutcome = TimelinePageOutcome.ITEMS;
    pageMocks.runtimeFeedState.feedExplanations = new Map();
    pageMocks.runtimeFeedState.reactionMutations = new Map();
    pageMocks.projectionAvailability = { available: true };
    pageMocks.privatePostsById = {};
  });

  it('does not render detail content while the Moments runtime is unavailable', () => {
    pageMocks.projectionAvailability = {
      available: false,
      reason: 'offline',
    };

    const markup = renderToStaticMarkup(
      React.createElement(MomentsPage, {
        activePostId: 'post-1',
        onOpenMoment: () => undefined,
        onOpenSearch: () => undefined,
        onOpenCircles: () => undefined,
        onBack: () => undefined,
      }),
    );

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

    saveListAnchor('moments:feed:home', 'post-100');
    const tail = renderMomentsPage();

    expect(tail.match(/data-moment-id=/g)).toHaveLength(100);
    expect(tail).toContain('data-scroll-anchor-id="post-199"');
    expect(tail).toContain('mobile.list.previous');
    expect(tail).toContain('mobile.moments.feed.loadMore');
  });

  it('keeps the overlapping identity window reachable when the retained cache slides', () => {
    saveListAnchor('moments:feed:home', 'post-100');
    const beforeSlide = renderMomentsPage();
    expect(beforeSlide).toContain('data-scroll-anchor-id="post-100"');
    expect(beforeSlide).toContain('data-scroll-anchor-id="post-199"');

    pageMocks.feed.posts = Array.from({ length: 200 }, (_, index) => ({
      id: `post-${index + 20}`,
      reactions: [],
    }));
    const afterSlide = renderMomentsPage();

    expect(afterSlide.match(/data-moment-id=/g)).toHaveLength(100);
    expect(afterSlide).toContain('data-window-start="80"');
    expect(afterSlide).toContain('data-scroll-anchor-id="post-100"');
    expect(afterSlide).toContain('data-scroll-anchor-id="post-199"');
    expect(afterSlide).toContain('mobile.list.next');
    expect(afterSlide).not.toContain('mobile.moments.feed.loadMore');

    saveListAnchor('moments:feed:home', 'post-120');
    const fetchedTail = renderMomentsPage();
    expect(fetchedTail).toContain('data-scroll-anchor-id="post-219"');
    expect(fetchedTail).toContain('mobile.moments.feed.loadMore');
  });

  it('keeps visible posts mounted while a user-triggered refresh is running', () => {
    pageMocks.feed.loadState = 'refreshing';

    const markup = renderMomentsPage();

    expect(markup.match(/data-moment-id=/g)).toHaveLength(100);
    expect(markup).not.toContain('mobile.moments.feed.loading');
    expect(markup).not.toContain('moments-feed-loading-more');
  });
});
