import { clone, create, equals, fromBinary } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import {
  FeedEventKind, FeedPayloadSchema, type FeedEvent,
} from '../gen/proto/domain/social/feed_log_pb';
import {
  CreatePostRequestSchema, PostSchema, TextPostSchema, ImagePostSchema,
  ImageAttachmentSchema, VideoPostSchema, VideoAttachmentSchema,
  LinkPostSchema, LinkPreviewSchema, RepostPostSchema, LocationPostSchema,
  PollPostSchema,
  PostInteractionSchema, ReactionKind, ReactionSummarySchema, type Post, type CreatePostRequest,
  PostStatsSchema,
} from '../gen/proto/domain/social/post_pb';
import {
  CommentSchema, CreateCommentRequestSchema, type Comment,
} from '../gen/proto/domain/social/comment_pb';

function stamp(ms: bigint) {
  return timestampFromDate(new Date(Number(ms)));
}

export function signedPostContent(request: CreatePostRequest): Post['content'] {
  const content = request.content;
  switch (content.case) {
    case 'text': return { case: 'textPost', value: create(TextPostSchema, { text: content.value.text }) };
    case 'image': return { case: 'imagePost', value: create(ImagePostSchema, {
      text: content.value.text,
      images: content.value.images.length ? content.value.images : content.value.imageIds.map(id =>
        create(ImageAttachmentSchema, { id, url: id })),
    }) };
    case 'video': return { case: 'videoPost', value: create(VideoPostSchema, {
      text: content.value.text,
      video: create(VideoAttachmentSchema, { id: content.value.videoId, url: content.value.videoId }),
    }) };
    case 'link': return { case: 'linkPost', value: create(LinkPostSchema, {
      text: content.value.text, link: create(LinkPreviewSchema, { url: content.value.url }),
    }) };
    case 'repost': return { case: 'repostPost', value: create(RepostPostSchema, {
      comment: content.value.comment, originalPostId: content.value.originalPostId,
    }) };
    case 'poll': return { case: 'pollPost', value: create(PollPostSchema, { text: content.value.text }) };
    case 'location': return { case: 'locationPost', value: create(LocationPostSchema, {
      text: content.value.text, location: content.value.location,
      images: content.value.imageIds.map(id => create(ImageAttachmentSchema, { id, url: id })),
    }) };
    default: throw new Error('FEED_UNSUPPORTED_POST_TYPE');
  }
}

type ReactionVersion = { sequence: bigint; present: boolean; actor: string; kind: number; target: string; parent: string };

// A projection over Native-verified bytes, never a signature verifier or a
// persistence authority. Runtime reset discards it; Native cache replays it.
export class PublicFeedProjection {
  readonly posts = new Map<string, Post>();
  readonly comments = new Map<string, Comment>();
  private readonly reactions = new Map<string, ReactionVersion>();
  private readonly commentVersions = new Map<string, bigint>();
  private readonly postVersions = new Map<string, bigint>();
  private readonly postRequests = new Map<string, CreatePostRequest>();
  private readonly deferredComments = new Map<string, { event: FeedEvent; home: string }>();

  apply(event: FeedEvent, home: string): void {
    const statement = event.statement;
    if (!statement || !home) throw new Error('FEED_INVALID_RESPONSE');
    const payload = fromBinary(FeedPayloadSchema, event.payload);
    const actor = statement.actorPtid;
    const mutation = payload.mutation;
    if (mutation.case === 'post') {
      const ref = `oss://${home}/post/${mutation.value.postId}`;
      const previous = this.posts.get(ref);
      if (previous && previous.authorPtid !== actor) throw new Error('FEED_FORK_DETECTED');
      if ((this.postVersions.get(ref) ?? 0n) >= statement.sequence) return;
      if (statement.kind === FeedEventKind.POST_TOMBSTONED) {
        if (!previous) throw new Error('FEED_GAP');
        this.posts.set(ref, { ...previous, isDeleted: true, updatedAt: stamp(statement.createdAtUnixMs) });
        this.postVersions.set(ref, statement.sequence);
        return;
      }
      if (previous?.isDeleted) throw new Error('FEED_INVALID');
      const request = fromBinary(CreatePostRequestSchema, mutation.value.createRequest);
      this.postRequests.set(ref, request);
      this.posts.set(ref, create(PostSchema, {
        publicFeedRef: ref, authorPtid: actor, type: request.type,
        audience: request.audience, content: signedPostContent(request),
        createdAt: previous?.createdAt ?? stamp(statement.createdAtUnixMs),
        updatedAt: stamp(statement.createdAtUnixMs),
      }));
      this.postVersions.set(ref, statement.sequence);
      return;
    }
    if (mutation.case === 'comment') {
      const ref = `oss://${home}/comment/${mutation.value.commentId}`;
      const previous = this.comments.get(ref);
      if ((this.commentVersions.get(ref) ?? 0n) >= statement.sequence) return;
      if (previous && previous.authorPtid !== actor) throw new Error('FEED_FORK_DETECTED');
      if (statement.kind === FeedEventKind.COMMENT_TOMBSTONED) {
        if (previous) this.comments.set(ref, { ...previous, isDeleted: true, updatedAt: stamp(statement.createdAtUnixMs) });
        this.commentVersions.set(ref, statement.sequence);
        return;
      }
      if (previous?.isDeleted) return;
      // An update receipt can arrive before its creation receipt. Keep it
      // retryable until a later bounded pass supplies the creation timestamp.
      if (!previous && statement.kind !== FeedEventKind.COMMENT_CREATED) {
        const retained = this.deferredComments.get(ref);
        if (!retained || retained.event.statement!.sequence < statement.sequence) {
          this.deferredComments.set(ref, { event, home });
        }
        return;
      }
      const request = fromBinary(CreateCommentRequestSchema, mutation.value.createRequest);
      this.comments.set(ref, create(CommentSchema, {
        publicFeedRef: ref, authorPtid: actor, postId: mutation.value.targetPostRef,
        content: request.content, replyToPublicFeedRef: request.replyToCommentId,
        typedMentions: request.typedMentions,
        createdAt: previous?.createdAt ?? stamp(statement.createdAtUnixMs),
        updatedAt: stamp(statement.createdAtUnixMs),
      }));
      this.commentVersions.set(ref, statement.sequence);
      const deferred = this.deferredComments.get(ref);
      if (deferred) {
        this.deferredComments.delete(ref);
        this.apply(deferred.event, deferred.home);
      }
      return;
    }
    if (mutation.case === 'reaction') {
      const { targetPostRef: parent, targetCommentRef, reactionKind: kind } = mutation.value;
      const target = targetCommentRef || parent;
      const comment = targetCommentRef ? this.comments.get(targetCommentRef) : undefined;
      if (comment && comment.postId !== parent) throw new Error('FEED_INVALID');
      const key = `${target}\0${actor}\0${kind}`;
      const previous = this.reactions.get(key);
      if (!previous || previous.sequence < statement.sequence) this.reactions.set(key, {
        target, parent, actor, kind, sequence: statement.sequence,
        present: statement.kind === FeedEventKind.REACTION_SET,
      });
    }
  }

  requestForEdit(ref: string, viewer: string): CreatePostRequest {
    const post = this.posts.get(ref);
    const request = this.postRequests.get(ref);
    if (!post || !request) throw new Error('FEED_PROJECTION_UNVERIFIED');
    if (post.authorPtid !== viewer) throw new Error('FEED_WRITER_NOT_AUTHORIZED');
    if (post.isDeleted) throw new Error('FEED_INVALID');
    return clone(CreatePostRequestSchema, request);
  }

  reactionSummaries(ref: string, viewer: string): Post['reactions'] {
    const summary = new Map<number, Post['reactions'][number]>();
    for (const reaction of this.reactions.values()) {
      if (!reaction.present || reaction.target !== ref) continue;
      if (this.posts.get(reaction.parent)?.isDeleted) continue;
      if (reaction.target !== reaction.parent) {
        const comment = this.comments.get(reaction.target);
        if (!comment || comment.isDeleted || comment.postId !== reaction.parent) continue;
      }
      const row = summary.get(reaction.kind) ?? create(ReactionSummarySchema, { kind: reaction.kind, count: 0n });
      row.count += 1n;
      row.reactedByViewer ||= reaction.actor === viewer;
      summary.set(reaction.kind, row);
    }
    return [...summary.values()];
  }

  bindPost(projected: Post, viewer: string): Post {
    const signed = this.posts.get(projected.publicFeedRef);
    if (!signed || signed.authorPtid !== projected.authorPtid) throw new Error('FEED_PROJECTION_UNVERIFIED');
    const body = clone(PostSchema, projected);
    body.id = '';
    body.author = undefined;
    body.stats = undefined;
    body.interaction = undefined;
    body.reactions = [];
    // Compare every authored field, including media, mentions and timestamps.
    if (!equals(PostSchema, body, signed)) throw new Error('FEED_PROJECTION_TAMPERED');
    const reactions = this.reactionSummaries(signed.publicFeedRef, viewer);
    return create(PostSchema, {
      ...projected, content: signed.content, typedMentions: signed.typedMentions,
      reactions,
      interaction: create(PostInteractionSchema, {
        isLiked: reactions.some(r => r.kind === ReactionKind.REACTION_LIKE && r.reactedByViewer),
      }),
      stats: create(PostStatsSchema, {
        likesCount: reactions.reduce((n, r) => n + r.count, 0n),
        commentsCount: BigInt([...this.comments.values()].filter(c => c.postId === signed.publicFeedRef && !c.isDeleted).length),
      }),
    });
  }

  bindComment(projected: Comment, target: string, viewer = ''): Comment {
    const signed = this.comments.get(projected.publicFeedRef);
    if (!signed || signed.authorPtid !== projected.authorPtid || signed.postId !== target) {
      throw new Error('FEED_PROJECTION_UNVERIFIED');
    }
    if (signed.content !== projected.content || signed.isDeleted !== projected.isDeleted
      || signed.replyToPublicFeedRef !== projected.replyToPublicFeedRef
      || !equals(CommentSchema, create(CommentSchema, { createdAt: signed.createdAt, updatedAt: signed.updatedAt }),
        create(CommentSchema, { createdAt: projected.createdAt, updatedAt: projected.updatedAt }))
      || !equals(CommentSchema, create(CommentSchema, { typedMentions: signed.typedMentions }),
        create(CommentSchema, { typedMentions: projected.typedMentions }))) {
      throw new Error('FEED_PROJECTION_TAMPERED');
    }
    const likes = this.reactionSummaries(signed.publicFeedRef, viewer)
      .find(reaction => reaction.kind === ReactionKind.REACTION_LIKE);
    return { ...projected, content: signed.content, typedMentions: signed.typedMentions,
      likesCount: likes?.count ?? 0n, isLiked: likes?.reactedByViewer ?? false };
  }
}
