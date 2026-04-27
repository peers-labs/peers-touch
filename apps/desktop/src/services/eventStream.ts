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
    case 'signaling': {
      const s = kind.value;
      // Map the protobuf enum back to the wire string form used at
      // the ingress endpoint. Defensive: skip frames with unknown
      // kinds rather than guess. This mirrors the inverse table in
      // station/app/subserver/events/handler.go::signalKindMap.
      const kindStr = signalKindFromEnum(s.kind);
      if (!kindStr) {
        log.warn('eventStream', 'unknown CallSignal kind, dropping', { kind: s.kind });
        return;
      }
      eventBus.publish(EVENT.REALTIME_CALL_SIGNAL, {
        eventId,
        sessionUlid: s.sessionUlid,
        fromActorId: s.fromActorId,
        kind: kindStr,
        payload: s.payload,
      });
      return;
    }
    case 'receipt': {
      const r = kind.value;
      const kindStr = receiptKindFromEnum(r.kind);
      if (!kindStr) {
        // KIND_UNSPECIFIED or a future enum we don't understand — drop
        // it. Receipts are advisory; failing closed (no UI tick) is
        // strictly better than guessing wrong.
        return;
      }
      eventBus.publish(EVENT.REALTIME_MESSAGE_RECEIPT, {
        eventId,
        sessionUlid: r.sessionUlid,
        messageUlid: r.ulid,
        fromActorId: r.fromActorId,
        kind: kindStr,
      });
      return;
    }
    case 'typing': {
      const t = kind.value;
      eventBus.publish(EVENT.REALTIME_TYPING_STATE, {
        eventId,
        sessionUlid: t.sessionUlid,
        fromActorId: t.fromActorId,
        typing: Boolean(t.typing),
      });
      return;
    }
    case 'mutation': {
      const m = kind.value;
      const kindStr = mutationKindFromEnum(m.kind);
      if (!kindStr) {
        // KIND_UNSPECIFIED — defensive drop. A future arm we
        // don't recognize is also dropped here so legacy clients
        // don't crash on a server-only enum addition.
        log.warn('eventStream', 'unknown MessageMutation kind, dropping', { kind: m.kind });
        return;
      }
      eventBus.publish(EVENT.REALTIME_MESSAGE_MUTATION, {
        eventId,
        sessionUlid: m.sessionUlid,
        messageUlid: m.ulid,
        fromActorId: m.fromActorId,
        kind: kindStr,
        newContent: m.newContent ?? '',
        newCiphertext: m.newCiphertext ?? new Uint8Array(),
        mutatedTsUnixMs: Number(m.mutatedTsUnixMs),
      });
      return;
    }
    default:
      return;
  }
}

// Inverse of MessageMutation_Kind enum. Keep aligned with the
// proto: KIND_UNSPECIFIED=0, RECALL=1, EDIT=2, DELETE=3.
function mutationKindFromEnum(value: number): 'RECALL' | 'EDIT' | 'DELETE' | null {
  switch (value) {
    case 1: return 'RECALL';
    case 2: return 'EDIT';
    case 3: return 'DELETE';
    default: return null;
  }
}

// Mirror of station's receiptKindMap. Keep both tables aligned —
// adding a new MessageReceipt_Kind on the proto side requires
// growing this and the Station-side reverse map together.
function receiptKindFromEnum(value: number): 'DELIVERED' | 'READ' | null {
  // From generated MessageReceipt_Kind enum:
  //   KIND_UNSPECIFIED=0, DELIVERED=1, READ=2.
  switch (value) {
    case 1: return 'DELIVERED';
    case 2: return 'READ';
    default: return null;
  }
}

// Inverse of station's signalKindMap. Keep these tables aligned —
// adding a new CallSignal_Kind on the proto side requires growing
// both maps in lockstep.
function signalKindFromEnum(value: number): 'OFFER' | 'ANSWER' | 'CANDIDATE' | 'HANGUP' | null {
  // The enum values come from the generated CallSignal_Kind proto:
  //   OFFER=1, ANSWER=2, CANDIDATE=3, HANGUP=4 (KIND_UNSPECIFIED=0).
  switch (value) {
    case 1: return 'OFFER';
    case 2: return 'ANSWER';
    case 3: return 'CANDIDATE';
    case 4: return 'HANGUP';
    default: return null;
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
