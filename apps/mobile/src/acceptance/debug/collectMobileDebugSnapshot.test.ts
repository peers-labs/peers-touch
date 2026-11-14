import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
  stationRoute: vi.fn(),
  messaging: vi.fn(),
  privateStatus: vi.fn(),
  privateMomentsSnapshot: vi.fn(),
}));

vi.mock('../../services/mobileCommands', () => ({
  readStationRouteBinding: commandMocks.stationRoute,
  messagingStatus: commandMocks.messaging,
  privateSocialStatus: commandMocks.privateStatus,
}));

vi.mock('../../runtimes/privateMomentsRuntime', () => ({
  readPrivateMomentsSnapshot: commandMocks.privateMomentsSnapshot,
}));

import { collectMobileDebugSnapshot } from './collectMobileDebugSnapshot';

function privateMomentsSource(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    reconciling: false,
    stationPeerId: 'station-1',
    actorPtid: 'ptid-1',
    deviceId: 'device-1',
    lifecycleGeneration: '7',
    activationGeneration: 3,
    projections: [{ id: 'p1' }, { id: 'p2' }],
    postsById: { a: {}, b: {}, c: {} },
    comments: [{}],
    lastReport: {
      endpointPrekeysAvailable: 12,
      recoveryPrekeysAvailable: 4,
      submissionsProcessed: 2,
      submissionsUnknown: 0,
      submissionsTerminal: 1,
    },
    errorMessage: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  commandMocks.stationRoute.mockResolvedValue({
    stationPeerId: 'station-1',
    routeId: 'route-1',
    routeType: 'direct',
    endpointOrigin: 'https://station.example',
    routeGeneration: 1,
    routeRevision: 2,
    transportOrigin: 'https://station.example',
  });
  commandMocks.messaging.mockResolvedValue({
    active: true,
    deviceEnrolled: true,
    laneSequence: 1,
    consumerEpoch: 0,
    conversationCount: 4,
    activationGeneration: 3,
    workerPhase: 'running',
  });
  commandMocks.privateStatus.mockResolvedValue({
    active: true,
    activationGeneration: 3,
    reconciliationMode: 'on_demand',
  });
  commandMocks.privateMomentsSnapshot.mockReturnValue(privateMomentsSource());
});

describe('collectMobileDebugSnapshot', () => {
  it('projects every runtime section with projected counts', async () => {
    const snapshot = await collectMobileDebugSnapshot();

    expect(snapshot.stationRoute.status).toBe('ok');
    expect(snapshot.stationRoute.data).toMatchObject({ stationPeerId: 'station-1' });
    expect(snapshot.messaging.status).toBe('ok');
    expect(snapshot.messaging.data).toMatchObject({ conversationCount: 4 });
    expect(snapshot.privateSocial.status).toBe('ok');
    expect(snapshot.privateMoments.data).toMatchObject({
      publishCount: 2,
      readCount: 3,
      commentCount: 1,
      activationGeneration: 3,
    });
    expect(snapshot.privateMoments.data?.lastReport).toMatchObject({
      endpointPrekeysAvailable: 12,
      recoveryPrekeysAvailable: 4,
      submissionsTerminal: 1,
    });
    expect(typeof snapshot.capturedAtMillis).toBe('number');
  });

  it('marks a null station binding empty and isolates per-section failures', async () => {
    commandMocks.stationRoute.mockResolvedValue(null);
    commandMocks.messaging.mockRejectedValue(new Error('messaging.unavailable'));
    commandMocks.privateStatus.mockRejectedValue(new Error('private.status.failed'));

    const snapshot = await collectMobileDebugSnapshot();

    expect(snapshot.stationRoute.status).toBe('empty');
    expect(snapshot.stationRoute.data).toBeNull();
    expect(snapshot.messaging.status).toBe('error');
    expect(snapshot.messaging.error).toBe('messaging.unavailable');
    expect(snapshot.privateSocial.status).toBe('error');
    expect(snapshot.privateSocial.error).toBe('private.status.failed');
    expect(snapshot.privateMoments.status).toBe('ok');
  });
});
