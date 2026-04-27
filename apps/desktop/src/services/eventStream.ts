/**
 * Frontend bridge for the unified realtime event stream.
 *
 * Counterpart to `src-tauri/src/infrastructure/event_stream`. The Rust
 * supervisor owns the SSE socket, decodes / persists the cursor, and
 * forwards each frame as the `realtime.event` Tauri event. This module
 * is the single subscriber: it decodes the protobuf StreamEvent and
 * fans out to typed payloads on the in-process `eventBus`.
 *
 * Why this layering, instead of having the Rust side decode and emit
 * per-kind Tauri events:
 *
 *   - Forward compatibility: adding a new oneof arm (e.g. a new
 *     CallSignal kind, future federation envelope) is a no-op in Rust;
 *     only the TS dispatcher needs to grow a new branch.
 *   - The Rust layer stays decode-light, so the wire contract has a
 *     single canonical decode path on the consumer side.
 *
 * Lifetime contract:
 *
 *   - Call `installEventStreamBridge()` exactly once at app boot,
 *     before any UI subscribes. Idempotent.
 *   - Call `startEventStream()` after the user is authenticated so the
 *     Rust supervisor opens the SSE socket. Safe to call multiple
 *     times — the Rust side replaces in-flight supervisors.
 *   - Call `stopEventStream()` on logout / actor switch / shutdown.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { fromBinary } from '@bufbuild/protobuf';

import { eventBus } from '../kernel/events';
import { EVENT } from '../kernel/events/catalog';
import { StreamEventSchema } from '../gen/proto/domain/realtime/event_pb';
import { api } from './desktop_api';
import { log } from '../utils/logger';

const REALTIME_EVENT = 'realtime.event';
const REALTIME_CONNECTION_STATE = 'realtime.connection-state';

interface RawRealtimeEnvelope {
  event_id?: string;
  data_b64?: string;
}

interface RawConnectionStatePayload {
  connected: boolean;
  reason?: string;
}

let unlistenRealtime: UnlistenFn | null = null;
let unlistenConnState: UnlistenFn | null = null;

/**
 * Install the Tauri listeners that translate raw `realtime.event`
 * frames into typed `eventBus` notifications. Must be called exactly
 * once at boot; subsequent calls are no-ops.
 */
export async function installEventStreamBridge(): Promise<void> {
  if (unlistenRealtime || unlistenConnState) return;

  try {
    unlistenRealtime = await listen<RawRealtimeEnvelope>(REALTIME_EVENT, (event) => {
      handleFrame(event.payload);
    });
  } catch (error) {
    log.warn('eventStream', 'failed to install realtime.event listener', error);
  }

  try {
    unlistenConnState = await listen<RawConnectionStatePayload>(
      REALTIME_CONNECTION_STATE,
      (event) => {
        const payload = event.payload ?? { connected: false };
        eventBus.publish(EVENT.REALTIME_CONNECTION_STATE, {
          connected: Boolean(payload.connected),
          reason: payload.reason ?? '',
        });
      },
    );
  } catch (error) {
    log.warn('eventStream', 'failed to install realtime.connection-state listener', error);
  }

  log.info('eventStream', 'bridge installed');
}

/**
 * Tear down the bridge. Used by tests and by app teardown paths;
 * production code typically leaves the bridge installed for the life
 * of the renderer process.
 */
export function teardownEventStreamBridge(): void {
  if (unlistenRealtime) {
    try { unlistenRealtime(); } catch { /* noop */ }
    unlistenRealtime = null;
  }
  if (unlistenConnState) {
    try { unlistenConnState(); } catch { /* noop */ }
    unlistenConnState = null;
  }
}

/**
 * Ask the Rust supervisor to open the SSE socket for the current
 * window's authenticated actor. Idempotent.
 */
export async function startEventStream(): Promise<void> {
  try {
    await api.realtimeStreamStart();
  } catch (error) {
    log.warn('eventStream', 'realtimeStreamStart failed', error);
  }
}

/**
 * Ask the Rust supervisor to close the SSE socket. Idempotent.
 */
export async function stopEventStream(): Promise<void> {
  try {
    await api.realtimeStreamStop();
  } catch (error) {
    log.warn('eventStream', 'realtimeStreamStop failed', error);
  }
}

// ---------------------------------------------------------------------
// Frame decode + dispatch
// ---------------------------------------------------------------------

function handleFrame(raw: RawRealtimeEnvelope | undefined | null): void {
  if (!raw || typeof raw.data_b64 !== 'string' || !raw.data_b64) {
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(raw.data_b64);
  } catch (error) {
    log.warn('eventStream', 'base64 decode failed, dropping frame', error);
    return;
  }
  let envelope;
  try {
    envelope = fromBinary(StreamEventSchema, bytes);
  } catch (error) {
    log.warn('eventStream', 'protobuf decode failed, dropping frame', error);
    return;
  }

  const eventId = envelope.eventId || raw.event_id || '';
  const kind = envelope.kind;

  if (!kind) {
    // Server should never send a frame with an empty oneof, but be
    // defensive — heartbeats and unknown kinds are silently dropped.
    return;
  }

  switch (kind.case) {
    case 'hb':
      // Heartbeats keep the connection warm; nothing to dispatch.
      return;
    case 'message': {
      const m = kind.value;
      eventBus.publish(EVENT.REALTIME_MESSAGE_RECEIVED, {
        eventId,
        sessionUlid: m.sessionUlid,
        messageUlid: m.ulid,
        senderActorId: m.senderActorId,
        recipientActorId: m.recipientActorId,
        ciphertext: m.ciphertext,
        sentTsUnixMs: Number(m.sentTsUnixMs),
      });
      return;
    }
    case 'presence': {
      const p = kind.value;
      eventBus.publish(EVENT.REALTIME_PRESENCE_FLIP, {
        actorId: p.actorId,
        online: Boolean(p.online),
      });
      return;
    }
    case 'resync': {
      const r = kind.value;
      log.info('eventStream', 'Resync received — UI must trigger cold catch-up', r);
      eventBus.publish(EVENT.REALTIME_RESYNC, {
        newestEventId: r.newestEventId,
        reason: r.reason ?? '',
      });
      return;
    }
    case 'receipt':
    case 'typing':
    case 'signaling':
      // Phase 5 only ships message + presence + resync to the UI.
      // Receipts (read indicators), typing, and call signaling all
      // ride on this same stream and will be wired in a follow-up
      // when the consumer surfaces exist (read-receipt UI, voice/
      // video signaling). Decoding here is a no-op so adding the
      // consumer later is purely additive.
      return;
    default:
      return;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  // atob is fine for the small SSE payloads we send (single message
  // protobuf, tens of KB at the high end). For very large payloads we
  // would switch to a streaming decoder; not needed yet.
  const binary = atob(b64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
