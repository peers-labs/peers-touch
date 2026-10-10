import { beforeEach, describe, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => ({
  active: {
    stationPeerId: 'station-a',
    actorPtid: 'ptid:alice',
    sessionId: 'session-a',
  },
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: ports.invoke }));
vi.mock('../runtimes/sessionRuntime', () => ({
  assertSessionReadAdmission: () => ports.active,
  assertSessionWriteAdmission: () => ports.active,
  runAfterAuthenticated401: (request: () => Promise<unknown>) => request(),
}));

import { executeSocialNativeOperation } from './socialNativeAdapter';

const session = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

describe('Social Native adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ports.invoke.mockResolvedValue({
      status: 200,
      contentType: 'application/json',
      bodyBytes: [],
    });
  });

  it('dispatches typed Social operations without Web credentials or Station URLs', async () => {
    await executeSocialNativeOperation(session, {
      operationId: 'moments_timeline',
      timeline_type: 0,
      limit: 20,
    });

    expect(ports.invoke).toHaveBeenCalledWith('social_adapter_execute', {
      input: {
        requestId: expect.any(String),
        stationPeerId: 'station-a',
        actorPtid: 'ptid:alice',
        sessionId: 'session-a',
        operation: {
          operationId: 'moments_timeline',
          timeline_type: 0,
          limit: 20,
        },
      },
    });
    expect(JSON.stringify(ports.invoke.mock.calls[0])).not.toMatch(
      /Authorization|Bearer|accessToken|refreshToken|stationOrigin|https?:\/\//,
    );
  });
});
