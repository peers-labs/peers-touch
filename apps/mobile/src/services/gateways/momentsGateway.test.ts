// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMock = vi.hoisted(() => vi.fn());

vi.mock('./gatewayTypes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gatewayTypes')>();
  return {
    ...actual,
    createGatewayTransport: () => ({
      command: commandMock,
      stationUrl: 'https://station.example',
    }),
  };
});

import type { MobileAuthSession } from '../../features/auth/authSession';
import {
  ActivitySource_Kind,
  Audience_Kind,
  PostDetailOutcome,
  PostType,
  ReactionKind,
  TimelinePageOutcome,
} from '../../gen/proto/domain/social/post_pb';
import { createMomentsGateway } from './momentsGateway';

const session = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
} satisfies MobileAuthSession;

beforeEach(() => {
  commandMock.mockReset();
  commandMock.mockResolvedValue({
    ok: true,
    data: { success: true, reactions: [] },
  });
});

describe('Moments reaction routes', () => {
  it('uses the canonical Station post-scoped react command', async () => {
    await createMomentsGateway(session).reactToPost('post/1', 2);

    expect(commandMock).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/v1/social/moments/post%2F1/react',
      body: {
        post_id: 'post/1',
        kind: 2,
      },
    });
  });

  it('uses the canonical Station post-scoped unreact command', async () => {
    await createMomentsGateway(session).unreactToPost('post/1', 2);

    expect(commandMock).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/v1/social/moments/post%2F1/unreact',
      body: {
        post_id: 'post/1',
        kind: 2,
      },
    });
  });
});

describe('Moments Station protobuf JSON decoding', () => {
  it('decodes snake-case timeline, post, reaction, and comment responses', async () => {
    commandMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          posts: [snakePost()],
          next_cursor: 'cursor-2',
          has_more: true,
          outcome: 'TIMELINE_PAGE_OUTCOME_ITEMS',
          policy_summary: {
            scanned_count: 1,
            filtered_count: 0,
          },
          explanations: [{
            object_id: 'post-1',
            source: {
              kind: 'ACTIVITY_SOURCE_LOCAL',
              station_peer_id: 'station-a',
            },
          }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          post: snakePost(),
          explanation: {
            object_id: 'post-1',
            source: { kind: 'ACTIVITY_SOURCE_LOCAL' },
          },
          outcome: 'POST_DETAIL_OUTCOME_AVAILABLE',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          success: true,
          reactions: [{
            kind: 'REACTION_LOVE',
            count: '3',
            reacted_by_viewer: true,
          }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          comments: [snakeCommentResource()],
          next_cursor: 'comment-cursor',
          has_more: true,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { comment: snakeComment() },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { success: true },
      });

    const gateway = createMomentsGateway(session);
    const feed = await gateway.fetchFeed('', 20);
    const detail = await gateway.getPost('post-1');
    const reaction = await gateway.reactToPost('post-1', ReactionKind.REACTION_LOVE);
    const comments = await gateway.fetchComments('post-1', '', 15);
    const created = await gateway.createComment('post-1', 'Reply', 'comment-root');
    const deleted = await gateway.deleteComment('comment-1');

    expect(feed).toMatchObject({
      ok: true,
      data: {
        nextCursor: 'cursor-2',
        hasMore: true,
        outcome: TimelinePageOutcome.ITEMS,
        policySummary: {
          scannedCount: 1,
          filteredCount: 0,
        },
        posts: [{
          id: 'post-1',
          authorPtid: 'ptid:alice',
          type: PostType.TEXT,
          content: { case: 'textPost', value: { text: 'Hello' } },
          stats: { commentsCount: 4n },
          author: { displayName: 'Alice' },
          audience: { kind: Audience_Kind.PUBLIC },
          reactions: [{
            kind: ReactionKind.REACTION_LIKE,
            count: 2n,
            reactedByViewer: true,
          }],
        }],
        explanations: [{
          objectId: 'post-1',
          source: {
            kind: ActivitySource_Kind.ACTIVITY_SOURCE_LOCAL,
            stationPeerId: 'station-a',
          },
        }],
      },
    });
    expect(detail).toMatchObject({
      ok: true,
      data: {
        post: { id: 'post-1', authorPtid: 'ptid:alice' },
        explanation: { objectId: 'post-1' },
        outcome: PostDetailOutcome.AVAILABLE,
      },
    });
    expect(reaction).toMatchObject({
      ok: true,
      data: {
        success: true,
        reactions: [{
          kind: ReactionKind.REACTION_LOVE,
          count: 3n,
          reactedByViewer: true,
        }],
      },
    });
    expect(comments).toMatchObject({
      ok: true,
      data: {
        nextCursor: 'comment-cursor',
        hasMore: true,
        comments: [{
          id: 'comment-1',
          postId: 'post-1',
          authorPtid: 'ptid:bob',
          likesCount: 1n,
          replyToCommentId: 'comment-root',
        }],
      },
    });
    expect(created).toMatchObject({
      ok: true,
      data: { comment: { id: 'comment-1', postId: 'post-1' } },
    });
    expect(deleted).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({ success: true }),
    }));
  });

  it('rejects private Comment resources at the public Mobile projection boundary', async () => {
    commandMock.mockResolvedValueOnce({
      ok: true,
      data: {
        comments: [{
          metadata: {
            comment_id: 'comment-private',
            post_id: 'post-private',
            author: {
              ptid: 'ptid:bob',
              acct: 'bob@example.test',
            },
          },
          private_content: {},
        }],
      },
    });

    await expect(
      createMomentsGateway(session).fetchComments('post-private', '', 15),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_MOMENTS_RESPONSE',
        path: '/api/v1/social/moments/post-private/comments',
      },
    });
  });

  it('fails visibly when Station JSON does not match the generated schema', async () => {
    commandMock.mockResolvedValueOnce({
      ok: true,
      data: {
        posts: 'not-an-array',
        next_cursor: 'cursor-2',
        has_more: true,
      },
    });

    await expect(
      createMomentsGateway(session).fetchFeed('', 20),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'INVALID_MOMENTS_RESPONSE',
        message: 'mobile.moments.feed.error',
        method: 'GET',
        path: '/api/v1/social/timeline',
      },
    });
  });

  it('preserves Station command failures without attempting generated decoding', async () => {
    commandMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'POLICY_REJECTED',
        message: 'mobile.moments.policy.violation',
        status: 403,
        method: 'GET',
        path: '/api/v1/social/timeline',
      },
    });

    await expect(
      createMomentsGateway(session).fetchFeed('', 20),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'POLICY_REJECTED',
        status: 403,
      },
    });
  });

  it('accepts payload-free typed hidden, deleted, and unavailable details', async () => {
    commandMock
      .mockResolvedValueOnce({
        ok: true,
        data: { outcome: 'POST_DETAIL_OUTCOME_HIDDEN' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { outcome: 'POST_DETAIL_OUTCOME_DELETED' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { outcome: 'POST_DETAIL_OUTCOME_UNAVAILABLE' },
      });

    const gateway = createMomentsGateway(session);

    await expect(gateway.getPost('hidden')).resolves.toMatchObject({
      ok: true,
      data: { outcome: PostDetailOutcome.HIDDEN },
    });
    await expect(gateway.getPost('deleted')).resolves.toMatchObject({
      ok: true,
      data: { outcome: PostDetailOutcome.DELETED },
    });
    await expect(gateway.getPost('missing')).resolves.toMatchObject({
      ok: true,
      data: { outcome: PostDetailOutcome.UNAVAILABLE },
    });
  });

  it('rejects unspecified or contradictory owner outcomes', async () => {
    commandMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          posts: [],
          outcome: 'TIMELINE_PAGE_OUTCOME_ITEMS',
          policy_summary: {
            scanned_count: 0,
            filtered_count: 0,
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          post: snakePost(),
          outcome: 'POST_DETAIL_OUTCOME_HIDDEN',
        },
      });

    const gateway = createMomentsGateway(session);
    await expect(gateway.fetchFeed('', 20)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_MOMENTS_OUTCOME' },
    });
    await expect(gateway.getPost('post-1')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_MOMENTS_OUTCOME' },
    });
  });
});

function snakePost() {
  return {
    id: 'post-1',
    author_ptid: 'ptid:alice',
    type: 'TEXT',
    created_at: '2026-09-16T10:00:00Z',
    stats: {
      comments_count: '4',
    },
    author: {
      id: 'ptid:alice',
      username: 'alice',
      display_name: 'Alice',
    },
    text_post: {
      text: 'Hello',
    },
    audience: {
      kind: 'PUBLIC',
    },
    reactions: [{
      kind: 'REACTION_LIKE',
      count: '2',
      reacted_by_viewer: true,
    }],
  };
}

function snakeComment() {
  return {
    id: 'comment-1',
    post_id: 'post-1',
    author_ptid: 'ptid:bob',
    content: 'Reply',
    created_at: '2026-09-16T10:01:00Z',
    author: {
      id: 'ptid:bob',
      username: 'bob',
      display_name: 'Bob',
    },
    likes_count: '1',
    reply_to_comment_id: 'comment-root',
  };
}

function snakeCommentResource() {
  return {
    metadata: {
      comment_id: 'comment-1',
      content_id: 'comment-1',
      post_id: 'post-1',
      reply_to_comment_id: 'comment-root',
      author: {
        ptid: 'ptid:bob',
        acct: 'bob@example.test',
      },
      created_at: '2026-09-16T10:01:00Z',
      reactions_count: '1',
    },
    public_content: {
      text: 'Reply',
    },
  };
}
