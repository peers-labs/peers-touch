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

  loadSessions: () => Promise<void>;
  loadGroups: () => Promise<void>;
  setActiveTab: (tab: 'friend' | 'group') => void;
  selectSession: (ulid: string) => void;
  selectGroup: (ulid: string) => void;
  loadMessages: (ulid: string, kind?: 'friend' | 'group') => Promise<void>;
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
  loadCurrentUserProfile: () => Promise<void>;

  loadFriendRequests: (status?: number, limit?: number, offset?: number) => Promise<void>;
  sendFriendRequest: (receiverDid: string, message?: string) => Promise<void>;
  acceptFriendRequest: (requestId: string) => Promise<void>;
  rejectFriendRequest: (requestId: string) => Promise<void>;

  loadGroupUnreadCounts: () => Promise<void>;
  loadConversationPreviews: () => Promise<void>;
  ackFriendMessages: (ulids: string[], status: number) => Promise<void>;
  markGroupRead: (groupUlid: string) => Promise<void>;

  getUnifiedConversations: () => UnifiedConversation[];

  searchMessages: (query: string, scope?: string, conversationId?: string) => Promise<void>;
  clearSearch: () => void;
  setScrollToMessageUlid: (ulid: string | null) => void;

  initEncryption: () => Promise<void>;
  establishSession: (sessionUlid: string, peerDid: string) => Promise<boolean>;
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

export const useSocialChatStore = create<SocialChatState>((set, get) => ({
  sessions: [],
  groups: [],
  activeTab: 'friend',
  activeSessionUlid: null,
  activeGroupUlid: null,
  messages: {},
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
      set((state) => ({
        sessions: list,
        loading: false,
        ...(!state.currentUserDid && derivedDid ? { currentUserDid: derivedDid } : {}),
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
  selectSession: (ulid) => set({ activeSessionUlid: ulid }),
  selectGroup: (ulid) => set({ activeGroupUlid: ulid }),

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
      let data: { messages?: unknown[] };
      if (activeTab === 'friend') {
        data = await api.friendChatListMessages(ulid);
      } else {
        data = await api.groupChatListMessages(ulid);
      }
      const msgs = data?.messages || [];
      set((state) => ({
        messages: { ...state.messages, [ulid]: msgs as (FriendChatMessage | GroupMessage)[] },
        loading: false,
      }));
    } catch (error) {
      log.error('socialChat', 'loadMessages failed', error);
      set({ loading: false });
      throw error;
    }
  },

  sendFriendMessage: async (sessionUlid, receiverDid, content, type, replyToUlid, attachments) => {
    try {
      const { sessionEncrypted, encryptionEnabled } = get();
      let encryptedPayload: string | undefined;
      let sendContent = content;

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

      await api.friendChatSendMessage(
        sessionUlid,
        receiverDid,
        sendContent,
        type,
        replyToUlid,
        attachments,
        encryptedPayload,
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

  sendGroupMessage: async (groupUlid, content, type, replyToUlid, attachments) => {
    try {
      const { encryptionEnabled } = get();
      let encryptedPayload: string | undefined;
      let sendContent = content;

      if (encryptionEnabled) {
        try {
          const enc = await api.cryptoGroupEncrypt(groupUlid, content);
          const envelope = JSON.stringify({
            c: enc.ciphertext,
            e: enc.epoch,
            n: enc.counter,
          });
          encryptedPayload = btoa(envelope);
          sendContent = '[Encrypted Message]';
        } catch {
          // Encryption not available for this group, send plaintext
        }
      }

      await api.groupChatSendMessage(
        groupUlid,
        sendContent,
        type,
        replyToUlid,
        undefined,
        undefined,
        attachments,
        encryptedPayload,
      );
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
        // No dedicated friend delete RPC; sync read/ack state with server before local removal.
        await api.friendChatAckMessages([messageUlid], FriendMessageStatus.READ);
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
            const m = msgs[0] as FriendChatMessage;
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
            const m = msgs[0] as GroupMessage;
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
      out.push({
        type: 'friend',
        ulid: s.ulid,
        name: peerDisplayName(s, did) || 'Friend',
        avatar: peerAv || '',
        lastActivity: activityFromSession(s),
        unread: friendUnreadForViewer(s, did),
        preview: state.lastPreviews[s.ulid],
        friendSession: s,
      });
    }

    for (const g of state.groups) {
      out.push({
        type: 'group',
        ulid: g.ulid,
        name: g.name || 'Group',
        avatar: '',
        lastActivity: activityFromGroup(g),
        unread: state.groupUnreadCounts[g.ulid] ?? 0,
        preview: state.lastPreviews[g.ulid],
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
