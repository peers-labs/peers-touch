import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface TestSessionState {
  authenticated: boolean;
  currentUser: { actorPtid: string } | null;
  sessionEpoch: number;
}

interface TestFederationState {
  self: { home_station_peer_id?: string } | null;
}

const mocks = vi.hoisted(() => {
  const moments = {
    postsById: {},
    circles: [],
    circleMembers: {},
    syncProjection: vi.fn<() => Promise<void>>(),
    hydratePrivateMoments: vi.fn(),
    listMyCircles: vi.fn<() => Promise<void>>(),
    loadMyStats: vi.fn<() => Promise<void>>(),
    loadCircleMembers: vi.fn<() => Promise<void>>(),
    loadPost: vi.fn<() => Promise<undefined>>(),
    loadComments: vi.fn<() => Promise<void>>(),
    setCommentTarget: vi.fn(),
    loadUserFeed: vi.fn<() => Promise<void>>(),
    evictPost: vi.fn(),
    refreshPostReactions: vi.fn<() => Promise<void>>(),
    reset: vi.fn(),
    setPublicFeedRecoveryError: vi.fn(),
  };
  const privateMoments = {
    postsById: {},
    activateActor: vi.fn(),
    deactivate: vi.fn(),
    bootstrap: vi.fn<() => Promise<void>>(),
    reconcile: vi.fn<() => Promise<void>>(),
    admitMoment: vi.fn<(_intent: unknown) => Promise<{
      state: 'READY_PRIVATE';
      draftId: string;
    }>>(),
    readMoment: vi.fn<() => Promise<void>>(),
    revokeMoment: vi.fn<() => Promise<void>>(),
    purgeMoment: vi.fn<() => Promise<void>>(),
  };
  const privateComments = {
    setCommentTarget: vi.fn(),
    activateActor: vi.fn(),
    deactivate: vi.fn(),
    bootstrap: vi.fn<() => Promise<void>>(),
    reconcile: vi.fn<() => Promise<void>>(),
    loadComments: vi.fn<() => Promise<void>>(),
    markParentUnavailable: vi.fn(),
  };
  const discovery = {
    loadMe: vi.fn<() => Promise<void>>(),
    loadUserProfile: vi.fn<() => Promise<void>>(),
    reset: vi.fn(),
  };
  const relationships = {
    loadRelationship: vi.fn<() => Promise<void>>(),
    loadRelationshipStatus: vi.fn<() => Promise<void>>(),
    loadFollowers: vi.fn<() => Promise<void>>(),
    loadFollowing: vi.fn<() => Promise<void>>(),
    reset: vi.fn(),
  };
  const socialChat = {
    currentUserPtid: null as string | null,
    currentUserProfile: null as { displayName: string } | null,
    peerProfiles: {} as Record<string, unknown | null>,
    loadCurrentUserProfile: vi.fn<() => Promise<void>>(),
    loadPeerProfile: vi.fn<(_actorPtid: string, _force?: boolean) => Promise<void>>(),
  };
  return {
    moments,
    privateMoments,
    privateComments,
    discovery,
    relationships,
    socialChat,
    sessionState: {
      authenticated: true,
      currentUser: { actorPtid: 'ptid:alice' },
      sessionEpoch: 1,
    } as TestSessionState,
    federationState: {
      self: { home_station_peer_id: 'station-a' },
    } as TestFederationState,
    sessionListener: undefined as
      | ((state: TestSessionState, previous: TestSessionState) => void)
      | undefined,
    federationListener: undefined as
      | ((state: TestFederationState, previous: TestFederationState) => void)
      | undefined,
  };
});

vi.mock('../store/moments', () => ({
  useMomentsStore: {
    getState: () => mocks.moments,
  },
}));

vi.mock('../store/privateMoments', () => ({
  usePrivateMomentsStore: {
    getState: () => mocks.privateMoments,
  },
}));

vi.mock('../store/privateComments', () => ({
  usePrivateCommentsStore: {
    getState: () => mocks.privateComments,
  },
}));

vi.mock('../store/discovery', () => ({
  useDiscoveryStore: {
    getState: () => mocks.discovery,
  },
}));

vi.mock('../store/relationships', () => ({
  useRelationshipsStore: {
    getState: () => mocks.relationships,
  },
}));

vi.mock('../store/session', () => ({
  useSessionStore: {
    getState: () => mocks.sessionState,
    subscribe: vi.fn((listener) => {
      mocks.sessionListener = listener;
      return () => {
        mocks.sessionListener = undefined;
      };
    }),
  },
}));

vi.mock('../store/federation', () => ({
  useFederationStore: {
    getState: () => mocks.federationState,
    subscribe: vi.fn((listener) => {
      mocks.federationListener = listener;
      return () => {
        mocks.federationListener = undefined;
      };
    }),
  },
}));

vi.mock('../store/socialChat', () => ({
  useSocialChatStore: {
    getState: () => mocks.socialChat,
  },
}));

vi.mock('../utils/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  acquireMomentComments,
  captureMomentsRuntimeScope,
  MomentsRuntimeScopeChangedError,
  momentsRuntime,
  preparePrivateAudience,
  prepareRemotePrivateRecipient,
} from './momentsRuntime';
const feedMocks = vi.hoisted(() => ({ resume: vi.fn() }));
vi.mock('../services/publicFeedNative', () => ({ resumePublicFeed: feedMocks.resume }));
import { EVENT, eventBus } from '../kernel/events';
import { useMomentsNavigationStore } from '../store/momentsNavigation';

let intervalCallbacks: Array<() => void>;
let timerRegistry: Map<number, () => void>;

function setSession(next: typeof mocks.sessionState): void {
  const previous = mocks.sessionState;
  mocks.sessionState = next;
  mocks.sessionListener?.(next, previous);
}

async function flushRuntime(): Promise<void> {
  await momentsRuntime.bootstrap(null);
}

// The runtime coalesces feed refreshes behind a trailing window.setTimeout;
// the fake window captures the fire callbacks for deterministic flushing.
async function flushCoalescedRefreshes(): Promise<void> {
  // Run every timer still live after clearTimeout cancellations.
  const pending = Array.from(timerRegistry.values());
  timerRegistry.clear();
  pending.forEach((callback) => callback());
  // The coalesced fire enqueues scoped projection work whose promise chain
  // spans several awaits; macrotask turns drain it deterministically.
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  momentsRuntime.teardown();
  vi.clearAllMocks();
  intervalCallbacks = [];
  timerRegistry = new Map();
  const target = Object.assign(new EventTarget(), {
    setInterval: vi.fn((callback: () => void) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    }),
    clearInterval: vi.fn(),
    setTimeout: vi.fn((callback: () => void) => {
      const handle = timerRegistry.size + 1;
      timerRegistry.set(handle, callback);
      return handle;
    }),
    clearTimeout: vi.fn((handle: number) => {
      timerRegistry.delete(handle);
    }),
  });
  vi.stubGlobal('window', target);
  mocks.sessionState = {
    authenticated: true,
    currentUser: { actorPtid: 'ptid:alice' },
    sessionEpoch: 1,
  };
  mocks.federationState = {
    self: { home_station_peer_id: 'station-a' },
  };
  mocks.moments.postsById = {};
  mocks.moments.circles = [];
  mocks.moments.circleMembers = {};
  mocks.privateMoments.postsById = {};
  mocks.moments.syncProjection.mockResolvedValue(undefined);
  feedMocks.resume.mockReset().mockResolvedValue(undefined);
  mocks.moments.hydratePrivateMoments.mockClear();
  mocks.moments.listMyCircles.mockResolvedValue(undefined);
  mocks.moments.loadCircleMembers.mockResolvedValue(undefined);
  mocks.moments.loadPost.mockResolvedValue(undefined);
  mocks.moments.loadComments.mockResolvedValue(undefined);
  mocks.moments.loadUserFeed.mockResolvedValue(undefined);
  mocks.privateMoments.bootstrap.mockResolvedValue(undefined);
  mocks.privateMoments.reconcile.mockResolvedValue(undefined);
  mocks.privateMoments.admitMoment.mockResolvedValue({
    state: 'READY_PRIVATE',
    draftId: 'draft-remote',
  });
  mocks.privateMoments.readMoment.mockResolvedValue(undefined);
  mocks.privateMoments.revokeMoment.mockResolvedValue(undefined);
  mocks.privateMoments.purgeMoment.mockResolvedValue(undefined);
  mocks.privateComments.bootstrap.mockResolvedValue(undefined);
  mocks.privateComments.reconcile.mockResolvedValue(undefined);
  mocks.privateComments.loadComments.mockResolvedValue(undefined);
  mocks.discovery.loadMe.mockResolvedValue(undefined);
  mocks.discovery.loadUserProfile.mockResolvedValue(undefined);
  mocks.relationships.loadRelationship.mockResolvedValue(undefined);
  mocks.relationships.loadFollowers.mockResolvedValue(undefined);
  mocks.relationships.loadFollowing.mockResolvedValue(undefined);
  mocks.socialChat.currentUserPtid = null;
  mocks.socialChat.currentUserProfile = null;
  mocks.socialChat.peerProfiles = {};
  mocks.socialChat.loadCurrentUserProfile.mockImplementation(async () => {
    mocks.socialChat.currentUserPtid = 'ptid:alice';
    mocks.socialChat.currentUserProfile = { displayName: 'Alice' };
  });
  mocks.socialChat.loadPeerProfile.mockImplementation(async (actorPtid) => {
    mocks.socialChat.peerProfiles[actorPtid] = { display_name: 'Bob' };
  });
});

afterEach(() => {
  momentsRuntime.teardown();
  vi.unstubAllGlobals();
});

describe('momentsRuntime identity fence', () => {
  it('shares visible thread acquisition and reconciles only while a viewport lease survives', async () => {
    momentsRuntime.install();
    await flushRuntime();
    mocks.moments.postsById = { inline: { id: 'inline', audience: { kind: 1 } } };
    mocks.moments.loadComments.mockClear();
    const first = acquireMomentComments('inline');
    const second = acquireMomentComments('inline');
    await vi.waitFor(() => expect(mocks.moments.loadComments).toHaveBeenCalledTimes(1));
    first();
    mocks.moments.loadComments.mockClear();
    await momentsRuntime.reconcile!('missed-comment-event');
    expect(mocks.moments.loadComments).toHaveBeenCalledWith('inline', true);
    second();
    mocks.moments.loadComments.mockClear();
    await momentsRuntime.reconcile!('hidden-thread');
    expect(mocks.moments.loadComments).not.toHaveBeenCalled();
  });

  it('does not read an inline thread whose interest is released before dispatch', async () => {
    momentsRuntime.install();
    await flushRuntime();
    mocks.moments.postsById = { inline: { id: 'inline', audience: { kind: 1 } } };
    mocks.moments.loadComments.mockClear();
    acquireMomentComments('inline')();
    await momentsRuntime.reconcile!('released-before-read');
    expect(mocks.moments.loadComments).not.toHaveBeenCalled();
  });

  it('keeps visible private threads at the original Secure Content read owner', async () => {
    momentsRuntime.install();
    await flushRuntime();
    mocks.moments.postsById = { private: { id: 'private', audience: { kind: 2 } } };
    mocks.moments.loadComments.mockClear();
    mocks.privateComments.loadComments.mockClear();
    const release = acquireMomentComments('private');
    await vi.waitFor(() => expect(mocks.privateComments.loadComments).toHaveBeenCalledWith('private'));
    expect(mocks.moments.loadComments).not.toHaveBeenCalled();
    release();
  });

  it('prevents an outgoing Actor thread lease from releasing a replacement Actor thread', async () => {
    momentsRuntime.install();
    await flushRuntime();
    mocks.moments.postsById = { inline: { id: 'inline', audience: { kind: 1 } } };
    const outgoing = acquireMomentComments('inline');
    await vi.waitFor(() => expect(mocks.moments.loadComments).toHaveBeenCalled());
    setSession({ authenticated: true, currentUser: { actorPtid: 'ptid:bob' }, sessionEpoch: 2 });
    await flushRuntime();
    const replacement = acquireMomentComments('inline');
    outgoing();
    mocks.moments.loadComments.mockClear();
    await momentsRuntime.reconcile!('replacement-thread');
    expect(mocks.moments.loadComments).toHaveBeenCalledWith('inline', true);
    replacement();
  });

  it('does not start an obsolete historical comment read after Back during the parent read', async () => {
    momentsRuntime.install();
    await flushRuntime();
    mocks.moments.loadComments.mockClear();
    let release!: (value: undefined) => void;
    mocks.moments.loadPost.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    useMomentsNavigationStore.getState().setView({
      kind: 'detail', postId: 'pending-post', commentId: 'old-comment', from: 'feed',
    });
    eventBus.publish(EVENT.MOMENT_COMMENTED, {
      eventId: 'pending-anchor', targetActorPtid: 'ptid:alice', sessionEpoch: 1,
      stationPeerId: 'station-a', stationUrl: 'https://station-a.test',
      postId: 'pending-post', authorActorPtid: 'ptid:alice', commentId: 'new-comment',
      commentAuthorActorPtid: 'ptid:bob', occurredAtUnixMs: 1,
    });
    await vi.waitFor(() => expect(release).toBeDefined());
    useMomentsNavigationStore.getState().setView({ kind: 'tab', tab: 'feed' });
    release(undefined);
    await flushRuntime();
    expect(mocks.moments.loadComments).not.toHaveBeenCalled();
    expect(mocks.privateComments.loadComments).not.toHaveBeenCalled();
  });

  it.each([false, true])('refreshes the original thread for a typed comment reaction (private=%s)', async privatePost => {
    momentsRuntime.install();
    await flushRuntime();
    vi.clearAllMocks();
    const postId = 'typed-comment-post';
    mocks.moments.loadPost.mockResolvedValue({ id: postId, audience: { kind: privatePost ? 2 : 1 } } as never);
    if (privatePost) {
      (mocks.privateMoments.postsById as Record<string, unknown>)[postId] = {
        postId, state: 'CONTENT_READY',
      };
    }
    useMomentsNavigationStore.getState().setView({
      kind: 'detail', postId, commentId: 'historical-root', from: 'feed',
    });
    eventBus.publish(EVENT.MOMENT_REACTED, {
      eventId: 'typed-comment-reaction', targetActorPtid: 'ptid:alice', sessionEpoch: 1,
      stationPeerId: 'station-a', stationUrl: 'https://station-a.test',
      postId, commentId: 'reply', authorActorPtid: 'ptid:alice',
      reactionActorPtid: 'ptid:bob', kind: 'REACTION_LIKE', removed: false, occurredAtUnixMs: 1,
    });
    await flushRuntime();
    const comments = privatePost ? mocks.privateComments.loadComments : mocks.moments.loadComments;
    expect(comments).toHaveBeenCalledWith(postId, true, 'historical-root');
  });

  it('keeps post reaction events post-scoped while periodic refresh retains the active comment', async () => {
    momentsRuntime.install();
    await flushRuntime();
    const postId = 'historical-post';
    mocks.moments.loadPost.mockResolvedValue({ id: postId, audience: { kind: 1 } } as never);
    useMomentsNavigationStore.getState().setView({
      kind: 'detail', postId, commentId: 'old-comment', from: 'feed',
    });
    eventBus.publish(EVENT.MOMENT_REACTED, {
      eventId: 'anchor-refresh', targetActorPtid: 'ptid:alice', sessionEpoch: 1,
      stationPeerId: 'station-a', stationUrl: 'https://station-a.test',
      postId, authorActorPtid: 'ptid:alice', reactionActorPtid: 'ptid:bob',
      kind: 'REACTION_LIKE', removed: false, occurredAtUnixMs: 1,
    });
    await flushRuntime();
    // Reaction events are post-scoped: they refresh only the post
    // projection, never the comment thread.
    expect(mocks.moments.loadPost).toHaveBeenLastCalledWith(postId);
    expect(mocks.moments.loadComments).not.toHaveBeenCalled();
    intervalCallbacks[0]();
    await flushRuntime();
    // The periodic reconcile still re-reads the anchored comment.
    expect(mocks.moments.loadComments).toHaveBeenLastCalledWith(postId, true, 'old-comment');
    useMomentsNavigationStore.getState().setView({ kind: 'tab', tab: 'feed' });
    expect(mocks.moments.setCommentTarget).toHaveBeenLastCalledWith(undefined, undefined);
    expect(mocks.privateComments.setCommentTarget).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it('hydrates visible public and private Moment authors in the runtime', async () => {
    mocks.moments.postsById = {
      public: {
        authorPtid: 'ptid:alice',
      },
      private: {
        author: { id: 'ptid:bob' },
      },
    };

    momentsRuntime.install();
    await flushRuntime();

    expect(mocks.socialChat.loadCurrentUserProfile).toHaveBeenCalled();
    expect(mocks.socialChat.loadPeerProfile).toHaveBeenCalledWith(
      'ptid:bob',
      false,
    );
  });

  it('loads an imported private Moment while the Moments page is unopened', async () => {
    momentsRuntime.install();
    await flushRuntime();
    vi.clearAllMocks();

    const wake = {
      eventId: 'remote-private-event-1',
      targetActorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationPeerId: 'station-a',
      stationUrl: 'https://station-a.test',
      postId: '01REMOTEPRIVATEPOST',
      authorActorPtid: 'ptid:alice',
      occurredAtUnixMs: 456,
      audience: 'FRIENDS',
    };
    eventBus.publish(EVENT.MOMENT_CREATED, wake);

    await vi.waitFor(() => {
      expect(mocks.moments.loadPost).toHaveBeenCalledWith(
        '01REMOTEPRIVATEPOST',
      );
      expect(mocks.privateMoments.readMoment).toHaveBeenCalledWith(
        '01REMOTEPRIVATEPOST',
      );
    });
    // Feed refresh is trailing-coalesced, not immediate per event.
    expect(mocks.moments.syncProjection).not.toHaveBeenCalled();
    await flushCoalescedRefreshes();
    expect(mocks.moments.syncProjection).toHaveBeenCalledTimes(1);
    expect(mocks.moments.syncProjection).toHaveBeenCalledWith('event:coalesced');

    eventBus.publish(EVENT.MOMENT_CREATED, wake);
    await Promise.resolve();
    expect(mocks.privateMoments.readMoment).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of realtime invalidations into one feed refresh', async () => {
    momentsRuntime.install();
    await flushRuntime();
    await vi.waitFor(() => {
      expect(captureMomentsRuntimeScope()).not.toBeNull();
    });
    vi.clearAllMocks();
    const wake = {
      eventId: 'burst-event',
      targetActorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationPeerId: 'station-a',
      stationUrl: 'https://station-a.test',
      postId: '01BURSTPOST',
      authorActorPtid: 'ptid:alice',
      occurredAtUnixMs: 456,
      audience: 'FRIENDS',
    };

    eventBus.publish(EVENT.MOMENT_CREATED, wake);
    eventBus.publish(EVENT.REALTIME_RESYNC, {
      reason: 'test-1',
      newestEventId: 'event-1',
    });
    eventBus.publish(EVENT.MOMENT_RESYNC_REQUESTED, { reason: 'test-2' });
    await Promise.resolve();
    expect(mocks.moments.syncProjection).not.toHaveBeenCalled();

    await flushCoalescedRefreshes();
    expect(mocks.moments.syncProjection).toHaveBeenCalledTimes(1);
  });

  it('refreshes a hidden private Comment thread once per EventBus event', async () => {
    momentsRuntime.install();
    await flushRuntime();
    vi.clearAllMocks();
    const postId = '01REMOTECOMMENTPOST';
    (mocks.privateMoments.postsById as Record<string, { state: string }>)[postId] = {
      state: 'CONTENT_READY',
    };
    const wake = {
      eventId: 'remote-private-comment-1',
      targetActorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationPeerId: 'station-a',
      stationUrl: 'https://station-a.test',
      postId,
      authorActorPtid: 'ptid:bob',
      commentId: '01REMOTECOMMENT',
      commentAuthorActorPtid: 'ptid:bob',
      occurredAtUnixMs: 459,
    };

    eventBus.publish(EVENT.MOMENT_COMMENTED, wake);
    await vi.waitFor(() => {
      expect(mocks.privateMoments.readMoment).toHaveBeenCalledWith(postId);
      expect(mocks.privateComments.loadComments).toHaveBeenCalledWith(postId, true, undefined);
    });

    eventBus.publish(EVENT.MOMENT_COMMENTED, wake);
    await Promise.resolve();
    expect(mocks.privateComments.loadComments).toHaveBeenCalledTimes(1);
  });

  it('hydrates hidden private Reaction summaries once per EventBus event', async () => {
    momentsRuntime.install();
    await flushRuntime();
    vi.clearAllMocks();
    const postId = '01REMOTEREACTIONPOST';
    (mocks.privateMoments.postsById as Record<string, unknown>)[postId] = {
      postId,
      state: 'CONTENT_READY',
      reactions: [{ kind: 1, count: 1n, reactedByViewer: true }],
      reactionRevision: '7',
      reactionsHydrated: true,
    };
    const wake = {
      eventId: 'remote-private-reaction-1',
      targetActorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationPeerId: 'station-a',
      stationUrl: 'https://station-a.test',
      postId,
      authorActorPtid: 'ptid:bob',
      reactionActorPtid: 'ptid:alice',
      kind: 'REACTION_LIKE',
      removed: false,
      occurredAtUnixMs: 460,
    };

    eventBus.publish(EVENT.MOMENT_REACTED, wake);
    await vi.waitFor(() => {
      expect(mocks.privateMoments.readMoment).toHaveBeenCalledWith(postId);
      expect(mocks.moments.hydratePrivateMoments).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            postId,
            reactionRevision: '7',
          }),
        ]),
      );
    });

    eventBus.publish(EVENT.MOMENT_REACTED, wake);
    await Promise.resolve();
    expect(mocks.privateMoments.readMoment).toHaveBeenCalledTimes(1);
  });

  it('purges a hidden private projection once per typed revocation event', async () => {
    momentsRuntime.install();
    await flushRuntime();
    vi.clearAllMocks();
    const wake = {
      eventId: 'remote-private-revocation-1',
      targetActorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationPeerId: 'station-a',
      stationUrl: 'https://station-a.test',
      postId: '01REMOTEREVOKEDPOST',
      occurredAtUnixMs: 461,
      reason: 'RELATIONSHIP_REVOKED' as const,
    };

    eventBus.publish(EVENT.MOMENT_REVOKED, wake);
    await vi.waitFor(() => {
      expect(mocks.privateComments.markParentUnavailable).toHaveBeenCalledWith(
        wake.postId,
        'SOCIAL_PRIVATE_RELATIONSHIP_REVOKED',
      );
      expect(mocks.privateMoments.revokeMoment).toHaveBeenCalledWith(
        wake.postId,
        'RELATIONSHIP_REVOKED',
      );
    });
    await flushCoalescedRefreshes();
    expect(mocks.moments.syncProjection).toHaveBeenCalledTimes(1);
    expect(mocks.moments.syncProjection).toHaveBeenCalledWith('event:coalesced');

    eventBus.publish(EVENT.MOMENT_REVOKED, wake);
    await Promise.resolve();
    expect(mocks.privateMoments.revokeMoment).toHaveBeenCalledTimes(1);
  });

  it('evicts the public projection immediately on deleted and revoked events', async () => {
    momentsRuntime.install();
    await flushRuntime();
    vi.clearAllMocks();

    const deletedWake = {
      eventId: 'remote-deleted-1',
      targetActorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationPeerId: 'station-a',
      stationUrl: 'https://station-a.test',
      postId: '01REMOTEDELETEDPOST',
      authorActorPtid: 'ptid:bob',
      occurredAtUnixMs: 462,
    };
    eventBus.publish(EVENT.MOMENT_DELETED, deletedWake);
    await vi.waitFor(() => {
      expect(mocks.moments.evictPost).toHaveBeenCalledWith('01REMOTEDELETEDPOST');
      expect(mocks.privateMoments.purgeMoment).toHaveBeenCalledWith('01REMOTEDELETEDPOST');
    });
    // Local eviction is not a write command: the store mock has no
    // delete action invoked by the runtime.
    expect(mocks.moments.evictPost).toHaveBeenCalledTimes(1);

    const revokedWake = {
      eventId: 'remote-revoked-public-1',
      targetActorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationPeerId: 'station-a',
      stationUrl: 'https://station-a.test',
      postId: '01REMOTEPUBLICREVOKED',
      occurredAtUnixMs: 463,
      reason: 'RELATIONSHIP_REVOKED' as const,
    };
    eventBus.publish(EVENT.MOMENT_REVOKED, revokedWake);
    await vi.waitFor(() => {
      expect(mocks.moments.evictPost).toHaveBeenCalledWith('01REMOTEPUBLICREVOKED');
    });
  });

  it('suppresses cached private posts immediately on a relationship block', async () => {
    momentsRuntime.install();
    await flushRuntime();
    vi.clearAllMocks();
    (mocks.privateMoments.postsById as Record<string, unknown>)['private-bob'] = {
      postId: 'private-bob',
      authorPtid: 'ptid:bob',
      state: 'CONTENT_READY',
    };

    eventBus.publish(EVENT.RELATIONSHIP_CHANGED, {
      targetActorPtid: 'ptid:bob',
      action: 'block',
    });

    await vi.waitFor(() => {
      expect(mocks.privateMoments.revokeMoment).toHaveBeenCalledWith(
        'private-bob',
        'RECIPIENT_BLOCKED',
      );
      expect(mocks.relationships.loadRelationship).toHaveBeenCalledWith('ptid:bob');
    });
    await flushCoalescedRefreshes();
    expect(mocks.moments.syncProjection).toHaveBeenCalledTimes(1);
    expect(mocks.moments.syncProjection).toHaveBeenCalledWith('event:coalesced');
  });

  it('rejects imported Moment wakes from another actor or Station scope', async () => {
    momentsRuntime.install();
    await flushRuntime();
    vi.clearAllMocks();

    eventBus.publish(EVENT.MOMENT_CREATED, {
      eventId: 'remote-private-wrong-actor',
      targetActorPtid: 'ptid:bob',
      sessionEpoch: 1,
      stationPeerId: 'station-a',
      stationUrl: 'https://station-a.test',
      postId: '01WRONGACTOR',
      authorActorPtid: 'ptid:alice',
      occurredAtUnixMs: 456,
      audience: 'FRIENDS',
    });
    eventBus.publish(EVENT.MOMENT_CREATED, {
      eventId: 'remote-private-wrong-station',
      targetActorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationPeerId: 'station-b',
      stationUrl: 'https://station-b.test',
      postId: '01WRONGSTATION',
      authorActorPtid: 'ptid:alice',
      occurredAtUnixMs: 457,
      audience: 'FRIENDS',
    });
    eventBus.publish(EVENT.MOMENT_CREATED, {
      eventId: 'remote-private-wrong-session',
      targetActorPtid: 'ptid:alice',
      sessionEpoch: 2,
      stationPeerId: 'station-a',
      stationUrl: 'https://station-a.test',
      postId: '01WRONGSESSION',
      authorActorPtid: 'ptid:alice',
      occurredAtUnixMs: 458,
      audience: 'FRIENDS',
    });
    await Promise.resolve();

    expect(mocks.privateMoments.readMoment).not.toHaveBeenCalled();
    expect(mocks.moments.syncProjection).not.toHaveBeenCalled();
  });

  it('allows a failed imported Moment wake to retry under the same event ID', async () => {
    momentsRuntime.install();
    await flushRuntime();
    vi.clearAllMocks();
    mocks.moments.loadPost
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValueOnce(undefined);

    const wake = {
      eventId: 'remote-private-retry',
      targetActorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationPeerId: 'station-a',
      stationUrl: 'https://station-a.test',
      postId: '01REMOTERETRY',
      authorActorPtid: 'ptid:bob',
      occurredAtUnixMs: 458,
      audience: 'FRIENDS',
    };
    eventBus.publish(EVENT.MOMENT_CREATED, wake);
    await vi.waitFor(() => {
      expect(mocks.moments.loadPost).toHaveBeenCalledTimes(1);
    });
    eventBus.publish(EVENT.MOMENT_CREATED, wake);
    await vi.waitFor(() => {
      expect(mocks.privateMoments.readMoment).toHaveBeenCalledWith(
        '01REMOTERETRY',
      );
    });
    expect(mocks.moments.loadPost).toHaveBeenCalledTimes(2);
  });

  it('returns typed readiness for one remote recipient before publish', async () => {
    momentsRuntime.install();
    await flushRuntime();

    const result = await prepareRemotePrivateRecipient({
      draftId: 'draft-remote',
      draftRevision: 1,
      audience: { kind: 'FRIENDS' },
      momentKind: 'TEXT',
      text: 'private',
      files: [],
    });

    expect(result).toEqual({
      state: 'READY_PRIVATE',
      draftId: 'draft-remote',
    });
    expect(mocks.privateMoments.admitMoment).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: 'draft-remote',
        audience: { kind: 'FRIENDS' },
      }),
      'CHECKING_REMOTE_READINESS',
    );
  });

  it('uses generic prekey readiness when recipient locality is unresolved', async () => {
    momentsRuntime.install();
    await flushRuntime();

    await preparePrivateAudience({
      draftId: 'draft-private',
      draftRevision: 1,
      audience: { kind: 'FRIENDS' },
      momentKind: 'TEXT',
      text: 'private',
      files: [],
    });

    expect(mocks.privateMoments.admitMoment).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'draft-private' }),
      'CHECKING_PRIVATE_READINESS',
    );
  });

  it('does not accept stale prekey readiness after a Station switch', async () => {
    let release!: (value: {
      state: 'READY_PRIVATE';
      draftId: string;
    }) => void;
    mocks.privateMoments.admitMoment.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    momentsRuntime.install();
    await flushRuntime();

    const pending = prepareRemotePrivateRecipient({
      draftId: 'draft-stale-prekey',
      draftRevision: 1,
      audience: { kind: 'FRIENDS' },
      momentKind: 'TEXT',
      text: 'private',
      files: [],
    });
    await vi.waitFor(() => {
      expect(mocks.privateMoments.admitMoment).toHaveBeenCalledTimes(1);
    });
    eventBus.publish(EVENT.STATION_ACTIVE_CHANGED, {
      stationPeerId: 'station-b',
      routeId: 'relay-b',
    });
    release({
      state: 'READY_PRIVATE',
      draftId: 'draft-stale-prekey',
    });

    await expect(pending).rejects.toBeInstanceOf(MomentsRuntimeScopeChangedError);
  });

  it('propagates an unavailable remote recipient without publishing', async () => {
    const unavailable = new Error('RECIPIENT_KEY_UNAVAILABLE');
    mocks.privateMoments.admitMoment.mockRejectedValueOnce(unavailable);
    momentsRuntime.install();
    await flushRuntime();

    await expect(prepareRemotePrivateRecipient({
      draftId: 'draft-unavailable',
      draftRevision: 1,
      audience: { kind: 'FRIENDS' },
      momentKind: 'TEXT',
      text: 'private',
      files: [],
    })).rejects.toBe(unavailable);
  });

  it('binds actor, session, and Station identity and owns periodic reconcile', async () => {
    momentsRuntime.install();
    await flushRuntime();

    expect(captureMomentsRuntimeScope()).toMatchObject({
      actorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationIdentity: 'peer:station-a',
    });
    expect(intervalCallbacks).toHaveLength(1);

    intervalCallbacks[0]();
    await flushRuntime();

    expect(mocks.moments.syncProjection).toHaveBeenCalledWith('periodic reconcile');
  });

  it('waits for a Home Station identity without failing runtime bootstrap', async () => {
    mocks.federationState = { self: {} };

    momentsRuntime.install();
    await flushRuntime();

    expect(captureMomentsRuntimeScope()).toMatchObject({
      actorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationIdentity: 'station:unresolved',
    });
  });

  it('keeps public projection active while private bootstrap retries', async () => {
    mocks.privateMoments.bootstrap.mockRejectedValueOnce(
      new Error('private trust unavailable'),
    );

    momentsRuntime.install();
    await flushRuntime();

    expect(mocks.moments.syncProjection).toHaveBeenCalledWith('bootstrap');
    expect(captureMomentsRuntimeScope()).toMatchObject({
      actorPtid: 'ptid:alice',
      stationIdentity: 'peer:station-a',
    });
    expect(mocks.privateComments.bootstrap).not.toHaveBeenCalled();
    expect(mocks.privateMoments.reconcile).not.toHaveBeenCalled();

    vi.clearAllMocks();
    intervalCallbacks[0]();
    await flushRuntime();

    expect(mocks.moments.syncProjection).toHaveBeenCalledWith(
      'periodic reconcile',
    );
    expect(mocks.privateMoments.bootstrap).toHaveBeenCalledOnce();
    expect(mocks.privateComments.bootstrap).toHaveBeenCalledOnce();
    expect(mocks.privateMoments.reconcile).toHaveBeenCalledOnce();
  });

  it('keeps private projection available when public verification or retained writes fail', async () => {
    feedMocks.resume.mockRejectedValueOnce(new Error('FEED_IDENTITY_REQUIRED'));
    mocks.moments.syncProjection.mockRejectedValueOnce(new Error('FEED_PROJECTION_TAMPERED'));
    await momentsRuntime.install();
    await flushRuntime();
    expect(mocks.moments.setPublicFeedRecoveryError).toHaveBeenCalledWith('Error: FEED_IDENTITY_REQUIRED');
    expect(mocks.privateMoments.bootstrap).toHaveBeenCalled();
    expect(mocks.privateMoments.reconcile).toHaveBeenCalled();
    intervalCallbacks[0]?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.moments.setPublicFeedRecoveryError).toHaveBeenLastCalledWith(null);
  });

  it('does not hide an authoritative sync failure during periodic resync', async () => {
    momentsRuntime.install();
    await flushRuntime();
    vi.clearAllMocks();
    mocks.moments.syncProjection.mockRejectedValueOnce(
      new Error('station projection unavailable'),
    );

    intervalCallbacks[0]();
    await vi.waitFor(() => {
      expect(mocks.moments.syncProjection).toHaveBeenCalledWith(
        'periodic reconcile',
      );
    });
    expect(mocks.privateMoments.reconcile).not.toHaveBeenCalled();
  });

  it('clears the prior projection immediately and serializes a Station switch', async () => {
    let releaseFirstRefresh!: () => void;
    mocks.moments.syncProjection
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        releaseFirstRefresh = resolve;
      }))
      .mockResolvedValue(undefined);

    momentsRuntime.install();
    await vi.waitFor(() => {
      expect(mocks.moments.syncProjection).toHaveBeenCalledTimes(1);
    });
    const resetsBeforeSwitch = mocks.moments.reset.mock.calls.length;

    eventBus.publish(EVENT.STATION_ACTIVE_CHANGED, {
      stationPeerId: 'station-b',
      routeId: 'direct-b',
    });

    expect(captureMomentsRuntimeScope()).toBeNull();
    expect(mocks.moments.reset.mock.calls.length).toBeGreaterThan(resetsBeforeSwitch);

    releaseFirstRefresh();
    await flushRuntime();

    expect(captureMomentsRuntimeScope()).toMatchObject({
      actorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationIdentity: 'peer:station-b',
    });
    expect(mocks.moments.syncProjection).toHaveBeenCalledTimes(2);
  });

  it('preserves the logical projection scope across a same-Station route switch', async () => {
    momentsRuntime.install();
    await flushRuntime();
    const before = captureMomentsRuntimeScope();
    const resetsBeforeSwitch = mocks.moments.reset.mock.calls.length;
    const syncsBeforeSwitch = mocks.moments.syncProjection.mock.calls.length;

    eventBus.publish(EVENT.STATION_ACTIVE_CHANGED, {
      stationPeerId: 'station-a',
      routeId: 'relay-a',
    });
    await flushRuntime();

    expect(captureMomentsRuntimeScope()).toEqual(before);
    expect(mocks.moments.reset).toHaveBeenCalledTimes(resetsBeforeSwitch);
    expect(mocks.moments.syncProjection).toHaveBeenCalledTimes(syncsBeforeSwitch);
  });

  it('clears projections on actor switch and logout', async () => {
    momentsRuntime.install();
    await flushRuntime();
    const previousGeneration = captureMomentsRuntimeScope()?.generation ?? 0;

    setSession({
      authenticated: true,
      currentUser: { actorPtid: 'ptid:bob' },
      sessionEpoch: 2,
    });
    await flushRuntime();

    expect(captureMomentsRuntimeScope()).toMatchObject({
      actorPtid: 'ptid:bob',
      sessionEpoch: 2,
      stationIdentity: 'peer:station-a',
    });

    setSession({
      authenticated: false,
      currentUser: null,
      sessionEpoch: 3,
    });
    await flushRuntime();

    expect(captureMomentsRuntimeScope()).toBeNull();
    expect(mocks.privateMoments.deactivate).toHaveBeenCalledWith(
      expect.any(Number),
    );
    expect(mocks.privateComments.deactivate).toHaveBeenCalledWith(
      expect.any(Number),
    );
    expect(mocks.moments.reset).toHaveBeenCalled();
    expect(mocks.discovery.reset).toHaveBeenCalled();
    expect(mocks.relationships.reset).not.toHaveBeenCalled();
    const calls = mocks.privateMoments.deactivate.mock.calls;
    expect(calls[calls.length - 1]?.[0]).toBeGreaterThan(previousGeneration);
  });
});
