import { identityRuntime } from '../kernel/identityRuntime';
import { api } from '../services/desktop_api';
import type { GroupChatFederatedActorInput } from '../services/desktop_api';
import { dispatchRealtimeFrameForAcceptance } from '../services/eventStream';
import { useSessionStore } from '../store/session';
import { useSocialChatStore } from '../store/socialChat';

interface LoginInput {
  account: string;
  password: string;
}

interface SyncFriendInput {
  sessionUlid: string;
  limit?: number;
  maxPages?: number;
}

interface CreateGroupInput {
  name: string;
  description?: string;
  memberDids?: string[];
  initialFederatedMembers?: GroupChatFederatedActorInput[];
}

interface SyncGroupInput {
  groupUlid: string;
  limit?: number;
  maxPages?: number;
}

interface SendGroupMessageInput {
  groupUlid: string;
  content: string;
  type?: number;
}

interface RemoveGroupMemberInput {
  groupUlid: string;
  memberDid: string;
}

declare global {
  interface Window {
    __PT_ACCEPTANCE__?: {
      loginWithPassword(input: LoginInput): Promise<{ authenticated: boolean; actorId: string | null }>;
      syncFriendSession(input: SyncFriendInput): Promise<{
        sessionUlid: string;
        messageCount: number;
        syncedCount: number;
        pagesFetched: number;
      }>;
      createGroup(input: CreateGroupInput): Promise<{ groupUlid: string; memberCount: number }>;
      syncGroup(input: SyncGroupInput): Promise<{
        groupUlid: string;
        messageCount: number;
        syncedCount: number;
        pagesFetched: number;
      }>;
      sendGroupMessage(input: SendGroupMessageInput): Promise<{ groupUlid: string; messageCount: number }>;
      removeGroupMember(input: RemoveGroupMemberInput): Promise<{ groupUlid: string; success: boolean; memberCount: number }>;
      getRealtimeDevice(): Promise<{ actorId: string | null; deviceId: string }>;
      dispatchRealtimeFrame(input: { eventId?: string; dataB64: string }): Promise<{ accepted: boolean }>;
    };
  }
}

function activeActorId(): string | null {
  return useSessionStore.getState().currentUser?.actorId ?? null;
}

async function hydrateSocialForActiveActor(): Promise<void> {
  const actorId = activeActorId();
  if (actorId) {
    const social = useSocialChatStore.getState();
    await social.hydrate(actorId);
    await useSocialChatStore.getState().initEncryption();
  }
}

export function installChatAcceptanceHarness(): void {
  window.__PT_ACCEPTANCE__ = {
    async loginWithPassword({ account, password }) {
      await identityRuntime.loginWithPassword(account, password);
      await identityRuntime.completeCurrentSession();
      await hydrateSocialForActiveActor();
      const user = useSessionStore.getState().currentUser;
      return {
        authenticated: Boolean(user?.actorId),
        actorId: user?.actorId ?? null,
      };
    },

    async syncFriendSession({ sessionUlid, limit = 50, maxPages = 1 }) {
      const sync = await api.friendChatSync(sessionUlid, limit, maxPages);
      const social = useSocialChatStore.getState();
      await social.loadSessions();
      await social.loadMessages(sessionUlid, 'friend');
      social.selectSession(sessionUlid);
      social.setActiveTab('friend');
      const messages = useSocialChatStore.getState().getIMMessages('friend', sessionUlid);
      return {
        sessionUlid,
        messageCount: messages.length,
        syncedCount: sync.synced_count,
        pagesFetched: sync.pages_fetched,
      };
    },

    async createGroup({ name, description, memberDids = [], initialFederatedMembers = [] }) {
      const response = await api.groupChatCreateGroup(name, description, memberDids, initialFederatedMembers);
      const groupUlid = response.group?.ulid || '';
      if (!groupUlid) {
        throw new Error('groupChatCreateGroup returned no group ulid');
      }
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      await social.loadGroupMembers(groupUlid);
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      return {
        groupUlid,
        memberCount: useSocialChatStore.getState().groupMembers[groupUlid]?.length ?? 0,
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
      const messages = useSocialChatStore.getState().getIMMessages('group', groupUlid);
      return {
        groupUlid,
        messageCount: messages.length,
        syncedCount: sync.synced_count,
        pagesFetched: sync.pages_fetched,
      };
    },

    async sendGroupMessage({ groupUlid, content, type = 1 }) {
      const social = useSocialChatStore.getState();
      await social.loadGroupMembers(groupUlid);
      await social.sendGroupMessage(groupUlid, content, type);
      await social.loadMessages(groupUlid, 'group');
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      return {
        groupUlid,
        messageCount: useSocialChatStore.getState().getIMMessages('group', groupUlid).length,
      };
    },

    async removeGroupMember({ groupUlid, memberDid }) {
      const response = await api.groupChatRemoveMember(groupUlid, memberDid);
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      await social.loadGroupMembers(groupUlid);
      return {
        groupUlid,
        success: Boolean(response.success),
        memberCount: useSocialChatStore.getState().groupMembers[groupUlid]?.length ?? 0,
      };
    },

    async getRealtimeDevice() {
      const device = await api.accountGetDeviceId();
      return {
        actorId: activeActorId(),
        deviceId: String(device?.device_id ?? ''),
      };
    },

    async dispatchRealtimeFrame({ eventId = '', dataB64 }) {
      dispatchRealtimeFrameForAcceptance({ event_id: eventId, data_b64: dataB64 });
      return { accepted: Boolean(dataB64) };
    },
  };
}
