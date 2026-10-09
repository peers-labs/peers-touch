// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';
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

vi.mock('../../features/social/useSocialExperience', () => ({
  useSocialExperience: () => ({ facade: { feed: {} } }),
}));

vi.mock('../../features/social/useMomentsFeed', () => ({
  useMomentDetail: () => detailHook.current,
}));

import {
  commentIdentityFallback,
  commentsContainReplyTarget,
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
        mode="detail"
        intents={{}}
        onReact={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('mobile.moments.feed.loading');
    expect(markup).not.toContain('Stale feed body');
    expect(markup).not.toContain('Thread reply');
  });

  it('keeps an empty inline thread compact and renders only its composer', () => {
    detailHook.current = {
      detail: { kind: 'available', post: feedPost },
      comments: [],
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
        mode="inline"
        intents={{}}
        onReact={vi.fn()}
      />,
    );

    expect(markup).toContain('mobile.moments.comment.placeholder');
    expect(markup).not.toContain('mobile.moments.comment.empty');
    expect(markup).not.toContain('moments.comments-empty');
  });

  it('keeps reply context inside the composite input only', () => {
    const source = readFileSync(
      new URL('./MomentCommentsSection.tsx', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('moments-comments-reply-indicator');
    expect(source).toContain('className="moments-comment-input-field"');
    expect(source).toContain('className="moments-comment-reply-clear"');
  });

  it('detects when a selected reply target disappears from the thread', () => {
    const target = {
      route: 'PUBLIC',
      comment: { id: 'comment-1' },
    };
    const replacement = {
      route: 'PUBLIC',
      comment: { id: 'comment-2' },
    };

    expect(commentsContainReplyTarget([target], target)).toBe(true);
    expect(commentsContainReplyTarget([replacement], target)).toBe(false);
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

    await expect(
      readAuthoritativeMomentDetail({ getPost } as never, 'post-1'),
    ).resolves.toEqual({
      kind: 'available',
      post: authoritativePost,
    });
    expect(getPost).toHaveBeenCalledOnce();
    expect(getPost).toHaveBeenCalledWith('post-1');
  });

  it('mounts only the first ten comments until the selected thread expands', () => {
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
        intents={{}}
        onReact={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-comment-total="150"');
    expect(markup).toContain('data-comment-visible="10"');
    expect(markup).toContain('data-scroll-anchor-id="comment-0"');
    expect(markup).toContain('data-scroll-anchor-id="comment-9"');
    expect(markup).not.toContain('data-scroll-anchor-id="comment-10"');
    expect(markup).toContain('mobile.moments.comment.showMore');
  });

  it('reuses the post identity when its author writes a degraded comment', () => {
    const postIdentity = {
      actorPtid: 'ptid:bob',
      avatar: 'data:image/svg+xml;base64,bob',
      displayName: 'Bob',
      username: 'bob',
    };

    expect(
      commentIdentityFallback(
        {
          route: 'PUBLIC',
          comment: {
            authorPtid: 'ptid:bob',
            author: {
              displayName: 'bob@10.37.221.38:18080',
              username: 'bob@10.37.221.38:18080',
            },
          },
        },
        postIdentity,
      ),
    ).toEqual(postIdentity);
  });

  it('reloads runtime-owned detail and comments after successful mutations', async () => {
    const createComment = vi.fn(async () => ({
      ok: true,
      data: { comment: { id: 'comment-created' } },
    }));
    const deleteComment = vi.fn(async () => ({
      ok: true,
      data: { success: true },
    }));
    const intents = {
      comment: async (postId, content, replyToCommentId) => {
        const result = await createComment(postId, content, replyToCommentId);
        return result.ok;
      },
      deleteComment: async (_postId, commentId) => {
        const result = await deleteComment(commentId);
        return result.ok;
      },
    };

    await expect(
      createMomentCommentAndReload(
        intents,
        'post-1',
        'Authoritative comment',
        undefined,
      ),
    ).resolves.toBe(true);
    await expect(
      deleteMomentCommentAndReload(intents, 'post-1', 'comment-created'),
    ).resolves.toBe(true);

    expect(createComment).toHaveBeenCalledWith(
      'post-1',
      'Authoritative comment',
      undefined,
    );
    expect(deleteComment).toHaveBeenCalledWith('comment-created');
  });

  it('does not reload runtime state after a rejected mutation', async () => {
    const createComment = vi.fn(async () => ({
      ok: false,
      error: { message: 'rejected' },
    }));

    await expect(
      createMomentCommentAndReload(
        {
          comment: async (postId, content, replyToCommentId) => {
            const result = await createComment(
              postId,
              content,
              replyToCommentId,
            );
            return result.ok;
          },
        },
        'post-1',
        'Rejected comment',
        undefined,
      ),
    ).resolves.toBe(false);
  });

  it('does not report mutation success when authoritative readback fails', async () => {
    const reloadMoment = vi.fn(async () => false);
    const createComment = vi.fn(async () => ({
      ok: true,
      data: { comment: { id: 'comment-created' } },
    }));

    await expect(
      createMomentCommentAndReload(
        {
          comment: async (postId, content, replyToCommentId) => {
            const result = await createComment(
              postId,
              content,
              replyToCommentId,
            );
            return result.ok && reloadMoment();
          },
        },
        'post-1',
        'Unconfirmed comment',
        undefined,
      ),
    ).resolves.toBe(false);
    expect(reloadMoment).toHaveBeenCalledOnce();
  });

  it('routes detail recovery only through the runtime retry owner', async () => {
    const retry = vi.fn(async () => false);

    await expect(retryMomentDetailRuntime({ retry })).resolves.toBe(false);
    expect(retry).toHaveBeenCalledOnce();
    await expect(retryMomentDetailRuntime(null)).resolves.toBe(false);
  });

  it('preserves authoritative deleted and hidden states', async () => {
    await expect(
      readAuthoritativeMomentDetail(
        {
          getPost: vi.fn(async () => ({
            ok: true,
            data: { outcome: PostDetailOutcome.DELETED },
          })),
        } as never,
        'post-1',
      ),
    ).resolves.toEqual({ kind: 'deleted' });

    await expect(
      readAuthoritativeMomentDetail(
        {
          getPost: vi.fn(async () => ({
            ok: true,
            data: { outcome: PostDetailOutcome.HIDDEN },
          })),
        } as never,
        'post-1',
      ),
    ).resolves.toEqual({ kind: 'hidden' });
  });

  it('does not guess whether an unavailable post was deleted or policy-hidden', async () => {
    await expect(
      readAuthoritativeMomentDetail(
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
      ),
    ).resolves.toEqual({
      kind: 'unavailable',
      reason: 'post not found',
    });
  });
});
