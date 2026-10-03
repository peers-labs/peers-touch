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
  momentsRuntime,
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
    expect(mocks.relationships.reset).toHaveBeenCalled();
    const calls = mocks.privateMoments.deactivate.mock.calls;
    expect(calls[calls.length - 1]?.[0]).toBeGreaterThan(previousGeneration);
  });
});
