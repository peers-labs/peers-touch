import { createDesktopStore } from './createDesktopStore';
import { create as createProto, fromBinary, toBinary } from '@bufbuild/protobuf';
import { timestampDate, timestampFromDate } from '@bufbuild/protobuf/wkt';
import {
  CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION,
  chatUnreadForParticipant,
  encryptedChatTransportMessageType,
  mergeUniqueChatMessages,
} from '@peers-touch/client-chat-core';

import {
  api,
  isUnauthorizedError,
  type AccountProfile,
  type ChatAttachmentInput,
  type ChatThreadCount,
} from '../services/desktop_api';
import {
  EncryptedMessageSchema,
  FriendMessageStatus,
  type FriendChatSession,
  type FriendChatMessage,
} from '../gen/proto/domain/chat/friend_chat_pb';
import {
  ChatEncryptedMessagePayloadSchema,
  GroupMessageAttachmentSchema,
  type ChatEncryptedMessagePayload,
  type Group,
  type GroupMessage,
  type GroupMember,
} from '../gen/proto/domain/chat/group_chat_pb';
import { EncryptedMediaDescriptorSchema } from '../gen/proto/domain/common/common_pb';
import {
  ConversationCommandSchema,
  ReceiptType,
  type Conversation,
  type ConversationMember,
} from '../gen/proto/domain/chat/conversation_pb';
import { imServiceV1 } from '../services/im-service';
import type {
  MessagingLocalAttachmentIntent,
  MessagingProjection,
} from '../services/im-service-contract';
import {
  encryptDirectPayloads,
  getLocalCryptoAddress,
} from '../runtimes/cryptoRuntime';
import { useCryptoStore } from './cryptoStore';
import { log } from '../utils/logger';
import { getDecryptCache, setDecryptCache } from './decryptCache';
import {
  readDesktopDomainValueSync,
  writeDesktopDomainValueSync,
} from '../storage/desktopClientStorage';
import {
  applyMessageMutationToList,
  applyMessageReceiptToList,
  applyPresenceToMap,
  applyTypingStateToMap,
  conversationKey,
  filterClearedMessages,
  messageGroupSeq,
  messageSentMs,
  previewFromMessage,
  pruneTypingPeers,
  projectDesktopIMConversation,
  projectDesktopIMMessages,
  visibleConversationUnread,
  type ConversationLocalState,
  type DesktopIMConversationProjection,
  type DesktopIMMessageProjection,
  type DesktopIMSenderProfileProjection,
  type MessagePreview,
  type SocialMessage,
} from './socialProjection';
import {
  friendRequestProfileDids,
  normalizeFriendRequestData,
  normalizeFriendRequests,
  normalizeConversations,
  normalizeConversationMembers,
  type FriendRequestData,
} from './socialNormalizers';
import { currentAuthenticatedActorId } from './session';

const GROUP_DECRYPT_FAILED_PLACEHOLDER = '[Message cannot be decrypted]';

function hasAuthenticatedActor(): boolean {
  return Boolean(currentAuthenticatedActorId());
}

function projectMessagingProjection(
  kind: 'friend' | 'group',
  conversationId: string,
  projection: MessagingProjection,
): SocialMessage {
  const timestamp = timestampFromDate(new Date(projection.timestampUnixMs));
  const common = {
    ulid: projection.messageId,
    senderDid: projection.senderPtid,
    senderDeviceId: projection.senderDeviceId,
    type: 1,
    content: projection.plaintext,
    attachments: projection.attachments.map(attachment => ({
      cid: `messaging:${attachment.attachmentId}`,
      attachmentId: attachment.attachmentId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      mime_type: attachment.mimeType,
      size: attachment.plaintextSize,
      plaintextSize: attachment.plaintextSize,
      ciphertextSize: attachment.ciphertextSize,
      availabilityState: attachment.availabilityState,
    })),
    replyToUlid: '',
    threadRootUlid: '',
    sentAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    encryptedPayload: new Uint8Array(),
    recalled: false,
    editedAt: undefined,
    groupSeq: BigInt(projection.eventSequence ?? 0),
  };
  if (kind === 'friend') {
    const status = projection.state === 'failed'
      ? FriendMessageStatus.FAILED
      : projection.state === 'read'
        ? FriendMessageStatus.READ
        : projection.state === 'delivered'
          ? FriendMessageStatus.DELIVERED
          : projection.eventId
            ? FriendMessageStatus.SENT
            : FriendMessageStatus.SENDING;
    return {
      ...common,
      $typeName: 'peers_touch.model.chat.v1.FriendChatMessage',
      sessionUlid: conversationId,
      receiverDid: '',
      status,
      deliveredAt: undefined,
      readAt: undefined,
    } as unknown as FriendChatMessage;
  }
  return {
    ...common,
    $typeName: 'peers_touch.model.chat.v1.GroupMessage',
    groupUlid: conversationId,
    mentionedDids: [],
    mentionAll: false,
  } as unknown as GroupMessage;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

interface FriendEncryptedEnvelope {
  version: 1;
  ciphertext: string;
  counter: number;
  ratchetPub?: string;
  prevCounter?: number;
  nonce?: string;
}

export function decodeFriendEncryptedEnvelope(bytes: Uint8Array): FriendEncryptedEnvelope | null {
  try {
    const wire = fromBinary(EncryptedMessageSchema, bytes);
    if (
      wire.version !== 1
      || !wire.ciphertext.byteLength
      || wire.ratchetPub.byteLength !== 32
      || wire.nonce.byteLength !== 12
    ) {
      return null;
    }
    return {
      version: 1,
      ciphertext: bytesToB64(wire.ciphertext),
      counter: wire.counter,
      ratchetPub: bytesToB64(wire.ratchetPub),
      prevCounter: wire.prevCounter,
      nonce: bytesToB64(wire.nonce),
    };
  } catch {
    return null;
  }
}

function encryptedMediaDescriptorFromInput(attachment: ChatAttachmentInput) {
  if (!attachment.encryption_suite || !attachment.encryption_key_b64 || !attachment.encryption_nonce_b64) return undefined;
  return createProto(EncryptedMediaDescriptorSchema, {
    encrypted: true,
    version: attachment.encryption_suite === 'AES-256-GCM-CHUNKED' ? 2 : CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION,
    suite: attachment.encryption_suite,
    keyB64: attachment.encryption_key_b64,
    nonceB64: attachment.encryption_nonce_b64,
    plaintextSha256B64: attachment.plaintext_sha256_b64 ?? '',
    ciphertextSha256B64: attachment.ciphertext_sha256_b64 ?? '',
    plaintextSize: BigInt(attachment.plaintext_size ?? attachment.size),
    ciphertextSize: BigInt(attachment.ciphertext_size ?? attachment.size),
    chunking: attachment.chunking ?? '',
    chunkSize: attachment.chunk_size ?? 0,
    chunkCount: attachment.chunk_count ?? 0,
    tagSize: attachment.tag_size ?? 0,
    nonceStrategy: attachment.nonce_strategy ?? '',
  });
}

function groupAttachmentFromInput(attachment: ChatAttachmentInput) {
  const mediaEncryption = encryptedMediaDescriptorFromInput(attachment);
  return createProto(GroupMessageAttachmentSchema, {
    cid: attachment.cid,
    filename: attachment.filename,
    mimeType: attachment.mime_type,
    size: BigInt(attachment.size),
    thumbnailCid: attachment.thumbnail_cid ?? '',
    visibility: attachment.visibility ?? '',
    mediaEncryption,
    encryptionSuite: '',
    encryptionKeyB64: '',
    encryptionNonceB64: '',
    plaintextSha256B64: attachment.plaintext_sha256_b64 ?? '',
    ciphertextSha256B64: attachment.ciphertext_sha256_b64 ?? '',
    plaintextSize: BigInt(attachment.plaintext_size ?? attachment.size),
    ciphertextSize: BigInt(attachment.ciphertext_size ?? attachment.size),
  });
}

export function createEncryptedChatPayloadBytes(
  text: string,
  attachments: readonly ChatAttachmentInput[] = [],
  messageType?: number,
): Uint8Array {
  return toBinary(ChatEncryptedMessagePayloadSchema, createProto(ChatEncryptedMessagePayloadSchema, {
    version: CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION,
    text,
    attachments: attachments.map(groupAttachmentFromInput),
    messageType: messageType ?? encryptedChatTransportMessageType(),
  }));
}

export function decodeEncryptedChatPayloadBytes(bytes: Uint8Array): ChatEncryptedMessagePayload | null {
  try {
    const payload = fromBinary(ChatEncryptedMessagePayloadSchema, bytes);
    if (payload.version === CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION) return payload;
  } catch {
    return null;
  }
  return null;
}

function applyDecodedChatPayload<T extends FriendChatMessage | GroupMessage>(
  message: T,
  payload: ChatEncryptedMessagePayload,
): T {
  return {
    ...message,
    content: payload.text,
    type: payload.messageType || message.type,
    attachments: payload.attachments,
  } as T;
}

export interface UnifiedConversation {
  type: 'friend' | 'group';
  ulid: string;
  name: string;
  avatar: string;
  lastActivity: Date;
  unread: number;
  preview?: MessagePreview;
  friendSession?: FriendChatSession;
  group?: Group;
}

export interface CurrentUserProfile {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
}

export interface ActorAvatarProfile {
  did: string;
  name: string;
  avatar: string;
}

export interface SearchResult {
  messageId: string;
  conversationId: string;
  scope: 'friend' | 'group';
  senderDid: string;
  content: string;
  sentAt: number;
  conversationName: string;
  messageType?: number;
  replyToUlid?: string;
  threadRootUlid?: string;
  attachments: SearchResultAttachment[];
  threadReplyCount?: number;
  hasLoadedThreadReplies: boolean;
}

export interface SearchResultAttachment {
  filename: string;
  mimeType: string;
}

interface ThreadLoadOptions {
  append?: boolean;
  afterUlid?: string;
  limit?: number;
}

interface SocialChatState {
  conversations: Conversation[];
  conversationMembers: Record<string, ConversationMember[]>;
  sessions: FriendChatSession[];
  groups: Group[];
  activeTab: 'friend' | 'group';
  activeSessionUlid: string | null;
  activeGroupUlid: string | null;
  messages: Record<string, SocialMessage[]>;
  threadMessages: Record<string, SocialMessage[]>;
  threadCounts: Record<string, ChatThreadCount>;
  threadLoading: Record<string, boolean>;
  threadLoadingMore: Record<string, boolean>;
  threadError: Record<string, string | null>;
  threadHasMore: Record<string, boolean>;
  threadNextCursor: Record<string, string | null>;
  messageHasMore: Record<string, boolean>;
  messageLoadingMore: Record<string, boolean>;
  groupMembers: Record<string, GroupMember[]>;
  loading: boolean;
  loadError: string | null;
  showDetail: boolean;
  currentUserProfile: CurrentUserProfile | null;
  /** Own DID for message ownership; prefer profile.id, may align with participant DIDs in sessions */
  currentUserDid: string | null;
  friendRequests: FriendRequestData[];
  groupUnreadCounts: Record<string, number>;
  lastPreviews: Record<string, MessagePreview>;
  conversationLocalState: Record<string, ConversationLocalState>;

  /**
   * In-memory peer public profile cache keyed by peer DID (numeric actor
   * id). Populated lazily by `loadPeerProfile` whenever a UI surface
   * (Contacts detail, Chat detail) needs the rich public profile of a
   * non-self actor. Entries are full ActorProfile projections from
   * Station; `null` means "fetch attempted but failed/not available" so
   * callers can fall back to in-session display name + avatar without
   * re-issuing the request.
   *
   * Lives in `socialChat` because the chat layer is the only consumer
   * that needs to pair sessions/groups with peer identity context.
   * Refreshes whenever a peer is selected; SSE `actor.profile.updated`
   * (when wired in) should also invalidate the entry.
   */
  peerProfiles: Record<string, AccountProfile | null>;
  /** Per-peer in-flight loader flag; prevents redundant concurrent fetches. */
  peerProfileLoading: Record<string, boolean>;

  searchQuery: string;
  searchResults: SearchResult[];
  searchLoading: boolean;
  /** After navigation from search, scroll this message into view once messages are loaded. */
  scrollToMessageUlid: string | null;
  /** Root message ULID for the currently-open social chat thread panel. */
  openThreadRootUlid: string | null;

  /** Per-message reactions: messageId → list of {actorId, emoji}. */
  reactions: Record<string, { actorId: string; emoji: string }[]>;

  encryptionEnabled: boolean;
  ownFingerprint: string | null;
  /** sessionUlid → whether E2E is active for that conversation. */
  sessionEncrypted: Record<string, boolean>;
  sessionSecurityState: Record<string, 'idle' | 'establishing' | 'ready' | 'error'>;
  sessionCryptoVersion: Record<string, number>;
  groupSecurityState: Record<
    string,
    'idle' | 'establishing' | 'ready' | 'crypto-desynced' | 'error'
  >;
  setSessionSecurityState: (
    sessionUlid: string,
    state: 'idle' | 'establishing' | 'ready' | 'error',
    version?: number,
  ) => void;
  setGroupSecurityState: (
    groupUlid: string,
    state: 'idle' | 'establishing' | 'ready' | 'crypto-desynced' | 'error',
  ) => void;
  /**
   * Per-session WebRTC status. `transport` is the in-use ICE candidate type:
   *   - `'direct'` = host/srflx/prflx (P2P)
   *   - `'relay'`  = TURN relay (still real-time, just routed via station's TURN)
   *   - `null`     = connection not established yet, or in-progress
   *
   * The UI uses `state` + `transport` to render Direct / Relay / Offline.
   */
  friendP2pStatus: Record<string, { state: string; detail?: string; transport?: 'direct' | 'relay' | null }>;
  setFriendP2pStatus: (
    sessionUlid: string,
    state: string,
    detail?: string,
    transport?: 'direct' | 'relay' | null,
  ) => void;

  /**
   * Server-confirmed presence per peer DID. Distinct from
   * `friendP2pStatus` which reflects the *transport* (WebRTC P2P /
   * TURN-relay / down) — a peer can be online yet have no P2P channel
   * up (e.g. bootstrapping ICE), so the two concepts must not be
   * conflated in the UI.
   *
   * Source of truth: Station `StreamEvent.PresenceFlip` events carried
   * by the unified `/events/stream`.
   */
  peerOnline: Record<string, boolean>;
  setPeerOnline: (did: string, online: boolean) => void;

  /**
   * Per-session typing-state map.
   *
   *   typingPeers[sessionUlid][peerActorId] = { typing, lastUpdate }
   *
   * `typing` mirrors the wire bit (true = peer is composing). The
   * UI bubble must NOT trust `typing=true` indefinitely though —
   * the sender's debouncer can die mid-pulse (network blip, app
   * background, crash) and leave a phantom "is typing…" hanging on
   * forever. We therefore stamp `lastUpdate` (ms epoch) each time we
   * apply a frame and rely on a periodic GC sweep
   * (`sweepTypingPeers`) that downgrades any `typing=true` whose
   * `lastUpdate` is older than `TYPING_TTL_MS` (~6s — slightly
   * longer than the sender's 3-4s debounce window so a brief packet
   * loss doesn't blip the bubble away).
   */
  typingPeers: Record<string, Record<string, { typing: boolean; lastUpdate: number }>>;
  /**
   * Apply an inbound TypingState frame (from the realtime SSE
   * stream). Idempotent — repeated `typing=true` pulses just bump
   * `lastUpdate`, which is what the GC sweep needs to keep the
   * bubble alive across the full keystroke burst.
   */
  applyTypingState: (sessionUlid: string, fromActorId: string, typing: boolean) => void;
  /**
   * Drop any `typing=true` entries whose last update is older than
   * `staleBefore` ms. Called from the social runtime sweep interval
   * so phantom "is typing…" bubbles auto-clear when the
   * sender goes silent without explicitly emitting `typing=false`.
   */
  sweepTypingPeers: (staleBefore: number) => void;
  /**
   * Runtime-owned realtime projection entry. The event stream inserts
   * the new fact immediately; API sync/load paths are reconcile passes,
   * not the first visible source of the message.
   */
  ingestRealtimeMessage: (kind: 'friend' | 'group', conversationUlid: string, message: SocialMessage) => Promise<void>;

  loadSessions: () => Promise<void>;
  loadGroups: () => Promise<void>;
  setActiveTab: (tab: 'friend' | 'group') => void;
  selectSession: (ulid: string) => void;
  selectGroup: (ulid: string) => void;
  loadMessages: (ulid: string, kind?: 'friend' | 'group') => Promise<void>;
  loadOlderMessages: (ulid: string, kind?: 'friend' | 'group') => Promise<void>;
  loadThreadMessages: (
    ulid: string,
    rootUlid: string,
    kind?: 'friend' | 'group',
    options?: ThreadLoadOptions,
  ) => Promise<void>;
  refreshThreadCounts: (ulid: string, rootUlids: string[], kind?: 'friend' | 'group') => Promise<void>;
  markThreadRead: (ulid: string, rootUlid: string, lastReadUlid?: string, kind?: 'friend' | 'group') => Promise<void>;
  sendFriendMessage: (
    sessionUlid: string,
    receiverDid: string,
    content: string,
    type?: number,
    replyToUlid?: string,
    attachments?: MessagingLocalAttachmentIntent[],
    threadRootUlid?: string,
  ) => Promise<void>;
  sendGroupMessage: (
    groupUlid: string,
    content: string,
    type?: number,
    replyToUlid?: string,
    attachments?: MessagingLocalAttachmentIntent[],
    threadRootUlid?: string,
  ) => Promise<void>;
  loadGroupMembers: (groupUlid: string) => Promise<void>;
  toggleDetail: () => void;
  setShowDetail: (show: boolean) => void;
  deleteMessage: (ulid: string, messageUlid: string, kind?: 'friend' | 'group') => Promise<void>;
  /**
   * Recall a previously-sent friend chat message. Hits the
   * `/friend-chat/message/recall` endpoint; on success the server
   * fans out a `MessageMutation` event over SSE which this store's
   * `applyMessageMutation` handler folds into the local cache —
   * we deliberately do NOT mutate optimistically so all clients
   * (including the sender's other devices) converge through the
   * same realtime pipeline.
   *
   * For group chat use `recallGroupMessage` — same realtime
   * convergence semantics, different RPC + container key.
   */
  recallFriendMessage: (sessionUlid: string, messageUlid: string) => Promise<void>;
  /**
   * Recall a previously-sent group message. Sender + recall-window
   * gates are enforced at the Station; on success the server fans
   * out a `MessageMutation { kind=RECALL }` over SSE which this
   * store's `applyMessageMutation` folds in.
   */
  recallGroupMessage: (groupUlid: string, messageUlid: string) => Promise<void>;
  /** Encrypt and submit a device-targeted edit for a direct message. */
  editFriendMessage: (
    sessionUlid: string,
    messageUlid: string,
    newContent: string,
  ) => Promise<void>;
  /** Group-chat counterpart to `editFriendMessage`. */
  editGroupMessage: (
    groupUlid: string,
    messageUlid: string,
    newContent?: string,
    newCiphertext?: Uint8Array,
  ) => Promise<void>;
  /** React to a message with an emoji. Works for both DM and group conversations. */
  reactToMessage: (conversationId: string, messageId: string, emoji: string, remove?: boolean) => Promise<void>;
  /**
   * Apply an inbound `MessageMutation` from the realtime stream.
   * Idempotent: re-applying the same RECALL/EDIT/DELETE on a row
   * already in that state is a no-op so multi-device sender echo
   * does not flicker.
   */
  applyMessageMutation: (
    sessionUlid: string,
    messageUlid: string,
    kind: 'RECALL' | 'EDIT' | 'DELETE',
    payload: { newContent: string; newCiphertext: Uint8Array; mutatedTsUnixMs: number },
  ) => void;
  loadCurrentUserProfile: () => Promise<void>;
  /**
   * Lazily load (or refresh) the public profile of `peerDid` into
   * `peerProfiles`. Idempotent: repeated calls while a fetch is in
   * flight no-op; subsequent calls after success refresh the cache so
   * peers seeing a profile edit converge on the new data when they
   * re-open the detail panel. Pass `force=true` to bypass the
   * already-cached short-circuit (used when a profile update event is
   * known to have invalidated the cached row).
   */
  loadPeerProfile: (peerDid: string, force?: boolean) => Promise<void>;

  loadFriendRequests: (status?: number, limit?: number, offset?: number) => Promise<void>;
  sendFriendRequest: (receiverDid: string, message?: string) => Promise<void>;
  acceptFriendRequest: (requestId: string) => Promise<void>;
  rejectFriendRequest: (requestId: string) => Promise<void>;

  loadGroupUnreadCounts: () => Promise<void>;
  loadConversationPreviews: () => Promise<void>;
  submitMessageReceipts: (
    conversationUlid: string,
    messageUlids: string[],
    status: FriendMessageStatus,
  ) => Promise<void>;
  /**
   * Apply a realtime MessageReceipt to the local message store.
   *
   * Idempotent: status flips are forward-only (SENT < DELIVERED < READ
   * in FriendMessageStatus enum) so a stale DELIVERED receipt arriving
   * after a READ will not downgrade the UI tick. Called from the
   * SocialChatPage SSE subscription, which already filters out
   * self-emitted receipts (multi-device READ echoes are *kept* — the
   * store action is the right place to perform the no-op clamp).
   */
  applyMessageReceipt: (
    sessionUlid: string,
    messageUlid: string,
    kind: 'DELIVERED' | 'READ',
  ) => void;
  markGroupRead: (groupUlid: string) => Promise<void>;
  updateConversationLocalState: (
    kind: 'friend' | 'group',
    ulid: string,
    patch: Partial<ConversationLocalState>,
  ) => Promise<void>;
  hideConversation: (kind: 'friend' | 'group', ulid: string, keepHistory: boolean) => Promise<void>;
  restoreConversation: (kind: 'friend' | 'group', ulid: string) => void;
  deleteFriendContact: (sessionUlid: string) => Promise<void>;
  deleteGroupContact: (groupUlid: string) => Promise<void>;

  getUnifiedConversations: () => UnifiedConversation[];
  getIMConversations: () => DesktopIMConversationProjection[];
  getIMMessages: (kind: 'friend' | 'group', conversationUlid: string) => DesktopIMMessageProjection[];
  getIMThreadMessages: (kind: 'friend' | 'group', conversationUlid: string, rootUlid: string) => DesktopIMMessageProjection[];
  getIMSenderProfile: (
    kind: 'friend' | 'group',
    conversationUlid: string,
    senderDid: string,
  ) => DesktopIMSenderProfileProjection;

  searchMessages: (query: string, scope?: string, conversationId?: string) => Promise<void>;
  clearSearch: () => void;
  setScrollToMessageUlid: (ulid: string | null) => void;
  openThread: (rootUlid: string) => void;
  closeThread: () => void;

  initEncryption: () => Promise<void>;
  /** Clear actor-scoped in-memory data (used by the identity pipeline). */
  reset: () => void;
  hydrate: (actorId: string) => Promise<void>;
}

function activityFromSession(s: FriendChatSession): Date {
  const ts = s.lastMessageAt ?? s.updatedAt ?? s.createdAt;
  return ts ? timestampDate(ts) : new Date(0);
}

function activityFromGroup(g: Group): Date {
  const ts = g.updatedAt ?? g.createdAt;
  return ts ? timestampDate(ts) : new Date(0);
}

function friendUnreadForViewer(s: FriendChatSession, viewerDid: string | null): number {
  return chatUnreadForParticipant(s, viewerDid);
}

/**
 * Resolve the *other* participant of a friend session relative to the
 * current viewer. Centralised here so callers (session list, contacts
 * panel, contacts page, group-create modal, ...) all agree on:
 *   - which side is "the friend" when the viewer is participant A
 *     vs. when the viewer is participant B,
 *   - the display-name fallback chain (proto display_name -> DID),
 *   - the avatar URL fallback chain (proto avatar -> empty string,
 *     which UserSquareAvatar then resolves through its own
 *     local-then-remote-then-fallback rules).
 *
 * `viewerDid == null` means "unknown viewer" — we then guess the B
 * side, but every caller that has the user's own DID should pass it.
 */
export function peerOfSession(
  s: FriendChatSession,
  viewerDid: string | null,
): { did: string; name: string; avatar: string } {
  if (viewerDid) {
    if (s.participantADid === viewerDid) {
      return {
        did: s.participantBDid || '',
        name: s.participantBDisplayName || s.participantBDid || '',
        avatar: s.participantBAvatar || '',
      };
    }
    if (s.participantBDid === viewerDid) {
      return {
        did: s.participantADid || '',
        name: s.participantADisplayName || s.participantADid || '',
        avatar: s.participantAAvatar || '',
      };
    }
    return { did: '', name: '', avatar: '' };
  }
  return {
    did: s.participantBDid || s.participantADid || '',
    name: s.participantBDisplayName || s.participantBDid || s.participantADid || '',
    avatar: s.participantBAvatar || s.participantAAvatar || '',
  };
}

function participantProfileOfSession(
  s: FriendChatSession,
  ptid: string,
): ActorAvatarProfile | null {
  if (!ptid) return null;
  if (s.participantADid === ptid) {
    return {
      did: s.participantADid || '',
      name: s.participantADisplayName || s.participantADid || '',
      avatar: s.participantAAvatar || '',
    };
  }
  return {
    did: s.participantBDid || s.participantADid || '',
    name: s.participantBDisplayName || s.participantBDid || s.participantADid || '',
    avatar: s.participantBAvatar || s.participantAAvatar || '',
  };
}

function peerDisplayName(s: FriendChatSession, viewerDid: string | null): string {
  return peerOfSession(s, viewerDid).name;
}

export function actorProfileFromSessions(
  sessions: FriendChatSession[],
  viewerDid: string | null,
  ptid: string,
  currentUserProfile?: CurrentUserProfile | null,
): ActorAvatarProfile {
  const did = ptid.trim();
  const fromSession = sessions
    .map((s) => participantProfileOfSession(s, did))
    .find((p): p is ActorAvatarProfile => !!p);

  if (viewerDid && did === viewerDid) {
    return {
      did,
      name: currentUserProfile?.displayName
        || currentUserProfile?.username
        || fromSession?.name
        || did,
      avatar: currentUserProfile?.avatar || fromSession?.avatar || '',
    };
  }

  return fromSession ?? { did, name: did, avatar: '' };
}

export function groupAvatarRemoteUrl(group?: Pick<Group, 'avatarCid'> | null): string {
  const raw = group?.avatarCid?.trim() ?? '';
  if (!raw) return '';
  if (raw.startsWith('/') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  if (raw.startsWith('oss://')) {
    try {
      const inner = new URL(raw.slice(6));
      const key = inner.pathname.slice(1);
      return `${inner.origin}/sub-oss/file?key=${encodeURIComponent(key)}`;
    } catch {
      return '';
    }
  }
  return '';
}

function normalizeGroupMember(raw: unknown): GroupMember {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    ...(item as unknown as GroupMember),
    groupUlid: String(item.groupUlid ?? item.group_ulid ?? ''),
    ptid: String(item.ptid ?? item.actor_did ?? ''),
    invitedBy: String(item.invitedBy ?? item.invited_by ?? ''),
  };
}

function normalizeGroupMembers(raw: unknown): GroupMember[] {
  return Array.isArray(raw) ? raw.map(normalizeGroupMember) : [];
}


function socialMessageExplicitThreadRootUlid(msg: SocialMessage): string {
  return (msg as SocialMessage & { threadRootUlid?: string }).threadRootUlid || '';
}

function cacheDecryptedGroupMessage(message: GroupMessage, decoded: GroupMessage): void {
  if (!message.ulid) return;
  setDecryptCache(message.ulid, {
    content: decoded.content,
    type: decoded.type || message.type,
    attachments: decoded.attachments as unknown[],
    cachedAt: Date.now(),
  });
}

function isMessageInThread(msg: SocialMessage, rootUlid: string): boolean {
  return socialMessageExplicitThreadRootUlid(msg) === rootUlid;
}

function mergeThreadMessages(existing: SocialMessage[], incoming: SocialMessage[]): SocialMessage[] {
  return mergeUniqueChatMessages(existing, incoming);
}

export function socialThreadKey(kind: 'friend' | 'group', ulid: string, rootUlid: string): string {
  return `${kind}:${ulid}:${rootUlid}`;
}

function conversationStateStorageKey(ptid: string | null): string {
  return `socialChat:conversationLocalState:${ptid || 'anonymous'}`;
}

function loadConversationLocalState(ptid: string | null): Record<string, ConversationLocalState> {
  try {
    const parsed = readDesktopDomainValueSync<Record<string, ConversationLocalState>>(
      'chat.conversation-settings',
      conversationStateStorageKey(ptid),
    );
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveConversationLocalState(ptid: string | null, state: Record<string, ConversationLocalState>): void {
  try {
    writeDesktopDomainValueSync('chat.conversation-settings', conversationStateStorageKey(ptid), state);
  } catch (error) {
    log.warn('socialChat', 'save conversation local state failed', error);
  }
}

function groupEncryptedPayloadB64(message: GroupMessage): string {
  const encryptedPayload = (message as { encryptedPayload?: Uint8Array | string }).encryptedPayload;
  if (typeof encryptedPayload === 'string') return encryptedPayload;
  if (encryptedPayload && encryptedPayload.byteLength > 0) return bytesToB64(encryptedPayload);
  return '';
}

async function decodeGroupMessage(
  groupUlid: string,
  message: GroupMessage,
  logLabel: string,
): Promise<GroupMessage> {
  const payloadB64 = groupEncryptedPayloadB64(message);
  if (message.recalled) {
    return message;
  }
  if (!payloadB64) {
    return { ...message, content: GROUP_DECRYPT_FAILED_PLACEHOLDER } as GroupMessage;
  }
  const cached = getDecryptCache(message.ulid);
  if (cached) {
    return { ...message, content: cached.content, type: cached.type || message.type, attachments: cached.attachments } as GroupMessage;
  }
  try {
    const cipherBytes = Uint8Array.from(atob(payloadB64), c => c.charCodeAt(0));
    const plaintext = await imServiceV1.mlsGroup.decrypt(groupUlid, cipherBytes);
    await imServiceV1.mlsGroup.save(groupUlid);
    const payload = decodeEncryptedChatPayloadBytes(plaintext);
    if (!payload) {
      throw new Error('MLS plaintext is not a valid encrypted chat payload');
    }
    const result = applyDecodedChatPayload(message, payload);
    cacheDecryptedGroupMessage(message, result);
    return result;
  } catch (error) {
    log.warn('socialChat', logLabel, error);
    return { ...message, content: GROUP_DECRYPT_FAILED_PLACEHOLDER } as GroupMessage;
  }
}

export async function decodeGroupMessages(
  groupUlid: string,
  messages: GroupMessage[],
  logLabel: string,
): Promise<GroupMessage[]> {
  const decoded: GroupMessage[] = [];
  for (const message of messages) {
    decoded.push(await decodeGroupMessage(groupUlid, message, logLabel));
  }
  return decoded;
}

const initialSocialState: Pick<
  SocialChatState,
  | 'sessions'
  | 'groups'
  | 'activeTab'
  | 'activeSessionUlid'
  | 'activeGroupUlid'
  | 'messages'
  | 'threadMessages'
  | 'threadCounts'
  | 'threadLoading'
  | 'threadLoadingMore'
  | 'threadError'
  | 'threadHasMore'
  | 'threadNextCursor'
  | 'messageHasMore'
  | 'messageLoadingMore'
  | 'groupMembers'
  | 'loading'
  | 'loadError'
  | 'showDetail'
  | 'currentUserProfile'
  | 'currentUserDid'
  | 'friendRequests'
  | 'groupUnreadCounts'
  | 'lastPreviews'
  | 'peerProfiles'
  | 'peerProfileLoading'
  | 'conversationLocalState'
  | 'searchQuery'
  | 'searchResults'
  | 'searchLoading'
  | 'scrollToMessageUlid'
  | 'openThreadRootUlid'
  | 'encryptionEnabled'
  | 'ownFingerprint'
  | 'sessionEncrypted'
  | 'sessionSecurityState'
  | 'sessionCryptoVersion'
  | 'groupSecurityState'
  | 'friendP2pStatus'
  | 'peerOnline'
  | 'typingPeers'
  | 'reactions'
  | 'conversations'
  | 'conversationMembers'
> = {
  conversations: [],
  conversationMembers: {},
  sessions: [],
  groups: [],
  activeTab: 'friend',
  activeSessionUlid: null,
  activeGroupUlid: null,
  messages: {},
  threadMessages: {},
  threadCounts: {},
  threadLoading: {},
  threadLoadingMore: {},
  threadError: {},
  threadHasMore: {},
  threadNextCursor: {},
  messageHasMore: {},
  messageLoadingMore: {},
  groupMembers: {},
  loading: false,
  loadError: null,
  showDetail: false,
  currentUserProfile: null,
  currentUserDid: null,
  friendRequests: [],
  groupUnreadCounts: {},
  lastPreviews: {},
  peerProfiles: {},
  peerProfileLoading: {},
  conversationLocalState: {},
  searchQuery: '',
  searchResults: [],
  searchLoading: false,
  scrollToMessageUlid: null,
  openThreadRootUlid: null,

  reactions: {},

  encryptionEnabled: false,
  ownFingerprint: null,
  sessionEncrypted: {},
  sessionSecurityState: {},
  sessionCryptoVersion: {},
  groupSecurityState: {},
  friendP2pStatus: {},
  peerOnline: {},
  typingPeers: {},
};

export const useSocialChatStore = createDesktopStore<SocialChatState>('socialChat', (set, get) => ({
  ...initialSocialState,

  reset: () => set({ ...initialSocialState }),
  setSessionSecurityState: (sessionUlid, securityState, version) =>
    set((state) => ({
      sessionSecurityState: {
        ...state.sessionSecurityState,
        [sessionUlid]: securityState,
      },
      sessionEncrypted: {
        ...state.sessionEncrypted,
        [sessionUlid]: securityState === 'ready',
      },
      ...(version === undefined
        ? {}
        : {
            sessionCryptoVersion: {
              ...state.sessionCryptoVersion,
              [sessionUlid]: version,
            },
          }),
    })),
  setGroupSecurityState: (groupUlid, securityState) =>
    set((state) => ({
      groupSecurityState: {
        ...state.groupSecurityState,
        [groupUlid]: securityState,
      },
    })),

  hydrate: async (actorId: string) => {
    const did = actorId.trim();
    if (!did) return;
    if (currentAuthenticatedActorId() !== did) return;
    set({ currentUserDid: did });
    const { loadCurrentUserProfile, loadSessions, loadGroups } = get();
    await loadCurrentUserProfile();
    await Promise.all([loadSessions(), loadGroups()]);
  },
  setFriendP2pStatus: (sessionUlid, state, detail, transport) =>
    set((prev) => ({
      friendP2pStatus: {
        ...prev.friendP2pStatus,
        [sessionUlid]: {
          state,
          ...(detail ? { detail } : {}),
          ...(transport !== undefined ? { transport } : {}),
        },
      },
    })),

  // Skip the set() if the value is already what we'd write. React+
  // Zustand will otherwise re-render every consumer for a no-op flip,
  // which is hot when SSE delivers many transitions in quick succession.
  setPeerOnline: (did, online) => {
    if (!did) return;
    set((state) => {
      const next = applyPresenceToMap(state.peerOnline, did, online);
      return next ? { peerOnline: next } : state;
    });
  },

  initEncryption: async () => {
    const cryptoState = useCryptoStore.getState();
    set({
      encryptionEnabled: cryptoState.encryptionEnabled,
      ownFingerprint: cryptoState.ownFingerprint,
    });
  },

  loadSessions: async () => {
    if (!hasAuthenticatedActor()) return;
    set({ loading: true });
    try {
      const projections = await imServiceV1.messaging.listConversations();
      const allConversations = normalizeConversations(projections.map(conversation => ({
        conversation_id: conversation.conversationId,
        kind: conversation.kind,
        membership_epoch: conversation.membershipEpoch,
        mls_epoch: conversation.mlsEpoch,
        status: conversation.active ? 1 : 0,
        name: conversation.name,
        owner_ptid: conversation.ownerPtid,
        updated_at: new Date(conversation.updatedAtUnixMs).toISOString(),
      })));
      const directConversations = allConversations.filter((c) => c.kind === 1);
      const memberMap: Record<string, ConversationMember[]> = {};
      for (const conversation of projections.filter(item => item.kind === 1)) {
        memberMap[conversation.conversationId] = normalizeConversationMembers(
          conversation.memberPtids.map(ptid => ({
            conversation_id: conversation.conversationId,
            ptid,
            role: ptid === conversation.ownerPtid ? 3 : 1,
            member_status: 1,
          })),
        );
      }

      const groupMembersUpdate: Record<string, any[]> = { ...get().groupMembers };
      for (const conversation of projections.filter(item => item.kind === 2)) {
        groupMembersUpdate[conversation.conversationId] = conversation.memberPtids.map(ptid => ({
          conversationId: conversation.conversationId,
          ptid,
          role: ptid === conversation.ownerPtid ? 3 : 1,
          memberStatus: 1,
        }));
      }

      const actorId = currentAuthenticatedActorId() || '';
      const actorUsername = get().currentUserProfile?.username?.trim().toLowerCase() || '';
      const isSelfMember = (member: ConversationMember): boolean => {
        if (!member.ptid) return false;
        if (member.ptid === actorId) return true;
        if (actorUsername && member.ptid.includes(`:p:${actorUsername}:`)) return true;
        return false;
      };
      set({
        conversations: allConversations,
        conversationMembers: memberMap,
        groupMembers: groupMembersUpdate,
        sessions: [],
        groups: [],
        loading: false,
        loadError: null,
        ...(!get().currentUserDid && actorId ? { currentUserDid: actorId } : {}),
      });
      log.info('socialChat', 'loadConversations completed', {
        direct: directConversations.length,
        group: allConversations.length - directConversations.length,
      });

      // Trigger profile loading for DM peers so names resolve.
      for (const [, members] of Object.entries(memberMap)) {
        for (const m of members) {
          if (m.ptid && !isSelfMember(m) && !get().peerProfiles[m.ptid]) {
            get().loadPeerProfile(m.ptid).catch(() => {});
          }
        }
      }
      get().loadFriendRequests().catch(() => {});
    } catch (error) {
      set({ loading: false });
      if (isUnauthorizedError(error)) return;
      const message = error instanceof Error ? error.message : String(error);
      set({ loadError: message });
      log.error('socialChat', 'loadConversations failed', error);

      get().loadFriendRequests().catch(() => {});
    }
  },

  loadGroups: async () => {
    await get().loadSessions();
  },

  setActiveTab: (tab) => set({ activeTab: tab, openThreadRootUlid: null }),
  selectSession: (ulid) => {
      const state = get();
      const did = state.currentUserDid;

      set((prev) => ({
        activeSessionUlid: ulid,
        activeTab: 'friend' as const,
        openThreadRootUlid: null,
        sessions: did
          ? prev.sessions.map((s) => {
              if (s.ulid !== ulid) return s;
              if (s.participantADid === did) return { ...s, unreadCountA: 0 } as typeof s;
              if (s.participantBDid === did) return { ...s, unreadCountB: 0 } as typeof s;
              return s;
            })
          : prev.sessions,
      }));

      // Server-side ack: notify Station so next loadSessions reflects 0 unread.
      // Mirrors selectGroup → markGroupRead pattern.
      if (did) {
        const loadedMsgs = state.messages[ulid] as FriendChatMessage[] | undefined;
        if (loadedMsgs && loadedMsgs.length > 0) {
          const unreadUlids = loadedMsgs
            .filter((m) => m.senderDid !== did && m.status !== FriendMessageStatus.READ)
            .map((m) => m.ulid);
          if (unreadUlids.length > 0) {
            get().submitMessageReceipts(ulid, unreadUlids, FriendMessageStatus.READ).catch(() => {});
          }
        }
      }
    },
  selectGroup: (ulid) => {
      set((prev) => ({
        activeGroupUlid: ulid,
        activeTab: 'group' as const,
        openThreadRootUlid: null,
        groupUnreadCounts: { ...prev.groupUnreadCounts, [ulid]: 0 },
      }));
      get().markGroupRead(ulid).catch(() => {});
    },

  loadMessages: async (ulid, kind) => {
    if (!hasAuthenticatedActor()) return;
    const activeTab = kind ?? get().activeTab;
    // Fast path: if messages are already loaded for this conversation, render
    // them immediately without blocking on network+decrypt. A background
    // refresh still happens to pick up new messages.
    // Conversation switches must be cache-first and non-blocking. Empty
    // conversations should show the empty state while the refresh reconciles
    // in the background, not a visible spinner on every tab click.
    set({ loading: false });
    try {
      const projections = await imServiceV1.messaging.listMessages(ulid);
      const msgs = projections.map(projection =>
        projectMessagingProjection(activeTab, ulid, projection),
      );
      const visibleMsgs = filterClearedMessages(
        msgs,
        get().conversationLocalState,
        activeTab,
        ulid,
      );
      set((state) => ({
        messages: { ...state.messages, [ulid]: visibleMsgs },
        messageHasMore: {
          ...state.messageHasMore,
          [ulid]: false,
        },
        loading: false,
      }));
      const rootUlids = visibleMsgs
        .filter((msg) => !socialMessageExplicitThreadRootUlid(msg))
        .map((msg) => msg.ulid)
        .filter(Boolean);
      if (rootUlids.length > 0) {
        get().refreshThreadCounts(ulid, rootUlids, activeTab).catch(() => {});
      }
      // Ack unread friend messages as READ so sender sees correct read receipts
      if (activeTab === 'friend') {
        const viewerDid = get().currentUserDid;
        const unreadUlids = (visibleMsgs as FriendChatMessage[])
          .filter((m) => m.senderDid !== viewerDid && m.status !== FriendMessageStatus.READ)
          .map((m) => m.ulid);
        if (unreadUlids.length > 0) {
          get().submitMessageReceipts(ulid, unreadUlids, FriendMessageStatus.READ).catch(() => {});
        }
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        set({ loading: false });
        return;
      }
      log.error('socialChat', 'loadMessages failed', error);
      set({ loading: false });
      throw error;
    }
  },

  loadOlderMessages: async (ulid, kind) => {
    const activeKind = kind ?? get().activeTab;
    set((state) => ({
      messageHasMore: { ...state.messageHasMore, [ulid]: false },
      messageLoadingMore: { ...state.messageLoadingMore, [ulid]: false },
    }));
    await get().loadMessages(ulid, activeKind);
  },

  loadThreadMessages: async (ulid, rootUlid, kind, options) => {
    const activeKind = kind ?? get().activeTab;
    const key = socialThreadKey(activeKind, ulid, rootUlid);
    const append = options?.append === true;
    set((state) => ({
      ...(append
        ? { threadLoadingMore: { ...state.threadLoadingMore, [key]: true } }
        : { threadLoading: { ...state.threadLoading, [key]: true } }),
      threadError: { ...state.threadError, [key]: null },
    }));
    try {
      const fallbackRoot = (get().messages[ulid] || []).find((msg) => msg.ulid === rootUlid);
      const nextMessages = fallbackRoot ? [fallbackRoot] : [];
      const hasMore = false;
      const nextCursor = hasMore
        ? String(nextMessages.reduce((max, message) => Math.max(max, messageGroupSeq(message)), 0))
        : null;
      set((state) => ({
        threadMessages: { ...state.threadMessages, [key]: nextMessages },
        threadLoading: { ...state.threadLoading, [key]: false },
        threadLoadingMore: { ...state.threadLoadingMore, [key]: false },
        threadError: { ...state.threadError, [key]: null },
        threadHasMore: { ...state.threadHasMore, [key]: hasMore },
        threadNextCursor: { ...state.threadNextCursor, [key]: nextCursor },
      }));
      await get().refreshThreadCounts(ulid, [rootUlid], activeKind);
    } catch (error) {
      log.error('socialChat', 'loadThreadMessages failed', error);
      const fallbackRoot = (get().messages[ulid] || []).find((msg) => msg.ulid === rootUlid);
      const fallbackThread = fallbackRoot
        ? [
            fallbackRoot,
            ...(get().messages[ulid] || [])
              .filter((msg) => msg.ulid !== rootUlid && isMessageInThread(msg, rootUlid)),
          ]
        : [];
      set((state) => ({
        threadMessages: !append && fallbackThread.length > 0
          ? { ...state.threadMessages, [key]: mergeThreadMessages([], fallbackThread) }
          : state.threadMessages,
        threadLoading: { ...state.threadLoading, [key]: false },
        threadLoadingMore: { ...state.threadLoadingMore, [key]: false },
        threadError: {
          ...state.threadError,
          [key]: fallbackThread.length > 0 ? null : error instanceof Error ? error.message : String(error),
        },
      }));
      if (fallbackThread.length > 0) return;
      throw error;
    }
  },

  refreshThreadCounts: async (ulid, rootUlids, kind) => {
    const activeKind = kind ?? get().activeTab;
    const uniqueRootUlids = Array.from(new Set(rootUlids.filter(Boolean)));
    if (uniqueRootUlids.length === 0) return;
    try {
      const data = await imServiceV1.conversation.threadCounts(ulid, uniqueRootUlids);
      const counts = data?.counts || [];
      set((state) => {
        const next = { ...state.threadCounts };
        for (const count of counts) {
          next[socialThreadKey(activeKind, ulid, count.rootUlid)] = count;
        }
        return { threadCounts: next };
      });
    } catch (error) {
      log.warn('socialChat', 'refreshThreadCounts failed', error);
    }
  },

  markThreadRead: async (ulid, rootUlid, lastReadUlid, kind) => {
    const activeKind = kind ?? get().activeTab;
    if (!ulid || !rootUlid) return;
    try {
      const messages = get().threadMessages[socialThreadKey(activeKind, ulid, rootUlid)] ?? [];
      const lastReadSeq = messages.find((message) => message.ulid === lastReadUlid)
        ? messageGroupSeq(messages.find((message) => message.ulid === lastReadUlid)!)
        : messages.reduce((max, message) => Math.max(max, messageGroupSeq(message)), 0);
      await imServiceV1.conversation.setReadCursor(ulid, lastReadSeq);
      await get().refreshThreadCounts(ulid, [rootUlid], activeKind);
    } catch (error) {
      log.warn('socialChat', 'markThreadRead failed', error);
    }
  },

  sendFriendMessage: async (sessionUlid, receiverDid, content, type, replyToUlid, attachments, explicitThreadRootUlid) => {
    try {
      if (!receiverDid) {
        throw new Error('A recipient is required for a direct message');
      }
      if (replyToUlid || explicitThreadRootUlid || ((type ?? 1) !== 1 && !attachments?.length)) {
        throw new Error('This message type has not been migrated to the Messaging Engine');
      }
      await imServiceV1.messaging.sendMessage(sessionUlid, 'direct', content, attachments);
      get().setSessionSecurityState(sessionUlid, 'ready', 1);
      await get().loadMessages(sessionUlid, 'friend').catch((error) => {
        log.warn('socialChat', 'sendFriendMessage: post-send message refresh failed', error);
      });
      set((state) => ({
        lastPreviews: {
          ...state.lastPreviews,
          [sessionUlid]: { content, type: 1, senderId: get().currentUserDid ?? '' },
        },
      }));
    } catch (error) {
      log.error('socialChat', 'sendFriendMessage failed', error);
      throw error;
    }
  },

  sendGroupMessage: async (groupUlid, content, type, _replyToUlid, attachments, explicitThreadRootUlid) => {
    try {
      if (_replyToUlid || explicitThreadRootUlid || ((type ?? 1) !== 1 && !attachments?.length)) {
        throw new Error('This message type has not been migrated to the Messaging Engine');
      }
      await imServiceV1.messaging.sendMessage(groupUlid, 'group', content, attachments);
      get().setGroupSecurityState(groupUlid, 'ready');
      await get().loadMessages(groupUlid, 'group').catch((error) => {
        log.warn('socialChat', 'sendGroupMessage: post-send message refresh failed', error);
      });
      set((state) => ({
        lastPreviews: {
          ...state.lastPreviews,
          [groupUlid]: { content, type: 1, senderId: get().currentUserDid ?? '' },
        },
      }));
    } catch (error) {
      const currentSecurityState = get().groupSecurityState[groupUlid];
      if (currentSecurityState !== 'establishing' && currentSecurityState !== 'crypto-desynced') {
        get().setGroupSecurityState(groupUlid, 'error');
      }
      log.error('socialChat', 'sendGroupMessage failed', error);
      throw error;
    }
  },

  loadGroupMembers: async (groupUlid) => {
    if (!hasAuthenticatedActor()) return;
    try {
      const data = await api.groupChatGetMembers(groupUlid);
      const members = normalizeGroupMembers(data?.members);

      set((state) => ({
        groupMembers: { ...state.groupMembers, [groupUlid]: members },
      }));

      const actorId = get().currentUserDid || '';
      const actorUn = get().currentUserProfile?.username?.trim().toLowerCase() || '';
      for (const m of members) {
        if (m.ptid && m.ptid !== actorId && !(actorUn && m.ptid.includes(`:p:${actorUn}:`)) && !get().peerProfiles[m.ptid]) {
          get().loadPeerProfile(m.ptid).catch(() => {});
        }
      }
    } catch (error) {
      if (isUnauthorizedError(error)) return;
      log.error('socialChat', 'loadGroupMembers failed', error);
      throw error;
    }
  },

  toggleDetail: () => set((state) => ({ showDetail: !state.showDetail })),
  setShowDetail: (show) => set({ showDetail: show }),
  openThread: (rootUlid) => {
    const state = get();
    const activeKind = state.activeTab === 'friend' ? 'friend' : 'group';
    const ulid = activeKind === 'friend' ? state.activeSessionUlid : state.activeGroupUlid;
    set({ openThreadRootUlid: rootUlid, showDetail: false });
    if (!ulid || !rootUlid) return;
    const key = socialThreadKey(activeKind, ulid, rootUlid);
    get().loadThreadMessages(ulid, rootUlid, activeKind)
      .then(() => {
        const loaded = get().threadMessages[key] || [];
        const lastReadUlid = loaded.length > 0
          ? loaded[loaded.length - 1].ulid
          : rootUlid;
        return get().markThreadRead(ulid, rootUlid, lastReadUlid, activeKind);
      })
      .catch((error) => {
        log.warn('socialChat', 'openThread projection load failed', error);
      });
  },
  closeThread: () => set({ openThreadRootUlid: null }),

  deleteMessage: async (ulid, messageUlid, kind) => {
    const tab = kind ?? get().activeTab;
    const key = conversationKey(tab, ulid);
    set((state) => {
      const currentLocalState = state.conversationLocalState[key] ?? {};
      const nextLocalState = {
        ...state.conversationLocalState,
        [key]: {
          ...currentLocalState,
          deletedMessageUlids: {
            ...(currentLocalState.deletedMessageUlids ?? {}),
            [messageUlid]: true as true,
          },
        },
      };
      const nextMessagesForConversation = (state.messages[ulid] ?? [])
        .filter((message) => message.ulid !== messageUlid);
      const nextThreadMessages = Object.fromEntries(
        Object.entries(state.threadMessages).map(([threadKey, threadMessages]) => [
          threadKey,
          threadKey.startsWith(`${tab}:${ulid}:`)
            ? threadMessages.filter((message) => message.ulid !== messageUlid)
            : threadMessages,
        ]),
      );
      const nextPreviews = { ...state.lastPreviews };
      if (nextMessagesForConversation.length > 0) {
        nextPreviews[ulid] = previewFromMessage(
          nextMessagesForConversation[nextMessagesForConversation.length - 1],
        );
      } else {
        delete nextPreviews[ulid];
      }
      saveConversationLocalState(state.currentUserDid, nextLocalState);
      return {
        conversationLocalState: nextLocalState,
        messages: {
          ...state.messages,
          [ulid]: nextMessagesForConversation,
        },
        threadMessages: nextThreadMessages,
        lastPreviews: nextPreviews,
      };
    });
  },

  recallFriendMessage: async (sessionUlid, messageUlid) => {
    try {
      const state = get();
      await imServiceV1.conversation.submitCommand({
        conversation_id: sessionUlid,
        sender_ptid: state.currentUserDid ?? '',
        sender_device_id: localStorage.getItem('peers_im_device_id') ?? '',
        observed_membership_epoch: 0,
        retract_message: { target_message_id: messageUlid },
      } as any);
      // Optimistic flip: mark the local row recalled immediately.
      // The realtime echo will idempotently re-affirm the same
      // state via `applyMessageMutation`.
      get().applyMessageMutation(
        sessionUlid,
        messageUlid,
        'RECALL',
        { newContent: '', newCiphertext: new Uint8Array(), mutatedTsUnixMs: Date.now() },
      );
    } catch (error) {
      log.error('socialChat', 'recallFriendMessage failed', error);
      throw error;
    }
  },

  editFriendMessage: async (sessionUlid, messageUlid, newContent) => {
    if (!newContent.trim()) throw new Error('editFriendMessage: newContent is required');
    try {
      const localAddress = getLocalCryptoAddress();
      if (!localAddress) throw new Error('crypto runtime is not initialized');
      const session = get().sessions.find(item => item.ulid === sessionUlid);
      const receiverDid = session
        ? peerOfSession(session, localAddress.ptid).did
        : get().conversationMembers[sessionUlid]?.find(
            member => member.ptid !== localAddress.ptid,
          )?.ptid ?? '';
      if (!receiverDid) throw new Error('editFriendMessage: receiverDid is required');
      const peerHomeStationPeerId = get().conversationMembers[sessionUlid]?.find(
        member => member.ptid === receiverDid,
      )?.actorHomeStationPeerId;
      const commandId = crypto.randomUUID();
      const devicePayloads = await encryptDirectPayloads(
        sessionUlid,
        receiverDid,
        createEncryptedChatPayloadBytes(newContent.trim()),
        peerHomeStationPeerId || undefined,
        { commandId, contentType: 1 },
      );
      await imServiceV1.conversation.submitCommand(
        createProto(ConversationCommandSchema, {
          commandId,
          conversationId: sessionUlid,
          senderPtid: localAddress.ptid,
          senderDeviceId: localAddress.deviceId,
          observedMembershipEpoch: 0n,
          payload: {
            case: 'editMessage',
            value: {
              targetMessageId: messageUlid,
              devicePayloads,
              groupEncryptedPayload: new Uint8Array(),
            },
          },
        }),
      );
      get().applyMessageMutation(
        sessionUlid,
        messageUlid,
        'EDIT',
        {
          newContent: newContent.trim(),
          newCiphertext: new Uint8Array(),
          mutatedTsUnixMs: Date.now(),
        },
      );
    } catch (error) {
      log.error('socialChat', 'editFriendMessage failed', error);
      throw error;
    }
  },

  recallGroupMessage: async (groupUlid, messageUlid) => {
    try {
      const state = get();
      const localAddress = getLocalCryptoAddress();
      if (!localAddress) throw new Error('crypto runtime is not initialized');
      const membershipEpoch = Number(
        state.conversations.find((conversation) => conversation.conversationId === groupUlid)
          ?.membershipEpoch ?? 0,
      );
      await imServiceV1.conversation.submitCommand({
        conversation_id: groupUlid,
        sender_ptid: localAddress.ptid,
        sender_device_id: localAddress.deviceId,
        observed_membership_epoch: membershipEpoch,
        retract_message: { target_message_id: messageUlid },
      } as any);
      get().applyMessageMutation(
        groupUlid,
        messageUlid,
        'RECALL',
        { newContent: '', newCiphertext: new Uint8Array(), mutatedTsUnixMs: Date.now() },
      );
    } catch (error) {
      log.error('socialChat', 'recallGroupMessage failed', error);
      throw error;
    }
  },

  editGroupMessage: async (groupUlid, messageUlid, newContent, newCiphertext) => {
    if ((!newContent || newContent.trim() === '') && (!newCiphertext || newCiphertext.byteLength === 0)) {
      throw new Error('editGroupMessage: newContent or newCiphertext is required');
    }
    try {
      const localAddress = getLocalCryptoAddress();
      if (!localAddress) throw new Error('crypto runtime is not initialized');
      let editCiphertext = newCiphertext;
      if ((!editCiphertext || editCiphertext.byteLength === 0) && newContent?.trim()) {
        const plaintext = createEncryptedChatPayloadBytes(newContent.trim(), [], undefined);
        editCiphertext = await imServiceV1.mlsGroup.encrypt(groupUlid, plaintext);
        await imServiceV1.mlsGroup.save(groupUlid);
      }
      if (!editCiphertext || editCiphertext.byteLength === 0) {
        throw new Error('Group encryption state is not ready');
      }
      const state = get();
      const membershipEpoch = Number(
        state.conversations.find((conversation) => conversation.conversationId === groupUlid)
          ?.membershipEpoch ?? 0,
      );
      await imServiceV1.conversation.submitCommand({
        conversation_id: groupUlid,
        sender_ptid: localAddress.ptid,
        sender_device_id: localAddress.deviceId,
        observed_membership_epoch: membershipEpoch,
        edit_message: {
          target_message_id: messageUlid,
          group_encrypted_payload: bytesToB64(editCiphertext),
        },
      } as any);
      get().applyMessageMutation(
        groupUlid,
        messageUlid,
        'EDIT',
        {
          newContent: newContent ?? '',
          newCiphertext: editCiphertext,
          mutatedTsUnixMs: Date.now(),
        },
      );
    } catch (error) {
      log.error('socialChat', 'editGroupMessage failed', error);
      throw error;
    }
  },

  applyMessageMutation: (sessionUlid, messageUlid, kind, payload) => {
    set((state) => {
      const next = applyMessageMutationToList(state.messages[sessionUlid], messageUlid, { kind, ...payload });
      return next ? { messages: { ...state.messages, [sessionUlid]: next } } : {};
    });
  },

  reactToMessage: async (conversationId, messageId, emoji, remove = false) => {
    try {
      await imServiceV1.conversation.react(conversationId, messageId, emoji, remove);
      set((state) => {
        const existing = state.reactions[messageId] ?? [];
        const currentUserDid = state.currentUserDid ?? '';
        let updated: { actorId: string; emoji: string }[];
        if (remove) {
          updated = existing.filter((r) => !(r.actorId === currentUserDid && r.emoji === emoji));
        } else {
          const alreadyReacted = existing.some((r) => r.actorId === currentUserDid && r.emoji === emoji);
          updated = alreadyReacted ? existing : [...existing, { actorId: currentUserDid, emoji }];
        }
        return { reactions: { ...state.reactions, [messageId]: updated } };
      });
    } catch (error) {
      log.error('socialChat', 'reactToMessage failed', error);
      throw error;
    }
  },

  loadCurrentUserProfile: async () => {
    if (!hasAuthenticatedActor()) return;
    try {
      const profile = await api.actorGetMyProfile();
      const profileDid = profile?.id?.trim() || null;
      set({
        currentUserProfile: profile,
        currentUserDid: profileDid,
        conversationLocalState: loadConversationLocalState(profileDid),
      });
    } catch (error) {
      if (isUnauthorizedError(error)) return;
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({ loadError: state.loadError || message }));
      log.error('socialChat', 'loadCurrentUserProfile failed', error);
      throw error;
    }
  },

  loadPeerProfile: async (peerDid, force = false) => {
    if (!hasAuthenticatedActor()) return;
    const did = (peerDid || '').trim();
    if (!did) return;
    const state = get();
    // Self profile is owned by `loadCurrentUserProfile`; never re-fetch it
    // through the peer endpoint or we'd double-write the same actor through
    // two different runtime channels.
    if (state.currentUserDid && state.currentUserDid === did) return;
    if (state.peerProfileLoading[did]) return;
    if (!force && did in state.peerProfiles) return;

    set((prev) => ({
      peerProfileLoading: { ...prev.peerProfileLoading, [did]: true },
    }));
    try {
      const profile = await api.peerProfileGet(did);
      set((prev) => ({
        peerProfiles: { ...prev.peerProfiles, [did]: profile ?? null },
        peerProfileLoading: { ...prev.peerProfileLoading, [did]: false },
      }));
    } catch (error) {
      log.warn('socialChat', 'loadPeerProfile failed', { peerDid: did, error });
      set((prev) => ({
        // Cache `null` so the UI stops spinning and falls back to the
        // session-derived display name + avatar; a future force-refresh
        // (e.g. on profile-updated event) will retry.
        peerProfiles: { ...prev.peerProfiles, [did]: null },
        peerProfileLoading: { ...prev.peerProfileLoading, [did]: false },
      }));
    }
  },

  loadFriendRequests: async (status, limit, offset) => {
    if (!hasAuthenticatedActor()) return;
    try {
      const data = await api.friendChatListFriendRequests(status, limit, offset);
      const requests = normalizeFriendRequests(
        (data as Record<string, unknown>)?.requests ?? [],
      );
      set({ friendRequests: requests });
      await Promise.allSettled(
        friendRequestProfileDids(requests, get().currentUserDid)
          .map((did) => get().loadPeerProfile(did)),
      );
    } catch {
      set({ friendRequests: [] });
    }
  },

  sendFriendRequest: async (receiverDid, message) => {
    try {
      await api.friendChatSendFriendRequest(receiverDid, message);
      await get().loadFriendRequests();
    } catch (error) {
      log.error('socialChat', 'sendFriendRequest failed', error);
      throw error;
    }
  },

  acceptFriendRequest: async (requestId) => {
    try {
      const data = await api.friendChatAcceptFriendRequest(requestId);
      const acceptedRequest = normalizeFriendRequestData(data?.request);
      set((state) => ({
        friendRequests: state.friendRequests.map((request) =>
          request.id === requestId
            ? {
                ...request,
                status: Number(acceptedRequest?.status ?? 2),
                respondedAt: acceptedRequest?.respondedAt ?? request.respondedAt,
              }
            : request,
        ),
      }));
      const sessionJson = data?.session;
      if (sessionJson) {
        const s = sessionJson as unknown as FriendChatSession;
        set((state) => ({
          sessions: [s, ...state.sessions.filter((x) => x.ulid !== s.ulid)],
        }));
      }
      await get().loadFriendRequests();
      await get().loadSessions();
      // Retry loadSessions after a short delay to catch the DM conversation
      // that Station creates asynchronously upon friend acceptance.
      setTimeout(() => { get().loadSessions().catch(() => {}); }, 1500);
    } catch (error) {
      log.error('socialChat', 'acceptFriendRequest failed', error);
      throw error;
    }
  },

  rejectFriendRequest: async (requestId) => {
    try {
      const data = await api.friendChatRejectFriendRequest(requestId);
      const rejectedRequest = normalizeFriendRequestData(data?.request);
      set((state) => ({
        friendRequests: state.friendRequests.map((request) =>
          request.id === requestId
            ? {
                ...request,
                status: Number(rejectedRequest?.status ?? 3),
                respondedAt: rejectedRequest?.respondedAt ?? request.respondedAt,
              }
            : request,
        ),
      }));
      await get().loadFriendRequests();
    } catch (error) {
      log.error('socialChat', 'rejectFriendRequest failed', error);
      throw error;
    }
  },

  loadGroupUnreadCounts: async () => {
    // Unread counts are tracked via the envelope resume system (imRuntime).
    // No dedicated conversation subserver endpoint — counts accumulate from events.
    if (!hasAuthenticatedActor()) return;
  },

  loadConversationPreviews: async () => {
    // Previews are populated from real-time envelope events after decryption.
    // The conversation subserver stores encrypted payloads only — plaintext
    // previews come from the client's local decryption cache or live stream.
    if (!hasAuthenticatedActor()) return;
  },

  submitMessageReceipts: async (conversationUlid, messageUlids, status) => {
    try {
      const receiptType = status === FriendMessageStatus.READ
        ? ReceiptType.READ
        : ReceiptType.DELIVERED;
      await Promise.all(
        messageUlids.map((messageUlid) =>
          imServiceV1.conversation.submitReceipt(conversationUlid, messageUlid, receiptType),
        ),
      );
    } catch (error) {
      log.error('socialChat', 'submitMessageReceipts failed', error);
      throw error;
    }
  },

  applyMessageReceipt: (sessionUlid, messageUlid, kind) => {
    set((state) => {
      const next = applyMessageReceiptToList(state.messages[sessionUlid], messageUlid, kind);
      return next ? { messages: { ...state.messages, [sessionUlid]: next } } : state;
    });
  },

  applyTypingState: (sessionUlid, fromActorId, typing) => {
    if (!sessionUlid || !fromActorId) return;
    set((state) => {
      const next = applyTypingStateToMap(state.typingPeers, sessionUlid, fromActorId, typing);
      return next ? { typingPeers: next } : state;
    });
  },

  sweepTypingPeers: (staleBefore) => {
    set((state) => {
      const next = pruneTypingPeers(state.typingPeers, staleBefore);
      return next ? { typingPeers: next } : state;
    });
  },

  ingestRealtimeMessage: async (kind, conversationUlid, message) => {
    if (!conversationUlid || !message.ulid) return;
    await get().loadMessages(conversationUlid, kind);
  },

  markGroupRead: async (groupUlid) => {
    try {
      const lastReadSeq = (get().messages[groupUlid] ?? [])
        .reduce((max, message) => Math.max(max, messageGroupSeq(message)), 0);
      await imServiceV1.conversation.setReadCursor(groupUlid, lastReadSeq);
      set((state) => ({
        groupUnreadCounts: { ...state.groupUnreadCounts, [groupUlid]: 0 },
      }));
    } catch (error) {
      log.error('socialChat', 'markGroupRead failed', error);
      throw error;
    }
  },

  updateConversationLocalState: async (kind, ulid, patch) => {
    const key = conversationKey(kind, ulid);
    try {
      if (patch.muted !== undefined) {
        await imServiceV1.conversation.updateMemberSettings(ulid, { muted: patch.muted });
      }
    } catch (error) {
      log.error('socialChat', 'update conversation settings failed', { kind, ulid, error });
      throw error;
    }
    set((state) => {
      const nextLocalState = {
        ...state.conversationLocalState,
        [key]: {
          ...state.conversationLocalState[key],
          ...patch,
        },
      };
      saveConversationLocalState(state.currentUserDid, nextLocalState);
      return { conversationLocalState: nextLocalState };
    });
  },

  hideConversation: async (kind, ulid, keepHistory) => {
    const key = conversationKey(kind, ulid);
    const nextEntry: ConversationLocalState = {
      hidden: true,
      ...(keepHistory ? {} : { clearedAt: Date.now() }),
    };
    set((state) => {
      const nextLocalState = { ...state.conversationLocalState, [key]: nextEntry };
      saveConversationLocalState(state.currentUserDid, nextLocalState);
      const nextMessages = { ...state.messages };
      const nextPreviews = { ...state.lastPreviews };
      if (!keepHistory) {
        delete nextMessages[ulid];
        delete nextPreviews[ulid];
      }
      return {
        conversationLocalState: nextLocalState,
        messages: nextMessages,
        lastPreviews: nextPreviews,
        ...(kind === 'friend' && state.activeSessionUlid === ulid ? { activeSessionUlid: null } : {}),
        ...(kind === 'group' && state.activeGroupUlid === ulid ? { activeGroupUlid: null } : {}),
      };
    });
  },

  restoreConversation: (kind, ulid) => {
    const key = conversationKey(kind, ulid);
    set((state) => {
      const current = state.conversationLocalState[key];
      if (!current?.hidden) return {};
      const nextLocalState = {
        ...state.conversationLocalState,
        [key]: { ...current, hidden: false },
      };
      saveConversationLocalState(state.currentUserDid, nextLocalState);
      return { conversationLocalState: nextLocalState };
    });
  },

  deleteFriendContact: async (sessionUlid) => {
    const state = get();
    const session = state.sessions.find((item) => item.ulid === sessionUlid);
    const peerDid = session ? peerOfSession(session, state.currentUserDid).did : '';
    if (!peerDid) throw new Error('Cannot delete friend without peer DID');

    try {
      await api.friendChatBlockUser(peerDid);
      set((prev) => {
        const nextLocalState = { ...prev.conversationLocalState };
        delete nextLocalState[conversationKey('friend', sessionUlid)];
        const nextMessages = { ...prev.messages };
        const nextPreviews = { ...prev.lastPreviews };
        delete nextMessages[sessionUlid];
        delete nextPreviews[sessionUlid];
        saveConversationLocalState(prev.currentUserDid, nextLocalState);
        return {
          sessions: prev.sessions.filter((item) => item.ulid !== sessionUlid),
          friendRequests: prev.friendRequests.filter((request) => (
            !(
              (request.senderId === peerDid || request.receiverId === peerDid)
              && (request.senderId === prev.currentUserDid || request.receiverId === prev.currentUserDid)
            )
          )),
          conversationLocalState: nextLocalState,
          messages: nextMessages,
          lastPreviews: nextPreviews,
          ...(prev.activeSessionUlid === sessionUlid ? { activeSessionUlid: null } : {}),
        };
      });
      await Promise.allSettled([get().loadSessions(), get().loadFriendRequests()]);
    } catch (error) {
      log.error('socialChat', 'deleteFriendContact failed', error);
      throw error;
    }
  },

  deleteGroupContact: async (groupUlid) => {
    try {
      const state = get();
      const actorPtid = state.currentUserDid ?? '';
      if (!actorPtid) throw new Error('No authenticated actor');
      const [conversation, federationSelf, device] = await Promise.all([
        imServiceV1.conversation.getConversation(groupUlid),
        api.federationGetSelf(),
        api.accountGetDeviceId(),
      ]);
      await imServiceV1.mlsGroup.requestLeaveIntent({
        federationId: conversation.federationId,
        authorityStationPeerId: conversation.authorityStationPeerId,
        authorityEpoch: Number(conversation.authorityEpoch),
        homeStationPeerId: federationSelf.homeStationPeerId,
        conversationId: groupUlid,
        actorPtid,
        actorDeviceId: device.device_id,
        observedMembershipEpoch: Number(conversation.membershipEpoch),
        observedMlsEpoch: Number(conversation.mlsEpoch),
      });
      get().setGroupSecurityState(groupUlid, 'establishing');
    } catch (error) {
      log.error('socialChat', 'deleteGroupContact failed', error);
      throw error;
    }
  },

  getUnifiedConversations: () => {
    const state = get();
    const did = state.currentUserDid;
    const out: UnifiedConversation[] = [];

    for (const s of state.sessions) {
      if (state.conversationLocalState[conversationKey('friend', s.ulid)]?.hidden) continue;
      const peer = peerOfSession(s, did);
      const loadedMsgs = state.messages[s.ulid];
      const loadedMainMsgs = loadedMsgs?.filter((message) => !socialMessageExplicitThreadRootUlid(message));
      const friendPreview = loadedMainMsgs && loadedMainMsgs.length > 0
        ? previewFromMessage(loadedMainMsgs[loadedMainMsgs.length - 1])
        : state.lastPreviews[s.ulid];
      out.push({
        type: 'friend',
        ulid: s.ulid,
        name: peer.name || 'Friend',
        avatar: peer.avatar || '',
        lastActivity: activityFromSession(s),
        unread: visibleConversationUnread(
          friendUnreadForViewer(s, did),
          state.conversationLocalState[conversationKey('friend', s.ulid)],
        ),
        preview: friendPreview,
        friendSession: s,
      });
    }

    for (const g of state.groups) {
      if (state.conversationLocalState[conversationKey('group', g.ulid)]?.hidden) continue;
      const loadedGroupMsgs = state.messages[g.ulid];
      const loadedMainGroupMsgs = loadedGroupMsgs?.filter((message) => !socialMessageExplicitThreadRootUlid(message));
      const groupPreview = loadedMainGroupMsgs && loadedMainGroupMsgs.length > 0
        ? previewFromMessage(loadedMainGroupMsgs[loadedMainGroupMsgs.length - 1])
        : state.lastPreviews[g.ulid];
      out.push({
        type: 'group',
        ulid: g.ulid,
        name: g.name || 'Group',
        avatar: groupAvatarRemoteUrl(g),
        lastActivity: activityFromGroup(g),
        unread: visibleConversationUnread(
          state.groupUnreadCounts[g.ulid] ?? 0,
          state.conversationLocalState[conversationKey('group', g.ulid)],
        ),
        preview: groupPreview,
        group: g,
      });
    }

    return out.sort((a, b) => {
      const stickyDelta = Number(Boolean(state.conversationLocalState[conversationKey(b.type, b.ulid)]?.sticky))
        - Number(Boolean(state.conversationLocalState[conversationKey(a.type, a.ulid)]?.sticky));
      if (stickyDelta !== 0) return stickyDelta;
      return b.lastActivity.getTime() - a.lastActivity.getTime();
    });
  },

  getIMConversations: () => {
    const state = get();
    const actorId = state.currentUserDid || '';
    const actorUsername = state.currentUserProfile?.username?.trim().toLowerCase() || '';
    const isOwnPtid = (ptid: string): boolean => {
      if (ptid === actorId) return true;
      if (actorUsername && ptid.includes(`:p:${actorUsername}:`)) return true;
      return false;
    };
    const out: DesktopIMConversationProjection[] = [];

    for (const conv of state.conversations) {
      const convId = conv.conversationId;
      const isDirect = conv.kind === 1;
      const kind = isDirect ? 'friend' : 'group';
      const localState = state.conversationLocalState[conversationKey(kind, convId)];

      const loadedMsgs = state.messages[convId];
      const loadedMainMsgs = loadedMsgs?.filter((message) => !socialMessageExplicitThreadRootUlid(message));
      const preview = loadedMainMsgs && loadedMainMsgs.length > 0
        ? previewFromMessage(loadedMainMsgs[loadedMainMsgs.length - 1])
        : state.lastPreviews[convId];

      const lastMsgMs = loadedMainMsgs && loadedMainMsgs.length > 0
        ? messageSentMs(loadedMainMsgs[loadedMainMsgs.length - 1])
        : 0;
      const lastActivity = lastMsgMs > 0
        ? new Date(lastMsgMs)
        : (conv.updatedAt ? timestampDate(conv.updatedAt) : new Date(0));

      if (isDirect) {
        const members = state.conversationMembers[convId] || [];
        const peer = members.find((m) => m.ptid && !isOwnPtid(m.ptid)) || members[0];
        const peerDid = peer?.ptid || '';
        const profile = state.peerProfiles[peerDid];
        const friendReq = peerDid
          ? state.friendRequests.find((r) => r.senderId === peerDid || r.receiverId === peerDid)
          : undefined;
        const peerName = peer?.nickname
          || profile?.display_name
          || profile?.username
          || (friendReq ? (friendReq.senderId === peerDid ? friendReq.senderDisplayName : friendReq.receiverDisplayName) : '')
          || peerDid
          || 'Friend';
        out.push(projectDesktopIMConversation({
          type: 'friend',
          ulid: convId,
          name: peerName,
          avatar: profile?.avatar || '',
          peerDid,
          lastActivity,
          unread: state.groupUnreadCounts[convId] ?? 0,
          muted: localState?.muted ?? (peer?.muted || false),
          alertEnabled: localState?.alertEnabled,
          hidden: localState?.hidden,
          preview,
        }));
      } else {
        const memberCount = (state.conversationMembers[convId] || []).length
          || (state.groupMembers[convId] || []).length
          || Number(conv.maxMembers || 0);
        out.push(projectDesktopIMConversation({
          type: 'group',
          ulid: convId,
          name: conv.name || 'Group',
          avatar: groupAvatarRemoteUrl({ avatarCid: conv.avatarCid || '' }),
          memberCount,
          lastActivity,
          unread: state.groupUnreadCounts[convId] ?? 0,
          muted: localState?.muted,
          alertEnabled: localState?.alertEnabled,
          hidden: localState?.hidden,
          preview,
        }));
      }
    }

    return out.sort((a, b) => {
      const stickyDelta = Number(Boolean(state.conversationLocalState[conversationKey(b.kind, b.id)]?.sticky))
        - Number(Boolean(state.conversationLocalState[conversationKey(a.kind, a.id)]?.sticky));
      if (stickyDelta !== 0) return stickyDelta;
      return b.lastActivityMs - a.lastActivityMs;
    });
  },

  getIMMessages: (kind, conversationUlid) => {
    const state = get();
    return projectDesktopIMMessages(
      kind,
      conversationUlid,
      state.messages[conversationUlid] || [],
    );
  },

  getIMThreadMessages: (kind, conversationUlid, rootUlid) => {
    const state = get();
    const key = socialThreadKey(kind, conversationUlid, rootUlid);
    return projectDesktopIMMessages(
      kind,
      conversationUlid,
      state.threadMessages[key] || [],
    );
  },

  getIMSenderProfile: (kind, conversationUlid, senderDid) => {
    const state = get();
    const did = senderDid.trim();
    const isSelf = Boolean(state.currentUserDid && did === state.currentUserDid);

    if (isSelf) {
      return {
        id: did,
        name: state.currentUserProfile?.displayName
          || state.currentUserProfile?.username
          || state.currentUserDid
          || did,
        avatar: state.currentUserProfile?.avatar || '',
        isSelf,
      };
    }

    if (kind === 'friend') {
      const session = state.sessions.find((item) => item.ulid === conversationUlid);
      const peer = session ? peerOfSession(session, state.currentUserDid) : null;
      if (peer?.name) {
        return { id: did || peer.did || '', name: peer.name, avatar: peer.avatar || '', isSelf };
      }
      const profile = state.peerProfiles[did];
      if (profile) {
        return { id: did, name: profile.display_name || profile.username || did, avatar: profile.avatar || '', isSelf };
      }
      const convMembers = state.conversationMembers[conversationUlid] || [];
      const memberEntry = convMembers.find((m) => m.ptid === did);
      if (memberEntry?.nickname) {
        return { id: did, name: memberEntry.nickname, avatar: '', isSelf };
      }
      const friendReq = state.friendRequests.find((r) => r.senderId === did || r.receiverId === did);
      if (friendReq) {
        const name = friendReq.senderId === did ? friendReq.senderDisplayName : friendReq.receiverDisplayName;
        const avatar = friendReq.senderId === did ? friendReq.senderAvatar : friendReq.receiverAvatar;
        if (name) return { id: did, name, avatar: avatar || '', isSelf };
      }
      return { id: did, name: did, avatar: '', isSelf };
    }

    const member = state.groupMembers[conversationUlid]?.find((item) => item.ptid === did);
    const profile = state.peerProfiles[did];
    const profileName = profile?.display_name || profile?.username || '';
    const fallback = actorProfileFromSessions(
      state.sessions,
      state.currentUserDid,
      did,
      state.currentUserProfile,
    );
    return {
      id: did,
      name: member?.nickname || profileName || fallback.name || did,
      avatar: profile?.avatar || fallback.avatar || '',
      isSelf,
    };
  },

  searchMessages: async (query, scope, conversationId) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      set({ searchResults: [], searchQuery: '' });
      return;
    }
    set({ searchLoading: true, searchQuery: trimmedQuery });
    try {
      const state = get();
      const targets = [
        ...state.sessions.map(session => ({ conversationId: session.ulid, scope: 'friend' as const })),
        ...state.groups.map(group => ({ conversationId: group.ulid, scope: 'group' as const })),
      ].filter(target => (
        (!conversationId || target.conversationId === conversationId)
        && (!scope || scope === target.scope)
      ));
      const projected = await Promise.all(targets.map(async target => ({
        ...target,
        messages: await imServiceV1.messaging.searchMessages(
          target.conversationId,
          trimmedQuery,
          { limit: 50 },
        ),
      })));
      if (get().searchQuery !== trimmedQuery) return;
      const results: SearchResult[] = projected.flatMap(({ conversationId, scope, messages }) => {
        let conversationName = '';
        if (scope === 'friend') {
          const session = state.sessions.find((item) => item.ulid === conversationId);
          if (session) {
            conversationName = peerDisplayName(session, state.currentUserDid)
              || peerOfSession(session, state.currentUserDid).did;
          }
        } else {
          const group = state.groups.find((item) => item.ulid === conversationId);
          conversationName = group?.name || '';
        }
        return messages
          .filter(message => {
            const localState = state.conversationLocalState[conversationKey(scope, conversationId)];
            const clearedAt = localState?.clearedAt ?? 0;
            if (localState?.deletedMessageUlids?.[message.messageId]) return false;
            return !clearedAt || message.timestampUnixMs >= clearedAt;
          })
          .map(message => ({
            messageId: message.messageId,
            conversationId,
            scope,
            senderDid: message.senderPtid,
            content: message.plaintext,
            sentAt: message.timestampUnixMs,
            conversationName: conversationName || conversationId.slice(0, 12),
            attachments: message.attachments.map(attachment => ({
              filename: attachment.filename,
              mimeType: attachment.mimeType,
            })),
            hasLoadedThreadReplies: false,
          }));
      }).sort((left, right) => (
        right.sentAt - left.sentAt || right.messageId.localeCompare(left.messageId)
      )).slice(0, 100);
      set({ searchResults: results, searchLoading: false });
    } catch (error) {
      log.error('socialChat', 'searchMessages failed', error);
      if (get().searchQuery === trimmedQuery) {
        set({ searchLoading: false });
      }
      throw error;
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [], searchLoading: false }),

  setScrollToMessageUlid: (ulid) => set({ scrollToMessageUlid: ulid }),

}));
