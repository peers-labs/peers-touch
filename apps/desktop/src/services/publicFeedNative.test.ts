import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  FeedBundleSchema, FeedEventSchema, FeedEventStatementSchema, FeedEventKind,
  FeedPayloadSchema, FeedPostMutationSchema, FeedPollBallotMutationSchema, FeedReactionMutationSchema,
} from '../gen/proto/domain/social/feed_log_pb';
import {
  AudienceSchema, Audience_Kind, CreatePostRequestSchema, CreateTextPostRequestSchema,
  PostSchema, ReactionKind,
} from '../gen/proto/domain/social/post_pb';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), readback: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../store/session', () => ({ useSessionStore: { getState: () => ({ currentUser: { actorPtid: 'ptid:alice' } }) } }));
vi.mock('./desktop_api', () => ({ invokeRustProto: mocks.readback }));

import {
  feedBase64, resetPublicFeed, resumePublicFeed, submitPublicFeed,
  verifyPublicPosts, committedPublicPost,
} from './publicFeedNative';
import { socialCreateMoment, socialCreateComment, socialReact, socialUnreact, socialSetCommentLike, socialUpdateMomentText, socialDeleteMoment } from './social_api';

type Input = { command_id: string; kind: FeedEventKind; payload_b64: string };
let pending: Input | undefined;
let sequence: bigint;
const committed = new Map<string, ReturnType<typeof create<typeof FeedEventSchema>>>();
function payload(id = '42', text = 'signed body') {
  return create(FeedPayloadSchema, { mutation: { case: 'post', value: create(FeedPostMutationSchema, {
    postId: id, createRequest: toBinary(CreatePostRequestSchema, create(CreatePostRequestSchema, {
      audience: create(AudienceSchema, { kind: Audience_Kind.PUBLIC }),
      content: { case: 'text', value: create(CreateTextPostRequestSchema, { text }) },
    })),
  }) } });
}

beforeEach(() => {
  resetPublicFeed();
  pending = undefined;
  sequence = 0n;
  committed.clear();
  mocks.readback.mockReset().mockRejectedValue(new Error('READBACK_OFFLINE'));
  mocks.invoke.mockReset().mockImplementation(async (name: string, args?: { input: Input }) => {
    if (name === 'social_public_feed_status') return { pending: pending ? [{
      commandId: pending.command_id, kind: pending.kind, payloadB64: pending.payload_b64,
    }] : [] };
    if (name === 'social_public_feed_prepare') return { state: 'PENDING_SUBMISSION' };
    if (name !== 'social_public_feed_submit') throw new Error(`Unexpected ${name}`);
    const input = args!.input;
    let event = committed.get(input.command_id);
    if (!event) {
      event = create(FeedEventSchema, {
        statement: create(FeedEventStatementSchema, {
          actorPtid: 'ptid:alice', sequence: ++sequence, kind: input.kind,
          createdAtUnixMs: 1_700_000_000_000n + sequence,
        }),
        payload: Uint8Array.from(atob(input.payload_b64), c => c.charCodeAt(0)),
      });
      committed.set(input.command_id, event);
    }
    pending = undefined;
    return { state: 'COMMITTED', homeStationPeerId: 'home-a',
      bundleB64: feedBase64(toBinary(FeedBundleSchema, create(FeedBundleSchema, { events: [event] }))),
    };
  });
});

describe('Public Feed Native adapter source regressions', () => {
  it('retries the retained command and original payload after a lost ACK', async () => {
    pending = { command_id: 'retained-command', kind: FeedEventKind.POST_CREATED,
      payload_b64: feedBase64(toBinary(FeedPayloadSchema, payload('7'))) };
    const result = await submitPublicFeed(FeedEventKind.POST_CREATED, payload('42'));
    expect(result.mutation.case === 'post' && result.mutation.value.postId).toBe('7');
    const input = mocks.invoke.mock.calls.find(([name]) => name === 'social_public_feed_submit')![1].input;
    expect(input).toEqual({ command_id: 'retained-command', kind: FeedEventKind.POST_CREATED,
      payload_b64: feedBase64(toBinary(FeedPayloadSchema, payload('7'))) });
  });

  it('rejects a different intent while an earlier action awaits its ACK', async () => {
    pending = { command_id: 'retained', kind: FeedEventKind.POST_CREATED,
      payload_b64: feedBase64(toBinary(FeedPayloadSchema, payload())) };
    await expect(submitPublicFeed(FeedEventKind.POST_CREATED, payload('43', 'changed'))).rejects.toThrow('FEED_PENDING_ACK');
    expect(mocks.invoke.mock.calls.some(([name]) => name === 'social_public_feed_prepare')).toBe(false);
  });

  it('resumes a retained action into the local verified projection', async () => {
    pending = { command_id: 'retained', kind: FeedEventKind.POST_CREATED,
      payload_b64: feedBase64(toBinary(FeedPayloadSchema, payload())) };
    await resumePublicFeed();
    expect(committedPublicPost('42').authorPtid).toBe('ptid:alice');
  });

  it('recovers a source-confirmed ballot by exact command without blocking unrelated actions', async () => {
    const ballot = create(FeedPayloadSchema, { mutation: { case: 'pollBallot',
      value: create(FeedPollBallotMutationSchema, { targetPostRef: 'oss://home-a/post/42',
        definitionHash: new Uint8Array(32), optionIndices: [0] }) } });
    const retained = { commandId: 'retained-ballot', kind: FeedEventKind.POLL_BALLOT_SET,
      payloadB64: feedBase64(toBinary(FeedPayloadSchema, ballot)) };
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (name: string, args?: { input: Input }) => {
      if (name === 'social_public_feed_status') return { pending: [], pendingAdmissions: [retained] };
      const result = await original(name,args);
      if (name === 'social_public_feed_submit' && args?.input.kind === FeedEventKind.POLL_BALLOT_SET) {
        return { ...result, sourceState: 'COMMITTED', state: 'PENDING_ADMISSION',
          errorCode: 'FEED_POLL_ADMISSION_PENDING' };
      }
      return result;
    });
    await expect(submitPublicFeed(FeedEventKind.POLL_BALLOT_SET, ballot, 'new-command'))
      .rejects.toThrow('FEED_POLL_ADMISSION_PENDING');
    expect(mocks.invoke.mock.calls.find(([name]) => name === 'social_public_feed_submit')![1].input.command_id)
      .toBe('retained-ballot');
    await resumePublicFeed();
    const reaction = create(FeedPayloadSchema, { mutation: { case: 'reaction',
      value: create(FeedReactionMutationSchema, { targetPostRef: 'oss://home-a/post/42', reactionKind: 1 }) } });
    await expect(submitPublicFeed(FeedEventKind.REACTION_SET, reaction, 'unrelated')).resolves.toEqual(reaction);
    const changed = create(FeedPayloadSchema, { mutation: { case: 'pollBallot',
      value: create(FeedPollBallotMutationSchema, { targetPostRef: 'oss://home-a/post/42',
        definitionHash: new Uint8Array(32), optionIndices: [1] }) } });
    await expect(submitPublicFeed(FeedEventKind.POLL_BALLOT_SET, changed)).rejects.toThrow('FEED_POLL_ADMISSION_PENDING');
  });

  it('fences delayed Native completion after an account reset', async () => {
    let release!: (value: unknown) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const flight = submitPublicFeed(FeedEventKind.POST_CREATED, payload());
    await Promise.resolve();
    await Promise.resolve();
    resetPublicFeed();
    release({ pending: [] });
    await expect(flight).rejects.toThrow('MOMENTS_SESSION_STALE');
    expect(() => committedPublicPost('42')).toThrow('FEED_PROJECTION_UNVERIFIED');
  });

  it('leaves private timeline shells to the existing private projection owner', async () => {
    const shell = create(PostSchema, { id: 'private', audience: { kind: Audience_Kind.FRIENDS } });
    expect(await verifyPublicPosts([shell])).toEqual([shell]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('publishes, comments and reacts without treating offline readback as a failed commit', async () => {
    const draft = { kind: 'text' as const, text: 'signed body', audience: create(AudienceSchema, { kind: Audience_Kind.PUBLIC }),
      draftId: 'draft-1', draftRevision: 1 };
    const post = (await socialCreateMoment(draft))!;
    const same = (await socialCreateMoment(draft))!;
    expect(same.id).toBe(post.id);
    const comment = (await socialCreateComment(post.id, 'reply', undefined, [], 'comment-draft:1'))!;
    const retry = (await socialCreateComment(post.id, 'reply', undefined, [], 'comment-draft:1'))!;
    expect(retry.id).toBe(comment.id);
    const reacted = await socialReact(post.id, ReactionKind.REACTION_LIKE);
    expect(reacted.reactions[0].reactedByViewer).toBe(true);
    expect((await socialUnreact(post.id)).reactions).toEqual([]);
    expect(mocks.readback).not.toHaveBeenCalled();
    expect(fromBinary(FeedPayloadSchema, [...committed.values()][0].payload).mutation.case).toBe('post');
  });

  it('edits a signed post with the same object identity and creation time, then prevents resurrection', async () => {
    const post = (await socialCreateMoment({
      kind: 'link', text: 'original', link: { url: 'https://example.org/resource', title: 'Resource' },
      audience: create(AudienceSchema, { kind: Audience_Kind.PUBLIC }),
    }))!;
    const edited = await socialUpdateMomentText(post.id, 'updated', 'edit-command');
    expect(edited.id).toBe(post.id);
    expect(edited.createdAt).toEqual(post.createdAt);
    expect(edited.updatedAt).not.toEqual(post.updatedAt);
    expect(edited.content.case).toBe('linkPost');
    if (edited.content.case === 'linkPost') {
      expect(edited.content.value.text).toBe('updated');
      expect(edited.content.value.link?.url).toBe('https://example.org/resource');
    }
    const event = committed.get('edit-command')!;
    expect(event.statement!.kind).toBe(FeedEventKind.POST_UPDATED);
    const update = fromBinary(FeedPayloadSchema, event.payload);
    expect(update.mutation.case === 'post' && update.mutation.value.postId).toBe(post.id);
    await socialDeleteMoment(post.id);
    await expect(socialUpdateMomentText(post.id, 'resurrect', 'later')).rejects.toThrow('FEED_INVALID');
    expect(committed.has('later')).toBe(false);
    expect(mocks.readback).not.toHaveBeenCalled();
  });

  it('signs root/reply likes with stable comment and parent references without changing post reactions', async () => {
    const post = (await socialCreateMoment({ kind: 'text', text: 'parent',
      audience: create(AudienceSchema, { kind: Audience_Kind.PUBLIC }) }))!;
    const root = (await socialCreateComment(post.id, 'root'))!;
    const reply = (await socialCreateComment(post.id, 'reply', root.id))!;
    await socialReact(post.id, ReactionKind.REACTION_LIKE);
    for (const comment of [root, reply]) {
      expect(await socialSetCommentLike(post.id, comment.id, true, `like:${comment.id}`))
        .toEqual({ likesCount: 1n, isLiked: true });
      expect(await socialSetCommentLike(post.id, comment.id, true, `like:${comment.id}`))
        .toEqual({ likesCount: 1n, isLiked: true });
      expect(await socialSetCommentLike(post.id, comment.id, false))
        .toEqual({ likesCount: 0n, isLiked: false });
      const event = committed.get(`like:${comment.id}`)!;
      const mutation = fromBinary(FeedPayloadSchema, event.payload).mutation;
      expect(mutation.case === 'reaction' && mutation.value.targetCommentRef).toBe(comment.publicFeedRef);
      expect(mutation.case === 'reaction' && mutation.value.targetPostRef).toBe(post.publicFeedRef);
    }
    const wrong = (await socialCreateMoment({ kind: 'text', text: 'other',
      audience: create(AudienceSchema, { kind: Audience_Kind.PUBLIC }) }))!;
    await expect(socialSetCommentLike(wrong.id, root.id, true)).rejects.toThrow('FEED_INVALID');
    expect(mocks.readback).not.toHaveBeenCalled();
  });
});
