// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  createMoment: vi.fn(),
  fetchFeed: vi.fn(),
  fetchPublicFeed: vi.fn(),
  getPost: vi.fn(),
  reactToPost: vi.fn(),
  unreactToPost: vi.fn(),
  fetchComments: vi.fn(),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
}));

const privateRuntime = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    snapshot: {
      active: true,
      reconciling: false,
      stationPeerId: 'station-a',
      actorPtid: 'ptid:alice',
      deviceId: 'device-a',
      lifecycleGeneration: '7',
      activationGeneration: 3,
      projections: [],
      postsById: {},
      commentDrafts: [],
      comments: [],
      publishStateHistory: ['AUDIENCE_REQUIRED'],
      readStateHistoryByPostId: {},
      lastReport: null,
      errorMessage: null,
    },
    publishPrivateText: vi.fn(),
    publishPrivate: vi.fn(),
    readPrivate: vi.fn(),
    openPrivateMedia: vi.fn(),
    recoverPrivate: vi.fn(),
    submitPrivateComment: vi.fn(),
    readPrivateComments: vi.fn(),
    storeRecoveryPhrase: vi.fn(),
    reconcilePrivate: vi.fn(),
    trackPublicMomentPublish: vi.fn(async (operation, isPublished) => {
      const result = await operation();
      isPublished(result);
      return result;
    }),
  };
});

vi.mock('../../services/gateways/momentsGateway', () => ({
  createMomentsGateway: () => gateway,
}));

vi.mock('../../runtimes/privateMomentsRuntime', () => ({
  readPrivateMomentsSnapshot: () => privateRuntime.snapshot,
  subscribePrivateMomentsRuntime: (listener: () => void) => {
    privateRuntime.listeners.add(listener);
    return () => privateRuntime.listeners.delete(listener);
  },
  publishPrivateTextMoment: privateRuntime.publishPrivateText,
  publishPrivateMoment: privateRuntime.publishPrivate,
  readPrivateMoment: privateRuntime.readPrivate,
  openPrivateMomentMedia: privateRuntime.openPrivateMedia,
  recoverPrivateMoment: privateRuntime.recoverPrivate,
  submitPrivateComment: privateRuntime.submitPrivateComment,
  readPrivateComments: privateRuntime.readPrivateComments,
  storePrivateSocialRecoveryPhrase: privateRuntime.storeRecoveryPhrase,
  reconcilePrivateMoments: privateRuntime.reconcilePrivate,
  trackPublicMomentPublish: privateRuntime.trackPublicMomentPublish,
}));

import {
  createMobileSocialFacade,
  readActiveMobileSocialFacade,
} from './mobileSocialFacade';

const session = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  deviceId: 'device-a',
  lifecycleGeneration: 7,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

let facade: ReturnType<typeof createMobileSocialFacade> | null = null;

beforeEach(() => {
  for (const mock of Object.values(gateway)) mock.mockReset();
  for (const [name, mock] of Object.entries(privateRuntime)) {
    if (name !== 'listeners' && name !== 'snapshot' && vi.isMockFunction(mock)) {
      mock.mockReset();
    }
  }
  gateway.fetchFeed.mockResolvedValue({
    ok: true,
    data: { posts: [], nextCursor: '', hasMore: false, outcome: 2 },
  });
  gateway.getPost.mockResolvedValue({
    ok: true,
    data: {
      outcome: 1,
      post: { id: 'post-1', reactions: [], commentsCount: 1n },
    },
  });
  gateway.fetchComments.mockResolvedValue({
    ok: true,
    data: { comments: [], nextCursor: '', hasMore: false },
  });
  gateway.createComment.mockResolvedValue({
    ok: true,
    data: { comment: { id: 'comment-1' } },
  });
  gateway.reactToPost.mockResolvedValue({
    ok: true,
    data: { success: true, reactions: [{ kind: 2, count: 1n, reactedByMe: true }] },
  });
  privateRuntime.snapshot.projections = [];
  privateRuntime.snapshot.postsById = {};
});

afterEach(() => {
  facade?.teardown();
  facade = null;
});

describe('Mobile Social facade', () => {
  it('publishes one immutable scope and composes matching public/private projections', () => {
    facade = createMobileSocialFacade(session, { retry: vi.fn(async () => true) });
    facade.activate();

    const projection = facade.state();
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.scope)).toBe(true);
    expect(projection.scope).toEqual({
      stationPeerId: 'station-a',
      actorPtid: 'ptid:alice',
      deviceId: 'device-a',
      lifecycleGeneration: '7',
    });
    expect(projection.runtime.privateSocial).not.toBe(privateRuntime.snapshot);
    expect(Object.isFrozen(projection.runtime.privateSocial)).toBe(true);
    expect('gateway' in facade).toBe(false);
    expect(readActiveMobileSocialFacade(session)).toBe(facade);
  });

  it('rejects nested projection mutation without changing current or future state', async () => {
    privateRuntime.snapshot.postsById = {
      'private-1': {
        postId: 'private-1',
        state: 'CONTENT_READY',
        payload: { text: 'private original' },
      },
    };
    facade = createMobileSocialFacade(session, { retry: vi.fn(async () => true) });
    facade.activate();
    gateway.createMoment.mockResolvedValue({
      ok: true,
      data: {
        post: {
          id: 'post-1',
          content: {
            case: 'textPost',
            value: { text: 'public original' },
          },
          reactions: [],
        },
      },
    });

    await facade.intents.publishMoment({
      draftId: 'draft-public-original',
      draftRevision: 1,
      draft: {
        kind: 'text',
        text: 'public original',
        audience: { kind: 1 },
      },
    });
    const projection = facade.state();

    expect(() => {
      projection.home.posts[0].content.value.text = 'mutated';
    }).toThrow(TypeError);
    expect(() => {
      projection.home.posts.push({ id: 'injected' });
    }).toThrow(TypeError);
    expect((projection.home.postIndex as Map<string, number>).set).toBeUndefined();
    expect(() => {
      projection.runtime.privateSocial.postsById['private-1'].payload.text =
        'mutated';
    }).toThrow(TypeError);

    expect(facade.state().home.posts[0].content.value.text)
      .toBe('public original');
    expect(facade.state().runtime.privateSocial.postsById['private-1'].payload.text)
      .toBe('private original');

    privateRuntime.listeners.forEach((listener) => listener());
    expect(facade.state().home.posts[0].content.value.text)
      .toBe('public original');
    expect(facade.state().runtime.privateSocial.postsById['private-1'].payload.text)
      .toBe('private original');
  });

  it('routes public mutations through one intent port and authoritative readback', async () => {
    facade = createMobileSocialFacade(session, { retry: vi.fn(async () => true) });
    facade.activate();
    gateway.createMoment.mockResolvedValue({
      ok: true,
      data: { post: { id: 'post-1', reactions: [] } },
    });

    await expect(facade.intents.publishMoment({
      draftId: 'draft-public',
      draftRevision: 1,
      draft: {
        kind: 'text',
        text: 'hello',
        audience: { kind: 1 },
      },
    })).resolves.toMatchObject({
      route: 'PUBLIC',
      outcome: { ok: true },
    });
    await expect(facade.intents.react('post-1', 2)).resolves.toBe(true);
    await expect(facade.intents.comment('post-1', 'reply')).resolves.toBe(true);

    expect(facade.state().home.posts).toHaveLength(1);
    expect(privateRuntime.trackPublicMomentPublish).toHaveBeenCalledOnce();
    expect(gateway.reactToPost).toHaveBeenCalledWith('post-1', 2);
    expect(gateway.createComment).toHaveBeenCalledWith('post-1', 'reply', undefined);
    expect(gateway.getPost).toHaveBeenCalledWith('post-1');
  });

  it('routes every non-public Audience through the private Native owner', async () => {
    privateRuntime.publishPrivateText.mockResolvedValue({
      draftId: 'draft-private',
      draftRevision: 1,
      state: 'PUBLISHED',
      postId: 'private-1',
    });
    facade = createMobileSocialFacade(session, { retry: vi.fn(async () => true) });
    facade.activate();

    await expect(facade.intents.publishMoment({
      draftId: 'draft-private',
      draftRevision: 1,
      draft: {
        kind: 'text',
        text: 'friends only',
        audience: { kind: 8 },
      },
    })).resolves.toMatchObject({
      route: 'PRIVATE',
      projection: { state: 'PUBLISHED', postId: 'private-1' },
    });

    expect(privateRuntime.publishPrivateText).toHaveBeenCalledWith({
      draftId: 'draft-private',
      draftRevision: 1,
      text: 'friends only',
      audience: { kind: 'FRIENDS' },
    });
    expect(gateway.createMoment).not.toHaveBeenCalled();
  });

  it('fences an in-flight completion after teardown', async () => {
    let resolvePublish: (value: unknown) => void = () => undefined;
    gateway.createMoment.mockReturnValue(new Promise((resolve) => {
      resolvePublish = resolve;
    }));
    facade = createMobileSocialFacade(session, { retry: vi.fn(async () => true) });
    facade.activate();

    const completion = facade.intents.publishMoment({
      draftId: 'draft-stale',
      draftRevision: 1,
      draft: {
        kind: 'text',
        text: 'stale',
        audience: { kind: 1 },
      },
    });
    facade.teardown();
    resolvePublish({ ok: true, data: { post: { id: 'stale-post' } } });

    await expect(completion).rejects.toThrow('mobile.social.facadeTornDown');
    expect(readActiveMobileSocialFacade()).toBeNull();
  });

  it('keeps key and bearer material outside the Web projection', () => {
    facade = createMobileSocialFacade(session, { retry: vi.fn(async () => true) });
    facade.activate();

    const serialized = JSON.stringify(facade.state());
    expect(serialized).not.toMatch(/bearer|rootKey|privateKey|recoveryPhrase/i);
  });
});
