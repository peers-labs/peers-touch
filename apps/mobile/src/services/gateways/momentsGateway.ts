/**
 * momentsGateway.ts — Moments domain API gateway
 *
 * Wraps Moments/post creation, feed, reaction, and comment APIs behind
 * a typed gateway with JSON quarantine and command outcome adapters.
 *
 * The createMoment endpoint uses protobuf; feed/reaction/comment
 * endpoints use the JSON gateway transport with proper envelope unwrapping.
 *
 * Change: W6B — Added feed pagination, reaction, comment, and reply
 * endpoints through the gateway transport layer.
 */

import { fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MobileAuthSession } from '../../features/auth/authSession';
import {
  CreatePostRequestSchema,
  CreatePostResponseSchema,
  type Post,
  type ReactionSummary,
} from '../../gen/proto/domain/social/post_pb';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';
import { readableErrorMessage } from '../../features/social/socialTypes';
import { buildMobileCreatePostRequest, type MobileMomentDraft } from '../../features/social/socialApiTypes';
import {
  createGatewayTransport,
  type CommandOutcome,
} from './gatewayTypes';

// ---------------------------------------------------------------------------
// Gateway output types
// ---------------------------------------------------------------------------

export interface MomentCreatedResult {
  readonly post: Post | undefined;
}

/** Cursor-based feed page returned by the timeline endpoint */
export interface MomentsFeedPage {
  readonly posts: readonly Post[];
  readonly nextCursor: string;
  readonly hasMore: boolean;
}

/** Result of a reaction toggle (react / unreact) */
export interface ReactionToggleResult {
  readonly success: boolean;
  readonly reactions: readonly ReactionSummary[];
}

/** Cursor-based comment page for a post */
export interface CommentsPage {
  readonly comments: readonly Comment[];
  readonly nextCursor: string;
  readonly hasMore: boolean;
}

/** Result of creating a comment */
export interface CommentCreatedResult {
  readonly comment: Comment | undefined;
}

// ---------------------------------------------------------------------------
// Moments gateway interface
// ---------------------------------------------------------------------------

export interface MomentsGateway {
  /** Create a new moment (post). Uses protobuf directly. */
  createMoment: (draft: MobileMomentDraft) => Promise<CommandOutcome<MomentCreatedResult>>;

  /** Fetch a cursor-based feed page (home timeline). */
  fetchFeed: (cursor: string, limit: number) => Promise<CommandOutcome<MomentsFeedPage>>;

  /** Fetch the public timeline feed page. */
  fetchPublicFeed: (cursor: string, limit: number) => Promise<CommandOutcome<MomentsFeedPage>>;

  /** Get a single post by ID. */
  getPost: (postId: string) => Promise<CommandOutcome<{ post: Post | undefined }>>;

  /** React to a post. */
  reactToPost: (postId: string, reactionKind: number) => Promise<CommandOutcome<ReactionToggleResult>>;

  /** Remove a reaction from a post. */
  unreactToPost: (postId: string, reactionKind: number) => Promise<CommandOutcome<ReactionToggleResult>>;

  /** Fetch comments for a post (cursor-based). */
  fetchComments: (postId: string, cursor: string, limit: number) => Promise<CommandOutcome<CommentsPage>>;

  /** Create a comment on a post. */
  createComment: (postId: string, content: string, replyToCommentId?: string) => Promise<CommandOutcome<CommentCreatedResult>>;

  /** Delete a comment. */
  deleteComment: (commentId: string) => Promise<CommandOutcome<{ success: boolean }>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMomentsGateway(session: MobileAuthSession): MomentsGateway {
  const { stationUrl, command } = createGatewayTransport(session);

  return {
    createMoment: async (draft) => {
      const req = buildMobileCreatePostRequest(draft);

      try {
        const response = await fetch(`${stationUrl}/api/v1/social/moments`, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            Accept: 'application/x-protobuf',
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/x-protobuf',
          },
          body: toBinary(CreatePostRequestSchema, req),
        });

        if (!response.ok) {
          // Attempt to read error as JSON (Station may respond with JSON errors)
          let errorMessage = `moment creation failed with status ${response.status}`;
          try {
            const text = await response.text();
            if (text) {
              const parsed = JSON.parse(text) as Record<string, unknown>;
              errorMessage = String(parsed.message ?? parsed.msg ?? parsed.detail ?? errorMessage);
            }
          } catch {
            // Retain default error message
          }
          return {
            ok: false,
            error: {
              code: 'MOMENTS_CREATE_FAILED',
              message: errorMessage,
              status: response.status,
              method: 'POST',
              path: '/api/v1/social/moments',
            },
          };
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        const created = fromBinary(CreatePostResponseSchema, bytes);
        return { ok: true, data: { post: created.post } };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'MOMENTS_TRANSPORT_ERROR',
            message: readableErrorMessage(error),
            method: 'POST',
            path: '/api/v1/social/moments',
          },
        };
      }
    },

    fetchFeed: (cursor, limit) =>
      command<MomentsFeedPage>({
        method: 'GET',
        path: '/api/v1/social/timeline',
        query: {
          type: 0, // TIMELINE_HOME
          cursor: cursor || undefined,
          limit,
        },
      }),

    fetchPublicFeed: (cursor, limit) =>
      command<MomentsFeedPage>({
        method: 'GET',
        path: '/api/v1/social/timeline',
        query: {
          type: 2, // TIMELINE_PUBLIC
          cursor: cursor || undefined,
          limit,
        },
      }),

    getPost: (postId) =>
      command<{ post: Post | undefined }>({
        method: 'GET',
        path: `/api/v1/social/posts/${encodeURIComponent(postId)}`,
      }),

    reactToPost: (postId, reactionKind) =>
      command<ReactionToggleResult>({
        method: 'POST',
        path: '/api/v1/social/reactions',
        body: {
          post_id: postId,
          kind: reactionKind,
        },
      }),

    unreactToPost: (postId, reactionKind) =>
      command<ReactionToggleResult>({
        method: 'DELETE',
        path: '/api/v1/social/reactions',
        body: {
          post_id: postId,
          kind: reactionKind,
        },
      }),

    fetchComments: (postId, cursor, limit) =>
      command<CommentsPage>({
        method: 'GET',
        path: `/api/v1/social/posts/${encodeURIComponent(postId)}/comments`,
        query: {
          cursor: cursor || undefined,
          limit,
        },
      }),

    createComment: (postId, content, replyToCommentId) =>
      command<CommentCreatedResult>({
        method: 'POST',
        path: `/api/v1/social/posts/${encodeURIComponent(postId)}/comments`,
        body: {
          content,
          ...(replyToCommentId ? { reply_to_comment_id: replyToCommentId } : {}),
        },
      }),

    deleteComment: (commentId) =>
      command<{ success: boolean }>({
        method: 'DELETE',
        path: `/api/v1/social/comments/${encodeURIComponent(commentId)}`,
      }),
  };
}
