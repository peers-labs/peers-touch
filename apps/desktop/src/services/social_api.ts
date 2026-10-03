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
  CreateVideoPostRequestSchema,
  CreateLinkPostRequestSchema,
  CreatePollPostRequestSchema,
  CreateRepostRequestSchema,
  CreateLocationPostRequestSchema,
  LocationSchema,
  GetPostResponseSchema,
  DeletePostResponseSchema,
  ListPostsResponseSchema,
  GetTimelineResponseSchema,
  SyncMomentsProjectionResponseSchema,
  GetMyMomentsStatsResponseSchema,
  ReactToPostResponseSchema,
  UnreactToPostResponseSchema,
  UpsertStationModerationPolicyResponseSchema,
  DeleteStationModerationPolicyResponseSchema,
  ListStationModerationPoliciesResponseSchema,
  ReactionKind,
  TimelineType,
  PostType,
  Audience_Kind,
  Audience,
  Mention,
  PostAuthorSchema,
  StationModerationPolicy_Kind,
  type CreatePostRequest,
  type CreatePostResponse,
  type GetPostResponse,
  type DeletePostResponse,
  type ListPostsResponse,
  type GetTimelineResponse,
  type SyncMomentsProjectionResponse,
  type GetMyMomentsStatsResponse,
  type Post,
  type ReactToPostResponse,
  type UnreactToPostResponse,
  type ImageAttachment,
  type UpsertStationModerationPolicyResponse,
  type DeleteStationModerationPolicyResponse,
  type ListStationModerationPoliciesResponse,
} from '../gen/proto/domain/social/post_pb';
import {
  CommentSchema,
  CreateCommentResponseSchema,
  DeleteCommentResponseSchema,
  type Comment,
  type CreateCommentResponse,
  type DeleteCommentResponse,
} from '../gen/proto/domain/social/comment_pb';
import {
  ListMomentCommentsResponseSchema,
  type CommentResource,
  type ListMomentCommentsRequest,
  type ListMomentCommentsResponse,
} from '../gen/proto/domain/social/private_content_pb';
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
  BlockSocialActorResponseSchema,
  FollowResponseSchema,
  UnfollowResponseSchema,
  UnblockSocialActorResponseSchema,
  GetRelationshipResponseSchema,
  GetFollowersResponseSchema,
  GetFollowingResponseSchema,
  type BlockSocialActorResponse,
  type FollowResponse,
  type UnfollowResponse,
  type UnblockSocialActorResponse,
  type GetRelationshipResponse,
  type GetFollowersResponse,
  type GetFollowingResponse,
} from '../gen/proto/domain/social/relationship_pb';
import { EVENT, eventBus } from '../kernel/events';
import { invokeRustProto } from './desktop_api';
import type { PrivateMomentLocalFileIntent } from './privateMomentsNative';

// ---------------------------------------------------------------------------
// Composer helpers — build typed `CreatePostRequest` payloads
// ---------------------------------------------------------------------------

export interface MomentDraftBase {
  audience: Audience;
  /** Stable renderer draft identity used by the Native private command journal. */
  draftId?: string;
  /** Increments whenever plaintext, audience, or local file intent changes. */
  draftRevision?: number;
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
  /** Typed attachments carrying E2EE media descriptors for new clients. */
  images?: ImageAttachment[];
  /** Local files handed to Native only after private prepare succeeds. */
  localFiles?: PrivateMomentLocalFileIntent[];
}

export interface VideoDraft extends MomentDraftBase {
  kind: 'video';
  text: string;
  /** Public OSS video identity. Private publishes use localFiles instead. */
  videoId?: string;
  /** Source, optional poster, then optional variants for Native encryption. */
  localFiles?: PrivateMomentLocalFileIntent[];
}

export interface LinkDraft extends MomentDraftBase {
  kind: 'link';
  text: string;
  link: {
    url: string;
    title: string;
    description?: string;
    imageUrl?: string;
    siteName?: string;
    faviconUrl?: string;
  };
}

export interface PollDraft extends MomentDraftBase {
  kind: 'poll';
  text: string;
  poll: {
    question: string;
    options: string[];
    minChoices: number;
    maxChoices: number;
    expiresAtSeconds: number;
    /** Public Social retains its existing duration-based wire contract. */
    durationHours: number;
    multipleChoice: boolean;
  };
}

export interface RepostDraft extends MomentDraftBase {
  kind: 'repost';
  originalPostId: string;
  comment: string;
}

export interface LocationDraft extends MomentDraftBase {
  kind: 'location';
  text: string;
  imageIds?: string[];
  location: {
    name: string;
    latitude: number;
    longitude: number;
    address?: string;
    placeId?: string;
  };
}

export type MomentDraft =
  | TextDraft
  | ImageDraft
  | VideoDraft
  | LinkDraft
  | PollDraft
  | RepostDraft
  | LocationDraft;

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
  if (draft.audience.kind !== Audience_Kind.PUBLIC) {
    throw new Error('PRIVATE_NATIVE_ADAPTER_REQUIRED');
  }
  const base = {
    audience: draft.audience,
    ...(draft.replyToPostId ? { replyToPostId: draft.replyToPostId } : {}),
  };
  // The oneof inner value MUST be a properly-constructed message —
  // bufbuild's `toBinary` rejects bare POJOs because it can't tell
  // which schema to use for the embedded fields.
  // The oneof case names are the camelCased proto field names
  // (`text` / `image` / `repost` are FIELD names of CreatePostRequest,
  // not the message-type short forms).
  switch (draft.kind) {
    case 'text':
      return create(CreatePostRequestSchema, {
        ...base,
        type: PostType.TEXT,
        content: {
          case: 'text',
          value: create(CreateTextPostRequestSchema, { text: draft.text }),
        },
      });
    case 'image': {
      const typedImages = draft.images ?? [];
      return create(CreatePostRequestSchema, {
        ...base,
        type: PostType.IMAGE,
        content: {
          case: 'image',
          value: create(CreateImagePostRequestSchema, {
            text: draft.text,
            imageIds: typedImages.length > 0 ? [] : draft.imageIds,
            images: typedImages,
          }),
        },
      });
    }
    case 'video':
      if (!draft.videoId?.trim()) {
        throw new Error('socialCreateMoment: public video_id is required');
      }
      return create(CreatePostRequestSchema, {
        ...base,
        type: PostType.VIDEO,
        content: {
          case: 'video',
          value: create(CreateVideoPostRequestSchema, {
            text: draft.text,
            videoId: draft.videoId,
          }),
        },
      });
    case 'link':
      return create(CreatePostRequestSchema, {
        ...base,
        type: PostType.LINK,
        content: {
          case: 'link',
          value: create(CreateLinkPostRequestSchema, {
            text: draft.text,
            url: draft.link.url,
          }),
        },
      });
    case 'poll':
      return create(CreatePostRequestSchema, {
        ...base,
        type: PostType.POLL,
        content: {
          case: 'poll',
          value: create(CreatePollPostRequestSchema, {
            text: draft.text,
            question: draft.poll.question,
            options: draft.poll.options,
            durationHours: draft.poll.durationHours,
            multipleChoice: draft.poll.multipleChoice,
          }),
        },
      });
    case 'repost':
      return create(CreatePostRequestSchema, {
        ...base,
        type: PostType.REPOST,
        content: {
          case: 'repost',
          value: create(CreateRepostRequestSchema, {
            originalPostId: draft.originalPostId,
            comment: draft.comment,
          }),
        },
      });
    case 'location':
      return create(CreatePostRequestSchema, {
        ...base,
        type: PostType.LOCATION,
        content: {
          case: 'location',
          value: create(CreateLocationPostRequestSchema, {
            text: draft.text,
            imageIds: draft.imageIds ?? [],
            location: create(LocationSchema, {
              name: draft.location.name,
              latitude: draft.location.latitude,
              longitude: draft.location.longitude,
              address: draft.location.address ?? '',
              placeId: draft.location.placeId ?? '',
            }),
          }),
        },
      });
  }
  throw new Error('socialCreateMoment: unsupported draft kind');
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

export async function socialGetMomentResponse(id: string): Promise<GetPostResponse> {
  return invokeRustProto<{ id: string }, GetPostResponse>(
    'social_get_moment',
    GetPostResponseSchema,
    { id },
  );
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

export async function socialSyncMomentsProjection(options?: {
  homeCursor?: string;
  publicCursor?: string;
  limit?: number;
  publicSort?: TimelineSort;
  reason?: string;
}): Promise<SyncMomentsProjectionResponse> {
  return invokeRustProto<
    {
      home_cursor?: string;
      public_cursor?: string;
      limit?: number;
      public_sort?: number;
      reason?: string;
    },
    SyncMomentsProjectionResponse
  >('social_sync_moments_projection', SyncMomentsProjectionResponseSchema, {
    home_cursor: options?.homeCursor,
    public_cursor: options?.publicCursor,
    limit: options?.limit,
    public_sort: options?.publicSort === 'hot' ? 1 : 0,
    reason: options?.reason,
  });
}

export async function socialListByAuthor(
  authorPtid: string,
  cursor?: string,
  limit?: number,
): Promise<ListPostsResponse> {
  return invokeRustProto<
    { author_ptid: string; cursor?: string; limit?: number },
    ListPostsResponse
  >('social_list_by_author', ListPostsResponseSchema, {
    author_ptid: authorPtid,
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
): Promise<ListMomentCommentsResponse> {
  const boundedLimit = Number.isInteger(limit) && Number(limit) > 0
    ? Math.min(Number(limit), 100)
    : 20;
  return invokeRustProto<
    {
      post_id: ListMomentCommentsRequest['postId'];
      cursor?: ListMomentCommentsRequest['cursor'];
      limit: ListMomentCommentsRequest['limit'];
    },
    ListMomentCommentsResponse
  >('social_get_comments', ListMomentCommentsResponseSchema, {
    post_id: postId,
    cursor,
    limit: boundedLimit,
  });
}

export function publicCommentFromResource(resource: CommentResource): Comment {
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

export async function socialFollow(targetActorPtid: string): Promise<FollowResponse> {
  return invokeRustProto<{ target_actor_ptid: string }, FollowResponse>(
    'social_follow',
    FollowResponseSchema,
    { target_actor_ptid: targetActorPtid },
  );
}

export async function socialUnfollow(targetActorPtid: string): Promise<UnfollowResponse> {
  return invokeRustProto<{ target_actor_ptid: string }, UnfollowResponse>(
    'social_unfollow',
    UnfollowResponseSchema,
    { target_actor_ptid: targetActorPtid },
  );
}

export async function socialGetFollowers(
  actorPtid?: string,
  cursor?: string,
  limit?: number,
): Promise<GetFollowersResponse> {
  return invokeRustProto<
    { actor_ptid?: string; cursor?: string; limit?: number },
    GetFollowersResponse
  >('social_get_followers', GetFollowersResponseSchema, {
    actor_ptid: actorPtid,
    cursor,
    limit,
  });
}

export async function socialGetFollowing(
  actorPtid?: string,
  cursor?: string,
  limit?: number,
): Promise<GetFollowingResponse> {
  return invokeRustProto<
    { actor_ptid?: string; cursor?: string; limit?: number },
    GetFollowingResponse
  >('social_get_following', GetFollowingResponseSchema, {
    actor_ptid: actorPtid,
    cursor,
    limit,
  });
}

export async function socialGetRelationship(
  targetActorPtid: string,
): Promise<GetRelationshipResponse> {
  return invokeRustProto<{ target_actor_ptid: string }, GetRelationshipResponse>(
    'social_get_relationship',
    GetRelationshipResponseSchema,
    { target_actor_ptid: targetActorPtid },
  );
}

export interface SocialRelationshipMutationInput {
  targetActorPtid: string;
  targetHomeStationPeerId: string;
  observedRevision: number;
}

export async function socialBlockActor(
  input: SocialRelationshipMutationInput,
): Promise<BlockSocialActorResponse> {
  return invokeRustProto<
    {
      target_actor_ptid: string;
      target_home_station_peer_id: string;
      observed_revision: number;
    },
    BlockSocialActorResponse
  >('social_block_actor', BlockSocialActorResponseSchema, {
    target_actor_ptid: input.targetActorPtid,
    target_home_station_peer_id: input.targetHomeStationPeerId,
    observed_revision: input.observedRevision,
  });
}

export async function socialUnblockActor(
  input: SocialRelationshipMutationInput,
): Promise<UnblockSocialActorResponse> {
  return invokeRustProto<
    {
      target_actor_ptid: string;
      target_home_station_peer_id: string;
      observed_revision: number;
    },
    UnblockSocialActorResponse
  >('social_unblock_actor', UnblockSocialActorResponseSchema, {
    target_actor_ptid: input.targetActorPtid,
    target_home_station_peer_id: input.targetHomeStationPeerId,
    observed_revision: input.observedRevision,
  });
}

// ---------------------------------------------------------------------------
// Station moderation
// ---------------------------------------------------------------------------

export interface StationModerationUpsertInput {
  stationDomain?: string;
  stationPeerId?: string;
  kind?: StationModerationPolicy_Kind;
  reason?: string;
}

export interface StationModerationDeleteInput {
  stationDomain?: string;
  stationPeerId?: string;
  kind?: StationModerationPolicy_Kind;
}

export interface StationModerationListInput {
  kind?: StationModerationPolicy_Kind;
  cursor?: string;
  limit?: number;
}

export async function socialStationModerationUpsert(
  input: StationModerationUpsertInput,
): Promise<UpsertStationModerationPolicyResponse> {
  const response = await invokeRustProto<
    {
      station_domain: string;
      station_peer_id?: string;
      kind?: number;
      reason?: string;
    },
    UpsertStationModerationPolicyResponse
  >('social_station_moderation_upsert', UpsertStationModerationPolicyResponseSchema, {
    station_domain: input.stationDomain ?? '',
    station_peer_id: input.stationPeerId,
    kind: input.kind ?? StationModerationPolicy_Kind.STATION_MODERATION_POLICY_BLOCK,
    reason: input.reason,
  });
  eventBus.publish(EVENT.MOMENT_RESYNC_REQUESTED, {
    reason: 'station_moderation_upsert',
  });
  return response;
}

export async function socialStationModerationDelete(
  input: StationModerationDeleteInput,
): Promise<DeleteStationModerationPolicyResponse> {
  const response = await invokeRustProto<
    {
      station_domain?: string;
      station_peer_id?: string;
      kind?: number;
    },
    DeleteStationModerationPolicyResponse
  >('social_station_moderation_delete', DeleteStationModerationPolicyResponseSchema, {
    station_domain: input.stationDomain,
    station_peer_id: input.stationPeerId,
    kind: input.kind ?? StationModerationPolicy_Kind.STATION_MODERATION_POLICY_BLOCK,
  });
  eventBus.publish(EVENT.MOMENT_RESYNC_REQUESTED, {
    reason: 'station_moderation_delete',
  });
  return response;
}

export async function socialStationModerationList(
  input: StationModerationListInput = {},
): Promise<ListStationModerationPoliciesResponse> {
  return invokeRustProto<
    {
      kind?: number;
      cursor?: string;
      limit?: number;
    },
    ListStationModerationPoliciesResponse
  >('social_station_moderation_list', ListStationModerationPoliciesResponseSchema, {
    kind: input.kind ?? StationModerationPolicy_Kind.STATION_MODERATION_POLICY_BLOCK,
    cursor: input.cursor,
    limit: input.limit,
  });
}

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

export async function socialCircleCreate(
  name: string,
  description?: string,
  memberPtids?: string[],
): Promise<CreateCircleResponse> {
  return invokeRustProto<
    { name: string; description?: string; member_ptids?: string[] },
    CreateCircleResponse
  >('social_circle_create', CreateCircleResponseSchema, {
    name,
    description,
    member_ptids: memberPtids,
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
  memberPtids: string[],
): Promise<AddCircleMemberResponse> {
  return invokeRustProto<
    { circle_id: string; member_ptids: string[] },
    AddCircleMemberResponse
  >('social_circle_add_members', AddCircleMemberResponseSchema, {
    circle_id: circleId,
    member_ptids: memberPtids,
  });
}

export async function socialCircleRemoveMembers(
  circleId: string,
  memberPtids: string[],
): Promise<RemoveCircleMemberResponse> {
  return invokeRustProto<
    { circle_id: string; member_ptids: string[] },
    RemoveCircleMemberResponse
  >('social_circle_remove_members', RemoveCircleMemberResponseSchema, {
    circle_id: circleId,
    member_ptids: memberPtids,
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
