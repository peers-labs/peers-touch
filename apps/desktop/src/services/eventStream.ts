/**
 * Frontend bridge for the unified realtime event stream.
 *
 * Counterpart to `src-tauri/src/infrastructure/event_stream`. The Rust
 * supervisor owns the SSE socket, decodes / persists the cursor, and
 * forwards each frame as the `realtime:event` Tauri event. This module
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
import type { RealtimeCallSignalKind } from '../kernel/events/types';
import {
  ConversationSettingsChanged_Kind,
  MomentEvent_Kind,
  StreamEventSchema,
  type MomentEvent,
} from '../gen/proto/domain/realtime/event_pb';
import { api } from './desktop_api';
import { log } from '../utils/logger';

const REALTIME_EVENT = 'realtime:event';
const REALTIME_CONNECTION_STATE = 'realtime:connection-state';
const BROWSER_GATEWAY_RESYNC_INTERVAL_MS = 30_000;

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
let browserGatewayResyncTimer: number | null = null;

/**
 * Install the Tauri listeners that translate raw `realtime:event`
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
    log.warn('eventStream', 'failed to install realtime:event listener', error);
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
    log.warn('eventStream', 'failed to install realtime:connection-state listener', error);
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
  startBrowserGatewayResyncFallback();
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
  stopBrowserGatewayResyncFallback();
  try {
    await api.realtimeStreamStop();
  } catch (error) {
    log.warn('eventStream', 'realtimeStreamStop failed', error);
  }
}

function isBrowserDevGateway(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).__PT_GATEWAY_BASE__ === 'string';
}

function startBrowserGatewayResyncFallback(): void {
  if (!isBrowserDevGateway() || browserGatewayResyncTimer) return;
  // Browser desktop-web talks to the Rust HTTP gateway outside a Tauri WebView,
  // so `@tauri-apps/api/event.listen` has no native event channel to receive
  // Rust `emit` frames. Keep the fallback inside the runtime bridge and reuse
  // the canonical cold-resync path as a low-frequency missed-event safety net
  // instead of turning full runtime reconciliation into a per-second poll.
  browserGatewayResyncTimer = window.setInterval(() => {
    eventBus.publish(EVENT.REALTIME_RESYNC, {
      newestEventId: '',
      reason: 'browser-dev-gateway-resync',
    });
  }, BROWSER_GATEWAY_RESYNC_INTERVAL_MS);
}

function stopBrowserGatewayResyncFallback(): void {
  if (!browserGatewayResyncTimer) return;
  window.clearInterval(browserGatewayResyncTimer);
  browserGatewayResyncTimer = null;
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
    case 'groupMembershipChange': {
      const g = kind.value;
      const memberKind = groupMembershipKindFromEnum(g.kind);
      if (!memberKind) {
        log.warn('eventStream', 'unknown GroupMembershipChange kind, dropping', { kind: g.kind });
        return;
      }
      eventBus.publish(EVENT.REALTIME_GROUP_MEMBERSHIP_CHANGE, {
        eventId,
        changeEventId: g.eventId ?? '',
        groupUlid: g.groupUlid,
        actorDid: g.actorDid,
        kind: memberKind,
        changedTsUnixMs: Number(g.changedTsUnixMs),
      });
      return;
    }
    case 'groupFederationEvent': {
      const g = kind.value;
      if (!g.groupUlid || !g.eventUlid) {
        log.warn('eventStream', 'invalid GroupFederationEvent, dropping', {
          groupUlid: g.groupUlid,
          eventUlid: g.eventUlid,
        });
        return;
      }
      eventBus.publish(EVENT.REALTIME_GROUP_FEDERATION_EVENT, {
        eventId,
        groupUlid: g.groupUlid,
        groupEventUlid: g.eventUlid,
        seq: Number(g.seq),
        eventType: g.eventType,
        authorityStationPeerId: g.authorityStationPeerId,
        authorityEpoch: Number(g.authorityEpoch),
        eventHash: g.eventHash,
        messageUlid: g.messageUlid,
        membershipEpoch: Number(g.membershipEpoch),
        committedTsUnixMs: Number(g.committedTsUnixMs),
        actorDid: g.actorDid,
      });
      return;
    }
      case 'groupSkdmEnvelopeDelivered': {
        const s = kind.value;
        if (!s.groupUlid || !s.senderDid || !s.recipientDid || !s.recipientDeviceId || s.encryptedPayload.byteLength === 0) {
          log.warn('eventStream', 'invalid GroupSkdmEnvelopeDelivered, dropping', {
            groupUlid: s.groupUlid,
            senderDid: s.senderDid,
            recipientDid: s.recipientDid,
            recipientDeviceId: s.recipientDeviceId,
          });
          return;
        }
        eventBus.publish(EVENT.REALTIME_GROUP_SKDM_ENVELOPE_DELIVERED, {
          eventId,
          groupUlid: s.groupUlid,
          membershipEpoch: Number(s.membershipEpoch),
          senderDid: s.senderDid,
          senderKeyId: s.senderKeyId,
          senderHomeStationPeerId: s.senderHomeStationPeerId,
          recipientDid: s.recipientDid,
          recipientDeviceId: s.recipientDeviceId,
          idempotencyKey: s.idempotencyKey,
          encryptedPayloadB64: bytesToBase64(s.encryptedPayload),
          deliveredTsUnixMs: Number(s.deliveredTsUnixMs),
        });
        return;
      }
    case 'conversationSettingsChanged': {
      const c = kind.value;
      const conversationKind = conversationSettingsKindFromEnum(c.kind);
      if (!conversationKind || !c.containerUlid) {
        log.warn('eventStream', 'unknown ConversationSettingsChanged kind, dropping', { kind: c.kind });
        return;
      }
      eventBus.publish(EVENT.REALTIME_CONVERSATION_SETTINGS_CHANGED, {
        eventId,
        conversationKind,
        containerUlid: c.containerUlid,
        actorId: c.actorId,
        changedTsUnixMs: Number(c.changedTsUnixMs),
      });
      return;
    }
    case 'moment':
      dispatchMomentEvent(eventId, kind.value);
      return;
    default:
      return;
  }
}

export function dispatchRealtimeFrameForAcceptance(raw: RawRealtimeEnvelope | undefined | null): void {
  handleFrame(raw);
}

function dispatchMomentEvent(eventId: string, event: MomentEvent): void {
  const occurredAtUnixMs = Number(event.occurredTsUnixMs || 0n);
  const base = {
    eventId,
    postId: event.postId,
    authorActorId: event.authorActorId || undefined,
    occurredAtUnixMs,
  };

  switch (event.kind) {
    case MomentEvent_Kind.CREATED:
      eventBus.publish(EVENT.MOMENT_CREATED, {
        ...base,
        audience: event.audience || undefined,
      });
      return;
    case MomentEvent_Kind.DELETED:
      eventBus.publish(EVENT.MOMENT_DELETED, {
        ...base,
        deletedByActorId: event.actorId || undefined,
      });
      return;
    case MomentEvent_Kind.COMMENTED:
      eventBus.publish(EVENT.MOMENT_COMMENTED, {
        ...base,
        commentId: event.commentId,
        commentAuthorActorId: event.actorId || undefined,
      });
      return;
    case MomentEvent_Kind.REACTED:
      eventBus.publish(EVENT.MOMENT_REACTED, {
        ...base,
        reactionActorId: event.actorId || undefined,
        kind: event.reactionKind || undefined,
        removed: Boolean(event.removed),
      });
      return;
    default:
      log.warn('eventStream', 'unknown MomentEvent kind, dropping', { kind: event.kind });
  }
}

// Inverse of GroupMembershipChange.Kind enum. Align with proto:
// KIND_UNSPECIFIED=0, KIND_ADDED=1, KIND_REMOVED=2, KIND_LEFT=3,
// KIND_UPDATED=4, KIND_TRANSFERRED=5, KIND_DISSOLVED=6.
function groupMembershipKindFromEnum(value: number): 'ADDED' | 'REMOVED' | 'LEFT' | 'UPDATED' | 'TRANSFERRED' | 'DISSOLVED' | null {
  switch (value) {
    case 1:
      return 'ADDED';
    case 2:
      return 'REMOVED';
    case 3:
      return 'LEFT';
    case 4:
      return 'UPDATED';
    case 5:
      return 'TRANSFERRED';
    case 6:
      return 'DISSOLVED';
    default:
      return null;
  }
}

function conversationSettingsKindFromEnum(value: number): 'friend' | 'group' | null {
  switch (value) {
    case ConversationSettingsChanged_Kind.FRIEND:
      return 'friend';
    case ConversationSettingsChanged_Kind.GROUP:
      return 'group';
    default:
      return null;
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
function signalKindFromEnum(value: number): RealtimeCallSignalKind | null {
  // The enum values come from the generated CallSignal_Kind proto:
  //   OFFER=1, ANSWER=2, CANDIDATE=3, HANGUP=4,
  //   CALL_REQUEST=5, CALL_ACCEPT=6, CALL_REJECT=7, CALL_END=8
  //   (KIND_UNSPECIFIED=0).
  switch (value) {
    case 1: return 'OFFER';
    case 2: return 'ANSWER';
    case 3: return 'CANDIDATE';
    case 4: return 'HANGUP';
    case 5: return 'CALL_REQUEST';
    case 6: return 'CALL_ACCEPT';
    case 7: return 'CALL_REJECT';
    case 8: return 'CALL_END';
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
