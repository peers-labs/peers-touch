import { beforeEach, describe, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => ({
  active: {
    stationPeerId: 'station-a',
    actorPtid: 'ptid:alice',
    sessionId: 'session-a',
    deviceId: 'device-a',
    lifecycleGeneration: 1,
  },
  invoke: vi.fn(),
  readAdmission: vi.fn(),
  refresh: vi.fn(),
  writeAdmission: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: ports.invoke }));
vi.mock('../runtimes/sessionRuntime', () => ({
  assertSessionReadAdmission: () => {
    ports.readAdmission();
    return ports.active;
  },
  assertSessionWriteAdmission: () => {
    ports.writeAdmission();
    return ports.active;
  },
  runAfterAuthenticated401: async (
    request: () => Promise<unknown>,
    isAuthenticated401: (error: unknown) => boolean,
    _admission: 'read' | 'write',
  ) => {
    try {
      return await request();
    } catch (error) {
      if (!isAuthenticated401(error)) throw error;
      ports.refresh();
      return request();
    }
  },
}));

import {
  executeStationOperation,
  responseJson,
} from './stationTransport';

const session = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

describe('Rust-owned Station transport bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ports.active.stationPeerId = 'station-a';
    ports.active.actorPtid = 'ptid:alice';
    ports.active.sessionId = 'session-a';
    ports.active.deviceId = 'device-a';
    ports.active.lifecycleGeneration = 1;
  });

  it('sends only the fixed operation and public session scope to Rust', async () => {
    ports.invoke.mockResolvedValue({
      status: 200,
      contentType: 'application/json',
      bodyBytes: Array.from(new TextEncoder().encode('{"data":{"ok":true}}')),
    });

    const response = await executeStationOperation(session, {
      operationId: 'actor_profile_get',
    });

    expect(responseJson(response)).toEqual({ data: { ok: true } });
    expect(ports.invoke).toHaveBeenCalledWith('station_transport_execute', {
      input: {
        requestId: expect.any(String),
        stationPeerId: 'station-a',
        actorPtid: 'ptid:alice',
        sessionId: 'session-a',
        operation: { operationId: 'actor_profile_get' },
      },
    });
    expect(JSON.stringify(ports.invoke.mock.calls[0])).not.toMatch(
      /Authorization|Bearer|accessToken|refreshToken|stationOrigin|https?:\/\//,
    );
    expect(ports.readAdmission).toHaveBeenCalledOnce();
    expect(ports.writeAdmission).not.toHaveBeenCalled();
  });

  it('refreshes once after an authenticated 401 and retries with the new session', async () => {
    ports.invoke
      .mockResolvedValueOnce({
        status: 401,
        contentType: 'application/json',
        bodyBytes: [],
      })
      .mockImplementationOnce(async () => ({
        status: 200,
        contentType: 'application/json',
        bodyBytes: [],
      }));
    ports.refresh.mockImplementation(() => {
      ports.active.sessionId = 'session-b';
    });

    await expect(executeStationOperation(session, {
      operationId: 'notification_unread_counts',
    })).resolves.toMatchObject({ status: 200 });

    expect(ports.refresh).toHaveBeenCalledOnce();
    expect(ports.invoke.mock.calls[1][1]).toMatchObject({
      input: {
        requestId: expect.any(String),
        sessionId: 'session-b',
      },
    });
  });

  it('keeps mutation admission closed independently from authenticated reads', async () => {
    ports.invoke.mockResolvedValue({
      status: 200,
      contentType: 'application/json',
      bodyBytes: [],
    });

    await executeStationOperation(session, {
      operationId: 'presence_heartbeat',
      reason: 'foreground',
    });

    expect(ports.writeAdmission).toHaveBeenCalledOnce();
    expect(ports.readAdmission).not.toHaveBeenCalled();
  });

  it('rejects a stale Web scope before invoking Rust', async () => {
    await expect(executeStationOperation(
      { ...session, actorRef: { ptid: 'ptid:bob' } },
      { operationId: 'actor_profile_get' },
    )).rejects.toThrow('mobile.stationTransport.sessionScopeMismatch');
    expect(ports.invoke).not.toHaveBeenCalled();
  });

  it('fences an already-cancelled operation before invoking Rust', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(executeStationOperation(
      session,
      { operationId: 'actor_profile_get' },
      controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(ports.invoke).not.toHaveBeenCalled();
  });

  it('cancels an in-flight native request when the AbortSignal fires', async () => {
    const controller = new AbortController();
    let rejectExecute!: (error: Error) => void;
    ports.invoke.mockImplementation((command: string) => {
      if (command === 'station_transport_execute') {
        return new Promise((_resolve, reject) => {
          rejectExecute = reject;
        });
      }
      if (command === 'station_transport_cancel') {
        rejectExecute(new Error('mobile.stationTransport.cancelled.request'));
        return Promise.resolve();
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const request = executeStationOperation(
      session,
      { operationId: 'actor_profile_get' },
      controller.signal,
    );
    await vi.waitFor(() => expect(ports.invoke).toHaveBeenCalledOnce());
    const requestId = ports.invoke.mock.calls[0]?.[1]?.input?.requestId;
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(ports.invoke).toHaveBeenNthCalledWith(2, 'station_transport_cancel', {
      input: { requestId },
    });
  });
});
