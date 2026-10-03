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

import {
  create,
  fromBinary,
  toBinary,
  type DescMessage,
  type JsonValue,
} from '@bufbuild/protobuf';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { mobileAuthScopeKey } from '../../features/auth/mobileAuthIdentity';
import {
  CreatePostRequestSchema,
  CreatePostResponseSchema,
  GetPostResponseSchema,
  GetTimelineResponseSchema,
  PostDetailOutcome,
  PostAuthorSchema,
  ReactToPostResponseSchema,
  TimelinePageOutcome,
  UnreactToPostResponseSchema,
  type FeedObjectExplanation,
  type Post,
  type ReactionSummary,
  type TimelinePolicySummary,
} from '../../gen/proto/domain/social/post_pb';
import {
  CommentSchema,
  CreateCommentResponseSchema,
  DeleteCommentResponseSchema,
  type Comment,
} from '../../gen/proto/domain/social/comment_pb';
import {
  ListMomentCommentsResponseSchema,
  type CommentResource,
  type ListMomentCommentsResponse,
} from '../../gen/proto/domain/social/private_content_pb';
import { readableErrorMessage } from '../../features/social/socialTypes';
import { buildMobileCreatePostRequest, type MobileMomentDraft } from '../../features/social/socialApiTypes';
import {
  MobileMutationAdmissionError,
  requireMobileMutationAdmission,
} from '../../runtimes/mutationAdmission';
import {
  executeStationOperation,
  responseBytes,
  responseJson,
} from '../stationTransport';
import {
  createGatewayTransport,
  decodeProtoJsonOutcome,
  type CommandOutcome,
  type GatewayRequestOptions,
} from './gatewayTypes';

// ---------------------------------------------------------------------------
// Gateway output types
// ---------------------------------------------------------------------------

export interface MomentCreatedResult {
  readonly post?: Post;
}

/** Cursor-based feed page returned by the timeline endpoint */
export interface MomentsFeedPage {
  readonly posts: readonly Post[];
  readonly nextCursor: string;
  readonly hasMore: boolean;
  readonly explanations: readonly FeedObjectExplanation[];
  readonly outcome: TimelinePageOutcome;
  readonly policySummary?: TimelinePolicySummary;
}

export interface MomentDetailResult {
  readonly post?: Post;
  readonly explanation?: FeedObjectExplanation;
  readonly outcome: PostDetailOutcome;
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
  readonly comment?: Comment;
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
  getPost: (postId: string) => Promise<CommandOutcome<MomentDetailResult>>;

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
  const { command } = createGatewayTransport(session, 'moments');
  const scopeKey = mobileAuthScopeKey(session);
  const commandProtoJson = async <Desc extends DescMessage>(
    options: GatewayRequestOptions,
    schema: Desc,
    message: string,
  ) => decodeProtoJsonOutcome(
    await command<JsonValue>(options),
    schema,
    {
      code: 'INVALID_MOMENTS_RESPONSE',
      message,
      method: options.method,
      path: options.path,
    },
  );

  return {
    createMoment: async (draft) => {
      const req = buildMobileCreatePostRequest(draft);

      try {
        requireMobileMutationAdmission(scopeKey, 'moments');
        const response = await executeStationOperation(session, {
          operationId: 'moments_create',
          body_bytes: Array.from(toBinary(CreatePostRequestSchema, req)),
        });

        if (response.status < 200 || response.status >= 300) {
          // Attempt to read error as JSON (Station may respond with JSON errors)
          let errorMessage = `moment creation failed with status ${response.status}`;
          const parsed = responseJson(response) as Record<string, unknown>;
          if (parsed && typeof parsed === 'object') {
            errorMessage = String(
              parsed.message ?? parsed.msg ?? parsed.detail ?? errorMessage,
            );
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

        const created = fromBinary(CreatePostResponseSchema, responseBytes(response));
        return { ok: true, data: { post: created.post } };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: error instanceof MobileMutationAdmissionError
              ? error.code
              : 'MOMENTS_TRANSPORT_ERROR',
            message: readableErrorMessage(error),
            method: 'POST',
            path: '/api/v1/social/moments',
          },
        };
      }
    },

    fetchFeed: async (cursor, limit) => {
      const result = await commandProtoJson({
        method: 'GET',
        path: '/api/v1/social/timeline',
        query: {
          type: 0, // TIMELINE_HOME
          cursor: cursor || undefined,
          limit,
        },
      }, GetTimelineResponseSchema, 'mobile.moments.feed.error');
      return validateTimelineOutcome(result, '/api/v1/social/timeline');
    },

    fetchPublicFeed: async (cursor, limit) => {
      const result = await commandProtoJson({
        method: 'GET',
        path: '/api/v1/social/timeline',
        query: {
          type: 2, // TIMELINE_PUBLIC
          cursor: cursor || undefined,
          limit,
        },
      }, GetTimelineResponseSchema, 'mobile.moments.feed.error');
      return validateTimelineOutcome(result, '/api/v1/social/timeline');
    },

    getPost: async (postId) => {
      const path = `/api/v1/social/moments/${encodeURIComponent(postId)}`;
      const result = await commandProtoJson({
        method: 'GET',
        path,
      }, GetPostResponseSchema, 'mobile.moments.feed.error');
      return validateDetailOutcome(result, path);
    },

    reactToPost: (postId, reactionKind) =>
      commandProtoJson({
        method: 'POST',
        path: `/api/v1/social/moments/${encodeURIComponent(postId)}/react`,
        body: {
          post_id: postId,
          kind: reactionKind,
        },
      }, ReactToPostResponseSchema, 'mobile.moments.reaction.error'),

    unreactToPost: (postId, reactionKind) =>
      commandProtoJson({
        method: 'POST',
        path: `/api/v1/social/moments/${encodeURIComponent(postId)}/unreact`,
        body: {
          post_id: postId,
          kind: reactionKind,
        },
      }, UnreactToPostResponseSchema, 'mobile.moments.reaction.error'),

    fetchComments: async (postId, cursor, limit) => {
      const path = `/api/v1/social/moments/${encodeURIComponent(postId)}/comments`;
      const result = await commandProtoJson({
        method: 'GET',
        path,
        query: {
          cursor: cursor || undefined,
          limit,
        },
      }, ListMomentCommentsResponseSchema, 'mobile.moments.comment.error');
      return projectPublicCommentPage(result, path);
    },

    createComment: (postId, content, replyToCommentId) =>
      commandProtoJson({
        method: 'POST',
        path: `/api/v1/social/moments/${encodeURIComponent(postId)}/comments`,
        body: {
          content,
          ...(replyToCommentId ? { reply_to_comment_id: replyToCommentId } : {}),
        },
      }, CreateCommentResponseSchema, 'mobile.moments.comment.sendError'),

    deleteComment: (commentId) =>
      commandProtoJson({
        method: 'DELETE',
        path: `/api/v1/social/comments/${encodeURIComponent(commentId)}`,
      }, DeleteCommentResponseSchema, 'mobile.moments.comment.error'),
  };
}

function validateTimelineOutcome(
  result: CommandOutcome<MomentsFeedPage>,
  path: string,
): CommandOutcome<MomentsFeedPage> {
  if (!result.ok) return result;
  const { outcome, posts, policySummary } = result.data;
  const validOutcome = outcome === TimelinePageOutcome.ITEMS
    || outcome === TimelinePageOutcome.EMPTY
    || outcome === TimelinePageOutcome.FILTERED_EMPTY;
  const validShape = outcome === TimelinePageOutcome.ITEMS
    ? posts.length > 0
    : posts.length === 0;
  const validSummary = Boolean(
    policySummary
    && policySummary.scannedCount >= posts.length
    && policySummary.filteredCount
      === policySummary.scannedCount - posts.length,
  );
  if (validOutcome && validShape && validSummary) return result;
  return invalidMomentsOutcome(path);
}

function validateDetailOutcome(
  result: CommandOutcome<MomentDetailResult>,
  path: string,
): CommandOutcome<MomentDetailResult> {
  if (!result.ok) return result;
  const { outcome, post, explanation } = result.data;
  if (
    outcome === PostDetailOutcome.AVAILABLE
    && post
    && explanation
  ) {
    return result;
  }
  if (
    (
      outcome === PostDetailOutcome.HIDDEN
      || outcome === PostDetailOutcome.DELETED
      || outcome === PostDetailOutcome.UNAVAILABLE
    )
    && !post
    && !explanation
  ) {
    return result;
  }
  return invalidMomentsOutcome(path);
}

function invalidMomentsOutcome<T>(path: string): CommandOutcome<T> {
  return {
    ok: false,
    error: {
      code: 'INVALID_MOMENTS_OUTCOME',
      message: 'mobile.moments.feed.error',
      method: 'GET',
      path,
    },
  };
}

function projectPublicCommentPage(
  result: CommandOutcome<ListMomentCommentsResponse>,
  path: string,
): CommandOutcome<CommentsPage> {
  if (!result.ok) return result;
  try {
    return {
      ok: true,
      data: {
        comments: result.data.comments.map(publicCommentFromResource),
        nextCursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      },
    };
  } catch {
    return {
      ok: false,
      error: {
        code: 'INVALID_MOMENTS_RESPONSE',
        message: 'mobile.moments.comment.error',
        method: 'GET',
        path,
      },
    };
  }
}

function publicCommentFromResource(resource: CommentResource): Comment {
  const metadata = resource.metadata;
  if (!metadata || resource.body.case !== 'publicContent') {
    throw new Error('PUBLIC_COMMENT_RESOURCE_INVALID');
  }
  const author = metadata.author;
  if (!metadata.commentId || !metadata.postId || !author?.ptid) {
    throw new Error('PUBLIC_COMMENT_RESOURCE_INVALID');
  }
  return create(CommentSchema, {
    id: metadata.commentId,
    postId: metadata.postId,
    authorPtid: author.ptid,
    content: resource.body.value.text,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    isDeleted: metadata.isDeleted,
    author: create(PostAuthorSchema, {
      id: author.ptid,
      username: author.acct,
      displayName: author.acct,
    }),
    likesCount: metadata.reactionsCount,
    replyToCommentId: metadata.replyToCommentId,
    repliesCount: metadata.repliesCount,
  });
}
