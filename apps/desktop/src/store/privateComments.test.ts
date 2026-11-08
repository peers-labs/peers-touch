import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';

import {
  PrivateCommentsNativeError,
  privateCommentsNative,
  type PrivateCommentPage,
  type PrivateCommentsNativeSnapshot,
} from '../services/privateCommentsNative';
import { usePrivateCommentsStore } from './privateComments';
import { useMomentsNavigationStore } from './momentsNavigation';
import { usePrivateMomentsStore } from './privateMoments';
import { ReactionKind, ReactionSummarySchema } from '../gen/proto/domain/social/post_pb';
import type { PrivateReactionMutationResult } from '../services/privateMomentsNative';

vi.mock('../services/privateMomentsNative', async importOriginal => ({
  ...await importOriginal<typeof import('../services/privateMomentsNative')>(),
  resolvePrivateMomentsPlatform: () => 'native',
}));
vi.mock('../utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function page(commentId: string, nextCursor = ''): PrivateCommentPage {
  return {
    postId: 'post-1',
    nextCursor,
    hasMore: !!nextCursor,
    comments: [{
      postId: 'post-1',
      commentId,
      contentId: `content-${commentId}`,
      generation: '1',
      authorPtid: 'alice',
      replyToCommentId: '',
      state: 'COMMENT_POSTED',
      text: commentId,
      mentions: [],
      reactionsCount: 0,
      reactions: [],
      reactionRevision: '0',
      isLiked: false,
      repliesCount: 0,
    }],
  };
}

function snapshot(sessionGeneration: string): PrivateCommentsNativeSnapshot {
  return {
    actorPtid: 'alice',
    deviceId: 'device-1',
    sessionGeneration,
    drafts: [],
    comments: [],
  };
}

const store = () => usePrivateCommentsStore.getState();
const thread = () => store().threadsByPost['post-1'];

describe('private Comment read completion and projection isolation', () => {
  beforeEach(async () => {
    store().reset();
    store().activateActor('alice', 1);
    vi.spyOn(privateCommentsNative, 'bootstrap').mockResolvedValue(snapshot('1'));
    await store().bootstrap(1);
  });

  afterEach(() => {
    useMomentsNavigationStore.getState().reset();
    store().reset();
    vi.restoreAllMocks();
  });

  it('retains the selected historical anchor for periodic and default refreshes until navigation', async () => {
    const list = vi.spyOn(privateCommentsNative, 'list')
      .mockImplementation(async input => page(input.anchorCommentId ?? 'default'));
    useMomentsNavigationStore.getState().setView({
      kind: 'detail', postId: 'post-1', commentId: 'historical', from: 'feed',
    });
    await store().loadComments('post-1', true, 'historical');
    await store().reconcile(['post-1'], 'periodic', 1);
    await store().loadComments('post-1', true);
    const beforeNavigation = thread().comments.map(row => row.commentId);
    useMomentsNavigationStore.getState().setView({ kind: 'tab', tab: 'feed' });
    await store().loadComments('post-1', true);

    expect(list.mock.calls.map(([input]) => input.anchorCommentId))
      .toEqual(['historical', 'historical', 'historical', undefined]);
    expect(beforeNavigation).toEqual(['historical']);
    expect(thread().comments[0].commentId).toBe('default');
  });

  it('keeps equivalent readers pending until their shared Native page is applied', async () => {
    const native = deferred<PrivateCommentPage>();
    const list = vi.spyOn(privateCommentsNative, 'list').mockReturnValue(native.promise);
    const first = store().loadComments('post-1', true);
    let settled = false;
    const second = store().loadComments(' post-1 ', true).then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    const settledBeforeNative = settled;
    const pendingThread = thread();
    native.resolve(page('original-comment'));
    await Promise.all([first, second]);

    expect(settledBeforeNative).toBe(false);
    expect(pendingThread).toMatchObject({ loading: true, loaded: false, comments: [] });
    expect(list).toHaveBeenCalledTimes(1);
    expect(thread()).toMatchObject({ loading: false, loaded: true });
    expect(thread().comments.map(item => item.commentId)).toEqual(['original-comment']);
  });

  it('registers the shared read before notifying synchronous Store subscribers', async () => {
    const native = deferred<PrivateCommentPage>();
    const list = vi.spyOn(privateCommentsNative, 'list').mockReturnValue(native.promise);
    let second: Promise<void> | undefined;
    const unsubscribe = usePrivateCommentsStore.subscribe(state => {
      if (state.threadsByPost['post-1']?.loading) {
        unsubscribe();
        second = state.loadComments('post-1', true);
      }
    });
    const first = store().loadComments('post-1', true);
    native.resolve(page('reentrant-comment'));
    await Promise.all([first, second]);
    expect(second).toBeDefined();
    expect(list).toHaveBeenCalledTimes(1);
    expect(thread().comments[0].commentId).toBe('reentrant-comment');
  });

  it('rejects both readers with the original error and permits an independent retry', async () => {
    const native = deferred<PrivateCommentPage>();
    const error = new PrivateCommentsNativeError({
      code: 'SOCIAL_PRIVATE_DEPENDENCY_FAILURE', state: 'COMMENT_FAILED',
    });
    const list = vi.spyOn(privateCommentsNative, 'list')
      .mockReturnValueOnce(native.promise)
      .mockResolvedValueOnce(page('recovered'));
    const first = store().loadComments('post-1', true);
    const second = store().loadComments('post-1', true);
    const completions = Promise.allSettled([first, second]);
    await Promise.resolve();
    native.reject(error);
    expect(await completions).toEqual([
      { status: 'rejected', reason: error }, { status: 'rejected', reason: error },
    ]);
    expect(thread()).toMatchObject({
      loading: false, state: 'COMMENT_FAILED', errorCode: error.code,
    });
    await store().loadComments('post-1', true);
    expect(list).toHaveBeenCalledTimes(2);
    expect(thread().comments[0].commentId).toBe('recovered');
    expect(thread().errorCode).toBeUndefined();
  });

  it('runs a refresh during pagination and ignores the superseded page and its finalizer', async () => {
    const oldPage = deferred<PrivateCommentPage>();
    const refreshed = deferred<PrivateCommentPage>();
    const list = vi.spyOn(privateCommentsNative, 'list')
      .mockResolvedValueOnce(page('initial', 'next-1'))
      .mockReturnValueOnce(oldPage.promise)
      .mockReturnValueOnce(refreshed.promise);
    await store().loadComments('post-1', true);
    const pagination = store().loadComments('post-1');
    await Promise.resolve();
    const refresh = store().loadComments('post-1', true);
    await Promise.resolve();
    oldPage.resolve(page('stale-page', 'next-2'));
    await pagination;
    expect(thread().loading).toBe(true);
    const joined = store().loadComments('post-1', true);
    refreshed.resolve(page('fresh-page'));
    await Promise.all([refresh, joined]);
    expect(list.mock.calls.map(([input]) => input.cursor)).toEqual(['', 'next-1', '']);
    expect(thread().comments.map(item => item.commentId)).toEqual(['fresh-page']);
  });

  it('loads a different historical anchor and cannot be overwritten by the old anchor', async () => {
    const oldAnchor = deferred<PrivateCommentPage>();
    const list = vi.spyOn(privateCommentsNative, 'list')
      .mockReturnValueOnce(oldAnchor.promise)
      .mockResolvedValueOnce(page('anchor-b'));
    const first = store().loadComments('post-1', true, 'anchor-a');
    await Promise.resolve();
    await store().loadComments('post-1', true, 'anchor-b');
    oldAnchor.resolve(page('anchor-a'));
    await first;
    expect(list.mock.calls.map(([input]) => input.anchorCommentId))
      .toEqual(['anchor-a', 'anchor-b']);
    expect(thread().comments.map(item => item.commentId)).toEqual(['anchor-b']);
  });

  it('discards a superseded error without poisoning a successful anchor read', async () => {
    const oldRead = deferred<PrivateCommentPage>();
    vi.spyOn(privateCommentsNative, 'list')
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(page('anchor-b'));
    const first = store().loadComments('post-1', true);
    await Promise.resolve();
    await store().loadComments('post-1', true, 'anchor-b');
    oldRead.reject(new Error('obsolete transport'));
    await first;
    expect(thread().comments[0].commentId).toBe('anchor-b');
    expect(thread().state).toBeUndefined();
  });

  it.each([
    ['another actor', () => store().activateActor('bob', 2)],
    ['another renderer', () => store().activateActor('alice', 2)],
    ['same actor reactivation', () => store().activateActor('alice', 1)],
    ['teardown', () => store().deactivate(2)],
    ['reset', () => store().reset()],
    ['post removal', () => store().clearPost('post-1')],
  ])('does not recreate a thread after %s', async (_name, invalidate) => {
    const oldRead = deferred<PrivateCommentPage>();
    vi.spyOn(privateCommentsNative, 'list').mockReturnValue(oldRead.promise);
    const first = store().loadComments('post-1', true);
    await Promise.resolve();
    invalidate();
    oldRead.resolve(page('obsolete-private-content'));
    await first;
    expect(thread()).toBeUndefined();
  });

  it('keeps a new read after post removal independent of the removed read', async () => {
    const oldRead = deferred<PrivateCommentPage>();
    const newRead = deferred<PrivateCommentPage>();
    const list = vi.spyOn(privateCommentsNative, 'list')
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise);
    const first = store().loadComments('post-1', true);
    await Promise.resolve();
    store().clearPost('post-1');
    const second = store().loadComments('post-1', true);
    await Promise.resolve();
    oldRead.resolve(page('removed'));
    await first;
    const joined = store().loadComments('post-1', true);
    newRead.resolve(page('new'));
    await Promise.all([second, joined]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(thread().comments.map(item => item.commentId)).toEqual(['new']);
  });

  it('preserves the unavailable-parent terminal state despite a late successful read', async () => {
    const native = deferred<PrivateCommentPage>();
    const list = vi.spyOn(privateCommentsNative, 'list').mockReturnValue(native.promise);
    const first = store().loadComments('post-1', true);
    await Promise.resolve();
    store().markParentUnavailable('post-1');
    native.resolve(page('revoked'));
    await first;
    await store().loadComments('post-1', true);
    expect(list).toHaveBeenCalledTimes(1);
    expect(thread()).toMatchObject({
      comments: [], loading: false, state: 'COMMENT_PARENT_UNAVAILABLE',
    });
  });

  it('invalidates a Native session replacement without leaving loading stuck', async () => {
    const native = deferred<PrivateCommentPage>();
    const list = vi.spyOn(privateCommentsNative, 'list')
      .mockReturnValueOnce(native.promise)
      .mockResolvedValueOnce(page('new-session'));
    const first = store().loadComments('post-1', true);
    await Promise.resolve();
    vi.mocked(privateCommentsNative.bootstrap).mockResolvedValueOnce(snapshot('2'));
    await store().bootstrap(1);
    expect(thread().loading).toBe(false);
    await store().loadComments('post-1', true);
    native.resolve(page('old-session'));
    await first;
    expect(list).toHaveBeenCalledTimes(2);
    expect(thread().comments.map(item => item.commentId)).toEqual(['new-session']);
  });

  it.each(['1', '0'])('preserves the current read across bootstrap generation %s', async generation => {
    const native = deferred<PrivateCommentPage>();
    const list = vi.spyOn(privateCommentsNative, 'list').mockReturnValue(native.promise);
    const first = store().loadComments('post-1', true);
    await Promise.resolve();
    vi.mocked(privateCommentsNative.bootstrap).mockResolvedValueOnce(snapshot(generation));
    await store().bootstrap(1);
    const second = store().loadComments('post-1', true);
    native.resolve(page('current-session'));
    await Promise.all([first, second]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(store().scope.nativeSessionGeneration).toBe('1');
    expect(thread().comments[0].commentId).toBe('current-session');
  });

  it('merges content and reaction revisions independently across refresh and bootstrap', async () => {
    const initial = page('comment-1');
    initial.comments[0] = {
      ...initial.comments[0],
      reactions: [create(ReactionSummarySchema, { kind: ReactionKind.REACTION_LIKE, count: 2n, reactedByViewer: true })],
      reactionsCount: 2, reactionRevision: '9', isLiked: true,
    };
    const edited = page('comment-1');
    edited.comments[0] = { ...edited.comments[0], generation: '2', text: 'edited' };
    vi.spyOn(privateCommentsNative, 'list')
      .mockResolvedValueOnce(initial).mockResolvedValueOnce(edited);
    await store().loadComments('post-1', true);
    await store().loadComments('post-1', true);
    expect(thread().comments[0]).toMatchObject({
      text: 'edited', generation: '2', reactionsCount: 2, reactionRevision: '9', isLiked: true,
    });
    const oldContent = page('comment-1').comments[0];
    vi.mocked(privateCommentsNative.bootstrap).mockResolvedValueOnce({
      ...snapshot('1'),
      comments: [{
        ...oldContent, reactions: [], reactionsCount: 0, reactionRevision: '10', isLiked: false,
      }],
    });
    await store().bootstrap(1);
    expect(thread().comments[0]).toMatchObject({
      text: 'edited', generation: '2', reactionsCount: 0, reactionRevision: '10', isLiked: false,
    });
  });

  it('applies a delayed reaction to current content without resurrecting removed comments', async () => {
    const reaction = deferred<PrivateReactionMutationResult>();
    const list = vi.spyOn(privateCommentsNative, 'list').mockResolvedValue(page('comment-1'));
    vi.spyOn(usePrivateMomentsStore.getState(), 'setReaction').mockReturnValue(reaction.promise);
    await store().loadComments('post-1', true);
    const operation = store().setCommentLike('post-1', 'comment-1', true);
    const edited = page('comment-1');
    edited.comments[0] = { ...edited.comments[0], text: 'new text', generation: '2' };
    list.mockResolvedValueOnce(edited);
    await store().loadComments('post-1', true);
    const result = {
      command: {
        commandId: 'reaction-1', postId: 'post-1', commentId: 'comment-1',
        kind: ReactionKind.REACTION_LIKE, operation: 'REACT', state: 'REACTION_COMMITTED',
        attemptCount: 1, projectionRevision: '5',
      },
      reactions: [create(ReactionSummarySchema, { kind: ReactionKind.REACTION_LIKE, count: 1n, reactedByViewer: true })],
      projectionRevision: '5', exactReplay: false,
    } satisfies PrivateReactionMutationResult;
    reaction.resolve(result);
    await operation;
    expect(thread().comments[0]).toMatchObject({
      text: 'new text', generation: '2', reactionsCount: 1, isLiked: true,
    });

    const next = deferred<PrivateReactionMutationResult>();
    vi.mocked(usePrivateMomentsStore.getState().setReaction).mockReturnValueOnce(next.promise);
    const removalRace = store().setCommentLike('post-1', 'comment-1', true);
    list.mockResolvedValueOnce({ ...page('comment-1'), comments: [] });
    await store().loadComments('post-1', true);
    next.resolve(result);
    await removalRace;
    expect(thread().comments).toEqual([]);
  });

  it('drops a reaction from a previous activation even when all scope field values match', async () => {
    const reaction = deferred<PrivateReactionMutationResult>();
    vi.spyOn(usePrivateMomentsStore.getState(), 'setReaction').mockReturnValue(reaction.promise);
    vi.spyOn(privateCommentsNative, 'list').mockResolvedValue(page('comment-1'));
    await store().loadComments('post-1', true);
    const operation = store().setCommentLike('post-1', 'comment-1', true);
    store().activateActor('alice', 1);
    await store().bootstrap(1);
    await store().loadComments('post-1', true);
    reaction.resolve({
      command: {
        commandId: 'old-reaction', postId: 'post-1', commentId: 'comment-1',
        kind: ReactionKind.REACTION_LIKE, operation: 'REACT', state: 'REACTION_COMMITTED',
        attemptCount: 1, projectionRevision: '5',
      },
      reactions: [create(ReactionSummarySchema, {
        kind: ReactionKind.REACTION_LIKE, count: 1n, reactedByViewer: true,
      })],
      projectionRevision: '5', exactReplay: false,
    });
    await operation;
    expect(thread().comments[0]).toMatchObject({ reactionsCount: 0, isLiked: false });
  });
});
