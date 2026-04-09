import { create } from 'zustand';

import { api } from '../services/desktop_api';
import type { FriendChatSession, FriendChatMessage } from '../gen/proto/domain/chat/friend_chat_pb';
import type { Group, GroupMessage, GroupMember } from '../gen/proto/domain/chat/group_chat_pb';

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

  loadSessions: () => Promise<void>;
  loadGroups: () => Promise<void>;
  setActiveTab: (tab: 'friend' | 'group') => void;
  selectSession: (ulid: string) => void;
  selectGroup: (ulid: string) => void;
  loadMessages: (ulid: string) => Promise<void>;
  sendFriendMessage: (sessionUlid: string, receiverDid: string, content: string) => Promise<void>;
  sendGroupMessage: (groupUlid: string, content: string) => Promise<void>;
  loadGroupMembers: (groupUlid: string) => Promise<void>;
  toggleDetail: () => void;
  setShowDetail: (show: boolean) => void;
  deleteMessage: (ulid: string, messageUlid: string) => void;
  loadCurrentUserProfile: () => Promise<void>;
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

  loadSessions: async () => {
    try {
      set({ loading: true });
      const data = await api.friendChatListSessions();
      set({ sessions: (data?.sessions || []) as unknown as FriendChatSession[], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadGroups: async () => {
    try {
      const data = await api.groupChatListGroups();
      set({ groups: (data?.groups || []) as unknown as Group[] });
    } catch { /* noop */ }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  selectSession: (ulid) => set({ activeSessionUlid: ulid }),
  selectGroup: (ulid) => set({ activeGroupUlid: ulid }),

  loadMessages: async (ulid) => {
    const { activeTab } = get();
    try {
      set({ loading: true });
      let data: any;
      if (activeTab === 'friend') {
        data = await api.friendChatListMessages(ulid);
      } else {
        data = await api.groupChatListMessages(ulid);
      }
      const msgs = data?.messages || [];
      set((state) => ({
        messages: { ...state.messages, [ulid]: msgs as unknown as (FriendChatMessage | GroupMessage)[] },
        loading: false,
      }));
    } catch {
      set({ loading: false });
    }
  },

  sendFriendMessage: async (sessionUlid, receiverDid, content) => {
    try {
      await api.friendChatSendMessage(sessionUlid, receiverDid, content);
      await get().loadMessages(sessionUlid);
    } catch { /* noop */ }
  },

  sendGroupMessage: async (groupUlid, content) => {
    try {
      await api.groupChatSendMessage(groupUlid, content);
      await get().loadMessages(groupUlid);
    } catch { /* noop */ }
  },

  loadGroupMembers: async (groupUlid) => {
    try {
      const data = await api.groupChatListMembers(groupUlid);
      const members = data?.members || [];
      set((state) => ({
        groupMembers: { ...state.groupMembers, [groupUlid]: members as unknown as GroupMember[] },
      }));
    } catch { /* noop */ }
  },

  toggleDetail: () => set((state) => ({ showDetail: !state.showDetail })),
  setShowDetail: (show) => set({ showDetail: show }),

  deleteMessage: (ulid, messageUlid) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [ulid]: (state.messages[ulid] || []).filter((m) => m.ulid !== messageUlid),
      },
    }));
  },

  loadCurrentUserProfile: async () => {
    try {
      const profile = await api.actorGetMyProfile();
      set({ currentUserProfile: profile });
    } catch { /* noop */ }
  },
}));
