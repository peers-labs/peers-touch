import { create } from 'zustand';

import type { MobileAuthSession } from '../auth/authSession';
import { SocialApiError } from '../social/socialTypes';
import type { Group, GroupMember, GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import { createGroupApiClient, type GroupApiClient } from './groupApi';
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
  unreadCounts: Record<string, number>;
  e2eeErrors: Record<string, string>;
  activeGroupUlid: string | null;
  loading: boolean;
  error: SocialApiError | null;
  lastReconcileAt: number | null;
  bindSession: (session: MobileAuthSession | null) => void;
  reconcile: () => Promise<void>;
  refreshGroups: () => Promise<void>;
  refreshUnreadCounts: () => Promise<void>;
  selectGroup: (groupUlid: string | null) => Promise<void>;
  loadMessages: (groupUlid: string) => Promise<void>;
  loadMembers: (groupUlid: string) => Promise<void>;
  ingestRealtimeMessage: (groupUlid: string, message: GroupMessage) => Promise<void>;
  applyMessageMutation: (
    groupUlid: string,
    messageUlid: string,
    kind: 'RECALL' | 'EDIT' | 'DELETE',
    payload: { newContent?: string; newCiphertext?: Uint8Array; mutatedTsUnixMs?: number },
  ) => void;
  applyDecryptedMessage: (groupUlid: string, messageUlid: string, plaintext: string) => void;
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
  unreadCounts: {},
  e2eeErrors: {},
  activeGroupUlid: null,
  loading: false,
  error: null,
  lastReconcileAt: null,

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
    set({ loading: true, error: null });
    try {
      await refreshGroups();
      await refreshUnreadCounts();
      set({ loading: false, lastReconcileAt: Date.now() });
    } catch (error) {
      set({ loading: false, error: normalizeError(error) });
    }
  },

  refreshGroups: async () => {
    const api = requireApi(get());
    const payload = await api.listGroups();
    set({ groups: (payload.groups ?? []).map(normalizeGroup) });
  },

  refreshUnreadCounts: async () => {
    const api = requireApi(get());
    const groups = get().groups.slice();
    const entries = await Promise.all(groups.map(async (group) => {
      const payload = await api.unreadCount(group.ulid);
      return [group.ulid, Number(payload.unreadCount ?? payload.unread_count ?? 0)] as const;
    }));
    set({ unreadCounts: Object.fromEntries(entries) });
  },

  selectGroup: async (groupUlid) => {
    set({ activeGroupUlid: groupUlid });
    if (!groupUlid) return;
    await Promise.allSettled([get().loadMessages(groupUlid), get().loadMembers(groupUlid)]);
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

  ingestRealtimeMessage: async (groupUlid, message) => {
    const normalized = normalizeGroupMessage(message);
    set((state) => ({
      messages: {
        ...state.messages,
        [groupUlid]: mergeGroupMessages(state.messages[groupUlid] ?? [], normalized),
      },
    }));
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

  setE2eeError: (messageUlid, error) =>
    set((state) => {
      const { [messageUlid]: _removed, ...rest } = state.e2eeErrors;
      return {
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
    unreadCounts: {},
    e2eeErrors: {},
    activeGroupUlid: null,
    loading: false,
    error: null,
    lastReconcileAt: null,
  };
}

function requireApi(state: GroupState): GroupApiClient {
  if (!state.api) {
    throw new SocialApiError({ method: 'GET', path: '/group-chat', message: 'group api is not bound' });
  }
  return state.api;
}

function normalizeError(error: unknown): SocialApiError {
  if (error instanceof SocialApiError) return error;
  return new SocialApiError({ method: 'UNKNOWN', path: 'group-store', message: error instanceof Error ? error.message : String(error) });
}
