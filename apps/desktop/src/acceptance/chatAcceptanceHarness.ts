import { identityRuntime } from '../kernel/identityRuntime';
import { api } from '../services/desktop_api';
import type { GroupChatFederatedActorInput } from '../services/desktop_api';
import { dispatchRealtimeFrameForAcceptance } from '../services/eventStream';
import { ensureSkdmDistributed, encryptBytesForGroup } from '../modules/identity/groupSenderKeys';
import { useSessionStore } from '../store/session';
import { createEncryptedChatPayloadBytes, decodeGroupMessages, useSocialChatStore } from '../store/socialChat';
import type { GroupMessage, GroupMember } from '../gen/proto/domain/chat/group_chat_pb';

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

interface SendGroupMessagesInput {
  groupUlid: string;
  prefix: string;
  count: number;
  startIndex?: number;
  type?: number;
}

interface SyncGroupPressureInput {
  groupUlid: string;
  expectedCount: number;
  prefix: string;
  limit?: number;
  maxPages?: number;
}

interface SyncGroupPressureProjectionInput {
  groupUlid: string;
  limit?: number;
  maxPages?: number;
}

interface SyncGroupPressurePageInput {
  groupUlid: string;
  prefix: string;
  beforeUlid?: string;
  limit?: number;
}

interface DecodeGroupPressureInput {
  groupUlid: string;
  prefix: string;
  expectedCount: number;
  chunkSize?: number;
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
      sendGroupMessages(input: SendGroupMessagesInput): Promise<{
        groupUlid: string;
        sentCount: number;
        firstContent: string;
        lastContent: string;
        durationMs: number;
      }>;
      syncGroupPressure(input: SyncGroupPressureInput): Promise<{
        ok: boolean;
        error?: string;
        stage?: string;
        groupUlid: string;
        messageCount: number;
        decodedCount: number;
        waitingCount: number;
        failedCount: number;
        pagesFetched: number;
        syncedCount: number;
        firstFound: boolean;
        lastFound: boolean;
      }>;
      syncGroupPressureProjection(input: SyncGroupPressureProjectionInput): Promise<{
        groupUlid: string;
        syncedCount: number;
        pagesFetched: number;
      }>;
      syncGroupPressurePage(input: SyncGroupPressurePageInput): Promise<{
        groupUlid: string;
        messageCount: number;
        bufferedCount: number;
        nextBeforeUlid: string;
        hasMore: boolean;
      }>;
      decodeGroupPressure(input: DecodeGroupPressureInput): Promise<{
        groupUlid: string;
        messageCount: number;
        decodedCount: number;
        waitingCount: number;
        failedCount: number;
        firstFound: boolean;
        lastFound: boolean;
        completed: boolean;
        decodedWindowCount: number;
      }>;
      removeGroupMember(input: RemoveGroupMemberInput): Promise<{ groupUlid: string; success: boolean; memberCount: number }>;
      getRealtimeDevice(): Promise<{ actorId: string | null; deviceId: string }>;
      dispatchRealtimeFrame(input: { eventId?: string; dataB64: string }): Promise<{ accepted: boolean }>;
    };
  }
}

function activeActorId(): string | null {
  return useSessionStore.getState().currentUser?.actorId ?? null;
}

interface PressureWindowState {
  rawByUlid: Map<string, GroupMessage>;
  decodedByUlid: Map<string, GroupMessage>;
  nextDecodeIndex: number;
}

const groupPressureWindows = new Map<string, PressureWindowState>();

function groupPressureWindow(groupUlid: string): PressureWindowState {
  let state = groupPressureWindows.get(groupUlid);
  if (!state) {
    state = {
      rawByUlid: new Map<string, GroupMessage>(),
      decodedByUlid: new Map<string, GroupMessage>(),
      nextDecodeIndex: 0,
    };
    groupPressureWindows.set(groupUlid, state);
  }
  return state;
}

function orderedPressureMessages(state: PressureWindowState): GroupMessage[] {
  return Array.from(state.rawByUlid.values()).sort((a, b) => {
    const secondsDelta = Number(a.sentAt?.seconds ?? 0n) - Number(b.sentAt?.seconds ?? 0n);
    if (secondsDelta) return secondsDelta;
    const nanosDelta = Number(a.sentAt?.nanos ?? 0) - Number(b.sentAt?.nanos ?? 0);
    return nanosDelta || (a.ulid || '').localeCompare(b.ulid || '');
  });
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

    async sendGroupMessages({ groupUlid, prefix, count, startIndex = 1, type = 1 }) {
      if (count < 1) {
        throw new Error('count must be >= 1');
      }
      if (startIndex < 1) {
        throw new Error('startIndex must be >= 1');
      }
      const did = useSocialChatStore.getState().currentUserDid ?? '';
      if (!did) {
        throw new Error('No active actor; cannot send group messages');
      }
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      await social.loadGroupMembers(groupUlid);
      const current = useSocialChatStore.getState();
      const members = (current.groupMembers[groupUlid] || []) as GroupMember[];
      const group = current.groups.find((item) => item.ulid === groupUlid);
      const observedMembershipEpoch = group?.membershipEpoch ?? 0n;
      const memberDids = members.map((member) => member.actorDid).filter((actorDid): actorDid is string => Boolean(actorDid));
      await ensureSkdmDistributed(did, groupUlid, memberDids, {
        membershipEpoch: observedMembershipEpoch,
        members: members.map((member) => ({
          actorDid: member.actorDid,
          actorHomeStationPeerId: member.actorHomeStationPeerId,
        })),
      });

      const startedAt = Date.now();
      const lastIndex = startIndex + count - 1;
      for (let index = startIndex; index <= lastIndex; index += 1) {
        const content = `${prefix}-${String(index).padStart(4, '0')}`;
        const encryptedPayloadB64 = await encryptBytesForGroup(
          groupUlid,
          createEncryptedChatPayloadBytes(content, [], type),
        );
        await api.groupChatSendMessage(
          groupUlid,
          '',
          type,
          undefined,
          undefined,
          undefined,
          [],
          encryptedPayloadB64,
          undefined,
          observedMembershipEpoch,
        );
      }
      await social.loadMessages(groupUlid, 'group').catch(() => {});
      return {
        groupUlid,
        sentCount: count,
        firstContent: `${prefix}-${String(startIndex).padStart(4, '0')}`,
        lastContent: `${prefix}-${String(lastIndex).padStart(4, '0')}`,
        durationMs: Date.now() - startedAt,
      };
    },

    async syncGroupPressure({ groupUlid, expectedCount, prefix, limit = 100, maxPages = 20 }) {
      let stage = 'start';
      try {
        const pageLimit = Math.max(1, Math.min(200, limit));
        const pageCount = Math.max(1, maxPages);
        stage = 'groupChatSync';
        const sync = await api.groupChatSync(groupUlid, pageLimit, pageCount);
        const social = useSocialChatStore.getState();
        stage = 'loadGroups';
        await social.loadGroups();
        stage = 'loadGroupMembers';
        await social.loadGroupMembers(groupUlid);
        const pages: GroupMessage[][] = [];
        let beforeUlid = '';
        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
          stage = `listMessages:${pageIndex + 1}`;
          const response = await api.groupChatListMessages(groupUlid, beforeUlid || undefined, pageLimit);
          const page = ((response?.messages || []) as GroupMessage[]);
          if (page.length === 0) break;
          pages.push(page);
          beforeUlid = page[0]?.ulid || '';
          if (page.length < pageLimit || !beforeUlid) break;
        }
        const messages = pages.flat();
        stage = 'decodeGroupMessages';
        const decoded = await decodeGroupMessages(groupUlid, messages, 'acceptance pressure group decrypt failed');
        const firstContent = `${prefix}-${String(1).padStart(4, '0')}`;
        const lastContent = `${prefix}-${String(expectedCount).padStart(4, '0')}`;
        const decodedContents = decoded.map((message) => message.content || '');
        useSocialChatStore.setState((state) => ({
          messages: { ...state.messages, [groupUlid]: decoded as any },
        }));
        const refreshedSocial = useSocialChatStore.getState();
        refreshedSocial.selectGroup(groupUlid);
        refreshedSocial.setActiveTab('group');
        return {
          ok: true,
          stage: 'complete',
          groupUlid,
          messageCount: decoded.length,
          decodedCount: decodedContents.filter((content) => content.startsWith(prefix)).length,
          waitingCount: decodedContents.filter((content) => content.includes('[Waiting for sender key')).length,
          failedCount: decodedContents.filter((content) => content.includes('[Decrypt failed]')).length,
          pagesFetched: pages.length,
          syncedCount: sync.synced_count,
          firstFound: decodedContents.includes(firstContent),
          lastFound: decodedContents.includes(lastContent),
        };
      } catch (error) {
        return {
          ok: false,
          stage,
          error: String(error instanceof Error ? error.message : error),
          groupUlid,
          messageCount: 0,
          decodedCount: 0,
          waitingCount: 0,
          failedCount: 0,
          pagesFetched: 0,
          syncedCount: 0,
          firstFound: false,
          lastFound: false,
        };
      }
    },

    async syncGroupPressureProjection({ groupUlid, limit = 100, maxPages = 20 }) {
      const pageLimit = Math.max(1, Math.min(200, limit));
      const pageCount = Math.max(1, maxPages);
      const sync = await api.groupChatSync(groupUlid, pageLimit, pageCount);
      groupPressureWindows.set(groupUlid, {
        rawByUlid: new Map<string, GroupMessage>(),
        decodedByUlid: new Map<string, GroupMessage>(),
        nextDecodeIndex: 0,
      });
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      await social.loadGroupMembers(groupUlid);
      return {
        groupUlid,
        syncedCount: sync.synced_count,
        pagesFetched: sync.pages_fetched,
      };
    },

    async syncGroupPressurePage({ groupUlid, prefix, beforeUlid = '', limit = 100 }) {
      const pageLimit = Math.max(1, Math.min(200, limit));
      const response = await api.groupChatListMessages(groupUlid, beforeUlid || undefined, pageLimit);
      const page = ((response?.messages || []) as GroupMessage[]);
      const state = groupPressureWindow(groupUlid);
      for (const message of page) {
        if (message.ulid) state.rawByUlid.set(message.ulid, message);
      }
      void prefix;
      const nextBeforeUlid = page[0]?.ulid || '';
      return {
        groupUlid,
        messageCount: page.length,
        bufferedCount: state.rawByUlid.size,
        nextBeforeUlid,
        hasMore: page.length >= pageLimit && Boolean(nextBeforeUlid),
      };
    },

    async decodeGroupPressure({ groupUlid, prefix, expectedCount, chunkSize = 100 }) {
      const state = groupPressureWindow(groupUlid);
      const ordered = orderedPressureMessages(state);
      const decodeSize = Math.max(1, Math.min(200, chunkSize));
      const chunk = ordered.slice(state.nextDecodeIndex, state.nextDecodeIndex + decodeSize);
      if (chunk.length > 0) {
        const decodedChunk = await decodeGroupMessages(groupUlid, chunk, 'acceptance pressure group ordered decrypt failed');
        for (const message of decodedChunk) {
          if (message.ulid) state.decodedByUlid.set(message.ulid, message);
        }
        state.nextDecodeIndex += chunk.length;
      }
      const decoded = ordered.map((message) => state.decodedByUlid.get(message.ulid) ?? message);
      const decodedContents = decoded.map((message) => message.content || '');
      useSocialChatStore.setState((state) => {
        const existing = (state.messages[groupUlid] || []) as GroupMessage[];
        const byUlid = new Map<string, GroupMessage>();
        for (const message of existing) {
          if (message.ulid) byUlid.set(message.ulid, message);
        }
        for (const message of decoded) {
          if (message.ulid) byUlid.set(message.ulid, message);
        }
        const merged = Array.from(byUlid.values()).sort((a, b) => {
          const delta = Number(a.sentAt?.seconds ?? 0n) - Number(b.sentAt?.seconds ?? 0n);
          return delta || (a.ulid || '').localeCompare(b.ulid || '');
        });
        return {
          messages: { ...state.messages, [groupUlid]: merged as any },
        };
      });
      const refreshedSocial = useSocialChatStore.getState();
      refreshedSocial.selectGroup(groupUlid);
      refreshedSocial.setActiveTab('group');
      const firstContent = `${prefix}-${String(1).padStart(4, '0')}`;
      const lastContent = `${prefix}-${String(expectedCount).padStart(4, '0')}`;
      return {
        groupUlid,
        messageCount: decoded.length,
        decodedCount: decodedContents.filter((content) => content.startsWith(prefix)).length,
        waitingCount: decodedContents.filter((content) => content.includes('[Waiting for sender key')).length,
        failedCount: decodedContents.filter((content) => content.includes('[Decrypt failed]')).length,
        firstFound: decodedContents.includes(firstContent),
        lastFound: decodedContents.includes(lastContent),
        completed: state.nextDecodeIndex >= ordered.length,
        decodedWindowCount: state.nextDecodeIndex,
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
