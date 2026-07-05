import { identityRuntime } from '../kernel/identityRuntime';
import { api } from '../services/desktop_api';
import { useSessionStore } from '../store/session';
import { useSocialChatStore } from '../store/socialChat';

interface LoginWithPasswordInput {
  account: string;
  password: string;
}

interface SyncFriendSessionInput {
  sessionUlid: string;
  limit?: number;
  maxPages?: number;
}

interface CreateGroupInput {
  name: string;
  description?: string;
  memberDids?: string[];
}

interface SyncGroupInput {
  groupUlid: string;
  limit?: number;
  maxPages?: number;
}

interface SendGroupMessageInput {
  groupUlid: string;
  content: string;
}

interface ChatAcceptanceHarness {
  loginWithPassword(input: LoginWithPasswordInput): Promise<{
    authenticated: boolean;
    actorId: string | null;
  }>;
  createGroup(input: CreateGroupInput): Promise<{
    groupUlid: string;
  }>;
  syncFriendSession(input: SyncFriendSessionInput): Promise<{
    sessionUlid: string;
    messageCount: number;
    syncedCount?: number;
    pagesFetched?: number;
  }>;
  syncGroup(input: SyncGroupInput): Promise<{
    groupUlid: string;
    messageCount: number;
    syncedCount?: number;
    pagesFetched?: number;
  }>;
  sendGroupMessage(input: SendGroupMessageInput): Promise<{
    groupUlid: string;
    messageUlid: string;
    messageCount: number;
  }>;
}

declare global {
  interface Window {
    __PT_ACCEPTANCE__?: ChatAcceptanceHarness;
  }
}

export function installChatAcceptanceHarness(): void {
  if (window.__PT_ACCEPTANCE__) return;

  window.__PT_ACCEPTANCE__ = {
    async loginWithPassword({ account, password }) {
      await identityRuntime.loginWithPassword(account, password);
      await identityRuntime.completeCurrentSession();
      const user = useSessionStore.getState().currentUser;
      if (user?.actorId) {
        await useSocialChatStore.getState().hydrate(user.actorId);
      }
      return {
        authenticated: Boolean(user?.actorId),
        actorId: user?.actorId ?? null,
      };
    },

    async createGroup({ name, description, memberDids = [] }) {
      const created = await api.groupChatCreateGroup(name, description, memberDids);
      await useSocialChatStore.getState().loadGroups();
      const groupUlid = created.group?.ulid ?? '';
      if (groupUlid) {
        await useSocialChatStore.getState().loadGroupMembers(groupUlid);
      }
      return { groupUlid };
    },

    async syncFriendSession({ sessionUlid, limit = 50, maxPages = 1 }) {
      const sync = await api.friendChatSync(sessionUlid, limit, maxPages);
      const social = useSocialChatStore.getState();
      await social.loadSessions();
      await social.loadMessages(sessionUlid, 'friend');
      social.selectSession(sessionUlid);
      social.setActiveTab('friend');
      const messages = useSocialChatStore.getState().messages[sessionUlid] || [];
      return {
        sessionUlid,
        messageCount: messages.length,
        syncedCount: sync.synced_count,
        pagesFetched: sync.pages_fetched,
      };
    },

    async syncGroup({ groupUlid, limit = 50, maxPages = 1 }) {
      const sync = await api.groupChatSync(groupUlid, limit, maxPages);
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      await social.loadGroupMembers(groupUlid);
      await social.loadMessages(groupUlid, 'group');
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      const messages = useSocialChatStore.getState().messages[groupUlid] || [];
      return {
        groupUlid,
        messageCount: messages.length,
        syncedCount: sync.synced_count,
        pagesFetched: sync.pages_fetched,
      };
    },

    async sendGroupMessage({ groupUlid, content }) {
      const social = useSocialChatStore.getState();
      await social.loadGroupMembers(groupUlid);
      await social.sendGroupMessage(groupUlid, content, 1);
      await social.loadMessages(groupUlid, 'group');
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      const messages = useSocialChatStore.getState().messages[groupUlid] || [];
      const messageUlid = messages[messages.length - 1]?.ulid ?? '';
      return {
        groupUlid,
        messageUlid,
        messageCount: messages.length,
      };
    },
  };
}
