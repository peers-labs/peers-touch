import { create } from 'zustand';

import type { MobileAuthSession } from '../auth/authSession';
import { mobileAuthScopeKey } from '../auth/mobileAuthIdentity';
import { SocialApiError, readableErrorMessage } from '../social/socialTypes';
import type { Group, GroupMember, GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import {
  messagingCreateGroup,
  messagingListConversations,
  messagingListMessages,
  messagingSendMessage,
  messagingSubmitEdit,
  messagingSubmitMetadataInteraction,
  messagingSubmitReadCursor,
  type MessagingAttachmentStageProjection,
  type MessagingSubmitCommandResult,
} from '../../services/mobileCommands';
import {
  createGroupGateway,
  unwrapOutcome,
  type GroupGateway,
  type GroupGatewaySettings as GroupSettings,
  type GroupGatewayCreateInput as CreateGroupInput,
  type GroupGatewayUpdateInput as UpdateGroupInput,
  type GroupGatewayUpdateMemberInput as UpdateGroupMemberInput,
  type GroupGatewayUpdateSettingsInput as UpdateGroupSettingsInput,
} from '../../services/gateways';
import { normalizeGroup, normalizeGroupMember } from './groupNormalizers';
import {
  projectGroupConversations,
  type GroupConversation,
} from './groupProjection';
import {
  groupFromMessaging,
  groupMessageFromMessaging,
} from '../chat/messagingProjectionAdapters';

export type { GroupSettings, CreateGroupInput, UpdateGroupInput, UpdateGroupMemberInput, UpdateGroupSettingsInput };

export interface GroupState {
  sessionKey: string | null;
  authSession: MobileAuthSession | null;
  gateway: GroupGateway | null;
  groups: Group[];
  members: Record<string, GroupMember[]>;
  messages: Record<string, GroupMessage[]>;
  settings: Record<string, GroupSettings>;
  unreadCounts: Record<string, number>;
  sendingGroups: Record<string, boolean>;
  activeGroupUlid: string | null;
  loading: boolean;
  error: SocialApiError | null;
  lastReconcileAt: number | null;
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
  updateMyNickname: (groupUlid: string, nickname: string) => Promise<void>;
  inviteMembers: (groupUlid: string, inviteePtids: string[]) => Promise<void>;
  leaveGroup: (groupUlid: string) => Promise<void>;
  removeMember: (groupUlid: string, actorPtid: string) => Promise<void>;
  updateMember: (groupUlid: string, actorPtid: string, input: UpdateGroupMemberInput) => Promise<void>;
  transferOwnership: (groupUlid: string, nextOwnerPtid: string) => Promise<void>;
  dissolveGroup: (groupUlid: string) => Promise<void>;
  setGroupSending: (groupUlid: string, sending: boolean) => void;
  sendMessage: (
    groupUlid: string,
    plaintext: string,
    attachments?: MessagingAttachmentStageProjection[],
  ) => Promise<MessagingSubmitCommandResult>;
  editMessage: (groupUlid: string, messageUlid: string, plaintext: string) => Promise<void>;
  recallMessage: (groupUlid: string, messageUlid: string) => Promise<void>;
  markRead: (groupUlid: string, upToUlid?: string) => Promise<void>;
  clearError: () => void;
}

export const useGroupStore = create<GroupState>((set, get) => ({
  sessionKey: null,
  authSession: null,
  gateway: null,
  groups: [],
  members: {},
  messages: {},
  settings: {},
  unreadCounts: {},
  sendingGroups: {},
  activeGroupUlid: null,
  loading: false,
  error: null,
  lastReconcileAt: null,
  bindSession: (session) => {
    if (!session) {
      set(emptyGroupState());
      return;
    }
    const sessionKey = mobileAuthScopeKey(session);
    if (get().sessionKey === sessionKey) return;
    set({
      ...emptyGroupState(),
      sessionKey,
      authSession: session,
      gateway: createGroupGateway(session),
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
  },

  refreshGroups: async () => {
    const state = get();
    const gw = requireGateway(state);
    const existing = new Map(state.groups.map((group) => [group.ulid, group]));
    const groups = (await messagingListConversations(messagingAccount(state)))
      .filter((conversation) => conversation.active && conversation.kind === 2)
      .map((conversation) => groupFromMessaging(
        conversation,
        existing.get(conversation.conversationId),
      ));
    set({ groups });
    const entries = await Promise.allSettled(groups.map(async (group) => {
      const settings = unwrapOutcome(await gw.getMySettings(group.ulid));
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
    const state = get();
    try {
      const conversationId = globalThis.crypto.randomUUID();
      const created = await messagingCreateGroup({
        ...messagingAccount(state),
        conversationId,
        name: input.name,
        memberPtids: input.initialMemberPtids,
        federationId: input.federationId,
      });
      if (created.state === 'failed') {
        throw new SocialApiError({
          method: 'INVOKE',
          path: 'messaging_create_group',
          message: 'mobile.group.operationCreateFailed',
        });
      }
      if (created.state === 'projected') {
        await get().refreshGroups();
      } else {
        const actorPtid = state.authSession?.actorRef.ptid ?? '';
        const group = groupFromMessaging({
          conversationId: created.conversationId,
          authorityStationId: state.authSession?.stationPeerId ?? '',
          federationId: input.federationId,
          kind: 2,
          name: input.name,
          ownerPtid: actorPtid,
          memberPtids: [...new Set([actorPtid, ...input.initialMemberPtids])].filter(Boolean),
          membershipEpoch: 0,
          mlsEpoch: 0,
          active: true,
          updatedAtUnixMs: Date.now(),
        });
        set((current) => ({ groups: mergeGroups(current.groups, group) }));
      }
      return created.conversationId;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  updateGroup: async (groupUlid, input) => {
    const gw = requireGateway(get());
    try {
      const payload = unwrapOutcome(await gw.updateGroup(groupUlid, input));
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
    const state = get();
    const account = messagingAccount(state);
    const groups = state.groups.slice();
    const entries = await Promise.all(groups.map(async (group) => {
      const projections = await messagingListMessages({
        ...account,
        conversationId: group.ulid,
      });
      const unreadCount = projections.filter((message) =>
        message.senderPtid !== account.actorPtid
        && !message.readByPtids.includes(account.actorPtid)
        && !message.retracted,
      ).length;
      return [
        group.ulid,
        unreadCount,
        projections.map((message) => groupMessageFromMessaging(group.ulid, message)),
      ] as const;
    }));
    const unreadCounts = Object.fromEntries(entries.map(([groupUlid, unreadCount]) => [groupUlid, unreadCount]));
    const activeGroupUlid = get().activeGroupUlid;
    set((current) => ({
      messages: {
        ...current.messages,
        ...Object.fromEntries(entries.map(([groupUlid, , messages]) => [groupUlid, messages])),
      },
      unreadCounts: activeGroupUlid ? { ...unreadCounts, [activeGroupUlid]: 0 } : unreadCounts,
    }));
  },

  selectGroup: async (groupUlid) => {
    set({ activeGroupUlid: groupUlid });
    if (!groupUlid) return;
    await Promise.allSettled([get().loadMessages(groupUlid), get().loadMembers(groupUlid), get().loadSettings(groupUlid)]);
  },

  loadMessages: async (groupUlid) => {
    const state = get();
    try {
      const messages = (
        await messagingListMessages({
          ...messagingAccount(state),
          conversationId: groupUlid,
        })
      ).map((message) => groupMessageFromMessaging(groupUlid, message));
      set((state) => ({
        messages: { ...state.messages, [groupUlid]: messages },
      }));
      const lastReadUlid = messages.at(-1)?.ulid;
      if (lastReadUlid && get().activeGroupUlid === groupUlid) {
        await get().markRead(groupUlid, lastReadUlid);
      }
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  loadMembers: async (groupUlid) => {
    const gw = requireGateway(get());
    try {
      const result = unwrapOutcome(await gw.listMembers(groupUlid));
      set((state) => ({
        members: { ...state.members, [groupUlid]: result.members.map(normalizeGroupMember) },
      }));
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  loadSettings: async (groupUlid) => {
    const gw = requireGateway(get());
    try {
      const settings = unwrapOutcome(await gw.getMySettings(groupUlid));
      set((state) => ({
        settings: { ...state.settings, [groupUlid]: settings },
      }));
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  updateMySettings: async (groupUlid, input) => {
    const gw = requireGateway(get());
    try {
      unwrapOutcome(await gw.updateMySettings(groupUlid, input));
      await get().loadSettings(groupUlid);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  updateMyNickname: async (groupUlid, nickname) => {
    const gw = requireGateway(get());
    try {
      const payload = unwrapOutcome(await gw.updateMyNickname(groupUlid, nickname));
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

  inviteMembers: async (groupUlid, inviteePtids) => {
    if (!inviteePtids.length) return;
    const gw = requireGateway(get());
    try {
      unwrapOutcome(await gw.inviteMembers(groupUlid, inviteePtids));
      await get().loadMembers(groupUlid);
      await get().refreshGroups();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  leaveGroup: async (groupUlid) => {
    const gw = requireGateway(get());
    try {
      unwrapOutcome(await gw.leaveGroup(groupUlid));
      set((state) => removeGroupFromState(state, groupUlid));
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  removeMember: async (groupUlid, actorPtid) => {
    const gw = requireGateway(get());
    try {
      unwrapOutcome(await gw.removeMember(groupUlid, actorPtid));
      await get().loadMembers(groupUlid);
      await get().refreshGroups();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  updateMember: async (groupUlid, actorPtid, input) => {
    const gw = requireGateway(get());
    try {
      const payload = unwrapOutcome(await gw.updateMember(groupUlid, actorPtid, input));
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

  transferOwnership: async (groupUlid, nextOwnerPtid) => {
    const gw = requireGateway(get());
    try {
      const payload = unwrapOutcome(await gw.transferOwnership(groupUlid, nextOwnerPtid));
      if (payload.group) {
        const group = normalizeGroup(payload.group);
        set((state) => ({ groups: mergeGroups(state.groups, group) }));
      } else {
        await get().refreshGroups();
      }
      await get().loadMembers(groupUlid);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  dissolveGroup: async (groupUlid) => {
    const gw = requireGateway(get());
    try {
      unwrapOutcome(await gw.dissolveGroup(groupUlid));
      set((state) => removeGroupFromState(state, groupUlid));
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  setGroupSending: (groupUlid, sending) =>
    set((state) => {
      const { [groupUlid]: _removed, ...rest } = state.sendingGroups;
      return { sendingGroups: sending ? { ...rest, [groupUlid]: true } : rest };
    }),

  sendMessage: async (groupUlid, plaintext, attachments) => {
    const state = get();
    set((state) => ({
      sendingGroups: { ...state.sendingGroups, [groupUlid]: true },
    }));
    try {
      const outcome = await messagingSendMessage({
        ...messagingAccount(state),
        conversationId: groupUlid,
        plaintext: plaintext.trim(),
        attachmentStageIds: attachments?.map((attachment) => attachment.stageId),
      });
      await get().loadMessages(groupUlid);
      return outcome;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    } finally {
      get().setGroupSending(groupUlid, false);
    }
  },

  editMessage: async (groupUlid, messageUlid, plaintext) => {
    const state = get();
    set((state) => ({
      sendingGroups: { ...state.sendingGroups, [groupUlid]: true },
    }));
    try {
      await messagingSubmitEdit({
        ...messagingAccount(state),
        conversationId: groupUlid,
        messageId: messageUlid,
        plaintext: plaintext.trim(),
      });
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    } finally {
      get().setGroupSending(groupUlid, false);
    }
  },

  recallMessage: async (groupUlid, messageUlid) => {
    const state = get();
    try {
      await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        conversationId: groupUlid,
        messageId: messageUlid,
        interaction: { kind: 'retract' },
      });
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  markRead: async (groupUlid, upToUlid) => {
    const state = get();
    const messages = state.messages[groupUlid] ?? [];
    const target = upToUlid
      ? messages.find((message) => message.ulid === upToUlid)
      : messages.at(-1);
    const eventSequence = target
      ? Number((target as GroupMessage & { eventSequence?: number }).eventSequence ?? 0)
      : 0;
    if (eventSequence > 0) {
      await messagingSubmitReadCursor({
        ...messagingAccount(state),
        conversationId: groupUlid,
        lastReadSequence: eventSequence,
      });
    }
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
    authSession: null,
    gateway: null,
    groups: [],
    members: {},
    messages: {},
    settings: {},
    unreadCounts: {},
    sendingGroups: {},
    activeGroupUlid: null,
    loading: false,
    error: null,
    lastReconcileAt: null,
  };
}

function mergeGroups(groups: Group[], incoming: Group): Group[] {
  const exists = groups.some((group) => group.ulid === incoming.ulid);
  return exists
    ? groups.map((group) => (group.ulid === incoming.ulid ? { ...group, ...incoming } : group))
    : [incoming, ...groups];
}

function upsertGroupMember(members: GroupMember[], incoming: GroupMember): GroupMember[] {
  const exists = members.some((member) => member.ptid === incoming.ptid);
  return exists
    ? members.map((member) => (member.ptid === incoming.ptid ? { ...member, ...incoming } : member))
    : [...members, incoming];
}

function removeGroupFromState(state: GroupState, groupUlid: string) {
  const { [groupUlid]: _members, ...members } = state.members;
  const { [groupUlid]: _messages, ...messages } = state.messages;
  const { [groupUlid]: _settings, ...settings } = state.settings;
  const { [groupUlid]: _unread, ...unreadCounts } = state.unreadCounts;
  return {
    groups: state.groups.filter((group) => group.ulid !== groupUlid),
    members,
    messages,
    settings,
    unreadCounts,
    activeGroupUlid: state.activeGroupUlid === groupUlid ? null : state.activeGroupUlid,
  };
}

function messagingAccount(state: GroupState) {
  const session = state.authSession;
  const actorPtid = session?.actorRef.ptid.trim();
  if (!session || !actorPtid) {
    throw new SocialApiError({
      method: 'INVOKE',
      path: 'messaging',
      message: 'mobile.social.notAuthenticated',
    });
  }
  return {
    stationPeerId: session.stationPeerId,
    actorPtid,
  };
}

function requireGateway(state: GroupState): GroupGateway {
  if (!state.gateway) {
    throw new SocialApiError({ method: 'GET', path: '/group-chat', message: 'group gateway is not bound' });
  }
  return state.gateway;
}

function normalizeError(error: unknown): SocialApiError {
  if (error instanceof SocialApiError) return error;
  return new SocialApiError({ method: 'UNKNOWN', path: 'group-store', message: readableErrorMessage(error) });
}
