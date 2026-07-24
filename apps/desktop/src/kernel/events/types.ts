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

export type RealtimeCallSignalKind =
  | 'OFFER'
  | 'ANSWER'
  | 'CANDIDATE'
  | 'HANGUP'
  // Application-layer ringing protocol — see CallSignal.Kind in
  // model/domain/realtime/event.proto. These kinds wrap a JSON
  // body (`{"callId":"<ulid>","kind":"audio"|"video"}`) inside the
  // same sealed signaling envelope used for SDP / candidates, so
  // Station never sees the call metadata.
  | 'CALL_REQUEST'
  | 'CALL_ACCEPT'
  | 'CALL_REJECT'
  | 'CALL_END';

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

/**
 * Receipt kind, mirrors `MessageReceipt.Kind` in the wire protobuf.
 * `KIND_UNSPECIFIED` (enum 0) is dropped at the dispatch boundary —
 * by the time a payload reaches an event subscriber the kind is
 * guaranteed to be `DELIVERED` or `READ`.
 */
export type RealtimeMessageReceiptKind = 'DELIVERED' | 'READ';

export interface RealtimeMessageReceiptPayload {
  /** Server-assigned event id. Opaque cursor; see contract §2.2. */
  eventId: string;
  /** Session this receipt belongs to (matches `MessageEnvelope.sessionUlid`). */
  sessionUlid: string;
  /** ULID of the message being acknowledged (the *sender*'s ulid). */
  messageUlid: string;
  /** Originating actor DID — the *receiver* of the original message,
   *  i.e. whoever is now reporting they got / read it. May equal the
   *  local actor for multi-device echo. */
  fromActorId: string;
  /** Whether this is a delivery receipt or a read receipt. */
  kind: RealtimeMessageReceiptKind;
}

export interface RealtimeTypingStatePayload {
  /** Server-assigned event id. Opaque cursor; see contract §2.2. */
  eventId: string;
  /** Session this typing-state belongs to. */
  sessionUlid: string;
  /** Originating actor DID — whoever is (not) typing. May equal the
   *  local actor for multi-device echo; consumers should ignore self. */
  fromActorId: string;
  /** True when the actor *started* typing, false when they stopped. */
  typing: boolean;
}

/**
 * Mutation kind, mirrors the wire `MessageMutation.Kind` enum. The
 * dispatch boundary drops `KIND_UNSPECIFIED` so subscribers always
 * see one of the concrete cases.
 */
export type RealtimeMessageMutationKind = 'RECALL' | 'EDIT' | 'DELETE';

/**
 * Group roster change kind, mirrors `GroupMembershipChange.Kind` on the
 * wire. `KIND_UNSPECIFIED` (enum 0) is dropped at the dispatch boundary.
 */
export type RealtimeGroupMembershipChangeKind =
  | 'ADDED'
  | 'REMOVED'
  | 'LEFT'
  | 'UPDATED'
  | 'TRANSFERRED'
  | 'DISSOLVED';

export interface RealtimeGroupMembershipChangePayload {
  /** Monotonic SSE envelope id (Last-Event-ID cursor). */
  eventId: string;
  /** Shared logical id for one roster change across recipients. */
  changeEventId: string;
  groupUlid: string;
  actorDid: string;
  kind: RealtimeGroupMembershipChangeKind;
  changedTsUnixMs: number;
}

export interface RealtimeGroupFederationEventPayload {
  eventId: string;
  groupUlid: string;
  groupEventUlid: string;
  seq: number;
  eventType: string;
  authorityStationPeerId: string;
  authorityEpoch: number;
  eventHash: string;
  messageUlid: string;
  membershipEpoch: number;
  committedTsUnixMs: number;
  actorDid: string;
}

export interface RealtimeGroupSkdmEnvelopeDeliveredPayload {
  eventId: string;
  groupUlid: string;
  membershipEpoch: number;
  senderDid: string;
  senderKeyId: number;
  senderHomeStationPeerId: string;
  recipientDid: string;
  recipientDeviceId: string;
  idempotencyKey: string;
  encryptedPayloadB64: string;
  deliveredTsUnixMs: number;
}

export interface RealtimeEnvelopeDeliveredPayload {
  eventId: string;
  inboxItemId: string;
  envelopeId: string;
  conversationId: string;
  payloadType: number;
  payloadBytes: Uint8Array;
  senderPtid: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  membershipEpoch: number;
  queuedTsUnixMs: number;
}

export interface RealtimeConversationSettingsChangedPayload {
  eventId: string;
  conversationKind: 'friend' | 'group';
  containerUlid: string;
  actorId: string;
  changedTsUnixMs: number;
}

export interface RealtimeMessageMutationPayload {
  /** Server-assigned event id. Opaque cursor; see contract §2.2. */
  eventId: string;
  /** Session that owns the mutated message. */
  sessionUlid: string;
  /** ULID of the *target* message — the one being recalled / edited
   *  / deleted. Receiver uses this as the local store key. */
  messageUlid: string;
  /** DID of whoever performed the mutation. Today this must equal
   *  the original sender (server-enforced); a future moderator path
   *  could surface a different actor here. */
  fromActorId: string;
  /** Which mutation arm this frame represents. */
  kind: RealtimeMessageMutationKind;
  /** For EDIT only: the new plaintext body, or empty when the chat
   *  is fully E2EE and only `newCiphertext` was supplied. */
  newContent: string;
  /** For EDIT only: the new ciphertext body, when applicable. */
  newCiphertext: Uint8Array;
  /** Server-stamped wall-clock at which the mutation landed.
   *  Display-only: clients must NOT use it for ordering. */
  mutatedTsUnixMs: number;
}

export interface MomentRealtimeBasePayload {
  /** Monotonic realtime cursor when the event comes from Station SSE. */
  eventId: string;
  postId: string;
  authorActorId?: string;
  occurredAtUnixMs: number;
}

export interface MomentCreatedPayload extends MomentRealtimeBasePayload {
  audience?: string;
}

export interface MomentDeletedPayload extends MomentRealtimeBasePayload {
  deletedByActorId?: string;
}

export interface MomentCommentedPayload extends MomentRealtimeBasePayload {
  commentId: string;
  commentAuthorActorId?: string;
}

export interface MomentReactedPayload extends MomentRealtimeBasePayload {
  reactionActorId?: string;
  kind?: string;
  removed: boolean;
}

export interface MomentResyncRequestedPayload {
  reason: string;
  newestEventId?: string;
}

export interface RelationshipChangedPayload {
  targetActorId: string;
  action: 'follow' | 'unfollow' | 'block' | 'unblock';
}

/**
 * Group Sender-Keys distribution-message install notification.
 *
 * Fired by `handleInboundSkdm` after a peer's SKDM has been
 * decoded, authenticated, and persisted. The store subscribes
 * and re-attempts decryption of any group ciphertext that
 * previously failed with `MissingSkdmError` for the same
 * `(groupUlid, senderDid, senderKeyId)` tuple, so a late SKDM
 * unblocks all the messages it was supposed to unblock without
 * forcing the user to reload the chat.
 */
export interface GroupSkdmInstalledPayload {
  groupUlid: string;
  senderDid: string;
  senderKeyId: number;
}

export interface AgentTurnStreamEventPayload {
  streamId: string;
  conversationId: string;
  agentId: string;
  event: string;
  data: Record<string, string>;
  timestampMs: number;
}

export interface EventPayloadMap {
  [EVENT.AUTH_IDENTITY_CHANGED]: void;
  [EVENT.AUTH_SESSION_REVOKED]: SessionRevokedPayload;
  [EVENT.OAUTH_CONNECTIONS_CHANGED]: void;
  [EVENT.NAVIGATION_REQUESTED]: ParsedDeepLink | { resource: 'settings'; id?: string };
  [EVENT.AGENT_BUILDER_STREAM_ENDED]: void;
  [EVENT.AGENT_TURN_STREAM_EVENT]: AgentTurnStreamEventPayload;
  [EVENT.GLOBAL_CONTEXT_UPDATED]: { slice: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_STARTED]: { name: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_FINISHED]: { name: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_FAILED]: { name: string; error: string; timestamp_ms: number };
  [EVENT.REALTIME_MESSAGE_RECEIVED]: RealtimeMessageReceivedPayload;
  [EVENT.REALTIME_PRESENCE_FLIP]: RealtimePresenceFlipPayload;
  [EVENT.REALTIME_RESYNC]: RealtimeResyncPayload;
  [EVENT.REALTIME_CONNECTION_STATE]: RealtimeConnectionStatePayload;
  [EVENT.REALTIME_CALL_SIGNAL]: RealtimeCallSignalPayload;
  [EVENT.REALTIME_MESSAGE_RECEIPT]: RealtimeMessageReceiptPayload;
  [EVENT.REALTIME_TYPING_STATE]: RealtimeTypingStatePayload;
  [EVENT.REALTIME_MESSAGE_MUTATION]: RealtimeMessageMutationPayload;
  [EVENT.REALTIME_GROUP_MEMBERSHIP_CHANGE]: RealtimeGroupMembershipChangePayload;
  [EVENT.REALTIME_GROUP_FEDERATION_EVENT]: RealtimeGroupFederationEventPayload;
    [EVENT.REALTIME_GROUP_SKDM_ENVELOPE_DELIVERED]: RealtimeGroupSkdmEnvelopeDeliveredPayload;
  [EVENT.REALTIME_ENVELOPE_DELIVERED]: RealtimeEnvelopeDeliveredPayload;
  [EVENT.REALTIME_CONVERSATION_SETTINGS_CHANGED]: RealtimeConversationSettingsChangedPayload;
  [EVENT.MOMENT_CREATED]: MomentCreatedPayload;
  [EVENT.MOMENT_DELETED]: MomentDeletedPayload;
  [EVENT.MOMENT_COMMENTED]: MomentCommentedPayload;
  [EVENT.MOMENT_REACTED]: MomentReactedPayload;
  [EVENT.MOMENT_RESYNC_REQUESTED]: MomentResyncRequestedPayload;
  [EVENT.RELATIONSHIP_CHANGED]: RelationshipChangedPayload;
  [EVENT.GROUP_SKDM_INSTALLED]: GroupSkdmInstalledPayload;
}

export interface AppEvent<TType extends keyof EventPayloadMap> {
  type: TType;
  payload: EventPayloadMap[TType];
}
