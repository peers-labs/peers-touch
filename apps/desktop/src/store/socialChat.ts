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
  pickLatestKeyExchangeBundle,
  type AccountProfile,
  type ChatAttachmentInput,
  type ChatIndexLocalMessageInput,
  type ChatSearchLocalResultRow,
  type ChatThreadCount,
} from '../services/desktop_api';
import {
  EncryptedMessageSchema,
  FriendChatMessageSchema,
  FriendMessageAttachmentSchema,
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
import { X3dhSessionInitSchema } from '../gen/proto/domain/chat/key_exchange_pb';
import {
  CommittedConversationEventSchema,
  type CommittedConversationEvent,
  type Conversation,
  type ConversationMember,
} from '../gen/proto/domain/chat/conversation_pb';
import { imServiceV1 } from '../services/im-service';
import { DirectKeyExchangeKind } from '../services/im-service-contract';
import { receiptTypeForMessageStatus } from '../services/chatReceipt';
import { isPresenceOnline } from '../services/chatPresence';
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
  mergeConversationMessages,
  messageSentMs,
  preserveMessageReceiptStatuses,
  previewFromMessage,
  pruneTypingPeers,
  projectDesktopIMConversation,
  projectDesktopIMMessages,
  projectConversationMessageEvents,
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

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

interface FriendEncryptedEnvelope {
  version: 1;
  ciphertext: string;
  counter: number;
  ratchetPub?: string;
  prevCounter?: number;
  nonce?: string;
}

function encodeFriendEncryptedEnvelope(input: FriendEncryptedEnvelope): string {
  const wire = createProto(EncryptedMessageSchema, {
    ciphertext: b64ToBytes(input.ciphertext),
    counter: input.counter,
    ratchetPub: input.ratchetPub ? b64ToBytes(input.ratchetPub) : new Uint8Array(),
    prevCounter: input.prevCounter ?? 0,
    version: input.version,
    nonce: input.nonce ? b64ToBytes(input.nonce) : new Uint8Array(),
  });
  return bytesToB64(toBinary(EncryptedMessageSchema, wire));
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

function friendAttachmentFromInput(attachment: ChatAttachmentInput) {
  return createProto(FriendMessageAttachmentSchema, {
    cid: attachment.cid,
    filename: attachment.filename,
    mimeType: attachment.mime_type,
    size: BigInt(attachment.size),
    thumbnailCid: attachment.thumbnail_cid ?? '',
    visibility: attachment.visibility ?? '',
    mediaEncryption: encryptedMediaDescriptorFromInput(attachment),
  });
}

function optimisticFriendMessage(input: {
  localId: string;
  sessionUlid: string;
  senderDid: string;
  receiverDid: string;
  content: string;
  type?: number;
  replyToUlid?: string;
  attachments: readonly ChatAttachmentInput[];
}): FriendChatMessage {
  const now = timestampFromDate(new Date());
  return createProto(FriendChatMessageSchema, {
    ulid: input.localId,
    sessionUlid: input.sessionUlid,
    senderDid: input.senderDid,
    receiverDid: input.receiverDid,
    type: input.type ?? 1,
    content: input.content,
    attachments: input.attachments.map(friendAttachmentFromInput),
    replyToUlid: input.replyToUlid ?? '',
    status: FriendMessageStatus.SENDING,
    sentAt: now,
    createdAt: now,
    updatedAt: now,
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

async function encryptFriendMessagePayload(
  sessionUlid: string,
  content: string,
  attachments: readonly ChatAttachmentInput[] = [],
  messageType?: number,
): Promise<string> {
  const plaintextBytes = createEncryptedChatPayloadBytes(content, attachments, messageType);
  const encryptedPlaintext = bytesToB64(plaintextBytes);
  const status = await api.cryptoSessionStatus(sessionUlid);
  if (!status.established) {
    throw new Error('Secure channel is not ready');
  }
  if (status.version !== 1) {
    throw new Error('Secure channel is not Double Ratchet v1');
  }
  const enc = await api.drEncrypt(sessionUlid, encryptedPlaintext);
  if (enc.version !== 1) {
    throw new Error('Double Ratchet returned an unsupported version');
  }
  return encodeFriendEncryptedEnvelope({
    version: 1,
    ciphertext: enc.ciphertext,
    counter: enc.counter,
    ratchetPub: enc.ratchet_pub,
    prevCounter: enc.prev_counter,
    nonce: enc.nonce,
  });
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

type DecryptCacheEntry = {
  content: string;
  type: number;
  attachments: unknown[];
  cachedAt: number;
};

function persistDecryptCache(messageId: string, entry: DecryptCacheEntry): void {
  api.chatDecryptCachePut({
    message_id: messageId,
    content: entry.content,
    message_type: entry.type,
    attachments_json: JSON.stringify(
      entry.attachments,
      (_key, value) => typeof value === 'bigint' ? value.toString() : value,
    ),
    cached_at: entry.cachedAt,
  }).catch((error) => {
    log.warn('socialChat', 'persist decrypt cache failed', error);
  });
}

async function readDurableDecryptCache(messageId: string): Promise<DecryptCacheEntry | null> {
  try {
    const { entry } = await api.chatDecryptCacheGet(messageId);
    if (!entry) return null;
    const cached: DecryptCacheEntry = {
      content: entry.content,
      type: entry.message_type,
      attachments: JSON.parse(entry.attachments_json) as unknown[],
      cachedAt: entry.cached_at,
    };
    setDecryptCache(messageId, cached);
    return cached;
  } catch (error) {
    log.warn('socialChat', 'read decrypt cache failed', error);
    return null;
  }
}

function cacheOwnCommittedMessage(
  event: CommittedConversationEvent,
  content: string,
  attachments: readonly ChatAttachmentInput[],
  messageType?: number,
): void {
  if (event.payload.case !== 'messageCommitted' || !event.payload.value.messageId) return;
  const entry = {
    content,
    type: messageType ?? encryptedChatTransportMessageType(),
    attachments: attachments.map(groupAttachmentFromInput),
    cachedAt: Date.now(),
  };
  setDecryptCache(event.payload.value.messageId, entry);
  persistDecryptCache(event.payload.value.messageId, entry);
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
    attachments?: ChatAttachmentInput[],
    threadRootUlid?: string,
    localMessageUlid?: string,
  ) => Promise<void>;
  retryFriendMessage: (
    sessionUlid: string,
    messageUlid: string,
    receiverDid: string,
  ) => Promise<void>;
  sendGroupMessage: (
    groupUlid: string,
    content: string,
    type?: number,
    replyToUlid?: string,
    attachments?: ChatAttachmentInput[],
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
  /**
   * Edit a previously-sent friend chat message. At least one of
   * `newContent` or `newCiphertext` must be non-empty; both may
   * be provided when an E2EE session also keeps a plaintext index
   * for local search. Like recall, the optimistic update is left
   * to the realtime convergence path.
   */
  editFriendMessage: (
    sessionUlid: string,
    messageUlid: string,
    newContent?: string,
    newCiphertext?: Uint8Array,
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
  ackFriendMessages: (
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
  establishSession: (
    sessionUlid: string,
    peerDid: string,
    initiatedBySend?: boolean,
  ) => Promise<boolean>;
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


function socialMessageReplyToUlid(msg: SocialMessage): string {
  return msg.replyToUlid || '';
}

function socialMessageExplicitThreadRootUlid(msg: SocialMessage): string {
  return (msg as SocialMessage & { threadRootUlid?: string }).threadRootUlid || '';
}

function socialMessageSentAtMs(msg: SocialMessage): number {
  const timestamp = msg.sentAt ?? msg.createdAt;
  return timestamp ? timestampDate(timestamp).getTime() : 0;
}

function cacheDecryptedGroupMessage(message: GroupMessage, decoded: GroupMessage): void {
  if (!message.ulid) return;
  const entry = {
    content: decoded.content,
    type: decoded.type || message.type,
    attachments: decoded.attachments as unknown[],
    cachedAt: Date.now(),
  };
  setDecryptCache(message.ulid, entry);
  persistDecryptCache(message.ulid, entry);
}

function isMessageInThread(msg: SocialMessage, rootUlid: string): boolean {
  return socialMessageExplicitThreadRootUlid(msg) === rootUlid;
}

const THREAD_REPLY_PAGE_SIZE = 50;

function mergeThreadMessages(existing: SocialMessage[], incoming: SocialMessage[]): SocialMessage[] {
  return mergeUniqueChatMessages(existing, incoming);
}

export function socialThreadKey(kind: 'friend' | 'group', ulid: string, rootUlid: string): string {
  return `${kind}:${ulid}:${rootUlid}`;
}

function stringFromRecord(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function attachmentMetadataFromUnknown(value: unknown): SearchResultAttachment | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const filename = stringFromRecord(record, 'filename', 'file_name', 'name');
  const mimeType = stringFromRecord(record, 'mimeType', 'mime_type', 'mime');
  if (!filename && !mimeType) return null;
  return { filename, mimeType };
}

function searchRowAttachments(row: ChatSearchLocalResultRow): SearchResultAttachment[] {
  const record = row as unknown as Record<string, unknown>;
  const attachments = Array.isArray(record.attachments)
    ? record.attachments
        .map(attachmentMetadataFromUnknown)
        .filter((item): item is SearchResultAttachment => item !== null)
    : [];
  const topLevel = attachmentMetadataFromUnknown({
    filename: record.filename,
    mime_type: record.mime_type,
  });
  return topLevel ? [topLevel, ...attachments] : attachments;
}

function dedupeSearchAttachments(items: SearchResultAttachment[]): SearchResultAttachment[] {
  const seen = new Set<string>();
  const out: SearchResultAttachment[] = [];
  for (const item of items) {
    const key = `${item.filename.toLowerCase()}|${item.mimeType.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function loadedMessageMetadata(message: SocialMessage | undefined): {
  attachments: SearchResultAttachment[];
  messageType?: number;
  replyToUlid?: string;
  threadRootUlid?: string;
} {
  if (!message) return { attachments: [] };
  return {
    attachments: dedupeSearchAttachments(
      (message.attachments || [])
        .map(attachmentMetadataFromUnknown)
        .filter((item): item is SearchResultAttachment => item !== null),
    ),
    messageType: numberFromUnknown(message.type),
    replyToUlid: socialMessageReplyToUlid(message) || undefined,
    threadRootUlid: socialMessageExplicitThreadRootUlid(message) || undefined,
  };
}

function searchRowMessageType(row: ChatSearchLocalResultRow): number | undefined {
  return numberFromUnknown(row.message_type) ?? numberFromUnknown(row.type);
}

function searchRowReplyToUlid(row: ChatSearchLocalResultRow): string | undefined {
  const record = row as unknown as Record<string, unknown>;
  return stringFromRecord(record, 'replyToUlid', 'reply_to_ulid') || undefined;
}

function searchRowThreadRootUlid(row: ChatSearchLocalResultRow): string | undefined {
  const record = row as unknown as Record<string, unknown>;
  return stringFromRecord(record, 'threadRootUlid', 'thread_root_ulid') || undefined;
}

function searchThreadMetadata(
  state: SocialChatState,
  scope: 'friend' | 'group',
  conversationId: string,
  messageId: string,
): { threadReplyCount?: number; hasLoadedThreadReplies: boolean } {
  const threadKey = socialThreadKey(scope, conversationId, messageId);
  const countedReplies = numberFromUnknown(state.threadCounts[threadKey]?.replyCount);
  const loadedReplies = (state.threadMessages[threadKey] || []).filter((msg) => msg.ulid && msg.ulid !== messageId).length;
  return {
    threadReplyCount: countedReplies ?? (loadedReplies > 0 ? loadedReplies : undefined),
    hasLoadedThreadReplies: loadedReplies > 0,
  };
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
  const durable = await readDurableDecryptCache(message.ulid);
  if (durable) {
    return { ...message, content: durable.content, type: durable.type || message.type, attachments: durable.attachments } as GroupMessage;
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

async function decodeRealtimeGroupMessage(groupUlid: string, message: GroupMessage): Promise<GroupMessage> {
  return decodeGroupMessage(groupUlid, message, 'realtime group decrypt failed');
}

async function decodeFriendMessage(
  sessionUlid: string,
  peerDid: string,
  message: FriendChatMessage,
): Promise<FriendChatMessage> {
  if (message.recalled) {
    return message;
  }
  if (!message.encryptedPayload || message.encryptedPayload.byteLength === 0 || !peerDid) {
    return { ...message, content: GROUP_DECRYPT_FAILED_PLACEHOLDER } as FriendChatMessage;
  }
  // Cache hit — skip expensive IPC decrypt
  const cached = getDecryptCache(message.ulid);
  if (cached) {
    return { ...message, content: cached.content, type: cached.type || message.type, attachments: cached.attachments } as FriendChatMessage;
  }
  const durable = await readDurableDecryptCache(message.ulid);
  if (durable) {
    return { ...message, content: durable.content, type: durable.type || message.type, attachments: durable.attachments } as FriendChatMessage;
  }

  try {
    const envelope = decodeFriendEncryptedEnvelope(message.encryptedPayload);
    if (!envelope) {
      throw new Error('Direct message is not a valid Double Ratchet v1 envelope');
    }
    const plaintextB64 = (await api.drDecrypt({
      sessionId: sessionUlid,
      ciphertext: envelope.ciphertext,
      ratchetPub: envelope.ratchetPub ?? '',
      counter: envelope.counter,
      prevCounter: envelope.prevCounter ?? 0,
      nonce: envelope.nonce ?? '',
      version: 1,
    })).plaintext;
    const payload = decodeEncryptedChatPayloadBytes(b64ToBytes(plaintextB64));
    if (!payload) {
      throw new Error('Double Ratchet plaintext is not a valid encrypted chat payload');
    }
    const result = applyDecodedChatPayload(message, payload);
    const entry = { content: result.content, type: result.type, attachments: (result as { attachments?: unknown[] }).attachments ?? [], cachedAt: Date.now() };
    setDecryptCache(message.ulid, entry);
    persistDecryptCache(message.ulid, entry);
    return result;
  } catch (error) {
    log.warn('socialChat', 'friend decrypt failed', error);
    return { ...message, content: GROUP_DECRYPT_FAILED_PLACEHOLDER } as FriendChatMessage;
  }
}

async function decodeFriendMessages(
  sessionUlid: string,
  peerDid: string,
  messages: FriendChatMessage[],
): Promise<FriendChatMessage[]> {
  const decoded: FriendChatMessage[] = [];
  for (const message of messages) {
    decoded.push(await decodeFriendMessage(sessionUlid, peerDid, message));
  }
  return decoded;
}

function isIndexableChatContent(message: SocialMessage): boolean {
  const content = message.content?.trim() ?? '';
  if (!content || (message as SocialMessage & { recalled?: boolean }).recalled) return false;
    if (
      content === '[Encrypted Message]' ||
      content === GROUP_DECRYPT_FAILED_PLACEHOLDER
    ) {
    return false;
  }
  return true;
}

function localSearchIndexMessage(
  scope: 'friend' | 'group',
  conversationId: string,
  message: SocialMessage,
): ChatIndexLocalMessageInput | null {
  if (!message.ulid || !conversationId || !isIndexableChatContent(message)) return null;
  return {
    scope,
    conversation_id: conversationId,
    message_id: message.ulid,
    sender_did: message.senderDid || '',
    content: message.content.trim(),
    reply_to_ulid: socialMessageReplyToUlid(message) || undefined,
    thread_root_ulid: socialMessageExplicitThreadRootUlid(message) || undefined,
    sent_at: socialMessageSentAtMs(message),
  };
}

async function indexLocalSearchMessages(
  scope: 'friend' | 'group',
  conversationId: string,
  messages: SocialMessage[],
): Promise<void> {
  const rows = messages
    .map((message) => localSearchIndexMessage(scope, conversationId, message))
    .filter((row): row is ChatIndexLocalMessageInput => row !== null);
  if (rows.length === 0) return;
  await api.chatIndexLocalMessages(rows);
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
    try {
      const result = await api.cryptoGenerateIdentity();
      set({
        encryptionEnabled: true,
        ownFingerprint: result.fingerprint,
      });
      try {
        const bundle = await api.cryptoGetKeyBundle();
        await api.keyExchangeUploadBundle({
          ...bundle,
          supported_versions: [1],
        });
      } catch (uploadErr) {
        log.error('socialChat', 'key bundle upload failed (non-fatal)', uploadErr);
      }
    } catch (error) {
      log.error('socialChat', 'initEncryption failed', error);
      set({ encryptionEnabled: false });
    }
  },

  establishSession: async (sessionUlid, peerDid, initiatedBySend = false) => {
    const { encryptionEnabled, sessionSecurityState } = get();
    if (!encryptionEnabled) {
      return false;
    }
    if (sessionSecurityState[sessionUlid] === 'establishing') {
      return false;
    }
    const actorDid = get().currentUserDid || currentAuthenticatedActorId() || '';
    if (!actorDid || !peerDid) {
      get().setSessionSecurityState(sessionUlid, 'error');
      return false;
    }
    // One deterministic initiator prevents simultaneous X3DH handshakes from
    // overwriting the same conversation session during background bootstrap.
    // An explicit sender may always initiate because X3DH must support an
    // offline recipient.
    if (!initiatedBySend && actorDid.localeCompare(peerDid) > 0) {
      return false;
    }
    get().setSessionSecurityState(sessionUlid, 'establishing');
    const persisted = await api.cryptoSessionStatus(sessionUlid);
    if (persisted.established && persisted.version === 1) {
      get().setSessionSecurityState(sessionUlid, 'ready', 1);
      return true;
    }
    try {
      const peerMember = get().conversationMembers[sessionUlid]?.find(
        (member) => member.ptid === peerDid,
      );
      const peerResp = await api.keyExchangeFetchBundle(
        peerDid,
        undefined,
        peerMember?.actorHomeStationPeerId,
      );
      const peerBundle = pickLatestKeyExchangeBundle(peerResp);
      if (!peerBundle?.ik_pub || !peerBundle.spk_pub) {
        get().setSessionSecurityState(sessionUlid, 'error');
        return false;
      }
      if (!peerBundle.supported_versions?.includes(1)) {
        throw new Error('Peer does not support Double Ratchet v1');
      }
      const negotiatedVersion = 1;
      const opkPub = peerBundle.opks?.[0];
      const initialized = await api.cryptoInitSession(
        sessionUlid,
        peerDid,
        peerBundle.ik_pub,
        peerBundle.spk_pub,
        peerBundle.spk_sig,
        opkPub,
      );
      const handshake = toBinary(
        X3dhSessionInitSchema,
        createProto(X3dhSessionInitSchema, {
          sessionId: sessionUlid,
          senderIdentityKey: b64ToBytes(initialized.sender_identity_key),
          senderEphemeralKey: b64ToBytes(initialized.ephemeral_key),
          recipientSignedPrekey: b64ToBytes(initialized.recipient_signed_prekey),
          recipientOneTimePrekey: initialized.recipient_one_time_prekey
            ? b64ToBytes(initialized.recipient_one_time_prekey)
            : new Uint8Array(),
          negotiatedVersion,
        }),
      );
      await imServiceV1.dkx.send(
        peerDid,
        sessionUlid,
        DirectKeyExchangeKind.INITIAL_MESSAGE,
        handshake,
        peerMember?.actorHomeStationPeerId || undefined,
      );
      await api.cryptoMarkSessionReady(sessionUlid);
      get().setSessionSecurityState(sessionUlid, 'ready', negotiatedVersion);
      return true;
    } catch (error) {
      log.error('socialChat', 'establishSession failed (peer may not have keys)', error);
      get().setSessionSecurityState(sessionUlid, 'error');
      return false;
    }
  },

  loadSessions: async () => {
    if (!hasAuthenticatedActor()) return;
    set({ loading: true });
    try {
      const rawConversations = await imServiceV1.conversation.listConversations();
      const allConversations = normalizeConversations(rawConversations);

      const directConversations = allConversations.filter((c) => c.kind === 1);
      const groupConversations = allConversations.filter((c) => c.kind === 2);
      const memberResults = await Promise.allSettled(
        directConversations.map(async (conv) => {
          const rawMembers = await imServiceV1.conversation.getMembers(conv.conversationId);
          return [conv.conversationId, normalizeConversationMembers(rawMembers)] as const;
        }),
      );
      const memberMap: Record<string, ConversationMember[]> = {};
      for (const result of memberResults) {
        if (result.status === 'fulfilled') {
          memberMap[result.value[0]] = result.value[1];
        }
      }

      const groupMemberResults = await Promise.allSettled(
        groupConversations.map(async (conv) => {
          const rawMembers = await imServiceV1.conversation.getMembers(conv.conversationId);
          return [conv.conversationId, rawMembers] as const;
        }),
      );
      const groupMembersUpdate: Record<string, any[]> = { ...get().groupMembers };
      for (const result of groupMemberResults) {
        if (result.status === 'fulfilled') {
          groupMembersUpdate[result.value[0]] = result.value[1] as any[];
        }
      }

      const actorPtid = get().currentUserDid || '';
      const peerPtids = Array.from(new Set(
        Object.values(memberMap)
          .flat()
          .map((member) => member.ptid)
          .filter((ptid) => ptid && ptid !== actorPtid),
      ));
      const presenceStatuses = peerPtids.length > 0
        ? await api.presenceQuery(peerPtids).catch((error) => {
            log.warn('socialChat', 'presence query failed', error);
            return { statuses: [] };
          })
        : { statuses: [] };
      const peerOnline = { ...get().peerOnline };
      for (const status of presenceStatuses.statuses) {
        if (status.actor_id) {
          peerOnline[status.actor_id] = isPresenceOnline(status.state);
        }
      }
      set({
        conversations: allConversations,
        conversationMembers: memberMap,
        groupMembers: groupMembersUpdate,
        sessions: [],
        groups: [],
        peerOnline,
        loading: false,
        loadError: null,
      });
      log.info('socialChat', 'loadConversations completed', {
        direct: directConversations.length,
        group: allConversations.length - directConversations.length,
      });

      // Trigger profile loading for DM peers so names resolve.
      for (const [, members] of Object.entries(memberMap)) {
        for (const m of members) {
          if (m.ptid && m.ptid !== actorPtid && !get().peerProfiles[m.ptid]) {
            get().loadPeerProfile(m.ptid).catch(() => {});
          }
        }
      }
      for (const conversation of directConversations) {
        const peer = memberMap[conversation.conversationId]?.find(
          (member) => member.ptid && member.ptid !== actorPtid,
        );
        if (peer?.ptid) {
          get().establishSession(conversation.conversationId, peer.ptid).catch(() => {});
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
            get().ackFriendMessages(ulid, unreadUlids, FriendMessageStatus.READ).catch(() => {});
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
      let friendPeerDid = '';
      if (activeTab === 'friend') {
        const session = get().sessions.find((s) => s.ulid === ulid);
        if (session) {
          const viewerDid = get().currentUserDid;
          const peerDid = viewerDid
            ? (session.participantADid === viewerDid ? session.participantBDid : session.participantADid)
            : '';
          friendPeerDid = peerDid;
        } else {
          const members = get().conversationMembers[ulid] || [];
          const viewerDid = get().currentUserDid || '';
          const peer = members.find((m) => m.ptid !== viewerDid);
          friendPeerDid = peer?.ptid || '';
        }
        if (friendPeerDid) {
          get().establishSession(ulid, friendPeerDid).catch(() => {});
        }
      }
      const data = await imServiceV1.conversation.listMessages(ulid, 0, 200);
      let msgs = projectConversationMessageEvents(activeTab, data.events);
      if (activeTab === 'friend') {
        const fmsgs = msgs as FriendChatMessage[];
        msgs = await decodeFriendMessages(
          ulid,
          friendPeerDid,
          fmsgs,
        );
      } else {
        // Group chat is stored remotely as opaque OpenMLS ciphertext.
        // The same decode path feeds rendering and the local plaintext
        // search index so UI state and search state cannot drift.
        msgs = await decodeGroupMessages(ulid, msgs as GroupMessage[], 'group decrypt failed');
      }
      const visibleMsgs = preserveMessageReceiptStatuses(
        get().messages[ulid] ?? [],
        filterClearedMessages(
          msgs as SocialMessage[],
          get().conversationLocalState,
          activeTab,
          ulid,
        ),
      );
      indexLocalSearchMessages(activeTab, ulid, visibleMsgs).catch((error) => {
        log.warn('socialChat', 'index loaded messages failed', error);
      });
      set((state) => ({
        messages: { ...state.messages, [ulid]: visibleMsgs },
        messageHasMore: {
          ...state.messageHasMore,
          [ulid]: data.hasMore,
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
          get().ackFriendMessages(ulid, unreadUlids, FriendMessageStatus.READ).catch(() => {});
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
    const current = get().messages[ulid] || [];
    if (current.length === 0 || get().messageLoadingMore[ulid]) return;
    const afterSeq = current.reduce((max, message) => Math.max(max, messageGroupSeq(message)), 0);
    set((state) => ({
      messageLoadingMore: { ...state.messageLoadingMore, [ulid]: true },
    }));
    try {
      const data = await imServiceV1.conversation.listMessages(ulid, afterSeq, 200);
      let pageMessages = projectConversationMessageEvents(activeKind, data.events);
      if (activeKind === 'friend') {
        const viewerDid = get().currentUserDid;
        const peerDid = get().conversationMembers[ulid]?.find((member) => member.ptid !== viewerDid)?.ptid ?? '';
        pageMessages = await decodeFriendMessages(
          ulid,
          peerDid,
          pageMessages as FriendChatMessage[],
        );
      } else {
        pageMessages = await decodeGroupMessages(ulid, pageMessages as GroupMessage[], 'older group decrypt failed');
      }
      const older = filterClearedMessages(
        pageMessages,
        get().conversationLocalState,
        activeKind,
        ulid,
      );
      const dedup = older.filter((msg) => !current.some((item) => item.ulid === msg.ulid));
      indexLocalSearchMessages(activeKind, ulid, dedup).catch((error) => {
        log.warn('socialChat', 'index older messages failed', error);
      });
      set((state) => ({
        messages: { ...state.messages, [ulid]: [...(state.messages[ulid] || []), ...dedup] },
        messageHasMore: {
          ...state.messageHasMore,
          [ulid]: data.hasMore,
        },
        messageLoadingMore: { ...state.messageLoadingMore, [ulid]: false },
      }));
      const rootUlids = dedup
        .filter((msg) => !socialMessageExplicitThreadRootUlid(msg))
        .map((msg) => msg.ulid)
        .filter(Boolean);
      if (rootUlids.length > 0) {
        get().refreshThreadCounts(ulid, rootUlids, activeKind).catch(() => {});
      }
    } catch (error) {
      log.error('socialChat', 'loadOlderMessages failed', error);
      set((state) => ({
        messageLoadingMore: { ...state.messageLoadingMore, [ulid]: false },
      }));
      throw error;
    }
  },

  loadThreadMessages: async (ulid, rootUlid, kind, options) => {
    const activeKind = kind ?? get().activeTab;
    const key = socialThreadKey(activeKind, ulid, rootUlid);
    const append = options?.append === true;
    const currentThread = get().threadMessages[key] || [];
    const afterSeq = append
      ? currentThread.reduce((max, message) => Math.max(max, messageGroupSeq(message)), 0)
      : 0;
    set((state) => ({
      ...(append
        ? { threadLoadingMore: { ...state.threadLoadingMore, [key]: true } }
        : { threadLoading: { ...state.threadLoading, [key]: true } }),
      threadError: { ...state.threadError, [key]: null },
    }));
    try {
      const data = await imServiceV1.conversation.listThreadMessages(
        ulid,
        rootUlid,
        afterSeq,
        options?.limit ?? THREAD_REPLY_PAGE_SIZE,
      );
      let loaded = projectConversationMessageEvents(activeKind, data.events);
      if (activeKind === 'friend') {
        const viewerDid = get().currentUserDid;
        const peerDid = get().conversationMembers[ulid]?.find((member) => member.ptid !== viewerDid)?.ptid ?? '';
        loaded = await decodeFriendMessages(
          ulid,
          peerDid,
          loaded as FriendChatMessage[],
        );
      } else if (activeKind === 'group') {
        loaded = await decodeGroupMessages(ulid, loaded as GroupMessage[], 'thread group decrypt failed');
      }
      loaded = filterClearedMessages(
        loaded,
        get().conversationLocalState,
        activeKind,
        ulid,
      );
      indexLocalSearchMessages(activeKind, ulid, loaded).catch((error) => {
        log.warn('socialChat', 'index thread messages failed', error);
      });
      const fallbackRoot = (get().messages[ulid] || []).find((msg) => msg.ulid === rootUlid);
      const baseMessages = append
        ? currentThread.length > 0
          ? currentThread
          : fallbackRoot
            ? [fallbackRoot]
            : []
        : [];
      const pageMessages = loaded.length > 0
        ? loaded
        : fallbackRoot
          ? [fallbackRoot]
          : [];
      const nextMessages = append
        ? mergeThreadMessages(baseMessages, pageMessages)
        : mergeThreadMessages([], pageMessages);
      const hasMore = data.hasMore;
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

  sendFriendMessage: async (
    sessionUlid,
    receiverDid,
    content,
    type,
    replyToUlid,
    attachments,
    explicitThreadRootUlid,
    retryMessageUlid,
  ) => {
    const did = get().currentUserDid ?? '';
    const threadRootUlid = explicitThreadRootUlid;
    const localMessageUlid = retryMessageUlid || `local-${crypto.randomUUID()}`;
    if (did && receiverDid && !threadRootUlid) {
      set((state) => {
        const current = state.messages[sessionUlid] ?? [];
        const existing = current.some((message) => message.ulid === localMessageUlid);
        const nextMessage = optimisticFriendMessage({
          localId: localMessageUlid,
          sessionUlid,
          senderDid: did,
          receiverDid,
          content,
          type,
          replyToUlid,
          attachments: attachments ?? [],
        });
        return {
          messages: {
            ...state.messages,
            [sessionUlid]: existing
              ? current.map((message) => (
                message.ulid === localMessageUlid ? nextMessage : message
              ))
              : [...current, nextMessage],
          },
        };
      });
    }
    try {
      if (!did || !receiverDid) {
        throw new Error('A sender and recipient are required for a secure message');
      }
      const established = await get().establishSession(sessionUlid, receiverDid, true);
      if (!established) {
        throw new Error('Establishing secure channel. Try again shortly.');
      }
      const payloadB64 = await encryptFriendMessagePayload(
        sessionUlid,
        content,
        attachments ?? [],
        type,
      );
      const deviceId = localStorage.getItem('peers_im_device_id') ?? '';

      const committed = await imServiceV1.conversation.submitCommand({
        conversation_id: sessionUlid,
        sender_ptid: did,
        sender_device_id: deviceId,
        observed_membership_epoch: 0,
        send_message: {
          encrypted_payload: payloadB64,
          content_type: type ?? 1,
          reply_to_message_id: '',
          thread_root_message_id: threadRootUlid ?? '',
        },
      } as any);
      cacheOwnCommittedMessage(committed, content, attachments ?? [], type);

      if (threadRootUlid) return;
      const committedMessageUlid = committed.payload.case === 'messageCommitted'
        ? committed.payload.value.messageId
        : '';
      if (!committedMessageUlid) {
        throw new Error('Station did not return a committed message ID');
      }
      set((state) => ({
        messages: {
          ...state.messages,
          [sessionUlid]: (state.messages[sessionUlid] ?? []).map((message) => (
            message.ulid === localMessageUlid
              ? {
                  ...message,
                  ulid: committedMessageUlid,
                  status: FriendMessageStatus.SENT,
                } as FriendChatMessage
              : message
          )),
        },
      }));
      await get().loadMessages(sessionUlid, 'friend').catch((error) => {
        log.warn('socialChat', 'sendFriendMessage: post-send message refresh failed', error);
      });
      set((state) => ({
        lastPreviews: {
          ...state.lastPreviews,
					[sessionUlid]: { content, type: type ?? 1, senderId: did },
        },
      }));
    } catch (error) {
      if (!threadRootUlid) {
        set((state) => ({
          messages: {
            ...state.messages,
            [sessionUlid]: (state.messages[sessionUlid] ?? []).map((message) => (
              message.ulid === localMessageUlid
                ? { ...message, status: FriendMessageStatus.FAILED } as FriendChatMessage
                : message
            )),
          },
        }));
      }
      log.error('socialChat', 'sendFriendMessage failed', error);
      throw error;
    }
  },

  retryFriendMessage: async (sessionUlid, messageUlid, receiverDid) => {
    const message = (get().messages[sessionUlid] ?? []).find(
      (item) => item.ulid === messageUlid,
    ) as FriendChatMessage | undefined;
    if (!message || message.status !== FriendMessageStatus.FAILED) return;
    await get().sendFriendMessage(
      sessionUlid,
      receiverDid,
      message.content,
      message.type,
      message.replyToUlid || undefined,
      message.attachments.map((attachment) => ({
        cid: attachment.cid,
        filename: attachment.filename,
        mime_type: attachment.mimeType,
        size: Number(attachment.size),
        thumbnail_cid: attachment.thumbnailCid || undefined,
        visibility: attachment.visibility || undefined,
        encryption_suite: attachment.mediaEncryption?.suite,
        encryption_key_b64: attachment.mediaEncryption?.keyB64,
        encryption_nonce_b64: attachment.mediaEncryption?.nonceB64,
        plaintext_sha256_b64: attachment.mediaEncryption?.plaintextSha256B64,
        ciphertext_sha256_b64: attachment.mediaEncryption?.ciphertextSha256B64,
        plaintext_size: Number(attachment.mediaEncryption?.plaintextSize ?? attachment.size),
        ciphertext_size: Number(attachment.mediaEncryption?.ciphertextSize ?? attachment.size),
        chunking: attachment.mediaEncryption?.chunking,
        chunk_size: attachment.mediaEncryption?.chunkSize,
        chunk_count: attachment.mediaEncryption?.chunkCount,
        tag_size: attachment.mediaEncryption?.tagSize,
        nonce_strategy: attachment.mediaEncryption?.nonceStrategy,
      })),
      undefined,
      messageUlid,
    );
  },

  sendGroupMessage: async (groupUlid, content, type, _replyToUlid, attachments, explicitThreadRootUlid) => {
    const did = get().currentUserDid ?? '';
    if (!did) {
      throw new Error('No active actor; cannot send group message');
    }
    try {
      const status = await imServiceV1.mlsGroup.status(groupUlid);
      if (!status.ready) {
        get().setGroupSecurityState(groupUlid, 'establishing');
        throw new Error('Establishing secure group channel. Try again shortly.');
      }
      get().setGroupSecurityState(groupUlid, 'ready');
      const plaintextBytes = createEncryptedChatPayloadBytes(content, attachments ?? [], type);
      const ciphertext = await imServiceV1.mlsGroup.encrypt(groupUlid, plaintextBytes);
      await imServiceV1.mlsGroup.save(groupUlid);
      const payloadB64 = bytesToB64(ciphertext);
      const deviceId = localStorage.getItem('peers_im_device_id') ?? '';
      const membershipEpoch = Number(
        get().conversations.find((conversation) => conversation.conversationId === groupUlid)
          ?.membershipEpoch ?? 0,
      );

      const committed = await imServiceV1.conversation.submitCommand({
        conversation_id: groupUlid,
        sender_ptid: did,
        sender_device_id: deviceId,
        observed_membership_epoch: membershipEpoch,
        send_message: {
          encrypted_payload: payloadB64,
          content_type: type ?? 1,
          reply_to_message_id: _replyToUlid ?? '',
          thread_root_message_id: explicitThreadRootUlid ?? '',
        },
      } as any);
      await imServiceV1.mlsGroup.recordAuthorityEvent(
        toBinary(CommittedConversationEventSchema, committed),
        deviceId,
      );
      cacheOwnCommittedMessage(committed, content, attachments ?? [], type);

      if (explicitThreadRootUlid) return;
      await get().loadMessages(groupUlid, 'group').catch((error) => {
        log.warn('socialChat', 'sendGroupMessage: post-send message refresh failed', error);
      });
      const previewContent = content || attachments?.[0]?.filename || '';
      set((state) => ({
        lastPreviews: {
          ...state.lastPreviews,
					[groupUlid]: { content: previewContent, type: type ?? 1, senderId: did },
        },
      }));
    } catch (error) {
      get().setGroupSecurityState(groupUlid, 'error');
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
      for (const m of members) {
        if (m.ptid && m.ptid !== actorId && !get().peerProfiles[m.ptid]) {
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

  editFriendMessage: async (sessionUlid, messageUlid, newContent, newCiphertext) => {
    if ((!newContent || newContent.trim() === '') && (!newCiphertext || newCiphertext.byteLength === 0)) {
      throw new Error('editFriendMessage: newContent or newCiphertext is required');
    }
    try {
      const {
        encryptionEnabled,
        sessionEncrypted,
        sessions,
        conversationMembers,
        currentUserDid,
      } = get();
      let editCiphertext = newCiphertext;
      if ((!editCiphertext || editCiphertext.byteLength === 0) && newContent?.trim() && encryptionEnabled && sessionEncrypted[sessionUlid]) {
        const session = sessions.find((item) => item.ulid === sessionUlid);
        const receiverDid = session
          ? peerOfSession(session, currentUserDid).did
          : conversationMembers[sessionUlid]?.find((member) => member.ptid !== currentUserDid)?.ptid ?? '';
        if (!receiverDid) throw new Error('editFriendMessage: receiverDid is required for encrypted edit');
        const encrypted = await encryptFriendMessagePayload(sessionUlid, newContent.trim(), [], undefined);
        editCiphertext = b64ToBytes(encrypted);
      }
      await imServiceV1.conversation.submitCommand({
        conversation_id: sessionUlid,
        sender_ptid: currentUserDid ?? '',
        sender_device_id: localStorage.getItem('peers_im_device_id') ?? '',
        observed_membership_epoch: 0,
        edit_message: {
          target_message_id: messageUlid,
          encrypted_payload: editCiphertext ? bytesToB64(editCiphertext) : '',
        },
      } as any);
      get().applyMessageMutation(
        sessionUlid,
        messageUlid,
        'EDIT',
        {
          newContent: newContent ?? '',
          newCiphertext: editCiphertext ?? new Uint8Array(),
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
      const membershipEpoch = Number(
        state.conversations.find((conversation) => conversation.conversationId === groupUlid)
          ?.membershipEpoch ?? 0,
      );
      await imServiceV1.conversation.submitCommand({
        conversation_id: groupUlid,
        sender_ptid: state.currentUserDid ?? '',
        sender_device_id: localStorage.getItem('peers_im_device_id') ?? '',
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
        sender_ptid: state.currentUserDid ?? '',
        sender_device_id: localStorage.getItem('peers_im_device_id') ?? '',
        observed_membership_epoch: membershipEpoch,
        edit_message: {
          target_message_id: messageUlid,
          encrypted_payload: bytesToB64(editCiphertext),
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
      const state = get();
      const conversation = state.conversations.find(
        (item) => item.conversationId === conversationId,
      );
      const senderPtid = state.currentUserDid ?? '';
      const senderDeviceId = localStorage.getItem('peers_im_device_id') ?? '';
      if (!conversation || !senderPtid || !senderDeviceId) {
        throw new Error('Reaction identity context is unavailable');
      }
      await imServiceV1.conversation.react(
        conversationId,
        messageId,
        emoji,
        senderPtid,
        senderDeviceId,
        Number(conversation.membershipEpoch),
        remove,
      );
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

  ackFriendMessages: async (conversationUlid, messageUlids, status) => {
    const receiptType = receiptTypeForMessageStatus(status);
    if (!receiptType || messageUlids.length === 0) return;
    try {
      await Promise.all(
        messageUlids.map((messageUlid) => (
          imServiceV1.conversation.submitReceipt(conversationUlid, messageUlid, receiptType)
        )),
      );
    } catch (error) {
      log.error('socialChat', 'ackFriendMessages failed', error);
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
    const projectedMessage = kind === 'group'
      ? await decodeRealtimeGroupMessage(conversationUlid, message as GroupMessage)
      : message;

    set((state) => {
      const visibleMessages = filterClearedMessages(
        mergeConversationMessages(state.messages[conversationUlid] ?? [], projectedMessage),
        state.conversationLocalState,
        kind,
        conversationUlid,
      );
      const threadRootUlid = socialMessageExplicitThreadRootUlid(projectedMessage);
      return {
        messages: {
          ...state.messages,
          [conversationUlid]: visibleMessages,
        },
        ...(threadRootUlid
          ? {}
          : {
              lastPreviews: {
                ...state.lastPreviews,
                [conversationUlid]: previewFromMessage(projectedMessage),
              },
            }),
      };
    });

    if (kind === 'friend') {
      const viewerDid = get().currentUserDid;
      const friendMessage = projectedMessage as FriendChatMessage;
      if (viewerDid && friendMessage.senderDid !== viewerDid && friendMessage.status !== FriendMessageStatus.READ) {
        const receiptStatus = get().activeTab === 'friend'
          && get().activeSessionUlid === conversationUlid
          ? FriendMessageStatus.READ
          : FriendMessageStatus.DELIVERED;
        get().ackFriendMessages(conversationUlid, [friendMessage.ulid], receiptStatus).catch((error) => {
          log.debug('socialChat', 'realtime delivered ack failed', error);
        });
      }
    }
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
        const peer = members.find((m) => m.ptid !== actorId) || members[0];
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
      const data = await api.chatSearchLocal(trimmedQuery, scope, conversationId);
      if (get().searchQuery !== trimmedQuery) return;
      const rawResults = (data?.results || []).filter((row) => {
        const scope = row.scope === 'group' ? 'group' : 'friend';
        const key = conversationKey(scope, row.conversation_id);
        const localState = get().conversationLocalState[key];
        const clearedAt = localState?.clearedAt ?? 0;
        if (localState?.deletedMessageUlids?.[row.message_id]) return false;
        return !clearedAt || Number(row.sent_at ?? 0) >= clearedAt;
      });
      const state = get();
      const { sessions, groups, currentUserDid, messages } = state;

      const results: SearchResult[] = rawResults.map((r) => {
        const scope = r.scope === 'group' ? 'group' : 'friend';
        let conversationName = '';
        if (scope === 'friend') {
          const session = sessions.find((s) => s.ulid === r.conversation_id);
          if (session) {
            conversationName = peerDisplayName(session, currentUserDid)
              || peerOfSession(session, currentUserDid).did;
          }
        } else {
          const group = groups.find((g) => g.ulid === r.conversation_id);
          conversationName = group?.name || '';
        }
        const loadedMessage = messages[r.conversation_id]?.find((msg) => msg.ulid === r.message_id);
        const loadedMetadata = loadedMessageMetadata(loadedMessage);
        const threadMetadata = searchThreadMetadata(state, scope, r.conversation_id, r.message_id);
        return {
          messageId: r.message_id,
          conversationId: r.conversation_id,
          scope,
          senderDid: r.sender_did,
          content: r.content,
          sentAt: r.sent_at,
          conversationName: conversationName || r.conversation_id.slice(0, 12),
          messageType: loadedMetadata.messageType ?? searchRowMessageType(r),
          replyToUlid: loadedMetadata.replyToUlid ?? searchRowReplyToUlid(r),
          threadRootUlid: loadedMetadata.threadRootUlid ?? searchRowThreadRootUlid(r),
          attachments: dedupeSearchAttachments([
            ...loadedMetadata.attachments,
            ...searchRowAttachments(r),
          ]),
          ...threadMetadata,
        };
      });
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
