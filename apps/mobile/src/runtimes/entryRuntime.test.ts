import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({
  launchState: 'station-selection',
  listeners: new Set<() => void>(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  cancelAccess: vi.fn(async () => true),
  startAccess: vi.fn(),
  verifyIdentity: vi.fn(),
  discoverStation: vi.fn(),
  activateRoute: vi.fn(),
  removeRouteBinding: vi.fn(async () => undefined),
  replaceRegistry: vi.fn(),
  transitionScope: vi.fn(async (_reason, transition) => { await transition(); }),
  reconcile: vi.fn(async () => undefined),
  reliability: { active: false, draftCount: 0, stationPeerId: 'station', actorPtid: 'alice', runtimeGeneration: 1 },
  prepareScope: vi.fn(),
  openAdmission: vi.fn(async () => undefined),
}));
const route = {
  nodePeerId: 'station-node',
  nodeAuthorizationDigest: Array(32).fill(2),
  authorizationEpoch: 1,
  routeId: 'station-direct',
  routeType: 'direct' as const,
  transport: 'direct_https' as const,
  endpointOrigin: 'https://station.invalid',
  routeGeneration: 1,
  addresses: ['/dns4/station.invalid/tcp/443/tls/http'],
  sourceRef: 'entry-runtime-test',
  lastVerifiedAt: 1,
  health: 'available' as const,
};
const station = {
  stationPeerId: 'station',
  url: 'https://station.invalid',
  label: 'Station',
  createdAt: 1,
  lastUsedAt: 1,
  identityVerified: true,
  pinnedStationRootPublicKey: [1],
  routes: [route],
  activeRouteId: route.routeId,
  routeRevision: 1,
  lifecycleGeneration: 1,
};
const registry = { activeStationPeerId: 'station', entries: [station] };

vi.mock('../app/lifecycle/MobileLifecycleKernel', () => ({
  getMobileLifecycleKernel: () => ({
    getState: () => ({ launchState: owner.launchState }),
    transitionLaunchState: (state: string) => { owner.launchState = state; },
    transitionScope: owner.transitionScope,
    reconcileLaunchState: owner.reconcile,
    subscribe: (listener: () => void) => {
      owner.listeners.add(listener);
      return () => owner.listeners.delete(listener);
    },
  }),
}));
vi.mock('../features/auth/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      setLoading: owner.setLoading, setError: owner.setError,
      setAccessDecision: vi.fn(), session: null, accessDecision: null,
    }),
  },
}));
vi.mock('../features/auth/authSession', () => ({
  currentAccessGate: vi.fn(), isAccessGranted: () => false,
  loadRememberedLoginAccounts: async () => [], rememberLoginAccount: vi.fn(),
  submitStationLoginGate: vi.fn(), submitStationInviteCodeGate: vi.fn(), submitStationSchemaGate: vi.fn(),
}));
vi.mock('../features/station/stationConnection', () => ({
  activateAndVerifyStationRoute: owner.activateRoute,
  discoverStationConnection: owner.discoverStation,
  verifyBoundStationRoute: owner.verifyIdentity,
}));
vi.mock('../services/mobileCommands', () => ({
  removeStationRouteBinding: owner.removeRouteBinding,
}));
vi.mock('./stationRuntime', () => ({
  readStationRegistryProjection: async () => registry,
  replaceStationRegistryProjection: owner.replaceRegistry,
  selectStationRouteRuntime: vi.fn(async () => registry),
  subscribeStationRegistryProjection: () => () => undefined,
  updateStationRegistryProjection: async () => registry,
}));
vi.mock('./accessRuntime', () => ({
  applyAccessGateRuntimeResult: vi.fn(), cancelAccessAttemptForActiveStation: owner.cancelAccess,
  refreshAccessDecisionForActiveStation: vi.fn(), startAccessAttemptForActiveStation: owner.startAccess,
}));
vi.mock('./sessionRuntime', () => ({
  logoutSessionRuntime: async () => undefined, activateNativeSessionRuntime: vi.fn(),
}));
vi.mock('./commandRuntime', () => ({
  notifyReliabilityCommandChanged: vi.fn(),
  openReliabilityAdmission: owner.openAdmission,
  readReliabilityRuntimeStatus: async () => owner.reliability,
  prepareReliabilityScopeExit: owner.prepareScope,
}));
vi.mock('./recoveryProjection', () => ({
  getRecoveryProjection: () => ({
    clearSessionMismatch: vi.fn(), reportSessionMismatch: vi.fn(),
  }),
}));

import { createMobileEntryRuntime } from './entryRuntime';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  owner.launchState = 'station-selection';
  owner.listeners.clear();
  owner.reliability = {
    active: false, draftCount: 0, stationPeerId: 'station', actorPtid: 'alice', runtimeGeneration: 1,
  };
  owner.prepareScope.mockImplementation(async () => owner.reliability);
  owner.verifyIdentity.mockResolvedValue({
    stationPeerId: 'station',
    verifiedAt: 1,
  });
  owner.discoverStation.mockResolvedValue({ routes: [] });
  owner.activateRoute.mockReset();
  owner.startAccess.mockResolvedValue({ attemptId: 'attempt', state: 'pending', gates: [] });
});

describe('Entry Runtime decisions and late results', () => {
  it('cancels a late access attempt and never reopens the gate after Back', async () => {
    const access = deferred<unknown>();
    owner.startAccess.mockReturnValue(access.promise);
    const runtime = createMobileEntryRuntime();
    const operation = runtime.actions.continueStation();
    await vi.waitFor(() => expect(owner.startAccess).toHaveBeenCalledOnce());
    runtime.actions.showStationSelection();
    access.resolve({ attemptId: 'attempt', state: 'pending', gates: [] });
    await operation;
    expect(owner.launchState).toBe('station-selection');
    expect(owner.reconcile).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().stationChecking).toBe(false);
    expect(owner.setLoading).toHaveBeenLastCalledWith(false);
  });

  it('leaves a saved identity unchanged when replacement is cancelled', async () => {
    const replacementRoute = {
      ...route,
      stationPeerId: 'replacement',
      stationRootPublicKey: [3],
      nodePeerId: 'replacement-node',
      routeId: 'replacement-direct',
    };
    owner.discoverStation.mockResolvedValue({ routes: [replacementRoute] });
    owner.activateRoute.mockResolvedValue({
      stationPeerId: 'replacement',
      canonicalOrigin: station.url,
      verifiedAt: 2,
      route: replacementRoute,
    });
    const runtime = createMobileEntryRuntime();
    const operation = runtime.actions.addStation(station.url);
    await vi.waitFor(() => expect(runtime.getSnapshot().pendingIdentityReplacement).toEqual(station));
    expect(owner.replaceRegistry).not.toHaveBeenCalled();
    runtime.actions.resolveStationIdentityReplacement(false);
    await operation;
    expect(owner.replaceRegistry).not.toHaveBeenCalled();
    expect(owner.startAccess).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().stationChecking).toBe(false);
  });

  it('preserves the active account and reopens admission when draft exit is cancelled', async () => {
    owner.reliability = { ...owner.reliability, active: true, draftCount: 1 };
    const runtime = createMobileEntryRuntime();
    const operation = runtime.actions.logout();
    await vi.waitFor(() => expect(runtime.getSnapshot().pendingScopeExit?.draftCount).toBe(1));
    expect(owner.transitionScope).not.toHaveBeenCalled();
    await runtime.getSnapshot().pendingScopeExit!.cancel();
    await operation;
    expect(owner.openAdmission).toHaveBeenCalledWith('station', 'alice', 1);
    expect(owner.transitionScope).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().pendingScopeExit).toBeNull();
  });

  it('executes a decision-free exit without displaying an empty draft dialog', async () => {
    owner.reliability = { ...owner.reliability, active: true };
    const runtime = createMobileEntryRuntime();
    await runtime.actions.logout();
    expect(owner.transitionScope).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot().pendingScopeExit).toBeNull();
  });
});
