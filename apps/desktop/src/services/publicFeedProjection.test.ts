import { describe, it, expect } from 'vitest';
import { clone, create, toBinary } from '@bufbuild/protobuf';
import {
  FeedEventSchema, FeedEventStatementSchema, FeedEventKind,
  FeedPayloadSchema, FeedPostMutationSchema, FeedCommentMutationSchema, FeedReactionMutationSchema,
  FeedPollBallotMutationSchema, FeedPollAdmissionSchema, FeedPollAdmissionResult,
} from '../gen/proto/domain/social/feed_log_pb';
import {
  AudienceSchema, Audience_Kind, CreatePostRequestSchema,
  CreateTextPostRequestSchema, CreatePollPostRequestSchema, PostType, PostSchema,
} from '../gen/proto/domain/social/post_pb';
import { CommentSchema, CreateCommentRequestSchema } from '../gen/proto/domain/social/comment_pb';
import { PublicFeedProjection } from './publicFeedProjection';

const home = 'home-a';
const actor = 'ptid:alice';
function postEvent() {
  const request = create(CreatePostRequestSchema, {
    audience: create(AudienceSchema, { kind: Audience_Kind.PUBLIC }),
    content: { case: 'text', value: create(CreateTextPostRequestSchema, { text: 'signed body' }) },
  });
  return create(FeedEventSchema, {
    statement: create(FeedEventStatementSchema, {
      actorPtid: actor, kind: FeedEventKind.POST_CREATED, sequence: 1n, createdAtUnixMs: 1_700_000_000_000n,
    }),
    payload: toBinary(FeedPayloadSchema, create(FeedPayloadSchema, {
      mutation: { case: 'post', value: create(FeedPostMutationSchema, { postId: '42', createRequest: toBinary(CreatePostRequestSchema, request) }) },
    })),
  });
}

describe('Native-verified public Feed projection binding', () => {
  it('binds Station local IDs only through portable references and rejects changed正文 or identity', () => {
    const projection = new PublicFeedProjection();
    projection.apply(postEvent(), home);
    const ref = `oss://${home}/post/42`;
    const signed = projection.posts.get(ref)!;
    const projected = create(PostSchema, { ...signed, id: '999' });
    expect(projection.bindPost(projected, actor).content).toEqual(signed.content);
    const modified = clone(PostSchema, projected);
    if (modified.content.case === 'textPost') modified.content.value.text = 'Station rewrite';
    expect(() => projection.bindPost(modified, actor)).toThrow('FEED_PROJECTION_TAMPERED');
    expect(() => projection.bindPost({ ...projected, publicFeedRef: 'oss://other/post/42' }, actor)).toThrow('FEED_PROJECTION_UNVERIFIED');
    expect(() => projection.bindPost({ ...projected, authorPtid: 'ptid:mallory' }, actor)).toThrow('FEED_PROJECTION_UNVERIFIED');
  });

  it('does not let late independent receipts resurrect a deleted comment', () => {
    const projection = new PublicFeedProjection();
    projection.apply(postEvent(), home);
    const target = `oss://${home}/post/42`;
    const request = create(CreateCommentRequestSchema, { postId: target, content: 'reply' });
    const event = create(FeedEventSchema, {
      statement: create(FeedEventStatementSchema, { actorPtid: 'ptid:bob', kind: FeedEventKind.COMMENT_CREATED, sequence: 2n, createdAtUnixMs: 1_700_000_000_001n }),
      payload: toBinary(FeedPayloadSchema, create(FeedPayloadSchema, { mutation: {
        case: 'comment', value: create(FeedCommentMutationSchema, { commentId: '7', targetPostRef: target, createRequest: toBinary(CreateCommentRequestSchema, request) }),
      } })),
    });
    projection.apply(event, 'home-b');
    const comment = create(CommentSchema, { ...projection.comments.get('oss://home-b/comment/7')!, id: '17', postId: '999' });
    expect(projection.bindComment(comment, target).content).toBe('reply');
    expect(() => projection.bindComment({ ...comment, content: 'forged' }, target)).toThrow('FEED_PROJECTION_TAMPERED');
    const removed = clone(FeedEventSchema, event);
    removed.statement!.kind = FeedEventKind.COMMENT_TOMBSTONED;
    removed.statement!.sequence = 3n;
    projection.apply(removed, 'home-b');
    projection.apply(event, 'home-b');
    expect(projection.comments.get('oss://home-b/comment/7')!.isDeleted).toBe(true);
  });

  it('replays a cold update before creation without changing the original creation time', () => {
    const projection = new PublicFeedProjection();
    const target = `oss://${home}/post/42`;
    const event = create(FeedEventSchema, {
      statement: create(FeedEventStatementSchema, {
        actorPtid: 'ptid:bob', kind: FeedEventKind.COMMENT_UPDATED,
        sequence: 4n, createdAtUnixMs: 1_700_000_000_004n,
      }),
      payload: toBinary(FeedPayloadSchema, create(FeedPayloadSchema, { mutation: {
        case: 'comment', value: create(FeedCommentMutationSchema, {
          commentId: '7', targetPostRef: target,
          createRequest: toBinary(CreateCommentRequestSchema, create(CreateCommentRequestSchema, {
            postId: target, content: 'edited',
          })),
        }),
      } })),
    });
    projection.apply(event, 'home-b');
    expect(projection.comments.size).toBe(0);
    const created = clone(FeedEventSchema, event);
    created.statement!.kind = FeedEventKind.COMMENT_CREATED;
    created.statement!.sequence = 2n;
    created.statement!.createdAtUnixMs = 1_700_000_000_002n;
    projection.apply(created, 'home-b');
    const comment = projection.comments.get('oss://home-b/comment/7')!;
    expect(comment.content).toBe('edited');
    expect(comment.createdAt!.nanos).toBe(2_000_000);
    expect(comment.updatedAt!.nanos).toBe(4_000_000);
  });

  it('does not resurrect a tombstoned post when Native replays an older page', () => {
    const projection = new PublicFeedProjection();
    const event = postEvent();
    projection.apply(event, home);
    const removed = clone(FeedEventSchema, event);
    removed.statement!.sequence = 2n;
    removed.statement!.kind = FeedEventKind.POST_TOMBSTONED;
    projection.apply(removed, home);
    projection.apply(event, home);
    expect(projection.posts.get(`oss://${home}/post/42`)!.isDeleted).toBe(true);
  });

  it('allows edits only from the verified author and keeps mutable editor drafts isolated', () => {
    const projection = new PublicFeedProjection();
    projection.apply(postEvent(), home);
    const ref = `oss://${home}/post/42`;
    expect(() => projection.requestForEdit(ref, 'ptid:bob')).toThrow('FEED_WRITER_NOT_AUTHORIZED');
    const draft = projection.requestForEdit(ref, actor);
    if (draft.content.case === 'text') draft.content.value.text = 'local draft';
    const original = projection.requestForEdit(ref, actor);
    expect(original.content.case === 'text' && original.content.value.text).toBe('signed body');
  });

  it('derives comment likes from typed verified receipts, isolating parent, stale and deleted targets', () => {
    const projection = new PublicFeedProjection();
    projection.apply(postEvent(), home);
    const parent = `oss://${home}/post/42`, ref = 'oss://home-b/comment/7';
    const reaction = (sequence: bigint, target: string, kind = FeedEventKind.REACTION_SET) => create(FeedEventSchema, {
      statement: create(FeedEventStatementSchema, { actorPtid: actor, kind, sequence, createdAtUnixMs: 1_700_000_000_001n }),
      payload: toBinary(FeedPayloadSchema, create(FeedPayloadSchema, { mutation: { case: 'reaction',
        value: create(FeedReactionMutationSchema, { targetPostRef: parent, targetCommentRef: target, reactionKind: 1 }) } })),
    });
    projection.apply(reaction(8n, ref), home);
    expect(projection.reactionSummaries(ref, actor)).toEqual([]);
    const created = create(FeedEventSchema, {
      statement: create(FeedEventStatementSchema, { actorPtid: 'ptid:bob', kind: FeedEventKind.COMMENT_CREATED,
        sequence: 2n, createdAtUnixMs: 1_700_000_000_001n }),
      payload: toBinary(FeedPayloadSchema, create(FeedPayloadSchema, { mutation: { case: 'comment',
        value: create(FeedCommentMutationSchema, { commentId: '7', targetPostRef: parent,
          createRequest: toBinary(CreateCommentRequestSchema, create(CreateCommentRequestSchema, { postId: parent, content: 'root' })) }) } })),
    });
    projection.apply(created, 'home-b');
    const comment = create(CommentSchema, { ...projection.comments.get(ref)!, likesCount: 999n, isLiked: false });
    expect(projection.bindComment(comment, parent, actor)).toMatchObject({ likesCount: 1n, isLiked: true });
    expect(projection.reactionSummaries(parent, actor)).toEqual([]);
    projection.apply(reaction(7n, ''), home);
    projection.apply(reaction(10n, ref, FeedEventKind.REACTION_REMOVED), home);
    projection.apply(reaction(9n, ref), home);
    expect(projection.bindComment(comment, parent, actor)).toMatchObject({ likesCount: 0n, isLiked: false });
    expect(projection.reactionSummaries(parent, actor)[0].count).toBe(1n);
    const deleted = clone(FeedEventSchema, created);
    deleted.statement!.kind = FeedEventKind.COMMENT_TOMBSTONED;
    deleted.statement!.sequence = 3n;
    projection.apply(deleted, 'home-b');
    projection.apply(reaction(11n, ref), home);
    expect(projection.reactionSummaries(ref, actor)).toEqual([]);
  });

  it('derives unique poll votes from admitted receipts and preserves immutable creation across edits', () => {
    const projection = new PublicFeedProjection();
    const creation = postEvent();
    const request = create(CreatePostRequestSchema, { type: PostType.POLL,
      audience: create(AudienceSchema, { kind: Audience_Kind.PUBLIC }),
      content: { case: 'poll', value: create(CreatePollPostRequestSchema, {
        text: 'original', question: 'Which route?', options: ['Direct', 'Relay'], durationHours: 1,
      }) },
    });
    const postPayload = (value: typeof request) => toBinary(FeedPayloadSchema, create(FeedPayloadSchema, {
      mutation: { case: 'post', value: create(FeedPostMutationSchema, {
        postId: '42', createRequest: toBinary(CreatePostRequestSchema, value),
      }) },
    }));
    creation.payload = postPayload(request);
    projection.apply(creation, home);
    const ref = `oss://${home}/post/42`;
    const vote = (sequence: bigint, index: number) => create(FeedEventSchema, {
      statement: create(FeedEventStatementSchema, { actorPtid: 'ptid:bob', kind: FeedEventKind.POLL_BALLOT_SET,
        sequence, createdAtUnixMs: 1_700_000_000_001n }),
      payload: toBinary(FeedPayloadSchema, create(FeedPayloadSchema, { mutation: { case: 'pollBallot',
        value: create(FeedPollBallotMutationSchema, { targetPostRef: ref, definitionHash: new Uint8Array(32), optionIndices: [index] }) } })),
    });
    const admission = (result = FeedPollAdmissionResult.ACCEPTED) => create(FeedPollAdmissionSchema, {
      statement: { targetPostRef: ref, homeStationPeerId: home, eventHash: new Uint8Array(32), result },
    });
    const result = () => {
      const signed = projection.posts.get(ref)!;
      const bound = projection.bindPost(signed, 'ptid:bob');
      if (bound.content.case !== 'pollPost') throw new Error('poll missing');
      return bound.content.value.result!;
    };
    projection.apply(vote(3n, 0), 'home-b');
    expect(result().totalVotes).toBe(0n);
    projection.apply(vote(3n, 0), 'home-b', admission());
    projection.apply(vote(4n, 1), 'home-b', admission());
    projection.apply(vote(3n, 0), 'home-b', admission());
    projection.apply(vote(5n, 0), 'home-b', admission(FeedPollAdmissionResult.CLOSED));
    expect(result()).toMatchObject({ totalVotes: 1n, userVotes: [1] });
    expect(result().options.map(option => option.votes)).toEqual([0n, 1n]);
    const projected = clone(PostSchema, projection.posts.get(ref)!);
    if (projected.content.case === 'pollPost') projected.content.value.result = { ...result(), totalVotes: 999n };
    expect(projection.bindPost(projected, 'ptid:bob').content).toMatchObject({
      case: 'pollPost', value: { result: { totalVotes: 1n } },
    });
    const edit = clone(FeedEventSchema, creation);
    edit.statement!.kind = FeedEventKind.POST_UPDATED;
    edit.statement!.sequence = 2n;
    edit.statement!.createdAtUnixMs += 3_600_001n;
    const updated = clone(CreatePostRequestSchema, request);
    if (updated.content.case === 'poll') updated.content.value.text = 'after closure';
    edit.payload = postPayload(updated);
    projection.apply(edit, home);
    expect(result()).toMatchObject({ totalVotes: 1n, userVotes: [1] });
    if (updated.content.case === 'poll') updated.content.value.options[0] = 'changed';
    edit.statement!.sequence = 3n;
    edit.payload = postPayload(updated);
    expect(() => projection.apply(edit, home)).toThrow('FEED_INVALID');
  });
});
