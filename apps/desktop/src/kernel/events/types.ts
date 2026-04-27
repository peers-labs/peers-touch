import type { ParsedDeepLink } from '../../utils/deeplink';
import { EVENT } from './catalog';

export type SessionRevokedReason = 'expired' | 'kicked' | 'not_found' | 'unknown';

export interface SessionRevokedPayload {
  reason: SessionRevokedReason;
  raw?: string;
}

export interface RealtimeMessageReceivedPayload {
  /** Server-assigned monotonic ULID; opaque to the UI. */
  eventId: string;
  /** Friend-chat session this message belongs to. */
  sessionUlid: string;
  /** Business message ULID; idempotency key for upsert into local store. */
  messageUlid: string;
  /** Sender DID. May equal the local actor for multi-device sender echo. */
  senderActorId: string;
  /** Recipient DID (always the local actor's stream target). */
  recipientActorId: string;
  /** Raw envelope ciphertext bytes; today this is the marshaled
   *  FriendChatMessage protobuf, tomorrow the sealed-sender ciphertext. */
  ciphertext: Uint8Array;
  /** Sender's claim of when the message was sent. UI display only. */
  sentTsUnixMs: number;
}

export interface RealtimePresenceFlipPayload {
  actorId: string;
  online: boolean;
}

export interface RealtimeResyncPayload {
  /** Newest event_id the server holds for this actor at Resync time;
   *  the client uses this as its new cursor after cold catch-up. */
  newestEventId: string;
  /** Free-text reason for the Resync (cursor evicted, server restart, …). */
  reason: string;
}

export interface RealtimeConnectionStatePayload {
  connected: boolean;
  reason: string;
}

export type RealtimeCallSignalKind = 'OFFER' | 'ANSWER' | 'CANDIDATE' | 'HANGUP';

export interface RealtimeCallSignalPayload {
  /** Server-assigned event id. Opaque cursor; see contract §2.2. */
  eventId: string;
  /** Friend-chat session that owns the call. The receiver uses this
   *  to look up the per-session ratchet for decryption. */
  sessionUlid: string;
  /** Originating actor DID (the caller). For multi-device sender
   *  echo this can equal the local actor. */
  fromActorId: string;
  /** Which signaling phase this frame represents. */
  kind: RealtimeCallSignalKind;
  /** Opaque ciphertext envelope produced by the standalone signaling
   *  envelope (contract §2.7.2 — X25519 + HKDF-SHA256 + AES-256-GCM
   *  with random nonce + AAD bound to `sessionUlid` and `kind`). The
   *  receiver opens it via `api.signalingEnvelopeOpen`, NOT the chat
   *  ratchet — see §2.7.2.1 for the rationale (chat ratchet requires
   *  strict in-order delivery and would stall on dropped candidates).
   *  Wire layout: `eph_pub(32B) || nonce(12B) || ciphertext || tag(16B)`. */
  payload: Uint8Array;
}

export interface EventPayloadMap {
  [EVENT.AUTH_IDENTITY_CHANGED]: void;
  [EVENT.AUTH_SESSION_REVOKED]: SessionRevokedPayload;
  [EVENT.OAUTH_CONNECTIONS_CHANGED]: void;
  [EVENT.NAVIGATION_REQUESTED]: ParsedDeepLink | { resource: 'settings'; id?: string };
  [EVENT.AGENT_BUILDER_STREAM_ENDED]: void;
  [EVENT.GLOBAL_CONTEXT_UPDATED]: { slice: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_STARTED]: { name: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_FINISHED]: { name: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_FAILED]: { name: string; error: string; timestamp_ms: number };
  [EVENT.REALTIME_MESSAGE_RECEIVED]: RealtimeMessageReceivedPayload;
  [EVENT.REALTIME_PRESENCE_FLIP]: RealtimePresenceFlipPayload;
  [EVENT.REALTIME_RESYNC]: RealtimeResyncPayload;
  [EVENT.REALTIME_CONNECTION_STATE]: RealtimeConnectionStatePayload;
  [EVENT.REALTIME_CALL_SIGNAL]: RealtimeCallSignalPayload;
}

export interface AppEvent<TType extends keyof EventPayloadMap> {
  type: TType;
  payload: EventPayloadMap[TType];
}
