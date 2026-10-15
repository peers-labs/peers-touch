import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({
  launchState: 'station-selection',
  listeners: new Set<() => void>(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  cancelAccess: vi.fn(async () => true),
  startAccess: vi.fn(),
  verifyIdentity: vi.fn(),
  replaceRegistry: vi.fn(),
  transitionScope: vi.fn(async (_reason, transition) => { await transition(); }),
  reconcile: vi.fn(async () => undefined),
  reliability: { active: false, draftCount: 0, stationPeerId: 'station', actorPtid: 'alice', runtimeGeneration: 1 },
  prepareScope: vi.fn(),
  openAdmission: vi.fn(async () => undefined),
}));
const station = { stationPeerId: 'station', url: 'https://station.invalid', label: 'Station', identityVerified: true };
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
  probeStation: async () => ({ online: true, checkedAt: 1 }),
  verifyStationIdentity: owner.verifyIdentity,
}));
vi.mock('./stationRuntime', () => ({
  readStationRegistryProjection: async () => registry,
  replaceStationRegistryProjection: owner.replaceRegistry,
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
  owner.verifyIdentity.mockResolvedValue({ stationPeerId: 'station' });
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
    owner.verifyIdentity.mockResolvedValue({ stationPeerId: 'replacement' });
    const runtime = createMobileEntryRuntime();
    const operation = runtime.actions.continueStation();
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
