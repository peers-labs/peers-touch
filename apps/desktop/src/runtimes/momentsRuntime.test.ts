import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface TestSessionState {
  authenticated: boolean;
  currentUser: { actorPtid: string } | null;
  sessionEpoch: number;
}

interface TestFederationState {
  self: { homeStationPeerId: string } | null;
}

const mocks = vi.hoisted(() => {
  const moments = {
    postsById: {},
    circles: [],
    circleMembers: {},
    syncProjection: vi.fn<() => Promise<void>>(),
    listMyCircles: vi.fn<() => Promise<void>>(),
    loadCircleMembers: vi.fn<() => Promise<void>>(),
    loadPost: vi.fn<() => Promise<undefined>>(),
    loadComments: vi.fn<() => Promise<void>>(),
    loadUserFeed: vi.fn<() => Promise<void>>(),
    reset: vi.fn(),
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
    purgeMoment: vi.fn<() => Promise<void>>(),
  };
  const privateComments = {
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
    loadFollowers: vi.fn<() => Promise<void>>(),
    loadFollowing: vi.fn<() => Promise<void>>(),
    reset: vi.fn(),
  };
  return {
    moments,
    privateMoments,
    privateComments,
    discovery,
    relationships,
    sessionState: {
      authenticated: true,
      currentUser: { actorPtid: 'ptid:alice' },
      sessionEpoch: 1,
    } as TestSessionState,
    federationState: {
      self: { homeStationPeerId: 'station-a' },
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

vi.mock('../utils/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  captureMomentsRuntimeScope,
  MomentsRuntimeScopeChangedError,
  momentsRuntime,
  preparePrivateAudience,
  prepareRemotePrivateRecipient,
} from './momentsRuntime';
import { EVENT, eventBus } from '../kernel/events';

let intervalCallbacks: Array<() => void>;

function setSession(next: typeof mocks.sessionState): void {
  const previous = mocks.sessionState;
  mocks.sessionState = next;
  mocks.sessionListener?.(next, previous);
}

async function flushRuntime(): Promise<void> {
  await momentsRuntime.bootstrap(null);
}

beforeEach(() => {
  momentsRuntime.teardown();
  vi.clearAllMocks();
  intervalCallbacks = [];
  const target = Object.assign(new EventTarget(), {
    setInterval: vi.fn((callback: () => void) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    }),
    clearInterval: vi.fn(),
  });
  vi.stubGlobal('window', target);
  mocks.sessionState = {
    authenticated: true,
    currentUser: { actorPtid: 'ptid:alice' },
    sessionEpoch: 1,
  };
  mocks.federationState = {
    self: { homeStationPeerId: 'station-a' },
  };
  mocks.moments.postsById = {};
  mocks.moments.circles = [];
  mocks.moments.circleMembers = {};
  mocks.privateMoments.postsById = {};
  mocks.moments.syncProjection.mockResolvedValue(undefined);
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
  mocks.privateMoments.purgeMoment.mockResolvedValue(undefined);
  mocks.privateComments.bootstrap.mockResolvedValue(undefined);
  mocks.privateComments.reconcile.mockResolvedValue(undefined);
  mocks.privateComments.loadComments.mockResolvedValue(undefined);
  mocks.discovery.loadMe.mockResolvedValue(undefined);
  mocks.discovery.loadUserProfile.mockResolvedValue(undefined);
  mocks.relationships.loadRelationship.mockResolvedValue(undefined);
  mocks.relationships.loadFollowers.mockResolvedValue(undefined);
  mocks.relationships.loadFollowing.mockResolvedValue(undefined);
});

afterEach(() => {
  momentsRuntime.teardown();
  vi.unstubAllGlobals();
});

describe('momentsRuntime identity fence', () => {
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
      expect(mocks.moments.syncProjection).toHaveBeenCalledWith(
        'event:moment.created',
      );
    });

    eventBus.publish(EVENT.MOMENT_CREATED, wake);
    await Promise.resolve();
    expect(mocks.privateMoments.readMoment).toHaveBeenCalledTimes(1);
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
      stationUrl: 'https://station-b.invalid/',
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
      stationUrl: 'https://station-b.invalid/',
    });

    expect(captureMomentsRuntimeScope()).toBeNull();
    expect(mocks.moments.reset.mock.calls.length).toBeGreaterThan(resetsBeforeSwitch);

    releaseFirstRefresh();
    await flushRuntime();

    expect(captureMomentsRuntimeScope()).toMatchObject({
      actorPtid: 'ptid:alice',
      sessionEpoch: 1,
      stationIdentity: 'url:https://station-b.invalid',
    });
    expect(mocks.moments.syncProjection).toHaveBeenCalledTimes(2);
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
