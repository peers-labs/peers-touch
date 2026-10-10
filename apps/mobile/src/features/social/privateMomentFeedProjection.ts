import { create } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';

import {
  PollOptionSchema,
  PollSchema,
} from '../../gen/proto/domain/activity/activity_pb';
import {
  AudienceSchema,
  Audience_Kind,
  ImageAttachmentSchema,
  ImagePostSchema,
  LinkPostSchema,
  LinkPreviewSchema,
  LocationPostSchema,
  LocationSchema,
  PollPostSchema,
  PostAuthorSchema,
  PostSchema,
  PostType,
  RepostPostSchema,
  ReactionSummarySchema,
  TextPostSchema,
  TimelinePageOutcome,
  VideoAttachmentSchema,
  VideoPostSchema,
  type Post,
  type ReactionKind,
} from '../../gen/proto/domain/social/post_pb';
import type { PrivateMomentReadProjection } from '../../services/mobileCommands';
import type { PrivateMomentsRuntimeSnapshot } from '../../runtimes/privateMomentsRuntime';
import type { MomentsFeedState } from './momentsFeedStore';

const MAX_COMPOSED_POSTS = 200;

const AUDIENCE_KIND: Record<
  PrivateMomentReadProjection['audienceKind'],
  Audience_Kind
> = {
  FRIENDS: Audience_Kind.FRIENDS,
  FOLLOWERS: Audience_Kind.FOLLOWERS,
  CIRCLE: Audience_Kind.CIRCLE,
  GROUP: Audience_Kind.GROUP,
  SELF: Audience_Kind.SELF,
  CUSTOM_ALLOW: Audience_Kind.CUSTOM_ALLOW,
  CUSTOM_DENY: Audience_Kind.CUSTOM_DENY,
  UNKNOWN: Audience_Kind.KIND_UNSPECIFIED,
};

function timestamp(value: number | undefined) {
  return value !== undefined && Number.isFinite(value)
    ? timestampFromDate(new Date(value))
    : undefined;
}

function postTime(post: Post): number {
  if (!post.createdAt) return 0;
  return Number(post.createdAt.seconds) * 1000
    + Math.floor(post.createdAt.nanos / 1_000_000);
}

function privateImage(media: {
  readonly attachmentId: string;
  readonly objectId: string;
  readonly localPath?: string;
  readonly width: number;
  readonly height: number;
  readonly altText: string;
}) {
  return create(ImageAttachmentSchema, {
    id: media.attachmentId || media.objectId,
    url: media.localPath ?? '',
    width: media.width,
    height: media.height,
    altText: media.altText,
  });
}

export function privateMomentFeedPost(
  projection: PrivateMomentReadProjection,
): Post | null {
  if (
    projection.state !== 'CONTENT_READY'
    || projection.audienceKind === 'UNKNOWN'
    || !projection.content
  ) {
    return null;
  }

  const content = projection.content;
  let type: PostType;
  let postContent: Post['content'];
  switch (content.kind) {
    case 'TEXT':
      type = PostType.TEXT;
      postContent = {
        case: 'textPost',
        value: create(TextPostSchema, { text: content.text }),
      };
      break;
    case 'IMAGE':
      type = PostType.IMAGE;
      postContent = {
        case: 'imagePost',
        value: create(ImagePostSchema, {
          text: content.text,
          images: content.media.map(privateImage),
        }),
      };
      break;
    case 'VIDEO': {
      type = PostType.VIDEO;
      const video = content.media[0];
      postContent = {
        case: 'videoPost',
        value: create(VideoPostSchema, {
          text: content.text,
          video: video
            ? create(VideoAttachmentSchema, {
                id: video.attachmentId || video.objectId,
                url: video.localPath ?? '',
                width: video.width,
                height: video.height,
                durationSeconds: Math.ceil(video.durationMs / 1000),
              })
            : undefined,
        }),
      };
      break;
    }
    case 'LINK':
      type = PostType.LINK;
      postContent = {
        case: 'linkPost',
        value: create(LinkPostSchema, {
          text: content.text,
          link: create(LinkPreviewSchema, {
            url: content.url,
            title: content.title,
          }),
        }),
      };
      break;
    case 'POLL':
      type = PostType.POLL;
      postContent = {
        case: 'pollPost',
        value: create(PollPostSchema, {
          text: [content.text, content.question].filter(Boolean).join('\n'),
          poll: create(PollSchema, {
            options: content.options.map((text) => create(PollOptionSchema, { text })),
            expiresIn: Math.max(0, content.expiresAtSeconds),
            multiple: content.maxChoices > 1,
          }),
        }),
      };
      break;
    case 'REPOST':
      type = PostType.REPOST;
      postContent = {
        case: 'repostPost',
        value: create(RepostPostSchema, {
          comment: content.comment,
          originalPostId: content.sourcePostId,
        }),
      };
      break;
    case 'LOCATION':
      type = PostType.LOCATION;
      postContent = {
        case: 'locationPost',
        value: create(LocationPostSchema, {
          text: content.text,
          location: create(LocationSchema, {
            name: content.name,
            latitude: Number(content.latitude),
            longitude: Number(content.longitude),
            address: content.address,
          }),
          images: content.media.map(privateImage),
        }),
      };
      break;
  }

  return create(PostSchema, {
    id: projection.postId,
    authorPtid: projection.authorPtid,
    type,
    createdAt: timestamp(projection.createdAtMillis),
    updatedAt: timestamp(projection.updatedAtMillis),
    author: create(PostAuthorSchema, {
      id: projection.authorPtid,
      displayName: projection.authorPtid,
    }),
    audience: create(AudienceSchema, {
      kind: AUDIENCE_KIND[projection.audienceKind],
    }),
    content: postContent,
    reactions: (projection.reactions ?? []).map((reaction) => (
      create(ReactionSummarySchema, {
        kind: reaction.kind as ReactionKind,
        count: BigInt(reaction.count),
        reactedByViewer: reaction.reactedByViewer,
      })
    )),
  });
}

export function composeHomeFeedState(
  publicHome: MomentsFeedState,
  privateSocial: PrivateMomentsRuntimeSnapshot | null,
): MomentsFeedState {
  if (!privateSocial) return publicHome;

  const postsById = new Map(publicHome.posts.map((post) => [post.id, post]));
  for (const projection of Object.values(privateSocial.postsById)) {
    const post = privateMomentFeedPost(projection);
    if (post) postsById.set(post.id, post);
  }
  const posts = [...postsById.values()]
    .sort((left, right) => postTime(right) - postTime(left))
    .slice(0, MAX_COMPOSED_POSTS);
  const reactionMutations = new Map(publicHome.reactionMutations);
  for (const command of privateSocial.reactionCommands ?? []) {
    if (!postsById.has(command.postId)) continue;
    switch (command.state) {
      case 'REACTION_PENDING':
        reactionMutations.set(command.postId, {
          requestId: command.attemptCount,
          reactionKind: command.kind,
          status: 'pending',
          errorMessage: '',
        });
        break;
      case 'REACTION_RETRYING':
        reactionMutations.set(command.postId, {
          requestId: command.attemptCount,
          reactionKind: command.kind,
          status: 'retrying',
          errorMessage: command.errorCode ?? '',
        });
        break;
      case 'REACTION_UNKNOWN_OUTCOME':
        reactionMutations.set(command.postId, {
          requestId: command.attemptCount,
          reactionKind: command.kind,
          status: 'unknown-outcome',
          errorMessage: command.errorCode ?? '',
        });
        break;
      case 'REACTION_REJECTED':
        reactionMutations.set(command.postId, {
          requestId: command.attemptCount,
          reactionKind: command.kind,
          status: 'rejected',
          errorMessage: command.errorCode ?? '',
        });
        break;
      case 'REACTION_COMMITTED':
        reactionMutations.delete(command.postId);
        break;
    }
  }
  if (
    posts.length === publicHome.posts.length
    && posts.every((post, index) => post === publicHome.posts[index])
    && reactionMutations.size === publicHome.reactionMutations.size
    && [...reactionMutations].every(([postId, mutation]) => (
      publicHome.reactionMutations.get(postId) === mutation
    ))
  ) {
    return publicHome;
  }

  return {
    ...publicHome,
    posts,
    postIndex: new Map(posts.map((post, index) => [post.id, index])),
    reactionMutations,
    pageOutcome: posts.length > 0
      ? TimelinePageOutcome.ITEMS
      : publicHome.pageOutcome,
  };
}
