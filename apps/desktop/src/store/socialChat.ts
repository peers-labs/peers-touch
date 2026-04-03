import { create } from 'zustand';
import { api } from '../services/desktop_api';
import type { FriendChatSession, FriendChatMessage } from '../gen/proto/domain/chat/friend_chat_pb';
import type { Group, GroupMessage, GroupMember } from '../gen/proto/domain/chat/group_chat_pb';
import type { ActorProfile } from '../gen/proto/domain/actor/actor_pb';

interface SocialChatState {
  sessions: FriendChatSession[];
  groups: Group[];
  activeSessionUlid: string | null;
  activeGroupUlid: string | null;
  activeTab: 'friend' | 'group';
  messages: Record<string, (FriendChatMessage | GroupMessage)[]>;
  loading: boolean;
  showDetail: boolean;
  groupMembers: Record<string, GroupMember[]>;
  currentUserProfile: ActorProfile | null;

  loadSessions: () => Promise<void>;
  loadGroups: () => Promise<void>;
  loadCurrentProfile: () => Promise<void>;
  selectSession: (ulid: string) => void;
  selectGroup: (ulid: string) => void;
  setActiveTab: (tab: 'friend' | 'group') => void;
  loadMessages: (ulid: string) => Promise<void>;
  sendFriendMessage: (sessionUlid: string, receiverDid: string, content: string) => Promise<void>;
  sendGroupMessage: (groupUlid: string, content: string) => Promise<void>;
  searchMessages: (query: string) => Promise<unknown[]>;
  toggleDetail: () => void;
  setShowDetail: (v: boolean) => void;
  createGroup: (name: string, description?: string, memberDids?: string[]) => Promise<Group | undefined>;
  createSession: (participantDid: string) => Promise<FriendChatSession | undefined>;
  getGroupMembers: (groupUlid: string) => Promise<GroupMember[]>;
  loadGroupMembers: (groupUlid: string) => Promise<void>;
  goOnline: () => Promise<void>;
  deleteMessage: (groupUlid: string, messageUlid: string) => Promise<void>;
  recallMessage: (groupUlid: string, messageUlid: string) => Promise<void>;
}

export const useSocialChatStore = create<SocialChatState>((set, get) => ({
  sessions: [],
  groups: [],
  activeSessionUlid: null,
  activeGroupUlid: null,
  activeTab: 'friend',
  messages: {},
  loading: false,
  showDetail: false,
  groupMembers: {},
  currentUserProfile: null,

  loadSessions: async () => {
    set({ loading: true });
    try {
      const resp = await api.friendChatListSessions();
      set({ sessions: resp.sessions });
    } catch {
    } finally {
      set({ loading: false });
    }
  },

  loadGroups: async () => {
    set({ loading: true });
    try {
      const resp = await api.groupChatListGroups();
      set({ groups: resp.groups });
    } catch {
    } finally {
      set({ loading: false });
    }
  },

  loadCurrentProfile: async () => {
    try {
      const profile = await api.actorGetMyProfile();
      set({ currentUserProfile: profile });
    } catch {
    }
  },

  selectSession: (ulid) => set({ activeSessionUlid: ulid, activeTab: 'friend' }),
  selectGroup: (ulid) => set({ activeGroupUlid: ulid, activeTab: 'group' }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  loadMessages: async (ulid) => {
    set({ loading: true });
    try {
      const { activeTab } = get();
      if (activeTab === 'friend') {
        const resp = await api.friendChatListMessages(ulid);
        set((s) => ({ messages: { ...s.messages, [ulid]: resp.messages } }));
      } else {
        const resp = await api.groupChatListMessages(ulid);
        set((s) => ({ messages: { ...s.messages, [ulid]: resp.messages } }));
      }
    } catch {
    } finally {
      set({ loading: false });
    }
  },

  sendFriendMessage: async (sessionUlid, receiverDid, content) => {
    try {
      const resp = await api.friendChatSendMessage(sessionUlid, receiverDid, content);
      if (resp.message) {
        set((s) => {
          const existing = (s.messages[sessionUlid] || []) as FriendChatMessage[];
          return { messages: { ...s.messages, [sessionUlid]: [...existing, resp.message!] } };
        });
      }
    } catch {
    }
  },

  sendGroupMessage: async (groupUlid, content) => {
    try {
      const resp = await api.groupChatSendMessage(groupUlid, content);
      if (resp.message) {
        set((s) => {
          const existing = (s.messages[groupUlid] || []) as GroupMessage[];
          return { messages: { ...s.messages, [groupUlid]: [...existing, resp.message!] } };
        });
      }
    } catch {
    }
  },

  searchMessages: async (query) => {
    try {
      const [friendResults, groupResults] = await Promise.all([
        api.friendChatLocalSearch(query),
        api.groupChatLocalSearch(query),
      ]);
      return [...friendResults, ...groupResults];
    } catch {
      return [];
    }
  },

  toggleDetail: () => set((s) => ({ showDetail: !s.showDetail })),

  setShowDetail: (v) => set({ showDetail: v }),

  createGroup: async (name, description, memberDids) => {
    try {
      const resp = await api.groupChatCreateGroup(name, description, memberDids);
      if (resp.group) {
        set((s) => ({ groups: [...s.groups, resp.group!] }));
      }
      return resp.group;
    } catch {
      return undefined;
    }
  },

  createSession: async (participantDid) => {
    try {
      const resp = await api.friendChatCreateSession(participantDid);
      if (resp.session) {
        set((s) => {
          const exists = s.sessions.some((sess) => sess.ulid === resp.session!.ulid);
          if (exists) return {};
          return { sessions: [...s.sessions, resp.session!] };
        });
      }
      return resp.session;
    } catch {
      return undefined;
    }
  },

  getGroupMembers: async (groupUlid) => {
    try {
      const resp = await api.groupChatGetMembers(groupUlid);
      return resp.members;
    } catch {
      return [];
    }
  },

  loadGroupMembers: async (groupUlid) => {
    try {
      const resp = await api.groupChatGetMembers(groupUlid);
      set((s) => ({ groupMembers: { ...s.groupMembers, [groupUlid]: resp.members } }));
    } catch {
    }
  },

  goOnline: async () => {
    try {
      await api.friendChatGoOnline();
    } catch {
    }
  },

  deleteMessage: async (groupUlid, messageUlid) => {
    try {
      await api.groupChatDeleteMessage(groupUlid, messageUlid);
      set((s) => {
        const existing = (s.messages[groupUlid] || []) as GroupMessage[];
        return {
          messages: {
            ...s.messages,
            [groupUlid]: existing.filter((m) => m.ulid !== messageUlid),
          },
        };
      });
    } catch {
    }
  },

  recallMessage: async (groupUlid, messageUlid) => {
    try {
      await api.groupChatRecallMessage(groupUlid, messageUlid);
      set((s) => {
        const existing = (s.messages[groupUlid] || []) as GroupMessage[];
        return {
          messages: {
            ...s.messages,
            [groupUlid]: existing.filter((m) => m.ulid !== messageUlid),
          },
        };
      });
    } catch {
    }
  },
}));
