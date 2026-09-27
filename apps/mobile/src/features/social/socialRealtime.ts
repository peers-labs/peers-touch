import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { MobileAuthSession } from '../auth/authSession';
import {
  MOBILE_STATION_REALTIME_EVENT,
  startStationRealtime,
  stopStationRealtime,
  type StationRealtimeEvent,
} from '../../services/stationTransport';
import {
  decodeRealtimeSseChunk,
  type RealtimeWireEvent,
} from './socialWire';

export interface RealtimeHandlers {
  readonly onConnected?: (cursor: string) => void;
  readonly onEvent: (event: RealtimeWireEvent) => void;
}

export async function startRealtimeStream(
  session: MobileAuthSession,
  signal: AbortSignal,
  handlers: RealtimeHandlers,
  resumeCursor = '',
) {
  if (signal.aborted) return;
  const decoder = new TextDecoder();
  let resolveCompletion!: () => void;
  let rejectCompletion!: (error: Error) => void;
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const pending: StationRealtimeEvent[] = [];
  let streamId: number | null = null;
  let buffer = '';
  let unlisten: UnlistenFn | null = null;
  let settled = false;

  const consume = (event: StationRealtimeEvent) => {
    if (streamId === null) {
      pending.push(event);
      return;
    }
    if (event.streamId !== streamId || settled) return;
    if (event.kind === 'connected') {
      handlers.onConnected?.(resumeCursor);
      return;
    }
    if (event.kind === 'error') {
      settled = true;
      rejectCompletion(new Error('mobile.social.realtimeUnavailable'));
      return;
    }
    if (event.kind === 'closed') {
      settled = true;
      resolveCompletion();
      return;
    }
    buffer += decoder.decode(Uint8Array.from(event.chunkBytes), { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    chunks.forEach((chunk) => {
      decodeRealtimeSseChunk(chunk).forEach(handlers.onEvent);
    });
  };

  const finish = () => {
    if (settled) return;
    settled = true;
    resolveCompletion();
  };
  signal.addEventListener('abort', finish, { once: true });
  try {
    unlisten = await listen<StationRealtimeEvent>(
      MOBILE_STATION_REALTIME_EVENT,
      (event) => consume(event.payload),
    );
    if (signal.aborted) return;
    const handle = await startStationRealtime(session, resumeCursor, signal);
    streamId = handle.streamId;
    pending.splice(0).forEach(consume);
    if (signal.aborted) finish();
    await completion;
  } catch (error) {
    if (!settled) {
      settled = true;
      throw error instanceof Error
        ? error
        : new Error('mobile.social.realtimeUnavailable');
    }
  } finally {
    signal.removeEventListener('abort', finish);
    unlisten?.();
    if (streamId !== null) await stopStationRealtime(streamId).catch(() => undefined);
  }
}
