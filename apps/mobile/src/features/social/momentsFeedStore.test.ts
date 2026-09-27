// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  createMomentsFeedStore,
  resolveMomentPolicyState,
} from './momentsFeedStore';
import {
  PostDetailOutcome,
  TimelinePageOutcome,
} from '../../gen/proto/domain/social/post_pb';


function post(id: string) {
  return { id, reactions: [] };
}

function comment(id: string) {
  return {
    id,
    author: { displayName: id },
    content: id,
    isDeleted: false,
    replyToCommentId: '',
  };
}

function feedPage(ids: readonly string[], nextCursor = '', hasMore = false) {
  return {
    ok: true,
    data: {
      posts: ids.map(post),
      nextCursor,
      hasMore,
      outcome: ids.length > 0
        ? TimelinePageOutcome.ITEMS
        : TimelinePageOutcome.EMPTY,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('moments feed runtime projection', () => {
  it('keeps the bounded feed alive independently of page mounts', async () => {
    const gateway = {
      fetchFeed: vi.fn(async () => ({
        ok: true,
        data: {
          posts: [
            { id: 'post-1', reactions: [] },
            { id: 'post-2', reactions: [] },
          ],
          nextCursor: 'cursor-2',
          hasMore: false,
        },
      })),
    };
    const store = createMomentsFeedStore(gateway);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.loadFeed();

    expect(store.state()).toMatchObject({
      cursor: 'cursor-2',
      hasMore: false,
      loadState: 'idle',
    });
    expect(store.state().posts.map((post) => post.id)).toEqual([
      'post-1',
      'post-2',
    ]);
    expect(listener).toHaveBeenCalled();

    const callCount = listener.mock.calls.length;
    unsubscribe();
    store.prependPost({ id: 'post-3', reactions: [] });
    expect(listener).toHaveBeenCalledTimes(callCount);

    store.teardown();
    store.removePost('post-1');
    expect(store.state().posts.map((post) => post.id)).toContain('post-1');
  });

  it('retains every newly fetched page in a sliding bounded cache', async () => {
    const pages = Array.from({ length: 12 }, (_, pageIndex) => {
      const posts = Array.from(
        { length: 20 },
        (_, itemIndex) => post(`post-${pageIndex * 20 + itemIndex}`),
      );
      return {
        posts,
        explanations: [
          ...posts.map(({ id }) => ({ objectId: id })),
          { objectId: `orphan-${pageIndex}` },
        ],
        nextCursor: pageIndex === 11 ? '' : `cursor-${pageIndex + 1}`,
        hasMore: pageIndex < 11,
      };
    });
    let pageIndex = 0;
    const gateway = {
      fetchFeed: vi.fn(async () => ({
        ok: true,
        data: pages[pageIndex++],
      })),
    };
    const store = createMomentsFeedStore(gateway);
    const visited = new Set<string>();

    await store.loadFeed();
    store.state().posts.forEach(({ id }) => visited.add(id));
    while (store.state().hasMore) {
      await store.loadMore();
      expect(store.state().posts.length).toBeLessThanOrEqual(200);
      store.state().posts.forEach(({ id }) => visited.add(id));
    }

    const retainedIds = store.state().posts.map(({ id }) => id);
    expect(visited.size).toBe(240);
    expect(retainedIds).toEqual(
      Array.from({ length: 200 }, (_, index) => `post-${index + 40}`),
    );
    expect([...store.state().feedExplanations.keys()]).toEqual(retainedIds);
    expect(gateway.fetchFeed.mock.calls.map(([cursor]) => cursor)).toEqual([
      '',
      ...Array.from({ length: 11 }, (_, index) => `cursor-${index + 1}`),
    ]);

    store.prependPost(post('post-live'));
    expect(store.state().posts).toHaveLength(200);
    expect(store.state().posts[0].id).toBe('post-live');
    expect(store.state().posts.at(-1)?.id).toBe('post-238');
    expect(store.state().feedExplanations.has('post-239')).toBe(false);

    store.removePost('post-40');
    expect(store.state().feedExplanations.has('post-40')).toBe(false);
  });

  it('merges an authoritative refresh without losing retained pages', async () => {
    const gateway = {
      fetchFeed: vi.fn()
        .mockResolvedValueOnce(feedPage(['post-1', 'post-2'], 'cursor-page-2', true))
        .mockResolvedValueOnce(feedPage(['post-3', 'post-4'], 'cursor-page-3', true))
        .mockResolvedValueOnce({
          ok: true,
          data: {
            posts: [
              post('post-new'),
              { ...post('post-1'), authorPtid: 'ptid:updated' },
            ],
            nextCursor: 'cursor-refreshed-page-2',
            hasMore: true,
          },
        }),
    };
    const store = createMomentsFeedStore(gateway);

    await store.loadFeed();
    await store.loadMore();
    await store.refresh();

    expect(store.state().posts.map(({ id }) => id)).toEqual([
      'post-new',
      'post-1',
      'post-2',
      'post-3',
      'post-4',
    ]);
    expect(store.state().posts[1].authorPtid).toBe('ptid:updated');
    expect(store.state()).toMatchObject({
      cursor: 'cursor-refreshed-page-2',
      hasMore: true,
      loadState: 'idle',
    });
  });

  it('retains visible rows and retries the exact failed refresh', async () => {
    const gateway = {
      fetchFeed: vi.fn()
        .mockResolvedValueOnce(feedPage(['post-1', 'post-2'], 'cursor-page-2', true))
        .mockResolvedValueOnce({
          ok: false,
          error: { message: 'refresh unavailable' },
        })
        .mockResolvedValueOnce(feedPage(['post-new'], 'cursor-new', true)),
    };
    const store = createMomentsFeedStore(gateway);
    await store.loadFeed();
    const retainedPosts = store.state().posts;

    await expect(store.refresh()).resolves.toBe(false);
    expect(store.state()).toMatchObject({
      posts: retainedPosts,
      cursor: 'cursor-page-2',
      hasMore: true,
      loadState: 'error',
      failure: {
        kind: 'refresh',
        message: 'refresh unavailable',
      },
    });

    await expect(store.refresh()).resolves.toBe(true);
    expect(store.state()).toMatchObject({
      cursor: 'cursor-new',
      loadState: 'idle',
      failure: null,
    });
    expect(gateway.fetchFeed.mock.calls.map(([cursor]) => cursor)).toEqual([
      '',
      '',
      '',
    ]);
  });

  it('retains the cursor and retries the exact failed pagination read', async () => {
    const gateway = {
      fetchFeed: vi.fn()
        .mockResolvedValueOnce(feedPage(['post-1'], 'cursor-page-2', true))
        .mockResolvedValueOnce({
          ok: false,
          error: { message: 'page unavailable' },
        })
        .mockResolvedValueOnce(feedPage(['post-2'], '', false)),
    };
    const store = createMomentsFeedStore(gateway);
    await store.loadFeed();

    await store.loadMore();
    expect(store.state()).toMatchObject({
      cursor: 'cursor-page-2',
      hasMore: true,
      loadState: 'error',
      failure: {
        kind: 'load-more',
        message: 'page unavailable',
      },
    });
    expect(store.state().posts.map(({ id }) => id)).toEqual(['post-1']);

    await store.loadMore();
    expect(store.state()).toMatchObject({
      cursor: '',
      hasMore: false,
      loadState: 'idle',
      failure: null,
    });
    expect(store.state().posts.map(({ id }) => id)).toEqual([
      'post-1',
      'post-2',
    ]);
    expect(gateway.fetchFeed.mock.calls.map(([cursor]) => cursor)).toEqual([
      '',
      'cursor-page-2',
      'cursor-page-2',
    ]);
  });

  it('keeps initial-load failure distinct from retained-feed failures', async () => {
    const gateway = {
      fetchFeed: vi.fn(async () => ({
        ok: false,
        error: { message: 'initial unavailable' },
      })),
    };
    const store = createMomentsFeedStore(gateway);

    await store.loadFeed();

    expect(store.state()).toMatchObject({
      posts: [],
      loadState: 'error',
      failure: {
        kind: 'initial',
        message: 'initial unavailable',
      },
    });
  });

  it('rejects a late page after a preserving refresh', async () => {
    const stalePage = deferred<ReturnType<typeof feedPage>>();
    const replacement = deferred<ReturnType<typeof feedPage>>();
    const gateway = {
      fetchFeed: vi.fn()
        .mockResolvedValueOnce(feedPage(['post-initial'], 'cursor-page-2', true))
        .mockImplementationOnce(() => stalePage.promise)
        .mockImplementationOnce(() => replacement.promise),
    };
    const store = createMomentsFeedStore(gateway);
    await store.loadFeed();

    const pageRequest = store.loadMore();
    const refreshRequest = store.refresh();
    replacement.resolve(feedPage(['post-replacement'], 'cursor-fresh', false));
    await refreshRequest;
    stalePage.resolve(feedPage(['post-stale-page'], 'cursor-stale', false));
    await pageRequest;

    expect(store.state().posts.map(({ id }) => id)).toEqual([
      'post-replacement',
      'post-initial',
    ]);
    expect(store.state()).toMatchObject({
      cursor: 'cursor-fresh',
      hasMore: false,
      loadState: 'idle',
    });
  });

  it('rejects a late page error after a preserving refresh', async () => {
    const stalePage = deferred<{
      ok: false;
      error: { message: string };
    }>();
    const gateway = {
      fetchFeed: vi.fn()
        .mockResolvedValueOnce(feedPage(['post-initial'], 'cursor-page-2', true))
        .mockImplementationOnce(() => stalePage.promise)
        .mockResolvedValueOnce(feedPage(['post-replacement'], '', false)),
    };
    const store = createMomentsFeedStore(gateway);
    await store.loadFeed();

    const pageRequest = store.loadMore();
    await store.refresh();
    stalePage.resolve({
      ok: false,
      error: { message: 'obsolete page failure' },
    });
    await pageRequest;

    expect(store.state()).toMatchObject({
      loadState: 'idle',
      errorMessage: '',
    });
    expect(store.state().posts.map(({ id }) => id)).toEqual([
      'post-replacement',
      'post-initial',
    ]);
  });

  it('rejects a late initial load after a newer refresh', async () => {
    const initialLoad = deferred<ReturnType<typeof feedPage>>();
    const refresh = deferred<ReturnType<typeof feedPage>>();
    const gateway = {
      fetchFeed: vi.fn()
        .mockImplementationOnce(() => initialLoad.promise)
        .mockImplementationOnce(() => refresh.promise),
    };
    const store = createMomentsFeedStore(gateway);

    const loadRequest = store.loadFeed();
    const refreshRequest = store.refresh();
    refresh.resolve(feedPage(['post-refreshed'], 'cursor-refreshed', false));
    await refreshRequest;
    initialLoad.resolve(feedPage(['post-initial-late'], 'cursor-initial', false));
    await loadRequest;

    expect(store.state().posts.map(({ id }) => id)).toEqual(['post-refreshed']);
    expect(store.state().cursor).toBe('cursor-refreshed');
  });

  it('publishes only the latest overlapping refresh', async () => {
    const first = deferred<ReturnType<typeof feedPage>>();
    const second = deferred<ReturnType<typeof feedPage>>();
    const gateway = {
      fetchFeed: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    };
    const store = createMomentsFeedStore(gateway);

    const firstRefresh = store.refresh();
    const secondRefresh = store.refresh();
    second.resolve(feedPage(['post-newest'], 'cursor-newest', false));
    await secondRefresh;
    first.resolve(feedPage(['post-obsolete'], 'cursor-obsolete', false));
    await firstRefresh;

    expect(store.state().posts.map(({ id }) => id)).toEqual(['post-newest']);
    expect(store.state().cursor).toBe('cursor-newest');
  });

  it('keeps selected detail and comments across page subscription teardown', async () => {
    const detailPost = post('post-detail');
    const gateway = {
      getPost: vi.fn(async () => ({
        ok: true,
        data: {
          post: detailPost,
          outcome: PostDetailOutcome.AVAILABLE,
        },
      })),
      fetchComments: vi.fn(async () => ({
        ok: true,
        data: {
          comments: [comment('comment-1')],
          nextCursor: '',
          hasMore: false,
        },
      })),
    };
    const store = createMomentsFeedStore(gateway);
    const unsubscribe = store.subscribe(vi.fn());

    await store.ensureMoment('post-detail');
    unsubscribe();
    await store.ensureMoment('post-detail');

    expect(store.state().selectedDetail).toEqual({
      postId: 'post-detail',
      readback: { kind: 'available', post: detailPost },
    });
    expect(store.state().commentsByPost.get('post-detail')?.comments).toEqual([
      comment('comment-1'),
    ]);
    expect(gateway.getPost).toHaveBeenCalledOnce();
    expect(gateway.fetchComments).toHaveBeenCalledOnce();
  });

  it('projects realtime deletion into retained selected detail', async () => {
    const gateway = {
      getPost: vi.fn(async () => ({
        ok: true,
        data: {
          post: post('post-detail'),
          outcome: PostDetailOutcome.AVAILABLE,
        },
      })),
      fetchComments: vi.fn(async () => ({
        ok: true,
        data: { comments: [], nextCursor: '', hasMore: false },
      })),
    };
    const store = createMomentsFeedStore(gateway);

    await store.ensureMoment('post-detail');
    store.removePost('post-detail');

    expect(store.state().selectedDetail).toEqual({
      postId: 'post-detail',
      readback: {
        kind: 'deleted',
        post: { ...post('post-detail'), isDeleted: true },
      },
    });
  });

  it('reconciles retained selected detail and comments with the feed', async () => {
    const gateway = {
      fetchFeed: vi.fn(async () => feedPage(['post-1'])),
      getPost: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            post: post('post-1'),
            outcome: PostDetailOutcome.AVAILABLE,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            post: post('post-1-updated'),
            outcome: PostDetailOutcome.AVAILABLE,
          },
        }),
      fetchComments: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            comments: [comment('comment-1')],
            nextCursor: '',
            hasMore: false,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            comments: [comment('comment-2')],
            nextCursor: '',
            hasMore: false,
          },
        }),
    };
    const store = createMomentsFeedStore(gateway);
    await store.ensureMoment('post-1');

    await expect(store.reconcile()).resolves.toBe(true);

    expect(gateway.fetchFeed).toHaveBeenCalledOnce();
    expect(gateway.getPost).toHaveBeenCalledTimes(2);
    expect(gateway.fetchComments).toHaveBeenCalledTimes(2);
    expect(store.state().selectedDetail).toEqual({
      postId: 'post-1',
      readback: { kind: 'available', post: post('post-1-updated') },
    });
    expect(
      store.state().commentsByPost.get('post-1')?.comments.map(({ id }) => id),
    ).toEqual(['comment-2']);
  });

  it('reports reconciliation failure when retained detail or comments cannot refresh', async () => {
    const gateway = {
      fetchFeed: vi.fn(async () => feedPage(['post-1'])),
      getPost: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            post: post('post-1'),
            outcome: PostDetailOutcome.AVAILABLE,
          },
        })
        .mockResolvedValueOnce({
          ok: false,
          error: { message: 'detail unavailable' },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            post: post('post-1'),
            outcome: PostDetailOutcome.AVAILABLE,
          },
        }),
      fetchComments: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            comments: [comment('comment-1')],
            nextCursor: '',
            hasMore: false,
          },
        })
        .mockResolvedValueOnce({
          ok: false,
          error: { message: 'comments unavailable' },
        }),
    };
    const store = createMomentsFeedStore(gateway);
    await store.ensureMoment('post-1');

    await expect(store.reconcile()).resolves.toBe(false);
    expect(store.state().selectedDetail?.readback).toEqual({
      kind: 'unavailable',
      reason: 'detail unavailable',
    });

    await expect(store.reconcile()).resolves.toBe(false);
    expect(store.state().selectedDetail?.readback.kind).toBe('available');
    expect(store.state().commentsByPost.get('post-1')).toMatchObject({
      comments: [comment('comment-1')],
      loading: false,
      errorMessage: 'comments unavailable',
    });
  });

  it('rejects stale overlapping detail results', async () => {
    const first = deferred<{
      ok: true;
      data: { post: ReturnType<typeof post> };
    }>();
    const second = deferred<{
      ok: true;
      data: { post: ReturnType<typeof post> };
    }>();
    const gateway = {
      getPost: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
      fetchComments: vi.fn(async () => ({
        ok: true,
        data: { comments: [], nextCursor: '', hasMore: false },
      })),
    };
    const store = createMomentsFeedStore(gateway);

    const oldDetail = store.reloadMoment('post-old');
    const newDetail = store.reloadMoment('post-new');
    second.resolve({
      ok: true,
      data: {
        post: post('post-new'),
        outcome: PostDetailOutcome.AVAILABLE,
      },
    });
    await newDetail;
    first.resolve({
      ok: true,
      data: {
        post: post('post-old'),
        outcome: PostDetailOutcome.AVAILABLE,
      },
    });
    await oldDetail;

    expect(store.state().selectedDetail).toEqual({
      postId: 'post-new',
      readback: { kind: 'available', post: post('post-new') },
    });
    expect(gateway.fetchComments).toHaveBeenCalledOnce();
    expect(gateway.fetchComments).toHaveBeenCalledWith('post-new', '', 15);
  });

  it('distinguishes navigation supersession from a failed reconciliation', async () => {
    const oldDetail = deferred();
    const gateway = {
      fetchFeed: vi.fn(async () => feedPage(['post-a', 'post-b'])),
      getPost: vi.fn(async (id: string) => ({
        ok: true,
        data: {
          post: post(id),
          outcome: PostDetailOutcome.AVAILABLE,
        },
      })),
      fetchComments: vi.fn(async () => ({
        ok: true,
        data: { comments: [], nextCursor: '', hasMore: false },
      })),
    };
    const store = createMomentsFeedStore(gateway);
    await store.ensureMoment('post-a');
    gateway.getPost.mockImplementationOnce(() => oldDetail.promise);

    const reconciliation = store.reconcile();
    await store.ensureMoment('post-b');
    oldDetail.resolve({
      ok: true,
      data: {
        post: post('post-a'),
        outcome: PostDetailOutcome.AVAILABLE,
      },
    });

    await expect(reconciliation).resolves.toBeNull();
    expect(store.state().selectedDetail).toMatchObject({
      postId: 'post-b', readback: { kind: 'available' },
    });
  });

  it('discards a superseded feed reconciliation without reporting failure', async () => {
    const oldFeed = deferred();
    const gateway = {
      fetchFeed: vi.fn()
        .mockImplementationOnce(() => oldFeed.promise)
        .mockResolvedValueOnce(feedPage(['post-new'])),
    };
    const store = createMomentsFeedStore(gateway);
    const reconciliation = store.reconcile();
    await store.refresh();
    oldFeed.resolve(feedPage(['post-old']));

    await expect(reconciliation).resolves.toBeNull();
    expect(store.state().posts.map(({ id }) => id)).toEqual(['post-new']);
  });

  it('fences reconciliation when selection changes while its comments are in flight', async () => {
    const oldComments = deferred();
    const gateway = {
      fetchFeed: vi.fn(async () => feedPage(['post-a', 'post-b'])),
      getPost: vi.fn(async (id: string) => ({
        ok: true,
        data: {
          post: post(id),
          outcome: PostDetailOutcome.AVAILABLE,
        },
      })),
      fetchComments: vi.fn(async () => ({
        ok: true, data: { comments: [], nextCursor: '', hasMore: false },
      })),
    };
    const store = createMomentsFeedStore(gateway);
    await store.ensureMoment('post-a');
    gateway.fetchComments.mockImplementationOnce(() => oldComments.promise);
    const reconciliation = store.reconcile();
    await vi.waitFor(() => expect(gateway.fetchComments).toHaveBeenCalledTimes(2));
    await store.ensureMoment('post-b');
    oldComments.resolve({
      ok: true, data: { comments: [comment('old')], nextCursor: '', hasMore: false },
    });

    await expect(reconciliation).resolves.toBeNull();
    expect(store.state().selectedDetail?.postId).toBe('post-b');
  });

  it.each(['detail-error', 'comment-error', 'wrong-post', 'hidden', 'deleted'])(
    'keeps inline readback unsuccessful for %s without replacing the feed',
    async (failure) => {
      const gateway = {
        fetchFeed: vi.fn(async () => feedPage(['target'], 'retained-cursor', true)),
        getPost: vi.fn(async () => {
          if (failure === 'detail-error') {
            return { ok: false, error: { message: 'unavailable', status: 503 } };
          }
          if (failure === 'hidden') {
            return {
              ok: true,
              data: { outcome: PostDetailOutcome.HIDDEN },
            };
          }
          if (failure === 'deleted') {
            return {
              ok: true,
              data: { outcome: PostDetailOutcome.DELETED },
            };
          }
          return {
            ok: true,
            data: {
              post: post(failure === 'wrong-post' ? 'other' : 'target'),
              outcome: PostDetailOutcome.AVAILABLE,
            },
          };
        }),
        fetchComments: vi.fn(async () => ({ ok: false, error: { message: 'offline' } })),
      };
      const store = createMomentsFeedStore(gateway);
      await store.loadFeed();
      const posts = store.state().posts;

      await expect(store.refreshPost('target')).resolves.toBe(false);
      expect(store.state().posts).toBe(posts);
      expect(store.state().cursor).toBe('retained-cursor');
      expect(store.state().selectedDetail).toBeNull();
      expect(gateway.fetchFeed).toHaveBeenCalledOnce();
    },
  );

  it('fences inline readback after an authoritative feed refresh', async () => {
    const detail = deferred();
    const gateway = {
      fetchFeed: vi.fn()
        .mockResolvedValueOnce(feedPage(['target'], 'old-cursor', true))
        .mockResolvedValueOnce(feedPage(['new'])),
      getPost: vi.fn(() => detail.promise),
      fetchComments: vi.fn(),
    };
    const store = createMomentsFeedStore(gateway);
    await store.loadFeed();
    const readback = store.refreshPost('target');
    await store.refresh();
    detail.resolve({
      ok: true,
      data: {
        post: post('target'),
        outcome: PostDetailOutcome.AVAILABLE,
      },
    });

    await expect(readback).resolves.toBe(false);
    expect(gateway.fetchComments).not.toHaveBeenCalled();
    expect(store.state().posts.map(({ id }) => id)).toEqual(['new', 'target']);
  });

  it('rejects a late comment page after an authoritative reload', async () => {
    const stalePage = deferred<{
      ok: true;
      data: {
        comments: ReturnType<typeof comment>[];
        nextCursor: string;
        hasMore: boolean;
      };
    }>();
    const replacement = deferred<{
      ok: true;
      data: {
        comments: ReturnType<typeof comment>[];
        nextCursor: string;
        hasMore: boolean;
      };
    }>();
    const gateway = {
      fetchComments: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            comments: [comment('comment-initial')],
            nextCursor: 'comments-page-2',
            hasMore: true,
          },
        })
        .mockImplementationOnce(() => stalePage.promise)
        .mockImplementationOnce(() => replacement.promise),
    };
    const store = createMomentsFeedStore(gateway);
    await store.loadComments('post-1');

    const pageRequest = store.loadMoreComments('post-1');
    const refreshRequest = store.loadComments('post-1');
    replacement.resolve({
      ok: true,
      data: {
        comments: [comment('comment-replacement')],
        nextCursor: '',
        hasMore: false,
      },
    });
    await refreshRequest;
    stalePage.resolve({
      ok: true,
      data: {
        comments: [comment('comment-stale-page')],
        nextCursor: '',
        hasMore: false,
      },
    });
    await pageRequest;

    expect(
      store.state().commentsByPost.get('post-1')?.comments.map(({ id }) => id),
    ).toEqual(['comment-replacement']);
  });

  it('bounds retained comments and per-post comment projections', async () => {
    const initialComments = Array.from(
      { length: 180 },
      (_, index) => comment(`comment-${index}`),
    );
    const nextComments = Array.from(
      { length: 40 },
      (_, index) => comment(`comment-${index + 180}`),
    );
    const gateway = {
      fetchComments: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            comments: initialComments,
            nextCursor: 'comments-page-2',
            hasMore: true,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            comments: nextComments,
            nextCursor: '',
            hasMore: false,
          },
        })
        .mockImplementation(async (postId: string) => ({
          ok: true,
          data: {
            comments: [comment(`comment-for-${postId}`)],
            nextCursor: '',
            hasMore: false,
          },
        })),
    };
    const store = createMomentsFeedStore(gateway);

    await store.loadComments('post-bounded');
    await store.loadMoreComments('post-bounded');
    const retained = store.state().commentsByPost.get('post-bounded')?.comments ?? [];
    expect(retained).toHaveLength(200);
    expect(retained[0].id).toBe('comment-20');
    expect(retained.at(-1)?.id).toBe('comment-219');

    for (let index = 0; index < 20; index += 1) {
      await store.loadComments(`post-${index}`);
    }
    expect(store.state().commentsByPost.size).toBe(20);
    expect(store.state().commentsByPost.has('post-bounded')).toBe(false);
  });

  it('fences evicted comment reads even when the same post is visited again', async () => {
    const stale = deferred();
    const replacement = deferred();
    const gateway = {
      fetchComments: vi.fn()
        .mockImplementationOnce(() => stale.promise)
        .mockImplementation(async () => ({
          ok: true,
          data: { comments: [], nextCursor: '', hasMore: false },
        })),
    };
    const store = createMomentsFeedStore(gateway);
    const oldRequest = store.loadComments('post-evicted');
    for (let index = 0; index < 20; index += 1) {
      await store.loadComments(`post-${index}`);
    }
    expect(store.state().commentsByPost.has('post-evicted')).toBe(false);

    gateway.fetchComments.mockImplementationOnce(() => replacement.promise);
    const currentRequest = store.loadComments('post-evicted');
    stale.resolve({
      ok: true,
      data: { comments: [comment('stale')], nextCursor: '', hasMore: false },
    });
    await expect(oldRequest).resolves.toBe(false);
    expect(store.state().commentsByPost.get('post-evicted')?.loading).toBe(true);
    replacement.resolve({
      ok: true,
      data: { comments: [comment('current')], nextCursor: '', hasMore: false },
    });
    await expect(currentRequest).resolves.toBe(true);
    expect(store.state().commentsByPost.get('post-evicted')?.comments[0].id)
      .toBe('current');
  });

  it('never lets a completed evicted comment request reinsert its projection', async () => {
    const stale = deferred();
    const gateway = {
      fetchComments: vi.fn()
        .mockImplementationOnce(() => stale.promise)
        .mockImplementation(async () => ({
          ok: true,
          data: { comments: [], nextCursor: '', hasMore: false },
        })),
    };
    const store = createMomentsFeedStore(gateway);
    const oldRequest = store.loadComments('post-evicted');
    for (let index = 0; index < 20; index += 1) {
      await store.loadComments(`post-${index}`);
    }
    stale.resolve({
      ok: true,
      data: { comments: [comment('stale')], nextCursor: '', hasMore: false },
    });
    await expect(oldRequest).resolves.toBe(false);
    expect(store.state().commentsByPost.has('post-evicted')).toBe(false);
    expect(store.state().commentsByPost.size).toBe(20);
  });

  it('prunes settled reactions on eviction while retaining inflight ownership', async () => {
    const store = createMomentsFeedStore({
      fetchFeed: vi.fn(async () => feedPage(['post-current'])),
    });
    await store.loadFeed();
    const pending = store.beginReaction('post-current', 1);
    store.removePost('post-current');
    expect(store.state().reactionMutations.get('post-current')?.status).toBe('pending');
    store.rollbackReaction(pending, 'rejected');
    expect(store.state().reactionMutations.size).toBe(0);

    for (let index = 0; index < 220; index += 1) {
      const id = `post-${index}`;
      store.prependPost(post(id));
      store.rollbackReaction(store.beginReaction(id, 1), 'rejected');
      expect(store.state().reactionMutations.size).toBeLessThanOrEqual(200);
    }
    await store.refresh();
    expect(store.state().reactionMutations.size).toBeGreaterThan(0);
    for (let index = 0; index < 200; index += 1) {
      store.prependPost(post(`replacement-${index}`));
    }
    expect(store.state().reactionMutations.size).toBe(0);
  });

  it('rejects every late result after runtime teardown', async () => {
    const feed = deferred<ReturnType<typeof feedPage>>();
    const detail = deferred<{
      ok: true;
      data: { post: ReturnType<typeof post> };
    }>();
    const comments = deferred<{
      ok: true;
      data: {
        comments: ReturnType<typeof comment>[];
        nextCursor: string;
        hasMore: boolean;
      };
    }>();
    const gateway = {
      fetchFeed: vi.fn(() => feed.promise),
      getPost: vi.fn(() => detail.promise),
      fetchComments: vi.fn(() => comments.promise),
    };
    const store = createMomentsFeedStore(gateway);

    const feedRequest = store.refresh();
    const detailRequest = store.reloadMoment('post-1');
    const commentsRequest = store.loadComments('post-1');
    const snapshotAtTeardown = store.state();
    store.teardown();

    feed.resolve(feedPage(['post-late']));
    detail.resolve({
      ok: true,
      data: {
        post: post('post-late'),
        outcome: PostDetailOutcome.AVAILABLE,
      },
    });
    comments.resolve({
      ok: true,
      data: {
        comments: [comment('comment-late')],
        nextCursor: '',
        hasMore: false,
      },
    });
    await Promise.all([feedRequest, detailRequest, commentsRequest]);

    expect(store.state()).toBe(snapshotAtTeardown);
  });

  it('shows pending optimistic state, rolls back on rejection, and commits Station response', async () => {
    const gateway = {
      fetchFeed: vi.fn(async () => ({
        ok: true,
        data: {
          posts: [{
            id: 'post-1',
            reactions: [{ kind: 1, count: 2n, reactedByViewer: false }],
          }],
          nextCursor: '',
          hasMore: false,
        },
      })),
    };
    const store = createMomentsFeedStore(gateway);
    await store.loadFeed();

    const rejected = store.beginReaction('post-1', 1);
    expect(rejected).not.toBeNull();
    expect(store.state().reactionMutations.get('post-1')).toMatchObject({
      status: 'pending',
      reactionKind: 1,
    });
    expect(store.state().posts[0].reactions[0]).toMatchObject({
      count: 3n,
      reactedByViewer: true,
    });

    store.rollbackReaction(rejected, 'Station rejected reaction');
    expect(store.state().posts[0].reactions[0]).toMatchObject({
      count: 2n,
      reactedByViewer: false,
    });
    expect(store.state().reactionMutations.get('post-1')).toMatchObject({
      status: 'rolled-back',
      errorMessage: 'Station rejected reaction',
    });

    const accepted = store.beginReaction('post-1', 1);
    store.commitReaction(accepted, [{
      kind: 1,
      count: 8n,
      reactedByViewer: true,
    }]);

    expect(store.state().posts[0].reactions[0]).toMatchObject({
      count: 8n,
      reactedByViewer: true,
    });
    expect(store.state().reactionMutations.has('post-1')).toBe(false);
  });

  describe('selected-detail reactions', () => {
    function reactionGateway(inFeed = false) {
      const selectedPost = {
        id: 'selected',
        reactions: [{ kind: 1, count: 2n, reactedByViewer: false }],
      };
      return {
        fetchFeed: vi.fn(async () => ({
          ok: true,
          data: {
            posts: inFeed ? [selectedPost] : [post('recent')],
            nextCursor: 'next-page',
            hasMore: true,
            outcome: TimelinePageOutcome.ITEMS,
          },
        })),
        getPost: vi.fn(async (id: string) => ({
          ok: true,
          data: {
            post: { ...selectedPost, id },
            outcome: PostDetailOutcome.AVAILABLE,
          },
        })),
        fetchComments: vi.fn(async () => ({
          ok: true,
          data: { comments: [], nextCursor: '', hasMore: false },
        })),
      };
    }

    it.each([false, true])('publishes optimistic, rollback, and committed detail state (inFeed=%s)', async (inFeed) => {
      const gateway = reactionGateway(inFeed);
      const store = createMomentsFeedStore(gateway);
      await store.loadFeed();
      await store.ensureMoment('selected');
      const feedIds = store.state().posts.map(({ id }) => id);
      const reactions = () => store.state().selectedDetail.readback.post.reactions;

      const pending = store.beginReaction('selected', 1);
      expect(pending).not.toBeNull();
      expect(reactions()[0]).toMatchObject({ count: 3n, reactedByViewer: true });
      expect(store.beginReaction('selected', 1)).toBeNull();

      store.rollbackReaction(pending, 'rejected');
      expect(reactions()[0]).toMatchObject({ count: 2n, reactedByViewer: false });
      expect(store.state().reactionMutations.get('selected')?.status).toBe('rolled-back');

      const retry = store.beginReaction('selected', 1);
      store.commitReaction(retry, [{ kind: 1, count: 8n, reactedByViewer: true }]);
      expect(reactions()[0]).toMatchObject({ count: 8n, reactedByViewer: true });
      expect(store.state().reactionMutations.has('selected')).toBe(false);
      if (inFeed) expect(store.state().posts[0].reactions).toEqual(reactions());
      expect(store.state().posts.map(({ id }) => id)).toEqual(feedIds);
      expect(store.state().cursor).toBe('next-page');
    });

    it('retains detail rollback metadata only while its projection is retained', async () => {
      const store = createMomentsFeedStore(reactionGateway());
      await store.loadFeed();
      await store.ensureMoment('selected');
      const pending = store.beginReaction('selected', 1);
      expect(pending).not.toBeNull();
      store.rollbackReaction(pending, 'rejected');
      await store.refresh();
      expect(store.state().reactionMutations.get('selected')?.status).toBe('rolled-back');
      await store.ensureMoment('other');
      expect(store.state().reactionMutations.has('selected')).toBe(false);
    });

    it.each(['commit', 'rollback'])('settles an evicted detail without replacing a newer selection (%s)', async (settlement) => {
      const store = createMomentsFeedStore(reactionGateway());
      await store.loadFeed();
      await store.ensureMoment('selected');
      const pending = store.beginReaction('selected', 1);
      expect(pending).not.toBeNull();
      await store.ensureMoment('other');
      const selectedDetail = store.state().selectedDetail;
      expect(store.state().reactionMutations.get('selected')?.status).toBe('pending');
      if (settlement === 'commit') store.commitReaction(pending, []);
      else store.rollbackReaction(pending, 'rejected');
      expect(store.state().selectedDetail).toBe(selectedDetail);
      expect(store.state().reactionMutations.has('selected')).toBe(false);
      expect(store.state().posts.map(({ id }) => id)).toEqual(['recent']);
    });

    it.each(['unavailable', 'hidden', 'deleted'])('does not react from an old feed row when detail is %s', async (kind) => {
      const gateway = reactionGateway(true);
      gateway.getPost.mockResolvedValueOnce(kind === 'deleted'
        ? {
          ok: true,
          data: { outcome: PostDetailOutcome.DELETED },
        }
        : kind === 'hidden'
          ? {
            ok: true,
            data: { outcome: PostDetailOutcome.HIDDEN },
          }
          : { ok: false, error: { message: 'unavailable', status: 503 } });
      const store = createMomentsFeedStore(gateway);
      await store.loadFeed();
      await store.ensureMoment('selected');
      expect(store.state().selectedDetail.readback.kind).toBe(kind);
      expect(store.beginReaction('selected', 1)).toBeNull();
      expect(store.state().reactionMutations.size).toBe(0);
    });
  });

  it('retains authoritative feed explanations for policy-hidden rendering', async () => {
    const policyExplanation = {
      objectId: 'post-hidden',
      audienceExplanation: { policyFiltered: true },
    };
    const gateway = {
      fetchFeed: vi.fn(async () => ({
        ok: true,
        data: {
          posts: [post('post-hidden')],
          explanations: [
            policyExplanation,
            { objectId: 'not-retained', audienceExplanation: { policyFiltered: true } },
          ],
          nextCursor: '',
          hasMore: false,
        },
      })),
    };
    const store = createMomentsFeedStore(gateway);

    await store.loadFeed();

    expect(store.state().feedExplanations.get('post-hidden')).toBe(policyExplanation);
    expect(store.state().feedExplanations.has('not-retained')).toBe(false);
    expect(resolveMomentPolicyState(policyExplanation)).toBe('hidden');
    expect(resolveMomentPolicyState({
      objectId: 'post-blocked',
      blockExplanation: { kind: 4 },
    })).toBe('blocked');
  });
});
