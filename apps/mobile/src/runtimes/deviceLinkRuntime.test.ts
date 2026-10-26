import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceLinkState } from '../gen/proto/domain/auth/device_link_pb';
import type { DeviceLinkProjection } from '../services/deviceLink';
import { useDeviceLinkStore } from '../features/auth/deviceLinkStore';
import type { StoredStationRegistry } from '../features/station/stationRegistry';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  scan: vi.fn(),
  cancel: vi.fn(),
  submit: vi.fn(),
  update: vi.fn(),
  activate: vi.fn(),
  decision: vi.fn(),
  access: vi.fn(),
  reconcile: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock('../services/deviceLink', () => ({
  readDeviceLink: mocks.read,
  scanDeviceLink: mocks.scan,
  cancelDeviceLink: mocks.cancel,
  submitDeviceLink: mocks.submit,
}));
vi.mock('./stationRuntime', () => ({ updateStationRegistryProjection: mocks.update }));
vi.mock('./sessionRuntime', () => ({ activateNativeSessionRuntime: mocks.activate }));
vi.mock('../features/auth/authSession', async (original) => ({
  ...await original<typeof import('../features/auth/authSession')>(),
  startStationAccessAttempt: mocks.access,
}));
vi.mock('./accessRuntime', () => ({
  applyAccessGateRuntimeResult: mocks.decision,
  sanitizeAccessDecision: (decision: unknown) => decision,
}));
vi.mock('../app/lifecycle/MobileLifecycleKernel', () => ({
  getMobileLifecycleKernel: () => ({
    getState: () => ({ phase: 'ACTIVE' }),
    reconcileLaunchState: mocks.reconcile,
  }),
}));

import {
  cancelMobileDeviceLink,
  createDeviceLinkRuntimeDescriptor,
  hasPendingDeviceLink,
  refreshMobileDeviceLink,
  startMobileDeviceLink,
} from './deviceLinkRuntime';

const idle: DeviceLinkProjection = {
  phase: 'idle', state: 0, stationPeerId: '', stationOrigin: '', actorPtid: '',
  actorLabel: '', deviceId: '', comparisonCode: '', expiresAtUnixMs: 0,
  revision: 0, accessDecision: null, session: null, route: null, routeRevision: 0,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Mobile Device Link lifecycle fences', () => {
  let runtime: ReturnType<typeof createDeviceLinkRuntimeDescriptor>;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.read.mockResolvedValue(idle);
    mocks.cancel.mockResolvedValue(idle);
    mocks.activate.mockResolvedValue({});
    mocks.access.mockResolvedValue({ state: 3, attemptId: 'session-access', gates: [] });
    mocks.update.mockImplementation(async (update: (registry: StoredStationRegistry) => StoredStationRegistry) =>
      update({ activeStationPeerId: '', entries: [] }));
    mocks.reconcile.mockResolvedValue(undefined);
    runtime = createDeviceLinkRuntimeDescriptor();
    await runtime.bootstrap({} as never);
  });
  afterEach(async () => {
    await runtime.teardown({ reason: 'app-unmount' });
    vi.useRealTimers();
  });

  it('does not promote a claim or an Access grant before credential acknowledgement', async () => {
    mocks.scan.mockResolvedValue({
      ...idle, phase: 'linking', state: DeviceLinkState.CLAIMS_PENDING,
      comparisonCode: '123 456', stationPeerId: 'station', actorPtid: 'actor',
      accessDecision: { state: 3, attemptId: 'claim-access', gates: [] },
    });
    await startMobileDeviceLink();
    expect(hasPendingDeviceLink()).toBe(true);
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('cancels the native camera immediately and drops a late scan result', async () => {
    const scan = deferred<DeviceLinkProjection>();
    mocks.scan.mockReturnValue(scan.promise);
    const scanning = startMobileDeviceLink();
    const cancelled = cancelMobileDeviceLink();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    scan.resolve({ ...idle, phase: 'linking', state: DeviceLinkState.CLAIMS_PENDING });
    await Promise.all([scanning, cancelled]);
    expect(useDeviceLinkStore.getState().phase).toBe('idle');
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('coalesces cancellation while the native cancel readback is pending', async () => {
    const cancel = deferred<DeviceLinkProjection>();
    mocks.cancel.mockReturnValue(cancel.promise);
    const first = cancelMobileDeviceLink();
    const second = cancelMobileDeviceLink();
    expect(first).toBe(second);
    expect(mocks.cancel).toHaveBeenCalledOnce();
    cancel.resolve(idle);
    await first;
  });

  it('does not publish an old result across background suspension', async () => {
    const scan = deferred<DeviceLinkProjection>();
    mocks.scan.mockReturnValue(scan.promise);
    const scanning = startMobileDeviceLink();
    await runtime.suspend();
    scan.resolve({ ...idle, phase: 'linking', state: DeviceLinkState.CLAIMS_PENDING });
    await scanning;
    expect(useDeviceLinkStore.getState().projection).toBeNull();
    await runtime.resume({} as never);
    expect(useDeviceLinkStore.getState().phase).toBe('idle');
  });

  it('rejects a committed credential for a different installation before Station adoption', async () => {
    mocks.read.mockResolvedValue({
      ...idle, phase: 'committed', state: DeviceLinkState.COMMITTED,
      stationPeerId: 'station', actorPtid: 'actor', deviceId: 'installation-A',
      session: { stationPeerId: 'station', actorPtid: 'actor', deviceId: 'installation-B' },
      route: { stationPeerId: 'station' }, routeRevision: 1,
    });
    await refreshMobileDeviceLink();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('retains a denied result for recovery without issuing background retries', async () => {
    mocks.scan.mockResolvedValue({ ...idle, phase: 'linking', state: DeviceLinkState.DENIED });
    await startMobileDeviceLink();
    expect(useDeviceLinkStore.getState().errorKey).toBe('mobile.deviceLink.ended');
    expect(hasPendingDeviceLink()).toBe(false);
    const reads = mocks.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.read).toHaveBeenCalledTimes(reads);
  });

  it('adopts the acknowledged route through the original Session owner without blocking kernel teardown', async () => {
    const reconcile = deferred<void>();
    mocks.reconcile.mockReturnValue(reconcile.promise);
    mocks.scan.mockResolvedValue({
      ...idle, phase: 'committed', state: DeviceLinkState.COMMITTED,
      stationPeerId: 'station', stationOrigin: 'https://station.example',
      actorPtid: 'actor', deviceId: 'installation', routeRevision: 7,
      accessDecision: null,
      session: {
        stationPeerId: 'station', actorPtid: 'actor', deviceId: 'installation',
        sessionId: 'acknowledged', lifecycleGeneration: 2,
      },
      route: {
        stationPeerId: 'station', stationRootPublicKey: [1, 2], nodePeerId: 'node',
        nodeAuthorizationDigest: Array(32).fill(1), authorizationEpoch: 1,
        routeId: 'route', routeType: 'direct', transport: 'libp2p_http_v1',
        endpointOrigin: 'https://station.example', routeGeneration: 1,
        innerTlsSpkiSha256: Array(32).fill(2), addresses: ['/ip4/192.0.2.1/tcp/443'],
        sourceRef: 'dedicated',
      },
    });
    await startMobileDeviceLink();
    expect(mocks.activate).toHaveBeenCalledOnce();
    expect(mocks.access).toHaveBeenCalledWith('station', 'https://station.example', 'acknowledged');
    expect(mocks.activate.mock.calls[0][0].routeRevision).toBe(7);
    expect(mocks.decision).toHaveBeenCalledOnce();
    expect(useDeviceLinkStore.getState().phase).toBe('committed');
    // The unresolved kernel queue must not be part of this owner's drain.
    await runtime.teardown({ reason: 'station-replace' });
    reconcile.resolve(undefined);
  });

  it('keeps a committed Session behind a newly required Access gate', async () => {
    mocks.access.mockResolvedValue({ state: 2, attemptId: 'current-policy', gates: [] });
    mocks.read.mockResolvedValue({
      ...idle, phase: 'committed', state: DeviceLinkState.COMMITTED,
      stationPeerId: 'station', stationOrigin: 'https://station.example',
      actorPtid: 'actor', deviceId: 'installation', routeRevision: 7,
      session: {
        stationPeerId: 'station', actorPtid: 'actor', deviceId: 'installation',
        sessionId: 'acknowledged', lifecycleGeneration: 2,
      },
      route: {
        stationPeerId: 'station', stationRootPublicKey: [1, 2], nodePeerId: 'node',
        nodeAuthorizationDigest: Array(32).fill(1), authorizationEpoch: 1,
        routeId: 'route', routeType: 'direct', transport: 'libp2p_http_v1',
        endpointOrigin: 'https://station.example', routeGeneration: 1,
        innerTlsSpkiSha256: Array(32).fill(2), addresses: ['/ip4/192.0.2.1/tcp/443'],
        sourceRef: 'dedicated',
      },
    });
    await refreshMobileDeviceLink();
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.decision).toHaveBeenCalledWith({ state: 2, attemptId: 'current-policy', gates: [] });
    expect(mocks.reconcile).toHaveBeenCalledWith('reliability-recovery');
    expect(hasPendingDeviceLink()).toBe(false);
  });
});
