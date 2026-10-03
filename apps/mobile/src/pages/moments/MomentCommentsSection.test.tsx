// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PostDetailOutcome } from '../../gen/proto/domain/social/post_pb';

const detailHook = vi.hoisted(() => ({
  current: {
    detail: { kind: 'loading' },
    comments: [],
    loading: false,
    hasMore: false,
    errorMessage: '',
    loadComments: vi.fn(),
    loadMore: vi.fn(),
    reloadMoment: vi.fn(async () => true),
  },
}));

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../features/auth/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ session: {} }),
}));

vi.mock('../../runtimes/socialProjectionRuntime', () => ({
  readActiveMomentsRuntime: () => ({ feed: {} }),
}));

vi.mock('../../features/social/useMomentsFeed', () => ({
  useMomentDetail: () => detailHook.current,
}));

import {
  createMomentCommentAndReload,
  deleteMomentCommentAndReload,
  MomentCommentsSection,
  readAuthoritativeMomentDetail,
  retryMomentDetailRuntime,
} from './MomentCommentsSection';

describe('Moment detail', () => {
  const feedPost = {
    id: 'post-1',
    author: { displayName: 'Alice' },
    content: {
      case: 'textPost',
      value: { text: 'Stale feed body' },
    },
    reactions: [],
    isDeleted: false,
  };

  it('does not render a stale feed snapshot before authoritative readback', () => {
    const markup = renderToStaticMarkup(
      <MomentCommentsSection
        postId="post-1"
        post={feedPost}
        gateway={{}}
        onReact={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('mobile.moments.feed.loading');
    expect(markup).not.toContain('Stale feed body');
    expect(markup).not.toContain('Thread reply');
  });

  it('reads selected detail authoritatively through the runtime helper', async () => {
    const authoritativePost = {
      ...feedPost,
      content: {
        case: 'textPost',
        value: { text: 'Authoritative body' },
      },
    };
    const getPost = vi.fn(async () => ({
      ok: true,
      data: {
        post: authoritativePost,
        outcome: PostDetailOutcome.AVAILABLE,
      },
    }));

    await expect(readAuthoritativeMomentDetail(
      { getPost } as never,
      'post-1',
    )).resolves.toEqual({
      kind: 'available',
      post: authoritativePost,
    });
    expect(getPost).toHaveBeenCalledOnce();
    expect(getPost).toHaveBeenCalledWith('post-1');
  });

  it('renders comments through one stable bounded-list surface', () => {
    detailHook.current = {
      detail: { kind: 'available', post: feedPost },
      comments: Array.from({ length: 150 }, (_, index) => ({
        id: `comment-${index}`,
        author: { displayName: `Author ${index}` },
        content: `Comment ${index}`,
        isDeleted: false,
        replyToCommentId: '',
      })),
      loading: false,
      hasMore: false,
      errorMessage: '',
      loadComments: vi.fn(),
      loadMore: vi.fn(),
      reloadMoment: vi.fn(async () => true),
    };

    const markup = renderToStaticMarkup(
      <MomentCommentsSection
        postId="post-1"
        post={feedPost}
        gateway={{}}
        onReact={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-window-surface="moments:comments:post-1"');
    expect(markup).toContain('data-window-total="150"');
    expect(markup).toContain('data-scroll-anchor-id="comment-0"');
    expect(markup).toContain('data-scroll-anchor-id="comment-99"');
    expect(markup).not.toContain('data-scroll-anchor-id="comment-100"');
  });

  it('reloads runtime-owned detail and comments after successful mutations', async () => {
    const reloadMoment = vi.fn(async () => true);
    const createComment = vi.fn(async () => ({
      ok: true,
      data: { comment: { id: 'comment-created' } },
    }));
    const deleteComment = vi.fn(async () => ({
      ok: true,
      data: { success: true },
    }));

    await expect(createMomentCommentAndReload(
      { createComment },
      'post-1',
      'Authoritative comment',
      undefined,
      reloadMoment,
    )).resolves.toBe(true);
    await expect(deleteMomentCommentAndReload(
      { deleteComment },
      'comment-created',
      reloadMoment,
    )).resolves.toBe(true);

    expect(createComment).toHaveBeenCalledWith(
      'post-1',
      'Authoritative comment',
      undefined,
    );
    expect(deleteComment).toHaveBeenCalledWith('comment-created');
    expect(reloadMoment).toHaveBeenCalledTimes(2);
  });

  it('does not reload runtime state after a rejected mutation', async () => {
    const reloadMoment = vi.fn(async () => true);
    const createComment = vi.fn(async () => ({
      ok: false,
      error: { message: 'rejected' },
    }));

    await expect(createMomentCommentAndReload(
      { createComment },
      'post-1',
      'Rejected comment',
      undefined,
      reloadMoment,
    )).resolves.toBe(false);

    expect(reloadMoment).not.toHaveBeenCalled();
  });

  it('does not report mutation success when authoritative readback fails', async () => {
    const reloadMoment = vi.fn(async () => false);
    const createComment = vi.fn(async () => ({
      ok: true,
      data: { comment: { id: 'comment-created' } },
    }));

    await expect(createMomentCommentAndReload(
      { createComment },
      'post-1',
      'Unconfirmed comment',
      undefined,
      reloadMoment,
    )).resolves.toBe(false);
    expect(reloadMoment).toHaveBeenCalledOnce();
  });

  it('routes detail recovery only through the runtime retry owner', async () => {
    const retry = vi.fn(async () => false);

    await expect(retryMomentDetailRuntime({ retry })).resolves.toBe(false);
    expect(retry).toHaveBeenCalledOnce();
    await expect(retryMomentDetailRuntime(null)).resolves.toBe(false);
  });

  it('preserves authoritative deleted and hidden states', async () => {
    await expect(readAuthoritativeMomentDetail(
      {
        getPost: vi.fn(async () => ({
          ok: true,
          data: { outcome: PostDetailOutcome.DELETED },
        })),
      } as never,
      'post-1',
    )).resolves.toEqual({ kind: 'deleted' });

    await expect(readAuthoritativeMomentDetail(
      {
        getPost: vi.fn(async () => ({
          ok: true,
          data: { outcome: PostDetailOutcome.HIDDEN },
        })),
      } as never,
      'post-1',
    )).resolves.toEqual({ kind: 'hidden' });
  });

  it('does not guess whether an unavailable post was deleted or policy-hidden', async () => {
    await expect(readAuthoritativeMomentDetail(
      {
        getPost: vi.fn(async () => ({
          ok: false,
          error: {
            code: '30002',
            message: 'post not found',
            status: 404,
            method: 'GET',
            path: '/api/v1/social/moments/post-1',
          },
        })),
      } as never,
      'post-1',
    )).resolves.toEqual({
      kind: 'unavailable',
      reason: 'post not found',
    });
  });
});
