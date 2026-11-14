import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PollPostSchema, PostSchema, AudienceSchema, Audience_Kind } from '../gen/proto/domain/social/post_pb';
import { PollResultSchema } from '../gen/proto/domain/social/poll_pb';
import { useMomentsStore } from './moments';

const api = vi.hoisted(() => ({ vote: vi.fn(), read: vi.fn(), commands: vi.fn() }));
vi.mock('../services/social_api', () => ({ socialVotePoll: api.vote, socialGetMomentResponse: api.read }));
vi.mock('../services/publicFeedNative', () => ({ resetPublicFeed: vi.fn(), readPublicPollCommands: api.commands }));
vi.mock('../utils/logger', () => ({ log: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../storage/desktopClientStorage', () => ({ readDesktopPreferenceSync: vi.fn() }));

function post(result = create(PollResultSchema)) {
  return create(PostSchema, { id: 'post', publicFeedRef: 'oss://home/post/1',
    audience: create(AudienceSchema, { kind: Audience_Kind.PUBLIC }),
    content: { case: 'pollPost', value: create(PollPostSchema, { result }) } });
}
function deferred() {
  let resolve!: (result: ReturnType<typeof create<typeof PollResultSchema>>) => void;
  const promise = new Promise<ReturnType<typeof create<typeof PollResultSchema>>>(complete => { resolve = complete; });
  return { resolve, promise };
}
const state = () => useMomentsStore.getState();
describe('Original Moments poll command ownership', () => {
  beforeEach(() => { vi.resetAllMocks(); state().reset(); useMomentsStore.setState({ postsById: { post: post() } }); });

  it('shares identical completion, refuses a different unresolved selection and preserves confirmed counts', async () => {
    const reply = deferred();
    api.vote.mockReturnValueOnce(reply.promise);
    const original = state().postsById.post;
    const first = state().votePoll('post', [0]);
    expect(state().votePoll('post', [0])).toBe(first);
    await expect(state().votePoll('post', [1])).rejects.toThrow('FEED_POLL_ADMISSION_PENDING');
    expect(state().postsById.post).toBe(original);
    reply.resolve(create(PollResultSchema, { totalVotes: 1n, userVotes: [0], hasVoted: true }));
    await first;
    expect(state().pollCommands.post.state).toBe('committed');
  });

  it('retries unknown and pending admission with the exact operation and full choice set', async () => {
    api.vote.mockRejectedValueOnce(new Error('FEED_POLL_ADMISSION_PENDING'))
      .mockResolvedValueOnce(create(PollResultSchema, { totalVotes: 1n, userVotes: [0, 1], hasVoted: true }));
    await expect(state().votePoll('post', [0, 1])).rejects.toThrow('FEED_POLL_ADMISSION_PENDING');
    await state().retryPoll('post');
    expect(api.vote.mock.calls[1].slice(0, 3)).toEqual(api.vote.mock.calls[0].slice(0, 3));
    expect(state().pollCommands.post.state).toBe('committed');
  });

  it('keeps previous ballot on cutoff rejection and fences delayed replies after identity reset', async () => {
    const previous = post(create(PollResultSchema, { totalVotes: 1n, userVotes: [0] }));
    useMomentsStore.setState({ postsById: { post: previous } });
    api.vote.mockRejectedValueOnce(new Error('FEED_POLL_CLOSED'));
    await expect(state().votePoll('post', [1])).rejects.toThrow('FEED_POLL_CLOSED');
    expect(state().postsById.post).toBe(previous);
    expect(state().pollCommands.post.state).toBe('rejected');
    const reply = deferred(); api.vote.mockReturnValueOnce(reply.promise);
    const old = state().votePoll('post', [1]);
    state().reset();
    reply.resolve(create(PollResultSchema, { totalVotes: 9n }));
    await old;
    expect(state().pollCommands).toEqual({});
    expect(state().postsById).toEqual({});
  });

  it('repaints new verified counts despite an unchanged authored revision and retains unchanged cards', async () => {
    const changed = post(create(PollResultSchema, { totalVotes: 2n }));
    api.read.mockResolvedValue({ post: changed });
    await state().loadPost('post');
    expect(state().postsById.post.content).toEqual(changed.content);
    const retained = state().postsById.post;
    await state().loadPost('post');
    expect(state().postsById.post).toBe(retained);
  });

  it('settles the exact journal command after verified readback without another vote or optimistic count', async () => {
    api.vote.mockImplementationOnce((_post, _options, _operation, identified) => {
      identified('journal-command');
      return Promise.reject(new Error('FEED_POLL_ADMISSION_PENDING'));
    });
    await expect(state().votePoll('post', [1])).rejects.toThrow('FEED_POLL_ADMISSION_PENDING');
    expect(state().pollCommands.post.operationId).toBe('journal-command');
    const verified = post(create(PollResultSchema, { totalVotes: 2n, userVotes: [1], hasVoted: true }));
    useMomentsStore.setState({ postsById: { post: verified } });
    api.commands.mockResolvedValue([{ commandId: 'journal-command', targetPostRef: verified.publicFeedRef,
      options: [1], state: 'committed' }]);
    await state().reconcilePublicPollCommands();
    expect(api.commands).toHaveBeenCalledExactlyOnceWith(['journal-command']);
    expect(api.vote).toHaveBeenCalledTimes(1);
    expect(state().pollCommands.post.state).toBe('committed');
    expect(state().postsById.post).toBe(verified);
  });

  it('does not settle from equal old choices, the wrong target or a missing qualified admission', async () => {
    api.vote.mockRejectedValue(new Error('FEED_POLL_ADMISSION_PENDING'));
    await expect(state().votePoll('post', [1])).rejects.toThrow('FEED_POLL_ADMISSION_PENDING');
    const retained = state().pollCommands.post;
    const verified = post(create(PollResultSchema, { totalVotes: 2n, userVotes: [1], hasVoted: true }));
    useMomentsStore.setState({ postsById: { post: verified } });
    for (const settlements of [[], [{ commandId: 'older', targetPostRef: verified.publicFeedRef, options: [1], state: 'committed' }],
      [{ commandId: retained.operationId, targetPostRef: 'oss://home/post/2', options: [1], state: 'committed' }],
      [{ commandId: retained.operationId, targetPostRef: verified.publicFeedRef, options: [0], state: 'committed' }]]) {
      api.commands.mockResolvedValue(settlements);
      await state().reconcilePublicPollCommands();
      expect(state().pollCommands.post).toBe(retained);
    }
    api.commands.mockResolvedValue([{ commandId: retained.operationId, targetPostRef: verified.publicFeedRef,
      options: [1], state: 'rejected', error: 'FEED_POLL_CLOSED' }]);
    await state().reconcilePublicPollCommands();
    expect(state().pollCommands.post.state).toBe('rejected');
    expect(state().postsById.post).toBe(verified);
  });

  it.each(['reset', 'delete', 'replace', 'retry'] as const)('fences delayed command readback across %s', async action => {
    api.vote.mockRejectedValueOnce(new Error('FEED_POLL_ADMISSION_PENDING'));
    await expect(state().votePoll('post', [1])).rejects.toThrow('FEED_POLL_ADMISSION_PENDING');
    const retained = state().pollCommands.post;
    let release!: (value: unknown) => void;
    api.commands.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const query = state().reconcilePublicPollCommands();
    let retry: Promise<void> | undefined;
    if (action === 'reset') state().reset();
    if (action === 'delete') state().evictPost('post');
    if (action === 'replace') useMomentsStore.setState({ pollCommands: {
      post: { ...retained, operationId: 'newer-command' },
    } });
    if (action === 'retry') {
      const reply = deferred();
      api.vote.mockReturnValueOnce(reply.promise);
      retry = state().retryPoll('post');
      await state().reconcilePublicPollCommands();
      expect(api.commands).toHaveBeenCalledTimes(1);
      release([{ commandId: retained.operationId, targetPostRef: 'oss://home/post/1', options: [1], state: 'committed' }]);
      await query;
      expect(state().pollCommands.post.state).toBe('pending');
      reply.resolve(create(PollResultSchema, { totalVotes: 2n, userVotes: [1] }));
      await retry;
      return;
    }
    const expected = state().pollCommands;
    release([{ commandId: retained.operationId, targetPostRef: 'oss://home/post/1', options: [1], state: 'committed' }]);
    await query;
    expect(state().pollCommands).toBe(expected);
  });
});
