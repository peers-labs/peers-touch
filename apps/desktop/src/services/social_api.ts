// Social (Moments) API service — typed wrappers around the
// `social_*` Tauri commands defined in
// `apps/desktop/src-tauri/src/interface/tauri_commands/social.rs`.
//
// Why a separate file (vs. growing `desktop_api.ts`):
//   - The Moments surface adds 22 commands. Folding them into the
//     existing 3.6k-line file makes review and dependency tracing
//     painful.
//   - All wrappers share the same proto-bytes pattern, so we get a
//     small set of helpers (`callProto`, `callProtoWithBody`) instead
//     of bespoke per-command boilerplate.
//
// Wire contract (mirrors `social.rs`):
//   - Every Tauri command returns proto-encoded `Vec<u8>` which the
//     `invokeRustProto` helper decodes into a typed message.
//   - Inputs are POJOs; the JSON shape matches each `Social*Input`
//     contract on the Rust side. Underscore field names are required
//     because that's what `serde(deserialize_with = "...")` expects.
//   - `social_create_moment` is the one exception — it takes a
//     pre-encoded `CreatePostRequest` blob so the discriminator logic
//     for content `oneof` and `Audience` lives in one place (here).

import { create, toBinary } from '@bufbuild/protobuf';
import {
  CreatePostRequestSchema,
  CreatePostResponseSchema,
  CreateTextPostRequestSchema,
  CreateImagePostRequestSchema,
  CreateRepostRequestSchema,
  GetPostResponseSchema,
  DeletePostResponseSchema,
  ListPostsResponseSchema,
  GetTimelineResponseSchema,
  GetMyMomentsStatsResponseSchema,
  ReactToPostResponseSchema,
  UnreactToPostResponseSchema,
  ReactionKind,
  TimelineType,
  PostType,
  Audience,
  Mention,
  type CreatePostRequest,
  type CreatePostResponse,
  type GetPostResponse,
  type DeletePostResponse,
  type ListPostsResponse,
  type GetTimelineResponse,
  type GetMyMomentsStatsResponse,
  type Post,
  type ReactToPostResponse,
  type UnreactToPostResponse,
} from '../gen/proto/domain/social/post_pb';
import {
  CreateCommentResponseSchema,
  DeleteCommentResponseSchema,
  GetCommentsResponseSchema,
  type Comment,
  type CreateCommentResponse,
  type DeleteCommentResponse,
  type GetCommentsResponse,
} from '../gen/proto/domain/social/comment_pb';
import {
  CreateCircleResponseSchema,
  RenameCircleResponseSchema,
  DeleteCircleResponseSchema,
  ListMyCirclesResponseSchema,
  AddCircleMemberResponseSchema,
  RemoveCircleMemberResponseSchema,
  ListCircleMembersResponseSchema,
  type CreateCircleResponse,
  type RenameCircleResponse,
  type DeleteCircleResponse,
  type ListMyCirclesResponse,
  type AddCircleMemberResponse,
  type RemoveCircleMemberResponse,
  type ListCircleMembersResponse,
} from '../gen/proto/domain/social/circle_pb';
import {
  FollowResponseSchema,
  UnfollowResponseSchema,
  GetRelationshipResponseSchema,
  GetFollowersResponseSchema,
  GetFollowingResponseSchema,
  type FollowResponse,
  type UnfollowResponse,
  type GetRelationshipResponse,
  type GetFollowersResponse,
  type GetFollowingResponse,
} from '../gen/proto/domain/social/relationship_pb';
import { invokeRustProto } from './desktop_api';

// ---------------------------------------------------------------------------
// Composer helpers — build typed `CreatePostRequest` payloads
// ---------------------------------------------------------------------------

export interface MomentDraftBase {
  audience: Audience;
  /** Optional pre-resolved typed mentions; deferred to P3 wiring. */
  mentions?: Mention[];
  /** Optional reply target. Currently only used by REPOST + comment-on-post. */
  replyToPostId?: string;
}

export interface TextDraft extends MomentDraftBase {
  kind: 'text';
  text: string;
}

export interface ImageDraft extends MomentDraftBase {
  kind: 'image';
  text: string;
  /** OSS CIDs (`oss://origin/key`); empty until OSS upload lands. */
  imageIds: string[];
}

export interface RepostDraft extends MomentDraftBase {
  kind: 'repost';
  originalPostId: string;
  comment: string;
}

export type MomentDraft = TextDraft | ImageDraft | RepostDraft;

/**
 * Build the `CreatePostRequest` proto from a draft union and encode
 * it for shipping to the Tauri BFF. Centralised so `oneof content`
 * and `Audience` discriminator logic exist in exactly one place.
 *
 * NOTE: Image attachments are accepted by the proto but the desktop
 * composer disables image picking until OSS upload integration
 * lands; tests construct ImageDraft directly to exercise the path.
 */
export function buildCreatePostRequest(draft: MomentDraft): CreatePostRequest {
  const req = create(CreatePostRequestSchema, {
    audience: draft.audience,
  });
  // The oneof inner value MUST be a properly-constructed message —
  // bufbuild's `toBinary` rejects bare POJOs because it can't tell
  // which schema to use for the embedded fields.
  // The oneof case names are the camelCased proto field names
  // (`text` / `image` / `repost` are FIELD names of CreatePostRequest,
  // not the message-type short forms).
  switch (draft.kind) {
    case 'text':
      req.type = PostType.TEXT;
      req.content = {
        case: 'text',
        value: create(CreateTextPostRequestSchema, { text: draft.text }),
      } as any;
      break;
    case 'image':
      req.type = PostType.IMAGE;
      req.content = {
        case: 'image',
        value: create(CreateImagePostRequestSchema, {
          text: draft.text,
          imageIds: draft.imageIds,
        }),
      } as any;
      break;
    case 'repost':
      req.type = PostType.REPOST;
      req.content = {
        case: 'repost',
        value: create(CreateRepostRequestSchema, {
          originalPostId: draft.originalPostId,
          comment: draft.comment,
        }),
      } as any;
      break;
  }
  if (draft.replyToPostId) {
    req.replyToPostId = draft.replyToPostId;
  }
  return req;
}

// ---------------------------------------------------------------------------
// Moments — write
// ---------------------------------------------------------------------------

export async function socialCreateMoment(draft: MomentDraft): Promise<Post | undefined> {
  const req = buildCreatePostRequest(draft);
  const payload = toBinary(CreatePostRequestSchema, req);
  const resp = await invokeRustProto<{ payload: number[] }, CreatePostResponse>(
    'social_create_moment',
    CreatePostResponseSchema,
    { payload: Array.from(payload) },
  );
  return resp.post;
}

export async function socialGetMoment(id: string): Promise<Post | undefined> {
  const resp = await invokeRustProto<{ id: string }, GetPostResponse>(
    'social_get_moment',
    GetPostResponseSchema,
    { id },
  );
  return resp.post;
}

export async function socialDeleteMoment(id: string): Promise<boolean> {
  const resp = await invokeRustProto<{ id: string }, DeletePostResponse>(
    'social_delete_moment',
    DeletePostResponseSchema,
    { id },
  );
  return resp.success;
}

// ---------------------------------------------------------------------------
// Moments — read
// ---------------------------------------------------------------------------

export type TimelineKindWire = 'PUBLIC' | 'HOME' | 'USER';
export type TimelineSort = 'recent' | 'hot';

/** Convert the proto enum form back to the wire string the BFF expects. */
export function timelineKindToWire(kind: TimelineType): TimelineKindWire {
  switch (kind) {
    case TimelineType.TIMELINE_PUBLIC: return 'PUBLIC';
    case TimelineType.TIMELINE_HOME: return 'HOME';
    case TimelineType.TIMELINE_USER: return 'USER';
    default: return 'PUBLIC';
  }
}

export async function socialGetTimeline(
  type: TimelineKindWire,
  cursor?: string,
  limit?: number,
  sort: TimelineSort = 'recent',
): Promise<GetTimelineResponse> {
  // The station's typed handler reads `sort` via proto-JSON enum
  // names. We only send the field when the client explicitly opts in
  // to HOT — RECENT is the proto default and the station's omission
  // path is a touch faster (no enum lookup). The wire string MUST
  // match the proto enum name exactly.
  const sortWire = sort === 'hot' ? 'TIMELINE_SORT_HOT' : undefined;
  return invokeRustProto<
    { type: TimelineKindWire; cursor?: string; limit?: number; sort?: string },
    GetTimelineResponse
  >('social_get_timeline', GetTimelineResponseSchema, {
    type,
    cursor,
    limit,
    sort: sortWire,
  });
}

export async function socialListByAuthor(
  userId: string,
  cursor?: string,
  limit?: number,
): Promise<ListPostsResponse> {
  return invokeRustProto<
    { user_id: string; cursor?: string; limit?: number },
    ListPostsResponse
  >('social_list_by_author', ListPostsResponseSchema, {
    user_id: userId,
    cursor,
    limit,
  });
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

export async function socialReact(
  postId: string,
  kind: ReactionKind,
): Promise<ReactToPostResponse> {
  return invokeRustProto<
    { post_id: string; kind: number },
    ReactToPostResponse
  >('social_react', ReactToPostResponseSchema, {
    post_id: postId,
    kind,
  });
}

export async function socialUnreact(
  postId: string,
  kind: ReactionKind = ReactionKind.REACTION_UNSPECIFIED,
): Promise<UnreactToPostResponse> {
  return invokeRustProto<
    { post_id: string; kind: number },
    UnreactToPostResponse
  >('social_unreact', UnreactToPostResponseSchema, {
    post_id: postId,
    kind,
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function socialGetComments(
  postId: string,
  cursor?: string,
  limit?: number,
): Promise<GetCommentsResponse> {
  return invokeRustProto<
    { post_id: string; cursor?: string; limit?: number },
    GetCommentsResponse
  >('social_get_comments', GetCommentsResponseSchema, {
    post_id: postId,
    cursor,
    limit,
  });
}

export async function socialCreateComment(
  postId: string,
  content: string,
  replyToCommentId?: string,
): Promise<Comment | undefined> {
  const resp = await invokeRustProto<
    { post_id: string; content: string; reply_to_comment_id?: string },
    CreateCommentResponse
  >('social_create_comment', CreateCommentResponseSchema, {
    post_id: postId,
    content,
    reply_to_comment_id: replyToCommentId,
  });
  return resp.comment;
}

export async function socialDeleteComment(commentId: string): Promise<boolean> {
  const resp = await invokeRustProto<{ comment_id: string }, DeleteCommentResponse>(
    'social_delete_comment',
    DeleteCommentResponseSchema,
    { comment_id: commentId },
  );
  return resp.success;
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export async function socialFollow(targetUserId: string): Promise<FollowResponse> {
  return invokeRustProto<{ target_user_id: string }, FollowResponse>(
    'social_follow',
    FollowResponseSchema,
    { target_user_id: targetUserId },
  );
}

export async function socialUnfollow(targetUserId: string): Promise<UnfollowResponse> {
  return invokeRustProto<{ target_user_id: string }, UnfollowResponse>(
    'social_unfollow',
    UnfollowResponseSchema,
    { target_user_id: targetUserId },
  );
}

export async function socialGetFollowers(
  userId?: string,
  cursor?: string,
  limit?: number,
): Promise<GetFollowersResponse> {
  return invokeRustProto<
    { user_id?: string; cursor?: string; limit?: number },
    GetFollowersResponse
  >('social_get_followers', GetFollowersResponseSchema, {
    user_id: userId,
    cursor,
    limit,
  });
}

export async function socialGetFollowing(
  userId?: string,
  cursor?: string,
  limit?: number,
): Promise<GetFollowingResponse> {
  return invokeRustProto<
    { user_id?: string; cursor?: string; limit?: number },
    GetFollowingResponse
  >('social_get_following', GetFollowingResponseSchema, {
    user_id: userId,
    cursor,
    limit,
  });
}

export async function socialGetRelationship(
  targetUserId: string,
): Promise<GetRelationshipResponse> {
  return invokeRustProto<{ target_user_id: string }, GetRelationshipResponse>(
    'social_get_relationship',
    GetRelationshipResponseSchema,
    { target_user_id: targetUserId },
  );
}

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

export async function socialCircleCreate(
  name: string,
  description?: string,
  memberDids?: string[],
): Promise<CreateCircleResponse> {
  return invokeRustProto<
    { name: string; description?: string; member_dids?: string[] },
    CreateCircleResponse
  >('social_circle_create', CreateCircleResponseSchema, {
    name,
    description,
    member_dids: memberDids,
  });
}

export async function socialCircleRename(
  circleId: string,
  name: string,
  description?: string,
): Promise<RenameCircleResponse> {
  return invokeRustProto<
    { circle_id: string; name: string; description?: string },
    RenameCircleResponse
  >('social_circle_rename', RenameCircleResponseSchema, {
    circle_id: circleId,
    name,
    description,
  });
}

export async function socialCircleDelete(circleId: string): Promise<DeleteCircleResponse> {
  return invokeRustProto<{ circle_id: string }, DeleteCircleResponse>(
    'social_circle_delete',
    DeleteCircleResponseSchema,
    { circle_id: circleId },
  );
}

export async function socialCircleListMine(): Promise<ListMyCirclesResponse> {
  return invokeRustProto<undefined, ListMyCirclesResponse>(
    'social_circle_list_mine',
    ListMyCirclesResponseSchema,
    undefined,
  );
}

export async function socialCircleAddMembers(
  circleId: string,
  memberDids: string[],
): Promise<AddCircleMemberResponse> {
  return invokeRustProto<
    { circle_id: string; member_dids: string[] },
    AddCircleMemberResponse
  >('social_circle_add_members', AddCircleMemberResponseSchema, {
    circle_id: circleId,
    member_dids: memberDids,
  });
}

export async function socialCircleRemoveMembers(
  circleId: string,
  memberDids: string[],
): Promise<RemoveCircleMemberResponse> {
  return invokeRustProto<
    { circle_id: string; member_dids: string[] },
    RemoveCircleMemberResponse
  >('social_circle_remove_members', RemoveCircleMemberResponseSchema, {
    circle_id: circleId,
    member_dids: memberDids,
  });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Fetch the dashboard-panel counters for the logged-in user. Cheap
 * enough to call on every Moments-tab open; the station computes
 * each value live with simple SQL aggregates.
 */
export async function socialGetMyStats(): Promise<GetMyMomentsStatsResponse> {
  return invokeRustProto<undefined, GetMyMomentsStatsResponse>(
    'social_get_my_stats',
    GetMyMomentsStatsResponseSchema,
    undefined,
  );
}

export async function socialCircleListMembers(
  circleId: string,
): Promise<ListCircleMembersResponse> {
  return invokeRustProto<{ circle_id: string }, ListCircleMembersResponse>(
    'social_circle_list_members',
    ListCircleMembersResponseSchema,
    { circle_id: circleId },
  );
}
