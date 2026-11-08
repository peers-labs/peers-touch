import { create } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactionKind, ReactionSummarySchema } from '../gen/proto/domain/social/post_pb';
import { CommentSchema } from '../gen/proto/domain/social/comment_pb';
import { useMomentsStore } from './moments';
import { usePrivateMomentsStore } from './privateMoments';
import {
  privateMomentsNative, privateReactionTargetKey, type PrivateReactionMutationResult,
} from '../services/privateMomentsNative';

const api = vi.hoisted(() => ({ react: vi.fn(), unreact: vi.fn(), commentLike: vi.fn() }));
vi.mock('../services/social_api', () => ({ socialReact: api.react, socialUnreact: api.unreact, socialSetCommentLike: api.commentLike }));
vi.mock('../services/publicFeedNative', () => ({ resetPublicFeed: vi.fn() }));
vi.mock('../utils/logger', () => ({ log: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../storage/desktopClientStorage', () => ({ readDesktopPreferenceSync: vi.fn() }));

function pendingResponse() {
  let complete!: (value: { reactions: ReturnType<typeof summary>[] }) => void;
  const promise = new Promise<{ reactions: ReturnType<typeof summary>[] }>(resolve => { complete = resolve; });
  return { promise, complete };
}
function summary(count: bigint) {
  return create(ReactionSummarySchema, { kind: ReactionKind.REACTION_LIKE, count, reactedByViewer: true });
}

describe('Moment reaction command scope', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useMomentsStore.getState().reset();
  });

  it.each(['add', 'remove'] as const)('isolates %s flights across scope reset and old finalization', async direction => {
    const service = direction === 'add' ? api.react : api.unreact;
    const action = () => direction === 'add'
      ? useMomentsStore.getState().reactToPost('public-post', ReactionKind.REACTION_LIKE)
      : useMomentsStore.getState().unreactToPost('public-post', ReactionKind.REACTION_LIKE);
    const oldReply = pendingResponse();
    const currentReply = pendingResponse();
    service.mockReturnValueOnce(oldReply.promise).mockReturnValueOnce(currentReply.promise);
    const old = action();
    useMomentsStore.getState().reset();
    const current = action();
    try {
      expect(service).toHaveBeenCalledTimes(2);
      expect(current).not.toBe(old);
      oldReply.complete({ reactions: [summary(9n)] });
      await old;
      expect(useMomentsStore.getState().reactions['public-post']).toBeUndefined();
      expect(action()).toBe(current);
      expect(service).toHaveBeenCalledTimes(2);
    } finally {
      oldReply.complete({ reactions: [summary(9n)] });
      currentReply.complete({ reactions: [summary(1n)] });
      await Promise.all([old, current]);
    }
    expect(useMomentsStore.getState().reactions['public-post']).toEqual([summary(1n)]);
  });

  it('shares the actual completion of identical intents in the same scope', async () => {
    const reply = pendingResponse();
    api.react.mockReturnValueOnce(reply.promise);
    const first = useMomentsStore.getState().reactToPost('public-post', ReactionKind.REACTION_LIKE);
    const second = useMomentsStore.getState().reactToPost('public-post', ReactionKind.REACTION_LIKE);
    expect(second).toBe(first);
    expect(api.react).toHaveBeenCalledOnce();
    reply.complete({ reactions: [summary(1n)] });
    await first;
  });

  it('releases a failed flight so the same intent can retry', async () => {
    api.react.mockRejectedValueOnce(new Error('FEED_PENDING_ACK'))
      .mockResolvedValueOnce({ reactions: [summary(1n)] });
    await expect(useMomentsStore.getState().reactToPost('public-post', ReactionKind.REACTION_LIKE))
      .rejects.toThrow('FEED_PENDING_ACK');
    await useMomentsStore.getState().reactToPost('public-post', ReactionKind.REACTION_LIKE);
    expect(api.react).toHaveBeenCalledTimes(2);
    expect(useMomentsStore.getState().reactions['public-post']).toEqual([summary(1n)]);
  });

  it('shares identical comment intents, rejects opposite pending intent and never guesses a count', async () => {
    let complete!: (value: { likesCount: bigint; isLiked: boolean }) => void;
    api.commentLike.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const comment = create(CommentSchema, { id: 'comment', postId: 'post', likesCount: 2n });
    useMomentsStore.setState({ comments: { post: [comment] } });
    const first = useMomentsStore.getState().setCommentLike('post', 'comment', true);
    expect(useMomentsStore.getState().setCommentLike('post', 'comment', true)).toBe(first);
    await expect(useMomentsStore.getState().setCommentLike('post', 'comment', false)).rejects.toThrow('FEED_PENDING_ACK');
    expect(useMomentsStore.getState().comments.post[0]).toBe(comment);
    expect(useMomentsStore.getState().commentReactionCommands.comment.pending).toBe(true);
    complete({ likesCount: 3n, isLiked: true });
    await first;
    expect(useMomentsStore.getState().comments.post[0]).toMatchObject({ likesCount: 3n, isLiked: true });
    expect(useMomentsStore.getState().commentReactionCommands.comment.pending).toBe(false);
  });

  it('preserves confirmed comment counts on error and fences delayed results after reset', async () => {
    api.commentLike.mockRejectedValueOnce(new Error('FEED_PENDING_ACK'));
    const comment = create(CommentSchema, { id: 'comment', postId: 'post', likesCount: 2n });
    useMomentsStore.setState({ comments: { post: [comment] } });
    await expect(useMomentsStore.getState().setCommentLike('post', 'comment', true)).rejects.toThrow('FEED_PENDING_ACK');
    expect(useMomentsStore.getState().comments.post[0]).toBe(comment);
    let complete!: (value: { likesCount: bigint; isLiked: boolean }) => void;
    api.commentLike.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const late = useMomentsStore.getState().setCommentLike('post', 'comment', true);
    useMomentsStore.getState().reset();
    complete({ likesCount: 99n, isLiked: true });
    await late;
    expect(useMomentsStore.getState().comments).toEqual({});
    expect(useMomentsStore.getState().commentReactionCommands).toEqual({});
  });
});

describe('Private target Reaction command scope', () => {
  const state = () => usePrivateMomentsStore.getState();
  function result(commentId = '', kind = ReactionKind.REACTION_LIKE): PrivateReactionMutationResult {
    return {
      command: {
        commandId: `command-${commentId || 'post'}-${kind}`, postId: 'post', commentId, kind,
        operation: 'REACT', state: 'REACTION_COMMITTED', attemptCount: 1, projectionRevision: '2',
      },
      reactions: [create(ReactionSummarySchema, { kind, count: 1n, reactedByViewer: true })],
      projectionRevision: '2', exactReplay: false,
    };
  }
  function deferred() {
    let resolve!: (value: PrivateReactionMutationResult) => void;
    const promise = new Promise<PrivateReactionMutationResult>(complete => { resolve = complete; });
    return { promise, resolve };
  }
  beforeEach(() => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    state().activateActor('alice', 1);
    usePrivateMomentsStore.setState({ postsById: {
      post: {
        postId: 'post', contentId: 'post', generation: '1', authorPtid: 'author',
        audienceKind: 'FRIENDS', state: 'CONTENT_READY', mentions: [],
        reactions: [], reactionRevision: '0', reactionsHydrated: true,
        content: { kind: 'TEXT', text: 'private' },
      },
    } });
  });
  afterEach(() => {
    state().reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shares actual completion and refuses an opposite intent without changing counts', async () => {
    const pending = deferred();
    const react = vi.spyOn(privateMomentsNative, 'react').mockReturnValue(pending.promise);
    const first = state().setReaction('post', ReactionKind.REACTION_LIKE, 'REACT', 'comment');
    expect(state().setReaction('post', ReactionKind.REACTION_LIKE, 'REACT', 'comment')).toBe(first);
    await expect(state().setReaction('post', ReactionKind.REACTION_LIKE, 'UNREACT', 'comment'))
      .rejects.toThrow('REACTION_COMMAND_PENDING');
    expect(react).toHaveBeenCalledOnce();
    expect(state().postsById.post.reactions).toEqual([]);
    pending.resolve(result('comment'));
    await first;
    expect(state().postsById.post.reactions).toEqual([]);
    expect(state().reactionCommands).toEqual({});
  });

  it('allows independent post, root, reply and kind commands', async () => {
    const pending = [deferred(), deferred(), deferred(), deferred()];
    const react = vi.spyOn(privateMomentsNative, 'react');
    pending.forEach(reply => react.mockReturnValueOnce(reply.promise));
    const flights = [
      state().setReaction('post', ReactionKind.REACTION_LIKE, 'REACT'),
      state().setReaction('post', ReactionKind.REACTION_LOVE, 'REACT'),
      state().setReaction('post', ReactionKind.REACTION_LIKE, 'REACT', 'root'),
      state().setReaction('post', ReactionKind.REACTION_LIKE, 'REACT', 'reply'),
    ];
    await Promise.resolve();
    expect(react).toHaveBeenCalledTimes(4);
    expect(Object.keys(state().reactionCommands)).toHaveLength(4);
    pending[0].resolve(result());
    pending[1].resolve({ ...result('', ReactionKind.REACTION_LOVE), projectionRevision: '3' });
    pending[2].resolve(result('root'));
    pending[3].resolve(result('reply'));
    await Promise.all(flights);
    expect(state().postsById.post.reactions?.[0].kind).toBe(ReactionKind.REACTION_LOVE);
  });

  it('retries the durable target command after an unknown result', async () => {
    const unknown = result('comment');
    unknown.command.state = 'REACTION_PENDING';
    unknown.command.errorCode = 'REACTION_RESULT_UNKNOWN';
    vi.spyOn(privateMomentsNative, 'react').mockResolvedValue(unknown);
    const retry = vi.spyOn(privateMomentsNative, 'retryReaction').mockResolvedValue(result('comment'));
    await state().setReaction('post', ReactionKind.REACTION_LIKE, 'REACT', 'comment');
    expect(state().reactionCommands[privateReactionTargetKey('post', 'comment')].commandId)
      .toBe(unknown.command.commandId);
    await state().setReaction('post', ReactionKind.REACTION_LIKE, 'REACT', 'comment');
    expect(retry).toHaveBeenCalledWith({
      actorPtid: 'alice', rendererGeneration: 1, commandId: unknown.command.commandId,
    });
  });

  it('refuses a substituted target response and retains unknown command state', async () => {
    vi.spyOn(privateMomentsNative, 'react').mockResolvedValue(result('other'));
    await expect(state().setReaction('post', ReactionKind.REACTION_LIKE, 'REACT', 'comment'))
      .rejects.toThrow('PRIVATE_PROJECTION_INVALID');
    expect(state().postsById.post.reactions).toEqual([]);
    expect(state().reactionCommands[privateReactionTargetKey('post', 'comment')].state)
      .toBe('REACTION_PENDING');
  });

  it('fences a result after identity replacement', async () => {
    const pending = deferred();
    vi.spyOn(privateMomentsNative, 'react').mockReturnValue(pending.promise);
    const flight = state().setReaction('post', ReactionKind.REACTION_LIKE, 'REACT');
    await Promise.resolve();
    state().activateActor('bob', 2);
    pending.resolve(result());
    await expect(flight).rejects.toThrow('PRIVATE_SESSION_REPLACED');
    expect(state().postsById).toEqual({});
    expect(state().reactionCommands).toEqual({});
  });

  it('does not dispatch a deferred old intent after scope replacement', async () => {
    const react = vi.spyOn(privateMomentsNative, 'react');
    const flight = state().setReaction('post', ReactionKind.REACTION_LIKE, 'REACT');
    state().activateActor('bob', 2);
    await expect(flight).rejects.toThrow('AUTHENTICATION_REQUIRED');
    expect(react).not.toHaveBeenCalled();
  });

  it('fences completion and clears status when the Native session advances', async () => {
    usePrivateMomentsStore.setState({ scope: {
      actorPtid: 'alice', rendererGeneration: 1, nativeSessionGeneration: '1',
    } });
    const pending = deferred();
    vi.spyOn(privateMomentsNative, 'react').mockReturnValue(pending.promise);
    vi.spyOn(privateMomentsNative, 'bootstrap').mockResolvedValue({
      actorPtid: 'alice', deviceId: 'device', sessionGeneration: '2', projections: [], reactionCommands: [],
    });
    const flight = state().setReaction('post', ReactionKind.REACTION_LIKE, 'REACT');
    await Promise.resolve();
    await state().bootstrap(1);
    pending.resolve(result());
    await expect(flight).rejects.toThrow('PRIVATE_SESSION_REPLACED');
    expect(state().reactionCommands).toEqual({});
    expect(state().postsById).toEqual({});
  });
});
