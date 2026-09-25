// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, describe, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => ({
  listener: null as ((event: { payload: unknown }) => void) | null,
  start: vi.fn(async () => ({ streamId: 7 })),
  stop: vi.fn(async () => undefined),
  unlisten: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (
    _name: string,
    listener: (event: { payload: unknown }) => void,
  ) => {
    ports.listener = listener;
    return ports.unlisten;
  }),
}));
vi.mock('../../services/stationTransport', () => ({
  MOBILE_STATION_REALTIME_EVENT: 'mobile:station-realtime',
  startStationRealtime: ports.start,
  stopStationRealtime: ports.stop,
}));

import { startRealtimeStream } from './socialRealtime';

const session = {
  stationPeerId: 'station-primary',
  stationUrl: 'https://station.example/',
  sessionId: 'session-1',
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

describe('social realtime stream', () => {
  afterEach(() => {
    ports.listener = null;
    vi.clearAllMocks();
  });

  it('resumes the single Station stream from the runtime-owned cursor', async () => {
    const onConnected = vi.fn();
    const onEvent = vi.fn();

    const stream = startRealtimeStream(
      session,
      new AbortController().signal,
      {
        onConnected,
        onEvent,
      },
      'event-42',
    );
    await vi.waitFor(() => expect(ports.start).toHaveBeenCalledOnce());
    ports.listener?.({
      payload: {
        streamId: 7,
        kind: 'connected',
        chunkBytes: [],
      },
    });
    ports.listener?.({
      payload: {
        streamId: 7,
        kind: 'chunk',
        chunkBytes: Array.from(new TextEncoder().encode(
          'id: event-43\nevent: presence.updated\ndata: {"ptid":"ptid:bob"}\n\n',
        )),
      },
    });
    ports.listener?.({
      payload: {
        streamId: 7,
        kind: 'closed',
        chunkBytes: [],
      },
    });
    await stream;

    expect(ports.start).toHaveBeenCalledWith(
      session,
      'event-42',
      expect.any(AbortSignal),
    );
    expect(onConnected).toHaveBeenCalledWith('event-42');
    expect(onEvent).toHaveBeenCalledOnce();
    expect(ports.stop).toHaveBeenCalledWith(7);
    expect(ports.unlisten).toHaveBeenCalledOnce();
  });
});
