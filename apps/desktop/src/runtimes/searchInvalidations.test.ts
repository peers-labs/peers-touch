import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { PostSchema, SyncMomentsProjectionResponseSchema, TextPostSchema } from '../gen/proto/domain/social/post_pb';
import { CommentSchema } from '../gen/proto/domain/social/comment_pb';
import { useMomentsStore } from '../store/moments';
import * as socialApi from '../services/social_api';
import { usePrivateCommentsStore } from '../store/privateComments';
import { usePrivateMomentsStore } from '../store/privateMoments';
import { privateCommentsNative } from '../services/privateCommentsNative';
import { subscribeSearchInvalidations } from './searchInvalidations';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../messaging/runtime', () => ({
  messagingDomainRuntime: { matchesInvalidation: () => false },
}));
vi.mock('./momentsRuntime', () => ({ matchesCurrentMomentEvent: () => true }));
vi.mock('../services/privateMomentsNative', async importOriginal => ({
  ...await importOriginal<typeof import('../services/privateMomentsNative')>(),
  resolvePrivateMomentsPlatform: () => 'native',
}));
vi.mock('../utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let release: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => {
  release?.();
  release = undefined;
  usePrivateCommentsStore.getState().reset();
  usePrivateMomentsStore.getState().reset();
  useMomentsStore.getState().reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('original Social Search invalidation observations', () => {
  it('reports a passive signed-feed tombstone even with the old normalized Post retained', async () => {
    const store = useMomentsStore;
    const post = create(PostSchema, { id: 'public-post',
      content: { case: 'textPost', value: { text: 'searchable public body' } } });
    vi.spyOn(socialApi, 'socialSyncMomentsProjection').mockResolvedValue(create(SyncMomentsProjectionResponseSchema, {
      homeTimeline: { posts: [post], explanations: [], hasMore: false, nextCursor: '' },
      publicTimeline: { posts: [post], explanations: [], hasMore: false, nextCursor: '' },
    }));
    await store.getState().syncProjection('initial original read');
    const changed = vi.fn();
    release = await subscribeSearchInvalidations(changed);
    await store.getState().syncProjection('unchanged passive read');
    expect(changed).not.toHaveBeenCalled();

    vi.mocked(socialApi.socialSyncMomentsProjection).mockResolvedValue(create(SyncMomentsProjectionResponseSchema, {
      homeTimeline: { posts: [], explanations: [], hasMore: false, nextCursor: '' },
      publicTimeline: { posts: [], explanations: [], hasMore: false, nextCursor: '' },
    }));
    await store.getState().syncProjection('passive tombstone read');
    expect(store.getState().postsById[post.id]).toBeDefined();
    expect(store.getState().feeds.explore.postIds).toEqual([]);
    expect(changed.mock.calls).toEqual([[['device.social', 'station.social.public']]]);
  });

  it('ignores Public read bookkeeping and equivalent content copies', async () => {
    const store = useMomentsStore;
    const post = create(PostSchema, { id: 'post',
      content: { case: 'textPost', value: { text: 'retained body' } } });
    const comment = create(CommentSchema, { id: 'comment', postId: 'post', content: 'retained comment' });
    store.setState({ postsById: { post }, comments: { post: [comment] } });
    const changed = vi.fn();
    release = await subscribeSearchInvalidations(changed);
    const state = store.getState();
    store.setState({
      postsById: { post: create(PostSchema, post) },
      comments: { post: [create(CommentSchema, comment)] },
      commentsLoading: { post: true }, commentsCursor: { post: 'next' },
      commentsHasMore: { post: true },
      feeds: {
        home: { ...state.feeds.home, postIds: [...state.feeds.home.postIds], loading: true },
        explore: { ...state.feeds.explore, postIds: [...state.feeds.explore.postIds],
          loadedAt: Date.now(), nextCursor: 'next', hasMore: true },
      },
    });
    expect(changed).not.toHaveBeenCalled();
  });

  it('reports Public content edits, comment removal, integrity refusal and reset', async () => {
    const store = useMomentsStore;
    const post = create(PostSchema, { id: 'post',
      content: { case: 'textPost', value: { text: 'original body' } } });
    store.setState({ postsById: { post }, comments: { post: [
      create(CommentSchema, { id: 'comment', postId: 'post', content: 'original comment' }),
    ] } });
    const changed = vi.fn();
    release = await subscribeSearchInvalidations(changed);
    store.setState({ postsById: { post: create(PostSchema, { ...post,
content: { case: 'textPost', value: create(TextPostSchema, { text: 'edited body' }) } }) } });
    store.setState({ comments: { post: [] } });
    store.setState({ publicFeedReadError: 'FEED_INVALID' });
    store.getState().reset();
    expect(changed.mock.calls).toEqual(Array.from({ length: 4 }, () =>
      [['device.social', 'station.social.public']]));
    release();
    release = undefined;
    store.setState({ postsById: { post } });
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it('keeps the qualified result during an unchanged real Comment bootstrap', async () => {
    const store = usePrivateCommentsStore;
    store.getState().activateActor('alice', 1);
    vi.spyOn(privateCommentsNative, 'bootstrap').mockResolvedValue({
      actorPtid: 'alice', deviceId: 'alice-device', sessionGeneration: '1',
      drafts: [], comments: [],
    });
    await store.getState().bootstrap(1);
    usePrivateCommentsStore.setState({
      threadsByPost: {
        post: { comments: [], nextCursor: '', hasMore: false, loaded: true, loading: false },
      },
    });
    const before = store.getState().threadsByPost;
    const changed = vi.fn();
    release = await subscribeSearchInvalidations(changed);
    await store.getState().bootstrap(1);

    expect(store.getState().threadsByPost).not.toBe(before);
    expect(changed).not.toHaveBeenCalled();
  });

  it('ignores read lifecycle and cursor changes but immediately reports parent denial', async () => {
    const store = usePrivateCommentsStore;
    store.setState({
      threadsByPost: {
        post: { comments: [], nextCursor: '', hasMore: false, loaded: false, loading: false },
      },
    });
    const changed = vi.fn();
    release = await subscribeSearchInvalidations(changed);
    store.setState({
      threadsByPost: {
        post: { comments: [], nextCursor: 'next', hasMore: true, loaded: true, loading: true },
      },
    });
    expect(changed).not.toHaveBeenCalled();

    store.getState().markParentUnavailable('post', 'PRIVATE_CONTENT_NOT_AUTHORIZED');
    expect(changed.mock.calls).toEqual([[['device.social']]]);
  });

  it('reports comment content acquisition, removal and actor replacement', async () => {
    const store = usePrivateCommentsStore;
    store.getState().activateActor('alice', 1);
    const changed = vi.fn();
    release = await subscribeSearchInvalidations(changed);
    store.setState({
      threadsByPost: {
        post: {
          comments: [{
            postId: 'post', commentId: 'comment', contentId: 'content', generation: '1',
            authorPtid: 'alice', replyToCommentId: '', state: 'COMMENT_POSTED',
            text: 'authorized original comment', mentions: [], reactionsCount: 0,
            reactions: [], reactionRevision: '0', isLiked: false, repliesCount: 0,
          }],
          nextCursor: '', hasMore: false, loaded: true, loading: false,
        },
      },
    });
    expect(changed).toHaveBeenCalledTimes(1);
    store.getState().clearPost('post');
    expect(changed).toHaveBeenCalledTimes(2);
    store.getState().activateActor('bob', 2);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('ignores equivalent Moment scope copies and still reports scope replacement', async () => {
    const store = usePrivateMomentsStore;
    store.getState().activateActor('alice', 1);
    const changed = vi.fn();
    release = await subscribeSearchInvalidations(changed);
    store.setState({
      scope: { ...store.getState().scope }, postsById: { ...store.getState().postsById },
    });
    expect(changed).not.toHaveBeenCalled();
    store.getState().activateActor('bob', 2);
    expect(changed.mock.calls).toEqual([[['device.social']]]);
  });
});
