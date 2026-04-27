import { create } from 'zustand';
import { timestampDate } from '@bufbuild/protobuf/wkt';

import { api, type ChatAttachmentInput } from '../services/desktop_api';
import { FriendMessageStatus, type FriendChatSession, type FriendChatMessage } from '../gen/proto/domain/chat/friend_chat_pb';
import type { Group, GroupMessage, GroupMember } from '../gen/proto/domain/chat/group_chat_pb';
import { log } from '../utils/logger';
interface FriendRequestData {
  id: string;
  senderId: string;
  receiverId: string;
  status: number;
  message: string;
  createdAt: string;
  respondedAt: string;
  senderDisplayName: string;
  senderAvatar: string;
  receiverDisplayName: string;
  receiverAvatar: string;
}

export interface MessagePreview {
  content: string;
  type: number;
  senderDid: string;
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

export interface SearchResult {
  messageId: string;
  conversationId: string;
  scope: 'friend' | 'group';
  senderDid: string;
  content: string;
  sentAt: number;
  conversationName: string;
}

interface SocialChatState {
  sessions: FriendChatSession[];
  groups: Group[];
  activeTab: 'friend' | 'group';
  activeSessionUlid: string | null;
  activeGroupUlid: string | null;
  messages: Record<string, (FriendChatMessage | GroupMessage)[]>;
  messageHasMore: Record<string, boolean>;
  messageLoadingMore: Record<string, boolean>;
  groupMembers: Record<string, GroupMember[]>;
  loading: boolean;
  showDetail: boolean;
  currentUserProfile: { id: string; username: string; displayName: string; avatar?: string } | null;
  /** Own DID for message ownership; prefer profile.id, may align with participant DIDs in sessions */
  currentUserDid: string | null;
  friendRequests: FriendRequestData[];
  groupUnreadCounts: Record<string, number>;
  lastPreviews: Record<string, MessagePreview>;

  searchQuery: string;
  searchResults: SearchResult[];
  searchLoading: boolean;
  /** After navigation from search, scroll this message into view once messages are loaded. */
  scrollToMessageUlid: string | null;

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
   * Source of truth: Station's `/friend-chat/presence/stream` SSE
   * (real-time push) plus the `participant_*_online` snapshot embedded
   * in `friendChatListSessions` responses (used to seed the map on
   * cold-start before the SSE has caught up).
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
   * `staleBefore` ms. Called from the SocialChatPage on a 1-2s
   * interval so phantom "is typing…" bubbles auto-clear when the
   * sender goes silent without explicitly emitting `typing=false`.
   */
  sweepTypingPeers: (staleBefore: number) => void;

  loadSessions: () => Promise<void>;
  loadGroups: () => Promise<void>;
  setActiveTab: (tab: 'friend' | 'group') => void;
  selectSession: (ulid: string) => void;
  selectGroup: (ulid: string) => void;
  loadMessages: (ulid: string, kind?: 'friend' | 'group') => Promise<void>;
  loadOlderMessages: (ulid: string, kind?: 'friend' | 'group') => Promise<void>;
  sendFriendMessage: (
    sessionUlid: string,
    receiverDid: string,
    content: string,
    type?: number,
    replyToUlid?: string,
    attachments?: ChatAttachmentInput[],
  ) => Promise<void>;
  sendGroupMessage: (
    groupUlid: string,
    content: string,
    type?: number,
    replyToUlid?: string,
    attachments?: ChatAttachmentInput[],
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
   * Friend chat only — group chat keeps using `groupChatRecallMessage`
   * with its own UI placement.
   */
  recallFriendMessage: (sessionUlid: string, messageUlid: string) => Promise<void>;
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

  getUnifiedConversations: () => UnifiedConversation[];

  searchMessages: (query: string, scope?: string, conversationId?: string) => Promise<void>;
  clearSearch: () => void;
  setScrollToMessageUlid: (ulid: string | null) => void;

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
  if (!viewerDid) {
    return Math.max(s.unreadCountA ?? 0, s.unreadCountB ?? 0);
  }
  if (s.participantADid === viewerDid) return s.unreadCountA ?? 0;
  if (s.participantBDid === viewerDid) return s.unreadCountB ?? 0;
  return Math.max(s.unreadCountA ?? 0, s.unreadCountB ?? 0);
}

function peerDisplayName(s: FriendChatSession, viewerDid: string | null): string {
  if (viewerDid) {
    if (s.participantADid === viewerDid) {
      return (s as any).participantBDisplayName || s.participantBDid || s.participantADid;
    }
    if (s.participantBDid === viewerDid) {
      return (s as any).participantADisplayName || s.participantADid || s.participantBDid;
    }
  }
  return (s as any).participantBDisplayName || s.participantBDid || s.participantADid || '';
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

const initialSocialState: Pick<
  SocialChatState,
  | 'sessions'
  | 'groups'
  | 'activeTab'
  | 'activeSessionUlid'
  | 'activeGroupUlid'
  | 'messages'
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
  | 'searchQuery'
  | 'searchResults'
  | 'searchLoading'
  | 'scrollToMessageUlid'
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
  searchQuery: '',
  searchResults: [],
  searchLoading: false,
  scrollToMessageUlid: null,

  encryptionEnabled: false,
  ownFingerprint: null,
  sessionEncrypted: {},
  friendP2pStatus: {},
  peerOnline: {},
  typingPeers: {},
};

export const useSocialChatStore = create<SocialChatState>((set, get) => ({
  ...initialSocialState,

  reset: () => set({ ...initialSocialState }),

  hydrate: async (actorId: string) => {
    if (!actorId) return;
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
    const prev = get().peerOnline[did];
    if (prev === online) return;
    set((state) => ({
      peerOnline: { ...state.peerOnline, [did]: online },
    }));
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
      const peerBundle = await api.keyExchangeFetchBundle(peerDid);
      if (!peerBundle.ik_pub || !peerBundle.spk_pub) {
        return false;
      }
      await api.cryptoInitSession(
        sessionUlid,
        peerDid,
        peerBundle.ik_pub,
        peerBundle.spk_pub,
        peerBundle.spk_sig,
        peerBundle.opk_pub,
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
    set({ loading: true });
    try {
      const data = await api.friendChatListSessions();
      const raw = (data?.sessions || []) as Record<string, any>[];
      const list = raw.map((r) => {
        const s = r as FriendChatSession;
        if (!s.participantADisplayName && r.participant_a_display_name) {
          (s as any).participantADisplayName = r.participant_a_display_name;
        }
        if (!s.participantAAvatar && r.participant_a_avatar) {
          (s as any).participantAAvatar = r.participant_a_avatar;
        }
        if (!s.participantBDisplayName && r.participant_b_display_name) {
          (s as any).participantBDisplayName = r.participant_b_display_name;
        }
        if (!s.participantBAvatar && r.participant_b_avatar) {
          (s as any).participantBAvatar = r.participant_b_avatar;
        }
        if (!s.participantADid && r.participant_a_did) {
          s.participantADid = r.participant_a_did;
        }
        if (!s.participantBDid && r.participant_b_did) {
          s.participantBDid = r.participant_b_did;
        }
        return s;
      });
      const derivedDid = deriveCurrentUserDidFromSessions(list);

      // Seed peerOnline from the snapshot embedded in this response.
      // We deliberately *only seed*, never *overwrite*: an SSE flip
      // that arrived 200ms before this list call must not be undone
      // by the response we're parsing now (the snapshot is server-side
      // serialized at request time, the SSE is live). Hence we only
      // write to keys that are currently `undefined`.
      const presenceSeed: Record<string, boolean> = {};
      for (const s of list) {
        const aDid = s.participantADid;
        const bDid = s.participantBDid;
        const r = s as any;
        const aOnline = Boolean(r.participantAOnline ?? r.participant_a_online);
        const bOnline = Boolean(r.participantBOnline ?? r.participant_b_online);
        if (aDid && presenceSeed[aDid] === undefined) presenceSeed[aDid] = aOnline;
        if (bDid && presenceSeed[bDid] === undefined) presenceSeed[bDid] = bOnline;
      }

      set((state) => ({
        sessions: list,
        loading: false,
        ...(!state.currentUserDid && derivedDid ? { currentUserDid: derivedDid } : {}),
        peerOnline: { ...presenceSeed, ...state.peerOnline },
      }));
    } catch (error) {
      log.error('socialChat', 'loadSessions failed', error);
      set({ loading: false });
      throw error;
    }
  },

  loadGroups: async () => {
    try {
      const data = await api.groupChatListGroups();
      set({ groups: (data?.groups || []) as Group[] });
    } catch (error) {
      log.error('socialChat', 'loadGroups failed', error);
      throw error;
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  selectSession: (ulid) => {
      const state = get();
      const did = state.currentUserDid;

      // Optimistic: clear unread badge for the selected session
      set((prev) => ({
        activeSessionUlid: ulid,
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
        // Optimistic: clear unread badge for the selected group
        groupUnreadCounts: { ...prev.groupUnreadCounts, [ulid]: 0 },
      }));
      get().markGroupRead(ulid).catch(() => {});
    },

  loadMessages: async (ulid, kind) => {
    const activeTab = kind ?? get().activeTab;
    set({ loading: true });
    try {
      if (activeTab === 'friend') {
        const session = get().sessions.find((s) => s.ulid === ulid);
        if (session) {
          const viewerDid = get().currentUserDid;
          const peerDid = viewerDid
            ? (session.participantADid === viewerDid ? session.participantBDid : session.participantADid)
            : '';
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
      const msgs = data?.messages || [];
      set((state) => ({
        messages: { ...state.messages, [ulid]: msgs as (FriendChatMessage | GroupMessage)[] },
        messageHasMore: {
          ...state.messageHasMore,
          [ulid]: Boolean(data?.hasMore ?? data?.has_more),
        },
        loading: false,
      }));
      // Ack unread friend messages as READ so sender sees correct read receipts
      if (activeTab === 'friend') {
        const viewerDid = get().currentUserDid;
        const unreadUlids = (msgs as FriendChatMessage[])
          .filter((m) => m.senderDid !== viewerDid && m.status !== FriendMessageStatus.READ)
          .map((m) => m.ulid);
        if (unreadUlids.length > 0) {
          get().ackFriendMessages(unreadUlids, FriendMessageStatus.READ).catch(() => {});
        }
      }
    } catch (error) {
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
      const older = (data?.messages || []) as (FriendChatMessage | GroupMessage)[];
      const dedup = older.filter((msg) => !current.some((item) => item.ulid === msg.ulid));
      set((state) => ({
        messages: { ...state.messages, [ulid]: [...dedup, ...(state.messages[ulid] || [])] },
        messageHasMore: {
          ...state.messageHasMore,
          [ulid]: Boolean(data?.hasMore ?? data?.has_more),
        },
        messageLoadingMore: { ...state.messageLoadingMore, [ulid]: false },
      }));
    } catch (error) {
      log.error('socialChat', 'loadOlderMessages failed', error);
      set((state) => ({
        messageLoadingMore: { ...state.messageLoadingMore, [ulid]: false },
      }));
      throw error;
    }
  },

  sendFriendMessage: async (sessionUlid, receiverDid, content, type, replyToUlid, attachments) => {
    try {
      const { sessionEncrypted, encryptionEnabled } = get();
      let encryptedPayload: string | undefined;
      let sendContent = content;
      const clientUlid = createClientMessageUlid();

      if (encryptionEnabled && sessionEncrypted[sessionUlid]) {
        try {
          const enc = await api.cryptoEncryptMessage(sessionUlid, receiverDid, content);
          const envelope = JSON.stringify({
            c: enc.ciphertext,
            n: enc.counter,
            ...(enc.ephemeral_key ? { e: enc.ephemeral_key } : {}),
          });
          encryptedPayload = btoa(envelope);
          sendContent = '[Encrypted Message]';
        } catch (encErr) {
          log.error('socialChat', 'encryption failed, sending plaintext', encErr);
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
        attachments,
        encryptedPayload,
        clientUlid,
      );
      await get().loadMessages(sessionUlid, 'friend');
      const did = get().currentUserDid ?? '';
      set((state) => ({
        lastPreviews: {
          ...state.lastPreviews,
          [sessionUlid]: { content, type: type ?? 1, senderDid: did },
        },
      }));
    } catch (error) {
      log.error('socialChat', 'sendFriendMessage failed', error);
      throw error;
    }
  },

  sendGroupMessage: async (groupUlid, content, type, replyToUlid, _attachments) => {
    try {
      const sendContent = content;

      // Group chat currently uses Station as the sole transport; attachments are not wired through the desktop bridge yet.
      await api.groupChatSendMessage(groupUlid, sendContent, type, replyToUlid);
      await get().loadMessages(groupUlid, 'group');
      const did = get().currentUserDid ?? '';
      set((state) => ({
        lastPreviews: {
          ...state.lastPreviews,
          [groupUlid]: { content, type: type ?? 1, senderDid: did },
        },
      }));
    } catch (error) {
      log.error('socialChat', 'sendGroupMessage failed', error);
      throw error;
    }
  },

  loadGroupMembers: async (groupUlid) => {
    try {
      const data = await api.groupChatGetMembers(groupUlid);
      const members = data?.members || [];
      set((state) => ({
        groupMembers: { ...state.groupMembers, [groupUlid]: members as GroupMember[] },
      }));
    } catch (error) {
      log.error('socialChat', 'loadGroupMembers failed', error);
      throw error;
    }
  },

  toggleDetail: () => set((state) => ({ showDetail: !state.showDetail })),
  setShowDetail: (show) => set({ showDetail: show }),

  deleteMessage: async (ulid, messageUlid, kind) => {
    const tab = kind ?? get().activeTab;
    try {
      if (tab === 'group') {
        await api.groupChatDeleteMessage(ulid, messageUlid);
      } else {
        // Friend chat: real server-side delete. The handler emits
        // a `MessageMutation { kind=DELETE }` over SSE which is
        // the canonical path that drops the row from the local
        // cache (via `applyMessageMutation`). Removing it locally
        // here too is just a best-effort optimistic update so the
        // bubble disappears immediately for the deleter; the SSE
        // round-trip would be ~30-100ms on the same machine.
        await api.friendChatDeleteMessage(ulid, messageUlid);
      }
      set((state) => ({
        messages: {
          ...state.messages,
          [ulid]: (state.messages[ulid] || []).filter((m) => m.ulid !== messageUlid),
        },
      }));
    } catch (error) {
      log.error('socialChat', 'deleteMessage failed', error);
      throw error;
    }
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
      await api.friendChatEditMessage(sessionUlid, messageUlid, newContent, newCiphertext);
      get().applyMessageMutation(
        sessionUlid,
        messageUlid,
        'EDIT',
        {
          newContent: newContent ?? '',
          newCiphertext: newCiphertext ?? new Uint8Array(),
          mutatedTsUnixMs: Date.now(),
        },
      );
    } catch (error) {
      log.error('socialChat', 'editFriendMessage failed', error);
      throw error;
    }
  },

  applyMessageMutation: (sessionUlid, messageUlid, kind, payload) => {
    set((state) => {
      const msgs = state.messages[sessionUlid];
      if (!msgs || msgs.length === 0) {
        return {} as Partial<SocialChatState>;
      }
      // DELETE removes the row entirely. RECALL keeps it (so reply
      // chains don't dangle) but flips `recalled=true` and clears
      // the body — the bubble renders as a tombstone client-side.
      // EDIT replaces the content / ciphertext and stamps editedAt.
      let mutated = false;
      let next: typeof msgs;
      if (kind === 'DELETE') {
        next = msgs.filter((m) => {
          if (m.ulid === messageUlid) {
            mutated = true;
            return false;
          }
          return true;
        });
      } else {
        next = msgs.map((m) => {
          if (m.ulid !== messageUlid) return m;
          // Only friend chat carries `recalled` / `editedAt`; if a
          // group message somehow gets routed here we silently
          // skip — the wire contract wouldn't put one in this map
          // anyway (group recall uses the group store).
          if (!('recalled' in m)) return m;
          const fcm = m as FriendChatMessage;
          if (kind === 'RECALL') {
            if (fcm.recalled) return m; // idempotent re-apply
            mutated = true;
            return {
              ...fcm,
              recalled: true,
              content: '',
              encryptedPayload: new Uint8Array(),
            } as FriendChatMessage;
          }
          // kind === 'EDIT'
          mutated = true;
          // Cast to any to construct the proto Timestamp shape
          // without importing the generated schema here. The store
          // surface already treats `editedAt` as opaque; the chat
          // bubble renders the tooltip "edited at <local time>".
          // We only set the ms field — protobuf-es accepts a
          // plain `{ seconds, nanos }` shape on assignment.
          const seconds = BigInt(Math.floor(payload.mutatedTsUnixMs / 1000));
          const nanos = (payload.mutatedTsUnixMs % 1000) * 1_000_000;
          return {
            ...fcm,
            content: payload.newContent || fcm.content,
            encryptedPayload:
              payload.newCiphertext.byteLength > 0
                ? payload.newCiphertext
                : fcm.encryptedPayload,
            editedAt: { seconds, nanos } as unknown as FriendChatMessage['editedAt'],
          } as FriendChatMessage;
        });
      }
      if (!mutated) return {} as Partial<SocialChatState>;
      return { messages: { ...state.messages, [sessionUlid]: next } };
    });
  },

  loadCurrentUserProfile: async () => {
    try {
      const profile = await api.actorGetMyProfile();
      const did = profile?.id?.trim() || null;
      set({
        currentUserProfile: profile,
        currentUserDid: did,
      });
    } catch (error) {
      log.error('socialChat', 'loadCurrentUserProfile failed', error);
      throw error;
    }
  },

  loadFriendRequests: async (status, limit, offset) => {
    try {
      // status omitted or 0: all statuses; backend returns both sent and received rows.
      const data = await api.friendChatListFriendRequests(
        status === undefined ? undefined : status,
        limit ?? 200,
        offset ?? 0,
      );
      const raw = data?.requests || [];
      const requests: FriendRequestData[] = raw.map((r: Record<string, any>) => ({
        id: r.id ?? r.Id ?? '',
        senderId: r.senderId ?? r.sender_id ?? r.senderDid ?? r.sender_did ?? '',
        receiverId: r.receiverId ?? r.receiver_id ?? r.receiverDid ?? r.receiver_did ?? '',
        status: r.status ?? 0,
        message: r.message ?? '',
        createdAt: r.createdAt ?? r.created_at ?? '',
        respondedAt: r.respondedAt ?? r.responded_at ?? '',
        senderDisplayName: r.senderDisplayName ?? r.sender_display_name ?? '',
        senderAvatar: r.senderAvatar ?? r.sender_avatar ?? '',
        receiverDisplayName: r.receiverDisplayName ?? r.receiver_display_name ?? '',
        receiverAvatar: r.receiverAvatar ?? r.receiver_avatar ?? '',
      }));
      set({ friendRequests: requests });
    } catch (error) {
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
      await api.friendChatRejectFriendRequest(requestId);
      await get().loadFriendRequests();
    } catch (error) {
      log.error('socialChat', 'rejectFriendRequest failed', error);
      throw error;
    }
  },

  loadGroupUnreadCounts: async () => {
    const { groups } = get();
    const counts: Record<string, number> = {};
    try {
      for (const g of groups) {
        const res = await api.groupChatUnreadCount(g.ulid);
        counts[g.ulid] = Number(res?.unreadCount ?? 0);
      }
      set({ groupUnreadCounts: counts });
    } catch (error) {
      log.error('socialChat', 'loadGroupUnreadCounts failed', error);
      throw error;
    }
  },

  loadConversationPreviews: async () => {
    const { sessions, groups } = get();
    const previews: Record<string, MessagePreview> = {};
    const tasks: Promise<void>[] = [];

    for (const s of sessions) {
      if (!s.lastMessageUlid) continue;
      tasks.push(
        api.friendChatListMessages(s.ulid, undefined, 1).then((data) => {
          const msgs = data?.messages;
          if (msgs && msgs.length > 0) {
            // Take last element — API may return ascending order
            const m = msgs[msgs.length - 1] as FriendChatMessage;
            previews[s.ulid] = { content: m.content ?? '', type: Number(m.type ?? 1), senderDid: m.senderDid ?? '' };
          }
        }).catch(() => {}),
      );
    }
    for (const g of groups) {
      tasks.push(
        api.groupChatListMessages(g.ulid, undefined, 1).then((data) => {
          const msgs = data?.messages;
          if (msgs && msgs.length > 0) {
            // Take last element — API may return ascending order
            const m = msgs[msgs.length - 1] as GroupMessage;
            previews[g.ulid] = { content: m.content ?? '', type: Number(m.type ?? 1), senderDid: m.senderDid ?? '' };
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
    // Map realtime MessageReceipt_Kind onto FriendMessageStatus —
    // these are intentionally distinct enums (the chat status carries
    // SENDING/SENT/FAILED that have no realtime meaning), so the
    // mapping is partial. See station handler.go::receiptKindFromFriendStatus
    // for the inverse table.
    const target =
      kind === 'READ'
        ? FriendMessageStatus.READ
        : kind === 'DELIVERED'
          ? FriendMessageStatus.DELIVERED
          : null;
    if (target == null) return;

    set((state) => {
      const current = state.messages[sessionUlid];
      if (!current || current.length === 0) return state;
      let mutated = false;
      const next = current.map((m) => {
        const fcm = m as FriendChatMessage;
        if (fcm.ulid !== messageUlid) return m;
        // Forward-only: a stale DELIVERED arriving after READ is
        // ignored, otherwise the receipt order on the wire would
        // dictate the UI state and dropped frames could regress the
        // tick. The persistence layer on Station applies the same
        // strict-greater filter, so client and server agree.
        if ((fcm.status ?? 0) >= target) return m;
        mutated = true;
        return { ...fcm, status: target } as FriendChatMessage;
      });
      if (!mutated) return state;
      return { messages: { ...state.messages, [sessionUlid]: next } };
    });
  },

  applyTypingState: (sessionUlid, fromActorId, typing) => {
    if (!sessionUlid || !fromActorId) return;
    set((state) => {
      const sessionMap = state.typingPeers[sessionUlid] ?? {};
      const prev = sessionMap[fromActorId];
      // Skip the set when nothing observable changes — a `typing=false`
      // for an actor we already had cleared is common when the sender
      // sends in quick succession (typing=true → send → typing=false),
      // and avoiding the no-op write keeps the UI subscriber from
      // re-rendering the message list on every keystroke.
      if (!typing && !prev) return state;
      const nextEntry = { typing, lastUpdate: Date.now() };
      if (prev && prev.typing === typing) {
        // Same state — only bump `lastUpdate` so the GC sweep keeps
        // the bubble alive while the sender is still composing.
        return {
          typingPeers: {
            ...state.typingPeers,
            [sessionUlid]: { ...sessionMap, [fromActorId]: nextEntry },
          },
        };
      }
      return {
        typingPeers: {
          ...state.typingPeers,
          [sessionUlid]: { ...sessionMap, [fromActorId]: nextEntry },
        },
      };
    });
  },

  sweepTypingPeers: (staleBefore) => {
    set((state) => {
      let mutated = false;
      const nextSessions: typeof state.typingPeers = {};
      for (const [sessionUlid, byActor] of Object.entries(state.typingPeers)) {
        let sessionMutated = false;
        const nextActors: Record<string, { typing: boolean; lastUpdate: number }> = {};
        for (const [actorId, entry] of Object.entries(byActor)) {
          if (entry.typing && entry.lastUpdate < staleBefore) {
            // Phantom typing — sender went silent without sending the
            // `typing=false` pulse. Clear the entry entirely (rather
            // than rewriting `typing=false`) so the map stays small
            // even after long-lived chats.
            sessionMutated = true;
            continue;
          }
          if (!entry.typing) {
            // We don't need to remember a `typing=false` past its
            // arrival — the absence of an entry is also "not typing".
            // Drop it to keep the map small.
            sessionMutated = true;
            continue;
          }
          nextActors[actorId] = entry;
        }
        if (sessionMutated) mutated = true;
        if (Object.keys(nextActors).length > 0) {
          nextSessions[sessionUlid] = nextActors;
        } else if (Object.keys(byActor).length > 0) {
          mutated = true;
        }
      }
      if (!mutated) return state;
      return { typingPeers: nextSessions };
    });
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

  getUnifiedConversations: () => {
    const state = get();
    const did = state.currentUserDid;
    const out: UnifiedConversation[] = [];

    for (const s of state.sessions) {
      const sa = s as any;
      const peerAv = did
        ? (s.participantADid === did ? sa.participantBAvatar : sa.participantAAvatar)
        : (sa.participantBAvatar || sa.participantAAvatar || '');
      const loadedMsgs = state.messages[s.ulid];
      const friendPreview = loadedMsgs && loadedMsgs.length > 0
        ? { content: loadedMsgs[loadedMsgs.length - 1].content ?? '', type: Number((loadedMsgs[loadedMsgs.length - 1] as any).type ?? 1), senderDid: loadedMsgs[loadedMsgs.length - 1].senderDid ?? '' }
        : state.lastPreviews[s.ulid];
      out.push({
        type: 'friend',
        ulid: s.ulid,
        name: peerDisplayName(s, did) || 'Friend',
        avatar: peerAv || '',
        lastActivity: activityFromSession(s),
        unread: friendUnreadForViewer(s, did),
        preview: friendPreview,
        friendSession: s,
      });
    }

    for (const g of state.groups) {
      const loadedGroupMsgs = state.messages[g.ulid];
      const groupPreview = loadedGroupMsgs && loadedGroupMsgs.length > 0
        ? { content: loadedGroupMsgs[loadedGroupMsgs.length - 1].content ?? '', type: Number((loadedGroupMsgs[loadedGroupMsgs.length - 1] as any).type ?? 1), senderDid: loadedGroupMsgs[loadedGroupMsgs.length - 1].senderDid ?? '' }
        : state.lastPreviews[g.ulid];
      out.push({
        type: 'group',
        ulid: g.ulid,
        name: g.name || 'Group',
        avatar: '',
        lastActivity: activityFromGroup(g),
        unread: state.groupUnreadCounts[g.ulid] ?? 0,
        preview: groupPreview,
        group: g,
      });
    }

    return out.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  },

  searchMessages: async (query, scope, conversationId) => {
    if (!query.trim()) {
      set({ searchResults: [], searchQuery: '' });
      return;
    }
    set({ searchLoading: true, searchQuery: query });
    try {
      const data = await api.chatSearchLocal(query, scope, conversationId);
      const rawResults = data?.results || [];
      const { sessions, groups, currentUserDid } = get();

      const results: SearchResult[] = rawResults.map((r) => {
        let conversationName = '';
        if (r.scope === 'friend') {
          const session = sessions.find((s) => s.ulid === r.conversation_id);
          if (session) {
            if (currentUserDid) {
              conversationName =
                session.participantADid === currentUserDid
                  ? session.participantBDid
                  : session.participantADid;
            } else {
              conversationName = session.participantBDid || session.participantADid || '';
            }
          }
        } else {
          const group = groups.find((g) => g.ulid === r.conversation_id);
          conversationName = group?.name || '';
        }
        return {
          messageId: r.message_id,
          conversationId: r.conversation_id,
          scope: r.scope as 'friend' | 'group',
          senderDid: r.sender_did,
          content: r.content,
          sentAt: r.sent_at,
          conversationName: conversationName || r.conversation_id.slice(0, 12),
        };
      });
      set({ searchResults: results, searchLoading: false });
    } catch (error) {
      log.error('socialChat', 'searchMessages failed', error);
      set({ searchLoading: false });
      throw error;
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [], searchLoading: false }),

  setScrollToMessageUlid: (ulid) => set({ scrollToMessageUlid: ulid }),
}));
