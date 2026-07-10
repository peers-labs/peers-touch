import { createDesktopStore } from './createDesktopStore';
import { create as createProto, fromBinary, toBinary } from '@bufbuild/protobuf';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import {
  CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION,
  chatUnreadForParticipant,
  clearChatUnreadForParticipant,
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
  FriendMessageType,
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
  ensureSkdmDistributed,
  encryptBytesForGroup,
  decryptBytesFromGroup,
  handleInboundSkdm,
  rotateGroupSenderChain,
  MissingSkdmError,
  FRIEND_MESSAGE_TYPE_SENDER_KEY_DISTRIBUTION,
} from '../modules/identity/groupSenderKeys';
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
  mergeConversationMessages,
  previewFromMessage,
  pruneTypingPeers,
  normalizeChatBackgroundId,
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
  normalizeFriendChatSession,
  normalizeFriendRequestData,
  normalizeFriendRequests,
  type FriendRequestData,
} from './socialNormalizers';
import { currentAuthenticatedActorId } from './session';

const GROUP_DECRYPT_WAITING_KEY_PLACEHOLDER = '[Waiting for sender key…]';
const GROUP_DECRYPT_BEFORE_JOIN_PLACEHOLDER = '[Message sent before you joined]';
const GROUP_DECRYPT_NOT_ENTITLED_PLACEHOLDER = '[Not entitled to this group message]';
const GROUP_DECRYPT_FAILED_PLACEHOLDER = '[Decrypt failed]';
const groupDecryptQueues = new Map<string, Promise<void>>();

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

function encodeFriendEncryptedEnvelope(input: { ciphertext: string; counter: number; ephemeralKey?: string }): string {
  const wire = createProto(EncryptedMessageSchema, {
    ciphertext: b64ToBytes(input.ciphertext),
    counter: input.counter,
    ephemeralKey: input.ephemeralKey ? b64ToBytes(input.ephemeralKey) : new Uint8Array(),
    version: 0,
  });
  return bytesToB64(toBinary(EncryptedMessageSchema, wire));
}

function decodeFriendEncryptedEnvelope(bytes: Uint8Array): { ciphertext: string; counter: number; ephemeralKey?: string } | null {
  try {
    const wire = fromBinary(EncryptedMessageSchema, bytes);
    if (!wire.ciphertext.byteLength) return null;
    return {
      ciphertext: bytesToB64(wire.ciphertext),
      counter: wire.counter,
      ephemeralKey: wire.ephemeralKey.byteLength ? bytesToB64(wire.ephemeralKey) : undefined,
    };
  } catch {
    try {
      const envelopeText = new TextDecoder().decode(bytes);
      const legacy = JSON.parse(envelopeText.startsWith('{') ? envelopeText : atob(envelopeText)) as {
        c?: string;
        n?: number;
        e?: string;
      };
      if (!legacy.c || legacy.n == null) return null;
      return { ciphertext: legacy.c, counter: legacy.n, ephemeralKey: legacy.e };
    } catch {
      return null;
    }
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

async function encryptFriendMessagePayload(
  sessionUlid: string,
  receiverDid: string,
  content: string,
  attachments: readonly ChatAttachmentInput[] = [],
  messageType?: number,
): Promise<string> {
  const plaintextBytes = createEncryptedChatPayloadBytes(content, attachments, messageType);
  const encryptedPlaintext = bytesToB64(plaintextBytes);
  const enc = await api.cryptoEncryptMessage(sessionUlid, receiverDid, encryptedPlaintext);
  return encodeFriendEncryptedEnvelope({
    ciphertext: enc.ciphertext,
    counter: enc.counter,
    ephemeralKey: enc.ephemeral_key,
  });
}

function decodeEncryptedChatPayloadBytes(bytes: Uint8Array): ChatEncryptedMessagePayload | null {
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

function clearActiveFriendUnread(
  sessions: FriendChatSession[],
  activeSessionUlid: string | null,
  currentUserDid: string | null,
): FriendChatSession[] {
  return clearChatUnreadForParticipant(sessions, activeSessionUlid, currentUserDid);
}

function localStateFromFriendSettings(
  settings: Awaited<ReturnType<typeof api.friendChatGetSettings>>['settings'] | undefined,
): ConversationLocalState {
  return {
    muted: Boolean(settings?.isMuted),
    sticky: Boolean(settings?.isPinned),
    alertEnabled: settings?.alertEnabled !== false,
    background: normalizeChatBackgroundId(settings?.background),
    clearedAt: Number(settings?.clearedAtUnixMs ?? 0),
  };
}

function localStateFromGroupSettings(
  settings: Awaited<ReturnType<typeof api.groupChatGetSettings>>,
): ConversationLocalState {
  return {
    muted: Boolean(settings?.isMuted),
    sticky: Boolean(settings?.isPinned),
    alertEnabled: settings?.alertEnabled !== false,
    background: normalizeChatBackgroundId(settings?.background),
    clearedAt: Number(settings?.clearedAtUnixMs ?? 0),
  };
}

function localStatePatchToRemote(patch: Partial<ConversationLocalState>) {
  return {
    ...(patch.muted !== undefined ? { isMuted: patch.muted } : {}),
    ...(patch.sticky !== undefined ? { isPinned: patch.sticky } : {}),
    ...(patch.alertEnabled !== undefined ? { alertEnabled: patch.alertEnabled } : {}),
    ...(patch.background !== undefined ? { background: patch.background } : {}),
    ...(patch.clearedAt !== undefined ? { clearedAt: patch.clearedAt } : {}),
  };
}

function mergeRemoteConversationLocalState(
  state: SocialChatState,
  entries: PromiseSettledResult<readonly [string, ConversationLocalState]>[],
): Partial<SocialChatState> {
  const nextLocalState = { ...state.conversationLocalState };
  entries.forEach((entry) => {
    if (entry.status === 'fulfilled') {
      nextLocalState[entry.value[0]] = {
        ...nextLocalState[entry.value[0]],
        ...entry.value[1],
      };
    }
  });
  saveConversationLocalState(state.currentUserDid, nextLocalState);
  return { conversationLocalState: nextLocalState };
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

interface ThreadPagePayload {
  root?: unknown | null;
  replies?: unknown[];
  messages?: unknown[];
  hasMore?: boolean;
  has_more?: boolean;
  nextCursor?: string;
  next_cursor?: string;
}

interface SocialChatState {
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

  encryptionEnabled: boolean;
  ownFingerprint: string | null;
  /** sessionUlid → whether E2E is active for that conversation (future key-exchange wiring). */
  sessionEncrypted: Record<string, boolean>;
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
  /**
   * Re-attempt decryption of any group ciphertext currently stuck on
   * the `[Waiting for sender key…]` / `[Decrypt failed]` placeholder.
   *
   * Triggered by the `GROUP_SKDM_INSTALLED` event so a late-arriving
   * SKDM unblocks all the messages it was supposed to unblock without
   * forcing the user to reload the chat. When `senderDid` is
   * provided we only retry rows attributed to that sender (cheap
   * narrowing on the common single-peer case); when omitted we retry
   * every placeholder in the group.
   */
  redecryptGroupMessages: (groupUlid: string, senderDid?: string) => Promise<void>;
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
  ackFriendMessages: (ulids: string[], status: number) => Promise<void>;
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
  establishSession: (sessionUlid: string, peerDid: string) => Promise<boolean>;
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
  actorDid: string,
): ActorAvatarProfile | null {
  if (!actorDid) return null;
  if (s.participantADid === actorDid) {
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
  actorDid: string,
  currentUserProfile?: CurrentUserProfile | null,
): ActorAvatarProfile {
  const did = actorDid.trim();
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
  return '';
}

function normalizeGroupMember(raw: unknown): GroupMember {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    ...(item as unknown as GroupMember),
    groupUlid: String(item.groupUlid ?? item.group_ulid ?? ''),
    actorDid: String(item.actorDid ?? item.actor_did ?? ''),
    invitedBy: String(item.invitedBy ?? item.invited_by ?? ''),
  };
}

function normalizeGroupMembers(raw: unknown): GroupMember[] {
  return Array.isArray(raw) ? raw.map(normalizeGroupMember) : [];
}


/** When profile has no id yet, infer own DID as the only participant common to all sessions (needs 2+ distinct peers). */
function deriveCurrentUserDidFromSessions(sessions: FriendChatSession[]): string | null {
  if (sessions.length === 0) return null;
  const [first, ...rest] = sessions;
  let common = new Set<string>(
    [first.participantADid, first.participantBDid].filter((d): d is string => Boolean(d)),
  );
  for (const s of rest) {
    const pair = new Set([s.participantADid, s.participantBDid].filter((d): d is string => Boolean(d)));
    common = new Set([...common].filter((d) => pair.has(d)));
    if (common.size === 0) return null;
  }
  if (common.size !== 1) return null;
  return [...common][0] ?? null;
}

function createClientMessageUlid(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 12).toUpperCase();
  return `fcmc-${ts}-${rand}`;
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

export function resolveGroupMissingSkdmPlaceholder(
  currentUserDid: string | null,
  members: GroupMember[] | undefined,
  message: GroupMessage,
): string {
  if (!currentUserDid || !Array.isArray(members)) return GROUP_DECRYPT_WAITING_KEY_PLACEHOLDER;

  const selfMember = members.find((member) => member.actorDid === currentUserDid);
  if (!selfMember) return GROUP_DECRYPT_NOT_ENTITLED_PLACEHOLDER;

  const joinedAtMs = selfMember.joinedAt ? timestampDate(selfMember.joinedAt).getTime() : 0;
  const sentAtMs = socialMessageSentAtMs(message);
  if (joinedAtMs > 0 && sentAtMs > 0 && sentAtMs < joinedAtMs) {
    return GROUP_DECRYPT_BEFORE_JOIN_PLACEHOLDER;
  }
  return GROUP_DECRYPT_WAITING_KEY_PLACEHOLDER;
}

function groupMissingSkdmPlaceholder(groupUlid: string, message: GroupMessage): string {
  const state = useSocialChatStore.getState();
  return resolveGroupMissingSkdmPlaceholder(
    state.currentUserDid,
    state.groupMembers[groupUlid],
    message,
  );
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

async function withGroupDecryptQueue<T>(groupUlid: string, work: () => Promise<T>): Promise<T> {
  const previous = groupDecryptQueues.get(groupUlid) ?? Promise.resolve();
  let release!: () => void;
  const current = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => {
    release = resolve;
  }));
  groupDecryptQueues.set(groupUlid, current);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (groupDecryptQueues.get(groupUlid) === current) {
      groupDecryptQueues.delete(groupUlid);
    }
  }
}

function isMessageInThread(msg: SocialMessage, rootUlid: string): boolean {
  return socialMessageExplicitThreadRootUlid(msg) === rootUlid;
}

const THREAD_REPLY_PAGE_SIZE = 50;

function threadPageMessages(data: ThreadPagePayload | undefined, rootUlid: string): SocialMessage[] {
  if (!data) return [];
  const root = data.root as SocialMessage | null | undefined;
  const rawMessages = Array.isArray(data.messages) ? (data.messages as SocialMessage[]) : [];
  const explicitReplies = Array.isArray(data.replies) ? (data.replies as SocialMessage[]) : [];
  const replies = explicitReplies.length > 0
    ? explicitReplies
    : rawMessages.filter((msg) => msg.ulid !== rootUlid && isMessageInThread(msg, rootUlid));
  if (root || replies.length > 0) {
    const out: SocialMessage[] = [];
    const seen = new Set<string>();
    if (root?.ulid) {
      out.push(root);
      seen.add(root.ulid);
    }
    for (const reply of replies) {
      if (!reply.ulid || seen.has(reply.ulid) || reply.ulid === rootUlid) continue;
      out.push(reply);
      seen.add(reply.ulid);
    }
    return out;
  }
  return rawMessages;
}

function mergeThreadMessages(existing: SocialMessage[], incoming: SocialMessage[]): SocialMessage[] {
  return mergeUniqueChatMessages(existing, incoming);
}

function latestThreadReplyUlid(messages: SocialMessage[], rootUlid: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.ulid && msg.ulid !== rootUlid) return msg.ulid;
  }
  return undefined;
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

function friendMessageTypeFromUnknown(value: unknown): number | undefined {
  const numeric = numberFromUnknown(value);
  if (numeric !== undefined) return numeric;
  if (typeof value !== 'string') return undefined;
  switch (value.trim()) {
    case 'FRIEND_MESSAGE_TYPE_SENDER_KEY_DISTRIBUTION':
      return FriendMessageType.SENDER_KEY_DISTRIBUTION;
    case 'FRIEND_MESSAGE_TYPE_TEXT':
      return FriendMessageType.TEXT;
    case 'FRIEND_MESSAGE_TYPE_IMAGE':
      return FriendMessageType.IMAGE;
    case 'FRIEND_MESSAGE_TYPE_FILE':
      return FriendMessageType.FILE;
    case 'FRIEND_MESSAGE_TYPE_AUDIO':
      return FriendMessageType.AUDIO;
    case 'FRIEND_MESSAGE_TYPE_VIDEO':
      return FriendMessageType.VIDEO;
    default:
      return undefined;
  }
}

function friendMessageTypeOf(message: FriendChatMessage): number | undefined {
  const record = message as unknown as Record<string, unknown>;
  return friendMessageTypeFromUnknown(record.type ?? record.messageType ?? record.message_type);
}

function friendMessageSenderDid(message: FriendChatMessage): string {
  const record = message as unknown as Record<string, unknown>;
  return stringFromRecord(record, 'senderDid', 'sender_did');
}

function friendMessageContent(message: FriendChatMessage): string {
  const record = message as unknown as Record<string, unknown>;
  return stringFromRecord(record, 'content');
}

function isSenderKeyDistributionMessage(message: FriendChatMessage): boolean {
  return friendMessageTypeOf(message) === FRIEND_MESSAGE_TYPE_SENDER_KEY_DISTRIBUTION;
}

function consumeInboundFriendControlMessages(messages: FriendChatMessage[], myDid?: string | null): FriendChatMessage[] {
  for (const message of messages) {
    if (!isSenderKeyDistributionMessage(message)) continue;
    const senderDid = friendMessageSenderDid(message);
    if (myDid && senderDid === myDid) continue;
    const content = friendMessageContent(message);
    if (!senderDid || !content) continue;
    // Fire-and-forget: handleInboundSkdm logs its own errors and never
    // rejects, so one malformed SKDM cannot poison friend message loading.
    handleInboundSkdm(senderDid, content).catch((err) =>
      log.warn('socialChat', 'handleInboundSkdm failed', err),
    );
  }
  return messages.filter((message) => !isSenderKeyDistributionMessage(message));
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

function conversationStateStorageKey(actorDid: string | null): string {
  return `socialChat:conversationLocalState:${actorDid || 'anonymous'}`;
}

function loadConversationLocalState(actorDid: string | null): Record<string, ConversationLocalState> {
  try {
    const parsed = readDesktopDomainValueSync<Record<string, ConversationLocalState>>(
      'chat.conversation-settings',
      conversationStateStorageKey(actorDid),
    );
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveConversationLocalState(actorDid: string | null, state: Record<string, ConversationLocalState>): void {
  try {
    writeDesktopDomainValueSync('chat.conversation-settings', conversationStateStorageKey(actorDid), state);
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
  if (message.recalled || !payloadB64) {
    return message;
  }
  // Cache hit — skip expensive IPC decrypt
  const cached = getDecryptCache(message.ulid);
  if (cached) {
    return { ...message, content: cached.content, type: cached.type || message.type, attachments: cached.attachments } as GroupMessage;
  }
  try {
    const out = await decryptBytesFromGroup(groupUlid, payloadB64);
    const payload = decodeEncryptedChatPayloadBytes(out.bytes);
    const result = payload
      ? applyDecodedChatPayload(message, payload)
      : ({ ...message, content: new TextDecoder().decode(out.bytes) } as GroupMessage);
    // Cache successful decrypt
    cacheDecryptedGroupMessage(message, result);
    return result;
  } catch (error) {
    if (error instanceof MissingSkdmError) {
        return { ...message, content: groupMissingSkdmPlaceholder(groupUlid, message) } as GroupMessage;
    }
    log.warn('socialChat', logLabel, error);
      return { ...message, content: GROUP_DECRYPT_FAILED_PLACEHOLDER } as GroupMessage;
  }
}

export async function decodeGroupMessages(
  groupUlid: string,
  messages: GroupMessage[],
  logLabel: string,
): Promise<GroupMessage[]> {
  return withGroupDecryptQueue(groupUlid, async () => {
    // Sender Keys are a ratcheting chain per (group, sender, sender_key_id).
    // Decrypting batches concurrently lets multiple IPC calls race the same
    // chain cursor and can poison rows as `[Decrypt failed]`. Serialize per group,
    // walk each batch in timeline order, then restore the API/UI order.
    const decodedByIndex = new Map<number, GroupMessage>();
    const ordered = messages
      .map((message, index) => ({ message, index }))
      .sort((a, b) => {
        const delta = socialMessageSentAtMs(a.message) - socialMessageSentAtMs(b.message);
        return delta || a.index - b.index;
      });
    for (const item of ordered) {
      decodedByIndex.set(item.index, await decodeGroupMessage(groupUlid, item.message, logLabel));
    }
    return messages.map((message, index) => decodedByIndex.get(index) ?? message);
  });
}

async function decodeRealtimeGroupMessage(groupUlid: string, message: GroupMessage): Promise<GroupMessage> {
  return decodeGroupMessage(groupUlid, message, 'realtime group decrypt failed');
}

async function decodeFriendMessage(
  sessionUlid: string,
  peerDid: string,
  message: FriendChatMessage,
): Promise<FriendChatMessage> {
  if (message.recalled || !message.encryptedPayload || message.encryptedPayload.byteLength === 0 || !peerDid) {
    return message;
  }
  // Cache hit — skip expensive IPC decrypt
  const cached = getDecryptCache(message.ulid);
  if (cached) {
    return { ...message, content: cached.content, type: cached.type || message.type, attachments: cached.attachments } as FriendChatMessage;
  }
  try {
    const envelope = decodeFriendEncryptedEnvelope(message.encryptedPayload);
    if (!envelope) return message;
    const decrypted = await api.cryptoDecryptMessage(
      sessionUlid,
      peerDid,
      envelope.ciphertext,
      envelope.counter,
      envelope.ephemeralKey,
    );
    try {
      const payload = decodeEncryptedChatPayloadBytes(b64ToBytes(decrypted.plaintext));
      const result = payload ? applyDecodedChatPayload(message, payload) : { ...message, content: decrypted.plaintext };
      setDecryptCache(message.ulid, { content: result.content, type: result.type, attachments: (result as { attachments?: unknown[] }).attachments ?? [], cachedAt: Date.now() });
      return result;
    } catch {
      setDecryptCache(message.ulid, { content: decrypted.plaintext, type: message.type, attachments: [], cachedAt: Date.now() });
      return { ...message, content: decrypted.plaintext };
    }
  } catch (error) {
    log.warn('socialChat', 'friend decrypt failed', error);
    return { ...message, content: '[Decrypt failed]' } as FriendChatMessage;
  }
}

async function decodeFriendMessages(
  sessionUlid: string,
  peerDid: string,
  messages: FriendChatMessage[],
): Promise<FriendChatMessage[]> {
  // Concurrent decryption — Signal ratchet state is keyed per (session, counter)
  // so parallel decrypts within the same session are safe.
  return Promise.all(messages.map((message) => decodeFriendMessage(sessionUlid, peerDid, message)));
}

function isIndexableChatContent(message: SocialMessage): boolean {
  const content = message.content?.trim() ?? '';
  if (!content || (message as SocialMessage & { recalled?: boolean }).recalled) return false;
    if (
      content === '[Encrypted Message]' ||
      content === GROUP_DECRYPT_WAITING_KEY_PLACEHOLDER ||
      content === GROUP_DECRYPT_BEFORE_JOIN_PLACEHOLDER ||
      content === GROUP_DECRYPT_NOT_ENTITLED_PLACEHOLDER ||
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
  | 'friendP2pStatus'
  | 'peerOnline'
  | 'typingPeers'
> = {
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

  encryptionEnabled: false,
  ownFingerprint: null,
  sessionEncrypted: {},
  friendP2pStatus: {},
  peerOnline: {},
  typingPeers: {},
};

export const useSocialChatStore = createDesktopStore<SocialChatState>('socialChat', (set, get) => ({
  ...initialSocialState,

  reset: () => set({ ...initialSocialState }),

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
        await api.keyExchangeUploadBundle(bundle);
      } catch (uploadErr) {
        log.error('socialChat', 'key bundle upload failed (non-fatal)', uploadErr);
      }
    } catch (error) {
      log.error('socialChat', 'initEncryption failed', error);
      set({ encryptionEnabled: false });
    }
  },

  establishSession: async (sessionUlid, peerDid) => {
    const { encryptionEnabled, sessionEncrypted } = get();
    if (!encryptionEnabled || sessionEncrypted[sessionUlid]) {
      return sessionEncrypted[sessionUlid] ?? false;
    }
    try {
      const peerResp = await api.keyExchangeFetchBundle(peerDid);
      const peerBundle = pickLatestKeyExchangeBundle(peerResp);
      if (!peerBundle?.ik_pub || !peerBundle.spk_pub) {
        return false;
      }
      const opkPub = peerBundle.opks?.[0];
      await api.cryptoInitSession(
        sessionUlid,
        peerDid,
        peerBundle.ik_pub,
        peerBundle.spk_pub,
        peerBundle.spk_sig,
        opkPub,
      );
      set((state) => ({
        sessionEncrypted: { ...state.sessionEncrypted, [sessionUlid]: true },
      }));
      return true;
    } catch (error) {
      log.error('socialChat', 'establishSession failed (peer may not have keys)', error);
      return false;
    }
  },

  loadSessions: async () => {
    if (!hasAuthenticatedActor()) return;
    set({ loading: true });
    try {
      const data = await api.friendChatListSessions();
      const list = (data?.sessions || []).map(normalizeFriendChatSession);
      const derivedDid = deriveCurrentUserDidFromSessions(list);

      set((state) => ({
        sessions: clearActiveFriendUnread(list, state.activeSessionUlid, derivedDid || state.currentUserDid),
        loading: false,
        ...(!state.currentUserDid && derivedDid
          ? { currentUserDid: derivedDid, conversationLocalState: loadConversationLocalState(derivedDid) }
          : {}),
      }));
      const settingsEntries = await Promise.allSettled(list.map(async (session) => {
        const resp = await api.friendChatGetSettings(session.ulid);
        return [conversationKey('friend', session.ulid), localStateFromFriendSettings(resp.settings)] as const;
      }));
      set((state) => mergeRemoteConversationLocalState(state, settingsEntries));
    } catch (error) {
      if (isUnauthorizedError(error)) {
        set({ loading: false });
        return;
      }
      log.error('socialChat', 'loadSessions failed', error);
      set({ loading: false });
      throw error;
    }
  },

  loadGroups: async () => {
    if (!hasAuthenticatedActor()) return;
    try {
      const data = await api.groupChatListGroups();
      const groups = (data?.groups || []) as Group[];
      set({ groups });
      const settingsEntries = await Promise.allSettled(groups.map(async (group) => {
        const resp = await api.groupChatGetSettings(group.ulid);
        return [conversationKey('group', group.ulid), localStateFromGroupSettings(resp)] as const;
      }));
      set((state) => mergeRemoteConversationLocalState(state, settingsEntries));
    } catch (error) {
      if (isUnauthorizedError(error)) return;
      log.error('socialChat', 'loadGroups failed', error);
      throw error;
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab, openThreadRootUlid: null }),
  selectSession: (ulid) => {
      const state = get();
      const did = state.currentUserDid;

      // Optimistic: clear unread badge for the selected session
      set((prev) => ({
        activeSessionUlid: ulid,
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
            get().ackFriendMessages(unreadUlids, FriendMessageStatus.READ).catch(() => {});
          }
        }
      }
    },
  selectGroup: (ulid) => {
      set((prev) => ({
        activeGroupUlid: ulid,
        openThreadRootUlid: null,
        // Optimistic: clear unread badge for the selected group
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
          if (peerDid) {
            get().establishSession(ulid, peerDid).catch(() => {});
          }
        }
      }
      let data: { messages?: unknown[]; hasMore?: boolean; has_more?: boolean };
      if (activeTab === 'friend') {
        data = await api.friendChatListMessages(ulid);
      } else {
        data = await api.groupChatListMessages(ulid);
      }
      let msgs = data?.messages || [];
      // Friend-chat type=50 (FRIEND_MESSAGE_TYPE_SENDER_KEY_DISTRIBUTION)
      // is a control type carrying a Sender-Keys SKDM. We MUST NOT
      // render these in the visible chat history -- they're a side
      // channel for group E2EE bootstrap. Route the body to the SKDM
      // consumer (best-effort, fire-and-forget) and drop the row from
      // the displayed list. The fan-out is per-load, but
      // cryptoGroupSkConsumeSkdm is idempotent (chain row keyed on
      // primary key) so repeated processing of the same SKDM after a
      // re-render is safe.
      if (activeTab === 'friend') {
        const fmsgs = msgs as FriendChatMessage[];
        const myDid = get().currentUserDid;
        msgs = await decodeFriendMessages(
          ulid,
          friendPeerDid,
          consumeInboundFriendControlMessages(fmsgs, myDid),
        );
      } else {
        // Group chat is stored remotely as Sender-Keys ciphertext.
        // The same decode path feeds rendering and the local plaintext
        // search index so UI state and search state cannot drift.
        msgs = await decodeGroupMessages(ulid, msgs as GroupMessage[], 'group decrypt failed');
      }
      const visibleMsgs = filterClearedMessages(
        msgs as SocialMessage[],
        get().conversationLocalState,
        activeTab,
        ulid,
      );
      indexLocalSearchMessages(activeTab, ulid, visibleMsgs).catch((error) => {
        log.warn('socialChat', 'index loaded messages failed', error);
      });
      set((state) => ({
        messages: { ...state.messages, [ulid]: visibleMsgs },
        messageHasMore: {
          ...state.messageHasMore,
          [ulid]: Boolean(data?.hasMore ?? data?.has_more),
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
          get().ackFriendMessages(unreadUlids, FriendMessageStatus.READ).catch(() => {});
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
    const oldest = current[0]?.ulid;
    if (!oldest) return;
    set((state) => ({
      messageLoadingMore: { ...state.messageLoadingMore, [ulid]: true },
    }));
    try {
      let data: { messages?: unknown[]; hasMore?: boolean; has_more?: boolean };
      if (activeKind === 'friend') {
        data = await api.friendChatListMessages(ulid, oldest, 50);
      } else {
        data = await api.groupChatListMessages(ulid, oldest, 50);
      }
      let pageMessages = (data?.messages || []) as SocialMessage[];
      if (activeKind === 'friend') {
        const session = get().sessions.find((s) => s.ulid === ulid);
        const viewerDid = get().currentUserDid;
        const peerDid = session && viewerDid
          ? (session.participantADid === viewerDid ? session.participantBDid : session.participantADid)
          : '';
        pageMessages = await decodeFriendMessages(
          ulid,
          peerDid,
          consumeInboundFriendControlMessages(pageMessages as FriendChatMessage[], viewerDid),
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
        messages: { ...state.messages, [ulid]: [...dedup, ...(state.messages[ulid] || [])] },
        messageHasMore: {
          ...state.messageHasMore,
          [ulid]: Boolean(data?.hasMore ?? data?.has_more),
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
    const afterUlid = options?.afterUlid
      ?? (append ? get().threadNextCursor[key] ?? latestThreadReplyUlid(currentThread, rootUlid) : undefined);
    set((state) => ({
      ...(append
        ? { threadLoadingMore: { ...state.threadLoadingMore, [key]: true } }
        : { threadLoading: { ...state.threadLoading, [key]: true } }),
      threadError: { ...state.threadError, [key]: null },
    }));
    try {
      const data = activeKind === 'friend'
        ? await api.friendChatListThreadMessages(ulid, rootUlid, options?.limit ?? THREAD_REPLY_PAGE_SIZE, 50, afterUlid)
        : await api.groupChatListThreadMessages(ulid, rootUlid, options?.limit ?? THREAD_REPLY_PAGE_SIZE, 50, afterUlid);
      let loaded = threadPageMessages(data as ThreadPagePayload | undefined, rootUlid);
      if (activeKind === 'friend') {
        const session = get().sessions.find((s) => s.ulid === ulid);
        const viewerDid = get().currentUserDid;
        const peerDid = session && viewerDid
          ? (session.participantADid === viewerDid ? session.participantBDid : session.participantADid)
          : '';
        loaded = await decodeFriendMessages(
          ulid,
          peerDid,
          consumeInboundFriendControlMessages(loaded as FriendChatMessage[], viewerDid),
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
      const hasMore = Boolean(data?.hasMore ?? data?.has_more);
      const nextCursor = hasMore
        ? (data?.nextCursor ?? data?.next_cursor ?? latestThreadReplyUlid(nextMessages, rootUlid) ?? null)
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
      const data = activeKind === 'friend'
        ? await api.friendChatThreadCounts(ulid, uniqueRootUlids)
        : await api.groupChatThreadCounts(ulid, uniqueRootUlids);
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
      if (activeKind === 'friend') {
        await api.friendChatThreadMarkRead(ulid, rootUlid, lastReadUlid);
      } else {
        await api.groupChatThreadMarkRead(ulid, rootUlid, lastReadUlid);
      }
      await get().refreshThreadCounts(ulid, [rootUlid], activeKind);
    } catch (error) {
      log.warn('socialChat', 'markThreadRead failed', error);
    }
  },

  sendFriendMessage: async (sessionUlid, receiverDid, content, type, replyToUlid, attachments, explicitThreadRootUlid) => {
    try {
      const { sessionEncrypted, encryptionEnabled } = get();
      let encryptedPayload: string | undefined;
      let sendContent = content;
      const clientUlid = createClientMessageUlid();
      const threadRootUlid = explicitThreadRootUlid;

      let sendAttachments = attachments;
      if ((content.trim() || attachments?.length) && encryptionEnabled && sessionEncrypted[sessionUlid]) {
        try {
          encryptedPayload = await encryptFriendMessagePayload(sessionUlid, receiverDid, content, attachments ?? [], type);
          sendContent = '[Encrypted Message]';
          sendAttachments = [];
        } catch (encErr) {
          log.error('socialChat', 'friend message encryption failed', encErr);
          throw encErr;
        }
      }

      // Real-time fan-out is handled entirely by the SSE EventBus
      // (Station publishes onto it inside `friend_chat.handleSendMessage`
      // for both recipient and sender-echo). No client-side WebRTC
      // hint is sent; SSE delivery beats DC settle time on cold
      // conversations and reaches multi-device peers. See
      // docs/architecture/realtime/event-stream.md.
      await api.friendChatSendMessage(
        sessionUlid,
        receiverDid,
        sendContent,
        type,
        replyToUlid,
        sendAttachments,
        encryptedPayload,
        clientUlid,
        threadRootUlid,
      );
      if (threadRootUlid) return;
      await get().loadMessages(sessionUlid, 'friend').catch((error) => {
        log.warn('socialChat', 'sendFriendMessage: post-send message refresh failed', error);
      });
      const did = get().currentUserDid ?? '';
      set((state) => ({
        lastPreviews: {
          ...state.lastPreviews,
					[sessionUlid]: { content, type: type ?? 1, senderId: did },
        },
      }));
    } catch (error) {
      log.error('socialChat', 'sendFriendMessage failed', error);
      throw error;
    }
  },

  sendGroupMessage: async (groupUlid, content, type, replyToUlid, attachments, explicitThreadRootUlid) => {
    // Group chat is end-to-end encrypted via Sender Keys
    // (see peers-touch/docs/architecture/encryption/group-sender-keys.md).
    // The send path is:
    //   1. ensureSkdmDistributed -> ship our SKDM to every member
    //      who hasn't received it yet, over the per-pair friend-chat
    //      E2EE envelope (idempotent on repeat sends).
    //   2. encryptForGroup -> wrap the plaintext as a
    //      `GroupCiphertext` and base64 the bytes.
    //   3. groupChatSendMessage -> Station sees ONLY the ciphertext
    //      bytes; `content` is forced to "" by the Rust layer so a
    //      buggy caller cannot smuggle plaintext alongside ciphertext.
    //
    // Any failure aborts the whole send: a chat that "looks sent"
    // but reaches members in plaintext would be a security regression
    // worse than just failing visibly.
    const did = get().currentUserDid ?? '';
    if (!did) {
      throw new Error('No active actor; cannot send group message');
    }
    try {
      // Members from local cache when available; otherwise fetch
      // fresh. The list is small (<=500) and member churn is rare
      // so a single fetch per send is acceptable.
      let members = get().groupMembers[groupUlid];
      if (!members || members.length === 0) {
        try {
          const data = await api.groupChatGetMembers(groupUlid);
          members = normalizeGroupMembers(data?.members);
          set((state) => ({
            groupMembers: { ...state.groupMembers, [groupUlid]: members! },
          }));
        } catch (err) {
          log.warn('socialChat', 'sendGroupMessage: loadGroupMembers failed', err);
          members = [];
        }
      }
      const threadRootUlid = explicitThreadRootUlid;
      const sendWithCurrentEpoch = async (currentMembers: GroupMember[]) => {
        const memberDids = currentMembers.map((m) => m.actorDid).filter((d): d is string => !!d);
        const group = get().groups.find((item) => item.ulid === groupUlid);
        const observedMembershipEpoch = group?.membershipEpoch ?? 0n;
        await ensureSkdmDistributed(did, groupUlid, memberDids, {
          membershipEpoch: observedMembershipEpoch,
          members: currentMembers.map((member) => ({
            actorDid: member.actorDid,
            actorHomeStationPeerId: member.actorHomeStationPeerId,
          })),
        });
        const encryptedPayloadB64 = await encryptBytesForGroup(
          groupUlid,
          createEncryptedChatPayloadBytes(content, attachments ?? [], type),
        );
        return api.groupChatSendMessage(
          groupUlid,
          '',
          type,
          replyToUlid,
          undefined,
          undefined,
          [],
          encryptedPayloadB64,
          threadRootUlid,
          observedMembershipEpoch,
        );
      };
      let sentResponse;
      try {
        sentResponse = await sendWithCurrentEpoch(members);
      } catch (error) {
        if (!(error instanceof Error) || !/membership epoch stale/i.test(error.message)) {
          throw error;
        }
        await get().loadGroups();
        const refreshed = await api.groupChatGetMembers(groupUlid);
        members = (refreshed?.members || []) as GroupMember[];
        set((state) => ({
          groupMembers: { ...state.groupMembers, [groupUlid]: members! },
        }));
        await rotateGroupSenderChain(did, groupUlid);
        sentResponse = await sendWithCurrentEpoch(members);
      }
      if (sentResponse.message?.ulid) {
        setDecryptCache(sentResponse.message.ulid, {
          content,
          type: type ?? sentResponse.message.type,
          attachments: attachments ?? [],
          cachedAt: Date.now(),
        });
      }
      if (threadRootUlid) return;
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
      log.error('socialChat', 'sendGroupMessage failed', error);
      throw error;
    }
  },

  loadGroupMembers: async (groupUlid) => {
    if (!hasAuthenticatedActor()) return;
    try {
      const data = await api.groupChatGetMembers(groupUlid);
      const members = normalizeGroupMembers(data?.members);

      // Forced rotation on observed membership shrinkage. We diff
      // the freshly-fetched member list against the cached one; if
      // any DID we previously knew about is gone AND we (the
      // current actor) are still in the group, rotate our local
      // sender chain so the departed member's copy of the chain
      // key cannot decrypt our future messages.
      //
      // We don't have an SSE event for membership changes yet
      // (tracked separately), so this poll-driven diff is the
      // current trigger. It misses the case where the departed
      // member leaves AND the current device never reloads members
      // before sending again -- a follow-up SSE
      // GroupMembershipChange event will close that gap. Until
      // then, the best-effort rotation is strictly better than
      // nothing.
      const did = get().currentUserDid;
      const oldMembers = get().groupMembers[groupUlid];
      if (did && oldMembers && oldMembers.length > 0) {
        const oldDids = new Set(oldMembers.map((m) => m.actorDid).filter((d): d is string => !!d));
        const newDids = new Set(members.map((m) => m.actorDid).filter((d): d is string => !!d));
        const stillIn = newDids.has(did);
        const removed = [...oldDids].filter((d) => !newDids.has(d) && d !== did);
        if (stillIn && removed.length > 0) {
          rotateGroupSenderChain(did, groupUlid).catch((err) =>
            log.warn('socialChat', 'rotateGroupSenderChain failed', err),
          );
        }
      }

      set((state) => ({
        groupMembers: { ...state.groupMembers, [groupUlid]: members },
      }));
    } catch (error) {
      if (isUnauthorizedError(error)) return;
      log.error('socialChat', 'loadGroupMembers failed', error);
      throw error;
    }
  },

  redecryptGroupMessages: async (groupUlid, senderDid) => {
    // Guards: nothing to do if we have no cached messages for this
    // group yet (the next loadMessages will decrypt fresh anyway).
    const cached = get().messages[groupUlid] as GroupMessage[] | undefined;
    if (!cached || cached.length === 0) return;

    // Identify rows that are encrypted-but-undecrypted. We use the
    // placeholder strings as the "stuck" sentinel because they are
    // produced exclusively by loadMessages' MissingSkdm / generic
    // failure arm; any successfully-decrypted row has the real
    // plaintext in `content` already.
      const PLACEHOLDERS = new Set([
        GROUP_DECRYPT_WAITING_KEY_PLACEHOLDER,
        GROUP_DECRYPT_FAILED_PLACEHOLDER,
      ]);
    const rows = cached.filter((m) => {
      if (m.recalled) return false;
      if (!m.encryptedPayload || m.encryptedPayload.byteLength === 0) return false;
      if (!PLACEHOLDERS.has(m.content || '')) return false;
      if (senderDid && m.senderDid && m.senderDid !== senderDid) return false;
      return true;
    });
    if (rows.length === 0) return;

    // Walk in original order; we update at the end as a single
    // setState so React doesn't re-render once per message.
    const decrypted = new Map<string, GroupMessage>();
    for (const m of rows) {
      try {
        const payloadB64 = bytesToB64(m.encryptedPayload);
        const out = await decryptBytesFromGroup(groupUlid, payloadB64);
        const payload = decodeEncryptedChatPayloadBytes(out.bytes);
        const result = payload
          ? applyDecodedChatPayload(m, payload)
          : ({ ...m, content: new TextDecoder().decode(out.bytes) } as GroupMessage);
        cacheDecryptedGroupMessage(m, result);
        decrypted.set(m.ulid, result);
      } catch (err) {
        // Still missing -- e.g. the SKDM that arrived was for a
        // DIFFERENT sender than this row. Leave the placeholder in
        // place so the next install (or next loadMessages) tries
        // again.
        if (!(err instanceof MissingSkdmError)) {
          log.warn('socialChat', 'redecryptGroupMessages: decrypt failed', err);
        }
      }
    }
    if (decrypted.size === 0) return;

    set((state) => {
      const list = state.messages[groupUlid] as GroupMessage[] | undefined;
      if (!list) return state;
      const next = list.map((m) => {
        return decrypted.get(m.ulid) ?? m;
      });
      return {
        messages: { ...state.messages, [groupUlid]: next as (FriendChatMessage | GroupMessage)[] },
      };
    });
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
      await api.friendChatRecallMessage(sessionUlid, messageUlid);
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
      const { encryptionEnabled, sessionEncrypted, sessions, currentUserDid } = get();
      let editContent = newContent;
      let editCiphertext = newCiphertext;
      if ((!editCiphertext || editCiphertext.byteLength === 0) && newContent?.trim() && encryptionEnabled && sessionEncrypted[sessionUlid]) {
        const session = sessions.find((item) => item.ulid === sessionUlid);
        const receiverDid = session ? peerOfSession(session, currentUserDid).did : '';
        if (!receiverDid) throw new Error('editFriendMessage: receiverDid is required for encrypted edit');
        const encrypted = await encryptFriendMessagePayload(sessionUlid, receiverDid, newContent.trim(), [], undefined);
        editContent = '';
        editCiphertext = b64ToBytes(encrypted);
      }
      await api.friendChatEditMessage(sessionUlid, messageUlid, editContent, editCiphertext);
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
      await api.groupChatRecallMessage(groupUlid, messageUlid);
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
      await api.groupChatEditMessage(groupUlid, messageUlid, newContent, newCiphertext);
      get().applyMessageMutation(
        groupUlid,
        messageUlid,
        'EDIT',
        {
          newContent: newContent ?? '',
          newCiphertext: newCiphertext ?? new Uint8Array(),
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
      // status omitted or 0: all statuses; backend returns both sent and received rows.
      const data = await api.friendChatListFriendRequests(
        status === undefined ? undefined : status,
        limit ?? 200,
        offset ?? 0,
      );
      const requests = normalizeFriendRequests(data?.requests);
      set({ friendRequests: requests });
    } catch (error) {
      if (isUnauthorizedError(error)) return;
      log.error('socialChat', 'loadFriendRequests failed', error);
      throw error;
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
    if (!hasAuthenticatedActor()) return;
    const { groups } = get();
    const counts: Record<string, number> = {};
    try {
      for (const g of groups) {
        const res = await api.groupChatUnreadCount(g.ulid);
        counts[g.ulid] = Number(res?.unreadCount ?? 0);
      }
      const activeGroupUlid = get().activeGroupUlid;
      set({ groupUnreadCounts: activeGroupUlid ? { ...counts, [activeGroupUlid]: 0 } : counts });
    } catch (error) {
      if (isUnauthorizedError(error)) return;
      log.error('socialChat', 'loadGroupUnreadCounts failed', error);
      throw error;
    }
  },

  loadConversationPreviews: async () => {
    if (!hasAuthenticatedActor()) return;
    const { sessions, groups } = get();
    const previews: Record<string, MessagePreview> = {};
    const tasks: Promise<void>[] = [];

    for (const s of sessions) {
      if (!s.lastMessageUlid) continue;
      tasks.push(
        api.friendChatListMessages(s.ulid, undefined, 20).then((data) => {
          const msgs = data?.messages;
          if (msgs && msgs.length > 0) {
            const myDid = get().currentUserDid;
            const friendMessages = consumeInboundFriendControlMessages(msgs as FriendChatMessage[], myDid);
            // Take last element — API may return ascending order
            const visibleMessages = filterClearedMessages(
              friendMessages,
              get().conversationLocalState,
              'friend',
              s.ulid,
            ).filter((message) => !socialMessageExplicitThreadRootUlid(message));
            const m = visibleMessages[visibleMessages.length - 1] as FriendChatMessage | undefined;
						if (m) previews[s.ulid] = { content: m.content ?? '', type: friendMessageTypeOf(m) ?? 1, senderId: friendMessageSenderDid(m) };
          }
        }).catch(() => {}),
      );
    }
    for (const g of groups) {
      tasks.push(
        api.groupChatListMessages(g.ulid, undefined, 20).then((data) => {
          const msgs = data?.messages;
          if (msgs && msgs.length > 0) {
            // Take last element — API may return ascending order
            const visibleMessages = filterClearedMessages(
              msgs as GroupMessage[],
              get().conversationLocalState,
              'group',
              g.ulid,
            ).filter((message) => !socialMessageExplicitThreadRootUlid(message));
            const m = visibleMessages[visibleMessages.length - 1] as GroupMessage | undefined;
						if (m) previews[g.ulid] = { content: m.content ?? '', type: Number(m.type ?? 1), senderId: m.senderDid ?? '' };
          }
        }).catch(() => {}),
      );
    }

    await Promise.allSettled(tasks);
    set({ lastPreviews: previews });
  },

  ackFriendMessages: async (ulids, status) => {
    try {
      await api.friendChatAckMessages(ulids, status);
      await get().loadSessions();
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
    if (kind === 'friend') {
      const visibleFriendMessages = consumeInboundFriendControlMessages(
        [message as FriendChatMessage],
        get().currentUserDid,
      );
      if (visibleFriendMessages.length === 0) return;
      message = visibleFriendMessages[0];
    }
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
        get().ackFriendMessages([friendMessage.ulid], FriendMessageStatus.DELIVERED).catch((error) => {
          log.debug('socialChat', 'realtime delivered ack failed', error);
        });
      }
    }
  },

  markGroupRead: async (groupUlid) => {
    try {
      await api.groupChatMarkRead(groupUlid);
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
    const remotePatch = localStatePatchToRemote(patch);
    try {
      if (Object.keys(remotePatch).length > 0) {
        if (kind === 'friend') {
          await api.friendChatUpdateSettings(ulid, remotePatch);
        } else {
          await api.groupChatUpdateSettings(ulid, remotePatch);
        }
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
      await api.groupChatLeaveGroup(groupUlid);
      set((prev) => {
        const nextLocalState = { ...prev.conversationLocalState };
        delete nextLocalState[conversationKey('group', groupUlid)];
        const nextMessages = { ...prev.messages };
        const nextPreviews = { ...prev.lastPreviews };
        delete nextMessages[groupUlid];
        delete nextPreviews[groupUlid];
        saveConversationLocalState(prev.currentUserDid, nextLocalState);
        return {
          groups: prev.groups.filter((group) => group.ulid !== groupUlid),
          groupMembers: Object.fromEntries(Object.entries(prev.groupMembers).filter(([key]) => key !== groupUlid)),
          groupUnreadCounts: Object.fromEntries(Object.entries(prev.groupUnreadCounts).filter(([key]) => key !== groupUlid)),
          conversationLocalState: nextLocalState,
          messages: nextMessages,
          lastPreviews: nextPreviews,
          ...(prev.activeGroupUlid === groupUlid ? { activeGroupUlid: null } : {}),
        };
      });
      await get().loadGroups();
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
    const did = state.currentUserDid;
    const out: DesktopIMConversationProjection[] = [];

    for (const s of state.sessions) {
      const localState = state.conversationLocalState[conversationKey('friend', s.ulid)];
      if (localState?.hidden) continue;
      const peer = peerOfSession(s, did);
      const loadedMsgs = state.messages[s.ulid];
      const loadedMainMsgs = loadedMsgs?.filter((message) => !socialMessageExplicitThreadRootUlid(message));
      const friendPreview = loadedMainMsgs && loadedMainMsgs.length > 0
        ? previewFromMessage(loadedMainMsgs[loadedMainMsgs.length - 1])
        : state.lastPreviews[s.ulid];
      out.push(projectDesktopIMConversation({
        type: 'friend',
        ulid: s.ulid,
        name: peer.name || 'Friend',
        avatar: peer.avatar || '',
        peerDid: peer.did || '',
        lastActivity: activityFromSession(s),
        unread: friendUnreadForViewer(s, did),
        muted: localState?.muted,
        alertEnabled: localState?.alertEnabled,
        hidden: localState?.hidden,
        preview: friendPreview,
      }));
    }

    for (const g of state.groups) {
      const localState = state.conversationLocalState[conversationKey('group', g.ulid)];
      if (localState?.hidden) continue;
      const loadedGroupMsgs = state.messages[g.ulid];
      const loadedMainGroupMsgs = loadedGroupMsgs?.filter((message) => !socialMessageExplicitThreadRootUlid(message));
      const groupPreview = loadedMainGroupMsgs && loadedMainGroupMsgs.length > 0
        ? previewFromMessage(loadedMainGroupMsgs[loadedMainGroupMsgs.length - 1])
        : state.lastPreviews[g.ulid];
      out.push(projectDesktopIMConversation({
        type: 'group',
        ulid: g.ulid,
        name: g.name || 'Group',
        avatar: groupAvatarRemoteUrl(g),
        memberCount: Number(g.memberCount ?? 0),
        lastActivity: activityFromGroup(g),
        unread: state.groupUnreadCounts[g.ulid] ?? 0,
        muted: localState?.muted,
        alertEnabled: localState?.alertEnabled,
        hidden: localState?.hidden,
        preview: groupPreview,
      }));
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
      return {
        id: did || peer?.did || '',
        name: peer?.name || did,
        avatar: peer?.avatar || '',
        isSelf,
      };
    }

    const member = state.groupMembers[conversationUlid]?.find((item) => item.actorDid === did);
    const profile = actorProfileFromSessions(
      state.sessions,
      state.currentUserDid,
      did,
      state.currentUserProfile,
    );
    return {
      id: did,
      name: member?.nickname || profile.name || did,
      avatar: profile.avatar || '',
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
