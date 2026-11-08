import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PollPostSchema, PostSchema, AudienceSchema, Audience_Kind } from '../gen/proto/domain/social/post_pb';
import { PollResultSchema } from '../gen/proto/domain/social/poll_pb';
import { useMomentsStore } from './moments';

const api = vi.hoisted(() => ({ vote: vi.fn(), read: vi.fn() }));
vi.mock('../services/social_api', () => ({ socialVotePoll: api.vote, socialGetMomentResponse: api.read }));
vi.mock('../services/publicFeedNative', () => ({ resetPublicFeed: vi.fn() }));
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
    expect(api.vote.mock.calls[1]).toEqual(api.vote.mock.calls[0]);
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
});
