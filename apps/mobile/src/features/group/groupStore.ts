import { create } from 'zustand';
import {
  clearChatE2eeProjectionStatus,
  setChatE2eeProjectionStatus,
  type ChatE2eeProjection,
} from '@peers-touch/client-chat-core';

import type { MobileAuthSession } from '../auth/authSession';
import { SocialApiError, readableErrorMessage } from '../social/socialTypes';
import type { ChatEncryptedMessagePayload, Group, GroupMember, GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import type { ChatAttachmentInput } from '../social/socialApi';
import { createGroupApiClient, type CreateGroupInput, type GroupApiClient, type GroupSettings, type UpdateGroupInput, type UpdateGroupMemberInput, type UpdateGroupSettingsInput } from './groupApi';
import { normalizeGroup, normalizeGroupMember, normalizeGroupMessage } from './groupNormalizers';
import {
  applyGroupDecryptedContentToList,
  applyGroupMutationToList,
  mergeGroupMessages,
  projectGroupConversations,
  type GroupConversation,
} from './groupProjection';

export interface GroupState {
  sessionKey: string | null;
  api: GroupApiClient | null;
  groups: Group[];
  members: Record<string, GroupMember[]>;
  messages: Record<string, GroupMessage[]>;
  settings: Record<string, GroupSettings>;
  unreadCounts: Record<string, number>;
  e2eeErrors: Record<string, string>;
  e2eeProjection: ChatE2eeProjection;
  encryptionReady: Record<string, boolean>;
  sendingGroups: Record<string, boolean>;
  activeGroupUlid: string | null;
  loading: boolean;
  error: SocialApiError | null;
  lastReconcileAt: number | null;
  encryptedSender: ((groupUlid: string, plaintext: string, attachments?: ChatAttachmentInput[], messageType?: number) => Promise<boolean>) | null;
  encryptedEditor: ((groupUlid: string, messageUlid: string, plaintext: string) => Promise<boolean>) | null;
  encryptionPreparer: ((groupUlid: string) => Promise<boolean>) | null;
  bindSession: (session: MobileAuthSession | null) => void;
  reconcile: () => Promise<void>;
  reconcileActiveGroupMessages: () => Promise<void>;
  createGroup: (input: CreateGroupInput) => Promise<string | null>;
  updateGroup: (groupUlid: string, input: UpdateGroupInput) => Promise<void>;
  refreshGroups: () => Promise<void>;
  refreshUnreadCounts: () => Promise<void>;
  selectGroup: (groupUlid: string | null) => Promise<void>;
  loadMessages: (groupUlid: string) => Promise<void>;
  loadMembers: (groupUlid: string) => Promise<void>;
  loadSettings: (groupUlid: string) => Promise<void>;
  updateMySettings: (groupUlid: string, input: UpdateGroupSettingsInput) => Promise<void>;
  inviteMembers: (groupUlid: string, inviteeDids: string[]) => Promise<void>;
  leaveGroup: (groupUlid: string) => Promise<void>;
  removeMember: (groupUlid: string, actorDid: string) => Promise<void>;
  updateMember: (groupUlid: string, actorDid: string, input: UpdateGroupMemberInput) => Promise<void>;
  ingestRealtimeMessage: (groupUlid: string, message: GroupMessage) => Promise<void>;
  applyMessageMutation: (
    groupUlid: string,
    messageUlid: string,
    kind: 'RECALL' | 'EDIT' | 'DELETE',
    payload: { newContent?: string; newCiphertext?: Uint8Array; mutatedTsUnixMs?: number },
  ) => void;
  applyDecryptedMessage: (groupUlid: string, messageUlid: string, plaintext: string | ChatEncryptedMessagePayload) => void;
  setEncryptionReady: (groupUlid: string, ready: boolean) => void;
  setGroupSending: (groupUlid: string, sending: boolean) => void;
  sendEncryptedMessage: (groupUlid: string, plaintext: string, attachments?: ChatAttachmentInput[], messageType?: number) => Promise<boolean>;
  editEncryptedMessage: (groupUlid: string, messageUlid: string, plaintext: string) => Promise<boolean>;
  recallMessage: (groupUlid: string, messageUlid: string) => Promise<void>;
  deleteMessage: (groupUlid: string, messageUlid: string) => Promise<void>;
  bindEncryptedSender: (sender: ((groupUlid: string, plaintext: string, attachments?: ChatAttachmentInput[], messageType?: number) => Promise<boolean>) | null) => void;
  bindEncryptedEditor: (editor: ((groupUlid: string, messageUlid: string, plaintext: string) => Promise<boolean>) | null) => void;
  bindEncryptionPreparer: (preparer: ((groupUlid: string) => Promise<boolean>) | null) => void;
  setE2eeError: (messageUlid: string, error: string | null) => void;
  markRead: (groupUlid: string, upToUlid?: string) => Promise<void>;
  clearError: () => void;
}

export const useGroupStore = create<GroupState>((set, get) => ({
  sessionKey: null,
  api: null,
  groups: [],
  members: {},
  messages: {},
  settings: {},
  unreadCounts: {},
  e2eeErrors: {},
  e2eeProjection: {},
  encryptionReady: {},
  sendingGroups: {},
  activeGroupUlid: null,
  loading: false,
  error: null,
  lastReconcileAt: null,
  encryptedSender: null,
  encryptedEditor: null,
  encryptionPreparer: null,

  bindSession: (session) => {
    if (!session) {
      set(emptyGroupState());
      return;
    }
    const sessionKey = `${session.stationUrl}|${session.sessionId}`;
    if (get().sessionKey === sessionKey) return;
    set({
      ...emptyGroupState(),
      sessionKey,
      api: createGroupApiClient(session),
    });
  },

  reconcile: async () => {
    const { refreshGroups, refreshUnreadCounts } = get();
    const coldStart = get().groups.length === 0;
    set({ loading: coldStart, error: null });
    try {
      await refreshGroups();
      await refreshUnreadCounts();
      await get().reconcileActiveGroupMessages();
      set({ loading: false, lastReconcileAt: Date.now() });
    } catch (error) {
      set({ loading: false, error: normalizeError(error) });
    }
  },

  reconcileActiveGroupMessages: async () => {
    const groupUlid = get().activeGroupUlid;
    if (!groupUlid) return;
    await Promise.allSettled([get().loadMessages(groupUlid), get().loadMembers(groupUlid), get().loadSettings(groupUlid)]);
    void get().encryptionPreparer?.(groupUlid);
  },

  refreshGroups: async () => {
    const api = requireApi(get());
    const payload = await api.listGroups();
    const groups = (payload.groups ?? []).map(normalizeGroup);
    set({ groups });
    const entries = await Promise.allSettled(groups.map(async (group) => {
      const settings = await api.getMySettings(group.ulid);
      return [group.ulid, settings] as const;
    }));
    set((state) => {
      const next = { ...state.settings };
      entries.forEach((entry) => {
        if (entry.status === 'fulfilled') next[entry.value[0]] = entry.value[1];
      });
      return { settings: next };
    });
  },

  createGroup: async (input) => {
    const api = requireApi(get());
    try {
      const payload = await api.createGroup(input);
      if (payload.group) {
        const group = normalizeGroup(payload.group);
        set((state) => ({ groups: mergeGroups(state.groups, group) }));
        return group.ulid;
      }
      await get().refreshGroups();
      return null;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  updateGroup: async (groupUlid, input) => {
    const api = requireApi(get());
    try {
      const payload = await api.updateGroup(groupUlid, input);
      if (payload.group) {
        const group = normalizeGroup(payload.group);
        set((state) => ({ groups: mergeGroups(state.groups, group) }));
        return;
      }
      await get().refreshGroups();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  refreshUnreadCounts: async () => {
    const api = requireApi(get());
    const groups = get().groups.slice();
    const entries = await Promise.all(groups.map(async (group) => {
      const payload = await api.unreadCount(group.ulid);
      return [group.ulid, Number(payload.unreadCount ?? payload.unread_count ?? 0)] as const;
    }));
    const unreadCounts = Object.fromEntries(entries);
    const activeGroupUlid = get().activeGroupUlid;
    set({ unreadCounts: activeGroupUlid ? { ...unreadCounts, [activeGroupUlid]: 0 } : unreadCounts });
  },

  selectGroup: async (groupUlid) => {
    set({ activeGroupUlid: groupUlid });
    if (!groupUlid) return;
    await Promise.allSettled([get().loadMessages(groupUlid), get().loadMembers(groupUlid), get().loadSettings(groupUlid)]);
    void get().encryptionPreparer?.(groupUlid);
  },

  loadMessages: async (groupUlid) => {
    const api = requireApi(get());
    try {
      const payload = await api.listMessages(groupUlid);
      const messages = (payload.messages ?? []).map(normalizeGroupMessage);
      set((state) => ({
        messages: { ...state.messages, [groupUlid]: messages },
      }));
      const lastReadUlid = messages.at(-1)?.ulid;
      if (lastReadUlid) await get().markRead(groupUlid, lastReadUlid);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  loadMembers: async (groupUlid) => {
    const api = requireApi(get());
    try {
      const payload = await api.listMembers(groupUlid);
      set((state) => ({
        members: { ...state.members, [groupUlid]: (payload.members ?? []).map(normalizeGroupMember) },
      }));
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  loadSettings: async (groupUlid) => {
    const api = requireApi(get());
    try {
      const settings = await api.getMySettings(groupUlid);
      set((state) => ({
        settings: { ...state.settings, [groupUlid]: settings },
      }));
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  updateMySettings: async (groupUlid, input) => {
    const api = requireApi(get());
    try {
      await api.updateMySettings(groupUlid, input);
      await get().loadSettings(groupUlid);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  inviteMembers: async (groupUlid, inviteeDids) => {
    if (!inviteeDids.length) return;
    const api = requireApi(get());
    try {
      await api.inviteMembers(groupUlid, inviteeDids);
      await get().loadMembers(groupUlid);
      await get().refreshGroups();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  leaveGroup: async (groupUlid) => {
    const api = requireApi(get());
    try {
      await api.leaveGroup(groupUlid);
      set((state) => {
        const { [groupUlid]: _members, ...members } = state.members;
        const { [groupUlid]: _messages, ...messages } = state.messages;
        const { [groupUlid]: _settings, ...settings } = state.settings;
        const { [groupUlid]: _unread, ...unreadCounts } = state.unreadCounts;
        const { [groupUlid]: _ready, ...encryptionReady } = state.encryptionReady;
        return {
          groups: state.groups.filter((group) => group.ulid !== groupUlid),
          members,
          messages,
          settings,
          unreadCounts,
          encryptionReady,
          activeGroupUlid: state.activeGroupUlid === groupUlid ? null : state.activeGroupUlid,
        };
      });
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  removeMember: async (groupUlid, actorDid) => {
    const api = requireApi(get());
    try {
      await api.removeMember(groupUlid, actorDid);
      await get().loadMembers(groupUlid);
      await get().refreshGroups();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  updateMember: async (groupUlid, actorDid, input) => {
    const api = requireApi(get());
    try {
      const payload = await api.updateMember(groupUlid, actorDid, input);
      if (payload.member) {
        const member = normalizeGroupMember(payload.member);
        set((state) => ({
          members: {
            ...state.members,
            [groupUlid]: upsertGroupMember(state.members[groupUlid] ?? [], member),
          },
        }));
      } else {
        await get().loadMembers(groupUlid);
      }
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  ingestRealtimeMessage: async (groupUlid, message) => {
    const normalized = normalizeGroupMessage(message);
    set((state) => ({
      messages: {
        ...state.messages,
        [groupUlid]: mergeGroupMessages(state.messages[groupUlid] ?? [], normalized),
      },
    }));
    if (get().activeGroupUlid === groupUlid) {
      await get().markRead(groupUlid, normalized.ulid).catch((error) => set({ error: normalizeError(error) }));
    }
    await get().refreshGroups().catch((error) => set({ error: normalizeError(error) }));
  },

  applyMessageMutation: (groupUlid, messageUlid, kind, payload) =>
    set((state) => {
      const next = applyGroupMutationToList(state.messages[groupUlid], messageUlid, { kind, ...payload });
      return next ? { messages: { ...state.messages, [groupUlid]: next } } : state;
    }),

  applyDecryptedMessage: (groupUlid, messageUlid, plaintext) =>
    set((state) => {
      const next = applyGroupDecryptedContentToList(state.messages[groupUlid], messageUlid, plaintext);
      if (!next) return state;
      const { [messageUlid]: _removed, ...e2eeErrors } = state.e2eeErrors;
      return {
        e2eeErrors,
        messages: { ...state.messages, [groupUlid]: next },
      };
    }),

  setEncryptionReady: (groupUlid, ready) =>
    set((state) => ({
      e2eeProjection: setChatE2eeProjectionStatus(
        state.e2eeProjection,
        groupUlid,
        ready ? 'ready' : 'blocked',
      ),
      encryptionReady: { ...state.encryptionReady, [groupUlid]: ready },
    })),

  setGroupSending: (groupUlid, sending) =>
    set((state) => {
      const { [groupUlid]: _removed, ...rest } = state.sendingGroups;
      return { sendingGroups: sending ? { ...rest, [groupUlid]: true } : rest };
    }),

  sendEncryptedMessage: async (groupUlid, plaintext, attachments, messageType) => {
    const sender = get().encryptedSender;
    if (!sender) return false;
    set((state) => ({
      sendingGroups: { ...state.sendingGroups, [groupUlid]: true },
    }));
    try {
      return await sender(groupUlid, plaintext, attachments, messageType);
    } finally {
      get().setGroupSending(groupUlid, false);
    }
  },

  editEncryptedMessage: async (groupUlid, messageUlid, plaintext) => {
    const editor = get().encryptedEditor;
    if (!editor) return false;
    set((state) => ({
      sendingGroups: { ...state.sendingGroups, [groupUlid]: true },
    }));
    try {
      return await editor(groupUlid, messageUlid, plaintext);
    } finally {
      get().setGroupSending(groupUlid, false);
    }
  },

  recallMessage: async (groupUlid, messageUlid) => {
    const api = requireApi(get());
    try {
      await api.recallMessage(groupUlid, messageUlid);
      get().applyMessageMutation(groupUlid, messageUlid, 'RECALL', { mutatedTsUnixMs: Date.now() });
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  deleteMessage: async (groupUlid, messageUlid) => {
    const api = requireApi(get());
    try {
      await api.deleteMessage(groupUlid, messageUlid);
      get().applyMessageMutation(groupUlid, messageUlid, 'DELETE', { mutatedTsUnixMs: Date.now() });
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  bindEncryptedSender: (sender) => set({ encryptedSender: sender }),

  bindEncryptedEditor: (editor) => set({ encryptedEditor: editor }),

  bindEncryptionPreparer: (preparer) => set({ encryptionPreparer: preparer }),

  setE2eeError: (messageUlid, error) =>
    set((state) => {
      const { [messageUlid]: _removed, ...rest } = state.e2eeErrors;
      return {
        e2eeProjection: error
          ? setChatE2eeProjectionStatus(state.e2eeProjection, messageUlid, 'error', { error })
          : clearChatE2eeProjectionStatus(state.e2eeProjection, messageUlid),
        e2eeErrors: error ? { ...rest, [messageUlid]: error } : rest,
      };
    }),

  markRead: async (groupUlid, upToUlid) => {
    const api = requireApi(get());
    await api.markRead(groupUlid, upToUlid);
    set((state) => ({ unreadCounts: { ...state.unreadCounts, [groupUlid]: 0 } }));
  },

  clearError: () => set({ error: null }),
}));

export function selectGroupConversations(state: GroupState): GroupConversation[] {
  return projectGroupConversations({
    groups: state.groups,
    messages: state.messages,
    unreadCounts: state.unreadCounts,
  });
}

function emptyGroupState() {
  return {
    sessionKey: null,
    api: null,
    groups: [],
    members: {},
    messages: {},
    settings: {},
    unreadCounts: {},
    e2eeErrors: {},
    e2eeProjection: {},
    encryptionReady: {},
    sendingGroups: {},
    activeGroupUlid: null,
    loading: false,
    error: null,
    lastReconcileAt: null,
    encryptedSender: null,
    encryptedEditor: null,
    encryptionPreparer: null,
  };
}

function mergeGroups(groups: Group[], incoming: Group): Group[] {
  const exists = groups.some((group) => group.ulid === incoming.ulid);
  return exists
    ? groups.map((group) => (group.ulid === incoming.ulid ? { ...group, ...incoming } : group))
    : [incoming, ...groups];
}

function upsertGroupMember(members: GroupMember[], incoming: GroupMember): GroupMember[] {
  const exists = members.some((member) => member.actorDid === incoming.actorDid);
  return exists
    ? members.map((member) => (member.actorDid === incoming.actorDid ? { ...member, ...incoming } : member))
    : [...members, incoming];
}

function requireApi(state: GroupState): GroupApiClient {
  if (!state.api) {
    throw new SocialApiError({ method: 'GET', path: '/group-chat', message: 'group api is not bound' });
  }
  return state.api;
}

function normalizeError(error: unknown): SocialApiError {
  if (error instanceof SocialApiError) return error;
  return new SocialApiError({ method: 'UNKNOWN', path: 'group-store', message: readableErrorMessage(error) });
}
