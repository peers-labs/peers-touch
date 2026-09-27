import { create } from 'zustand';

import type { MobileAuthSession } from '../auth/authSession';
import { mobileAuthScopeKey } from '../auth/mobileAuthIdentity';
import { SocialApiError, readableErrorMessage } from '../social/socialTypes';
import type { Group, GroupMember, GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import {
  messagingConversationSummary,
  messagingCreateGroup,
  messagingCommandStatus,
  messagingListConversations,
  messagingListMessages,
  messagingListThreadMessages,
  messagingSendMessage,
  messagingSubmitEdit,
  messagingSubmitMetadataInteraction,
  messagingSubmitReadCursor,
  type MessagingAttachmentStageProjection,
  type MessagingPendingConversationCommandResult,
  type MessagingPendingCommandResult,
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
  type GroupListProjection,
} from './groupProjection';
import {
  groupFromMessaging,
  groupMessageFromMessaging,
} from '../chat/messagingProjectionAdapters';
import {
  refreshChatMessageCommandOutcomes,
  trackChatMessageCommand,
  type ChatMessageCommandOutcomes,
} from '../chat/messageCommandState';

export type { GroupSettings, CreateGroupInput, UpdateGroupInput, UpdateGroupMemberInput, UpdateGroupSettingsInput };

export type GroupOperationPhase = 'pending' | 'failed';
export type GroupMembershipAction = 'add' | 'remove';

export interface GroupCreateOperation {
  readonly conversationId: string;
  readonly commandId: string;
  readonly name: string;
  readonly description: string;
  readonly initialMemberPtids: readonly string[];
  readonly federationId: string;
  readonly phase: GroupOperationPhase;
}

export interface GroupMembershipOperation {
  readonly groupUlid: string;
  readonly memberPtid: string;
  readonly action: GroupMembershipAction;
  readonly commandId: string;
  readonly phase: GroupOperationPhase;
}

export interface GroupState {
  sessionKey: string | null;
  authSession: MobileAuthSession | null;
  gateway: GroupGateway | null;
  groups: GroupListProjection[];
  members: Record<string, GroupMember[]>;
  messages: Record<string, GroupMessage[]>;
  threadMessages: Record<string, GroupMessage[]>;
  messageCommandOutcomes: ChatMessageCommandOutcomes;
  settings: Record<string, GroupSettings>;
  unreadCounts: Record<string, number>;
  sendingGroups: Record<string, boolean>;
  groupCreateOperation: GroupCreateOperation | null;
  membershipOperations: Record<string, GroupMembershipOperation>;
  activeGroupUlid: string | null;
  loading: boolean;
  error: SocialApiError | null;
  lastReconcileAt: number | null;
  bindSession: (session: MobileAuthSession | null) => void;
  reconcile: () => Promise<void>;
  reconcileActiveGroupMessages: () => Promise<void>;
  createGroup: (input: CreateGroupInput) => Promise<string | null>;
  clearGroupCreateOperation: (conversationId?: string) => void;
  updateGroup: (groupUlid: string, input: UpdateGroupInput) => Promise<void>;
  refreshGroups: () => Promise<void>;
  refreshUnreadCounts: () => Promise<void>;
  selectGroup: (groupUlid: string | null) => Promise<void>;
  loadMessages: (groupUlid: string) => Promise<void>;
  loadThreadMessages: (groupUlid: string, threadRootMessageUlid: string) => Promise<void>;
  refreshMessageCommandOutcomes: () => Promise<void>;
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
    context?: {
      replyToMessageId?: string;
      threadRootMessageId?: string;
    },
  ) => Promise<MessagingSubmitCommandResult>;
  editMessage: (
    groupUlid: string,
    messageUlid: string,
    plaintext: string,
  ) => Promise<MessagingPendingCommandResult>;
  recallMessage: (
    groupUlid: string,
    messageUlid: string,
  ) => Promise<MessagingPendingCommandResult>;
  hideMessageForActor: (
    groupUlid: string,
    messageUlid: string,
  ) => Promise<MessagingPendingCommandResult>;
  moderateMessage: (
    groupUlid: string,
    messageUlid: string,
    reasonCode: string,
  ) => Promise<MessagingPendingCommandResult>;
  setMessageReaction: (
    groupUlid: string,
    messageUlid: string,
    reaction: string,
    remove: boolean,
    threadRootMessageUlid?: string,
  ) => Promise<MessagingPendingCommandResult>;
  setMessagePinned: (
    groupUlid: string,
    messageUlid: string,
    remove: boolean,
    threadRootMessageUlid?: string,
  ) => Promise<MessagingPendingCommandResult>;
  markRead: (groupUlid: string, upToUlid?: string) => Promise<void>;
  clearError: () => void;
}

let groupRefresh: object | null = null;
let unreadRefresh: object | null = null;
let groupReconcile: object | null = null;
let messagingScope = {};
const messageLoads = new Map<string, object>();
const summaryReads = new Map<string, object>();
const readCursors = new Map<string, object>();
const memberLoads = new Map<string, object>();

export const useGroupStore = create<GroupState>((set, get) => ({
  sessionKey: null,
  authSession: null,
  gateway: null,
  groups: [],
  members: {},
  messages: {},
  threadMessages: {},
  messageCommandOutcomes: {},
  settings: {},
  unreadCounts: {},
  sendingGroups: {},
  groupCreateOperation: null,
  membershipOperations: {},
  activeGroupUlid: null,
  loading: false,
  error: null,
  lastReconcileAt: null,
  bindSession: (session) => {
    if (session && get().sessionKey === mobileAuthScopeKey(session)) return;
    messagingScope = {};
    groupRefresh = null;
    unreadRefresh = null;
    groupReconcile = null;
    messageLoads.clear();
    summaryReads.clear();
    readCursors.clear();
    memberLoads.clear();
    if (!session) {
      set(emptyGroupState());
      return;
    }
    const sessionKey = mobileAuthScopeKey(session);
    set({
      ...emptyGroupState(),
      sessionKey,
      authSession: session,
      gateway: createGroupGateway(session),
    });
  },

  reconcile: async () => {
    const scope = get().authSession;
    const request = {};
    groupReconcile = request;
    const isCurrent = () => groupReconcile === request && get().authSession === scope;
    const { refreshGroups, refreshUnreadCounts } = get();
    const coldStart = get().groups.length === 0;
    set({ loading: coldStart, error: null });
    try {
      await refreshGroups();
      if (!isCurrent()) return;
      await refreshUnreadCounts();
      if (!isCurrent()) return;
      await get().reconcileActiveGroupMessages();
      if (!isCurrent()) return;
      set({ loading: false, lastReconcileAt: Date.now() });
    } catch (error) {
      if (!isCurrent()) return;
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
    const refresh = {};
    groupRefresh = refresh;
    unreadRefresh = null;
    const isCurrent = () => groupRefresh === refresh
      && get().authSession === state.authSession && get().gateway === gw;
    try {
      const conversations = await messagingListConversations(messagingAccount(state));
      if (!isCurrent()) return;
      const existing = new Map(get().groups.map((group) => [group.ulid, group]));
      const groups = conversations
        .filter((conversation) => conversation.active && conversation.kind === 2)
        .map((conversation) => {
          const previous = existing.get(conversation.conversationId);
          return {
            ...groupFromMessaging(conversation, previous),
            description: conversation.description ?? previous?.description ?? '',
            lastMessage: previous?.lastMessage,
          };
        });
      const ids = new Set(groups.map((group) => group.ulid));
      for (const id of messageLoads.keys()) {
        if (!ids.has(id)) messageLoads.delete(id);
      }
      for (const id of summaryReads.keys()) {
        if (!ids.has(id)) summaryReads.delete(id);
      }
      for (const id of readCursors.keys()) {
        if (!ids.has(id)) readCursors.delete(id);
      }
      set((current) => ({
        groups,
        activeGroupUlid: current.activeGroupUlid
          && ids.has(current.activeGroupUlid)
          ? current.activeGroupUlid
          : null,
        members: retainGroupRecords(current.members, ids),
        messages: retainGroupRecords(current.messages, ids),
        threadMessages: retainGroupThreadRecords(current.threadMessages, ids),
        settings: retainGroupRecords(current.settings, ids),
        unreadCounts: retainGroupRecords(current.unreadCounts, ids),
        sendingGroups: retainGroupRecords(current.sendingGroups, ids),
        membershipOperations: retainGroupMembershipOperations(
          current.membershipOperations,
          ids,
        ),
      }));
      const entries = await Promise.allSettled(groups.map(async (group) => {
        const settings = unwrapOutcome(await gw.getMySettings(group.ulid));
        return [group.ulid, settings] as const;
      }));
      if (!isCurrent()) return;
      set((state) => {
        const next = { ...state.settings };
        entries.forEach((entry) => {
          if (entry.status === 'fulfilled') next[entry.value[0]] = entry.value[1];
        });
        return { settings: next };
      });
    } catch (error) {
      if (!isCurrent()) return;
      throw error;
    }
  },

  createGroup: async (input) => {
    const state = get();
    if (state.groupCreateOperation?.phase === 'pending') return null;
    const conversationId = globalThis.crypto.randomUUID();
    const operation: GroupCreateOperation = {
      conversationId,
      commandId: '',
      name: input.name,
      description: input.description ?? '',
      initialMemberPtids: [...input.initialMemberPtids],
      federationId: input.federationId,
      phase: 'pending',
    };
    set({ groupCreateOperation: operation });
    try {
      const created = await messagingCreateGroup({
        ...messagingAccount(state),
        conversationId,
        name: input.name,
        memberPtids: input.initialMemberPtids,
        federationId: input.federationId,
      });
      const createdConversationId = created.conversationId.trim() || conversationId;
      set((current) => current.groupCreateOperation?.conversationId === conversationId ? {
        groupCreateOperation: {
          ...current.groupCreateOperation,
          conversationId: createdConversationId,
          commandId: created.commandId,
        },
      } : current);
      if (created.state === 'failed') {
        const failure = new SocialApiError({
          method: 'INVOKE',
          path: 'messaging_create_group',
          message: 'mobile.group.operationCreateFailed',
        });
        set((current) => current.groupCreateOperation?.conversationId === createdConversationId ? {
          groupCreateOperation: {
            ...current.groupCreateOperation,
            phase: 'failed',
          },
          error: failure,
        } : current);
        throw failure;
      }
      if (created.state === 'pending') return null;
      await get().refreshGroups();
      return get().groups.some((group) => group.ulid === createdConversationId)
        ? createdConversationId
        : null;
    } catch (error) {
      const normalized = normalizeError(error);
      set((current) => current.groupCreateOperation?.conversationId === conversationId
        || current.groupCreateOperation?.conversationId === operation.conversationId
        ? {
          groupCreateOperation: current.groupCreateOperation ? {
            ...current.groupCreateOperation,
            phase: 'failed',
          } : null,
          error: normalized,
        }
        : { error: normalized });
      throw error;
    }
  },

  clearGroupCreateOperation: (conversationId) =>
    set((state) => (
      !state.groupCreateOperation
      || (conversationId && state.groupCreateOperation.conversationId !== conversationId)
        ? state
        : { groupCreateOperation: null }
    )),

  updateGroup: async (groupUlid, input) => {
    const gw = requireGateway(get());
    try {
      unwrapOutcome(await gw.updateGroup(groupUlid, input));
      await get().refreshGroups();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  refreshUnreadCounts: async () => {
    const state = get();
    const account = messagingAccount(state);
    const groups = state.groups;
    const listRefresh = groupRefresh;
    const refresh = {};
    unreadRefresh = refresh;
    const isCurrent = () => unreadRefresh === refresh
      && get().authSession === state.authSession && groupRefresh === listRefresh
      && get().groups.length === groups.length
      && get().groups.every((group, index) => group.ulid === groups[index].ulid);
    try {
      const entries = await Promise.all(groups.map(async (group) => {
        const request = {};
        const readCursor = readCursors.get(group.ulid);
        summaryReads.set(group.ulid, request);
        const summary = await messagingConversationSummary({
          ...account,
          conversationId: group.ulid,
        });
        return { groupUlid: group.ulid, summary, request, readCursor };
      }));
      if (!isCurrent()) return;
      set((current) => {
        const unreadCounts: GroupState['unreadCounts'] = {};
        const summaries = new Map(entries.map((entry) => [entry.groupUlid, entry]));
        const groups = current.groups.map((group) => {
          const { groupUlid, summary, request, readCursor } = summaries.get(group.ulid)!;
          const ownsSummary = summaryReads.get(groupUlid) === request;
          unreadCounts[groupUlid] = current.activeGroupUlid === groupUlid ? 0
            : ownsSummary && readCursors.get(groupUlid) === readCursor
              ? summary.unreadCount : current.unreadCounts[groupUlid] ?? 0;
          return ownsSummary ? {
            ...group,
            lastMessage: summary.lastMessage
              ? groupMessageFromMessaging(groupUlid, summary.lastMessage) : undefined,
          } : group;
        });
        return { unreadCounts, groups };
      });
    } catch (error) {
      if (!isCurrent()) return;
      throw error;
    }
  },

  selectGroup: async (groupUlid) => {
    set({ activeGroupUlid: groupUlid });
    if (!groupUlid) return;
    await Promise.allSettled([get().loadMessages(groupUlid), get().loadMembers(groupUlid), get().loadSettings(groupUlid)]);
  },

  loadMessages: async (groupUlid) => {
    const state = get();
    const scope = state.authSession;
    const generation = messagingScope;
    const request = {};
    const readCursor = readCursors.get(groupUlid);
    messageLoads.set(groupUlid, request);
    summaryReads.set(groupUlid, request);
    const isCurrent = () => get().authSession === scope
      && messagingScope === generation && messageLoads.get(groupUlid) === request;
    try {
      const account = messagingAccount(state);
      const projections = await messagingListMessages({
        ...account,
        conversationId: groupUlid,
      });
      if (!isCurrent()) return;
      const messages = projections.map((message) => groupMessageFromMessaging(groupUlid, message));
      const messageCommandOutcomes = await refreshChatMessageCommandOutcomes(
        get().messageCommandOutcomes,
        messages,
        state.authSession?.actorRef.ptid ?? '',
        (commandId) => messagingCommandStatus({
          ...messagingAccount(state),
          commandId,
        }),
      );
      if (!isCurrent()) return;
      const unread = projections.filter((message) =>
        message.senderPtid !== account.actorPtid
        && !message.readByPtids.includes(account.actorPtid)
        && !message.retracted,
      ).length;
      set((state) => ({
        messages: { ...state.messages, [groupUlid]: messages },
        messageCommandOutcomes,
        ...(summaryReads.get(groupUlid) === request ? {
          groups: state.groups.map((group) => group.ulid === groupUlid
            ? { ...group, lastMessage: messages.at(-1) } : group),
          unreadCounts: {
            ...state.unreadCounts,
            [groupUlid]: state.activeGroupUlid === groupUlid ? 0
              : readCursors.get(groupUlid) === readCursor ? unread : state.unreadCounts[groupUlid] ?? 0,
          },
        } : {}),
      }));
      const lastReadUlid = messages.at(-1)?.ulid;
      if (lastReadUlid && get().activeGroupUlid === groupUlid) {
        await get().markRead(groupUlid, lastReadUlid);
      }
    } catch (error) {
      if (!isCurrent()) return;
      set({ error: normalizeError(error) });
      throw error;
    } finally {
      if (messageLoads.get(groupUlid) === request) messageLoads.delete(groupUlid);
    }
  },

  loadThreadMessages: async (groupUlid, threadRootMessageUlid) => {
    const state = get();
    const scope = state.authSession;
    try {
      const messages = (
        await messagingListThreadMessages({
          ...messagingAccount(state),
          conversationId: groupUlid,
          threadRootMessageId: threadRootMessageUlid,
        })
      ).map((message) => groupMessageFromMessaging(groupUlid, message));
      const messageCommandOutcomes = await refreshChatMessageCommandOutcomes(
        get().messageCommandOutcomes,
        [
          ...(get().messages[groupUlid] ?? []),
          ...messages,
        ],
        state.authSession?.actorRef.ptid ?? '',
        (commandId) => messagingCommandStatus({
          ...messagingAccount(state),
          commandId,
        }),
      );
      if (get().authSession !== scope) return;
      set((state) => ({
        threadMessages: {
          ...state.threadMessages,
          [threadRootMessageUlid]: messages,
        },
        messageCommandOutcomes,
      }));
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  refreshMessageCommandOutcomes: async () => {
    const state = get();
    const scope = state.authSession;
    const messages = Object.values(state.messages).flat();
    const threadMessages = Object.values(state.threadMessages).flat();
    const messageCommandOutcomes = await refreshChatMessageCommandOutcomes(
      state.messageCommandOutcomes,
      [...messages, ...threadMessages],
      state.authSession?.actorRef.ptid ?? '',
      (commandId) => messagingCommandStatus({
        ...messagingAccount(state),
        commandId,
      }),
    );
    if (get().authSession !== scope) return;
    set({ messageCommandOutcomes });
  },

  loadMembers: async (groupUlid) => {
    const state = get();
    const gw = requireGateway(state);
    const scope = state.authSession;
    const request = {};
    memberLoads.set(groupUlid, request);
    const isCurrent = () => get().authSession === scope
      && get().gateway === gw
      && memberLoads.get(groupUlid) === request;
    try {
      const result = unwrapOutcome(await gw.listMembers(groupUlid));
      if (!isCurrent()) return;
      const members = result.members.map(normalizeGroupMember);
      set((current) => ({
        members: { ...current.members, [groupUlid]: members },
        membershipOperations: reconcileGroupMembershipOperations(
          current.membershipOperations,
          groupUlid,
          members,
        ),
      }));
      const pending = Object.entries(get().membershipOperations).filter(([, operation]) => (
        operation.groupUlid === groupUlid
        && operation.phase === 'pending'
        && Boolean(operation.commandId)
      ));
      const statuses = await Promise.allSettled(pending.map(async ([key, operation]) => ({
        key,
        commandId: operation.commandId,
        status: await messagingCommandStatus({
          ...messagingAccount(state),
          commandId: operation.commandId,
        }),
      })));
      if (!isCurrent()) return;
      set((current) => {
        const membershipOperations = { ...current.membershipOperations };
        statuses.forEach((settled) => {
          if (settled.status !== 'fulfilled') return;
          const { key, commandId, status } = settled.value;
          const operation = membershipOperations[key];
          if (!operation || operation.commandId !== commandId) return;
          if (status.state === 'failed' || status.state === 'superseded') {
            membershipOperations[key] = { ...operation, phase: 'failed' };
          }
        });
        return { membershipOperations };
      });
    } catch (error) {
      if (!isCurrent()) return;
      set({ error: normalizeError(error) });
      throw error;
    } finally {
      if (memberLoads.get(groupUlid) === request) memberLoads.delete(groupUlid);
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
    const targets = [...new Set(inviteePtids.map((ptid) => ptid.trim()).filter(Boolean))]
      .filter((memberPtid) => (
        get().membershipOperations[groupMembershipOperationKey(groupUlid, memberPtid)]?.phase
        !== 'pending'
      ));
    if (!targets.length) return;
    const state = get();
    const gw = requireGateway(state);
    set((current) => ({
      membershipOperations: beginGroupMembershipOperations(
        current.membershipOperations,
        groupUlid,
        targets,
        'add',
      ),
    }));
    try {
      const payload = unwrapOutcome(await gw.inviteMembers(groupUlid, targets));
      if (get().authSession !== state.authSession || get().gateway !== gw) return;
      const commands = groupMembershipCommands(payload);
      set((current) => ({
        membershipOperations: attachGroupMembershipCommandIds(
          current.membershipOperations,
          groupUlid,
          targets,
          'add',
          commands,
        ),
      }));
      await Promise.allSettled([get().loadMembers(groupUlid), get().refreshGroups()]);
    } catch (error) {
      const normalized = normalizeError(error);
      set((current) => ({
        membershipOperations: failGroupMembershipOperations(
          current.membershipOperations,
          groupUlid,
          targets,
          'add',
        ),
        error: normalized,
      }));
      throw error;
    }
  },

  leaveGroup: async (groupUlid) => {
    const gw = requireGateway(get());
    try {
      unwrapOutcome(await gw.leaveGroup(groupUlid));
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  removeMember: async (groupUlid, actorPtid) => {
    const memberPtid = actorPtid.trim();
    const key = groupMembershipOperationKey(groupUlid, memberPtid);
    if (!memberPtid || get().membershipOperations[key]?.phase === 'pending') return;
    const state = get();
    const gw = requireGateway(state);
    set((current) => ({
      membershipOperations: beginGroupMembershipOperations(
        current.membershipOperations,
        groupUlid,
        [memberPtid],
        'remove',
      ),
    }));
    try {
      const payload = unwrapOutcome(await gw.removeMember(groupUlid, memberPtid));
      if (get().authSession !== state.authSession || get().gateway !== gw) return;
      set((current) => ({
        membershipOperations: attachGroupMembershipCommandIds(
          current.membershipOperations,
          groupUlid,
          [memberPtid],
          'remove',
          groupMembershipCommands(payload),
        ),
      }));
      await Promise.allSettled([get().loadMembers(groupUlid), get().refreshGroups()]);
    } catch (error) {
      const normalized = normalizeError(error);
      set((current) => ({
        membershipOperations: failGroupMembershipOperations(
          current.membershipOperations,
          groupUlid,
          [memberPtid],
          'remove',
        ),
        error: normalized,
      }));
      throw error;
    }
  },

  updateMember: async (groupUlid, actorPtid, input) => {
    const gw = requireGateway(get());
    try {
      unwrapOutcome(await gw.updateMember(groupUlid, actorPtid, input));
      await Promise.all([
        get().loadMembers(groupUlid),
        get().refreshGroups(),
      ]);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  transferOwnership: async (groupUlid, nextOwnerPtid) => {
    const gw = requireGateway(get());
    try {
      unwrapOutcome(await gw.transferOwnership(groupUlid, nextOwnerPtid));
      await Promise.all([
        get().refreshGroups(),
        get().loadMembers(groupUlid),
      ]);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  dissolveGroup: async (groupUlid) => {
    const gw = requireGateway(get());
    try {
      unwrapOutcome(await gw.dissolveGroup(groupUlid));
      await get().refreshGroups();
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

  sendMessage: async (groupUlid, plaintext, attachments, context) => {
    const state = get();
    set((state) => ({
      sendingGroups: { ...state.sendingGroups, [groupUlid]: true },
    }));
    try {
      const outcome = await messagingSendMessage({
        ...messagingAccount(state),
        admissionDomain: 'group',
        conversationId: groupUlid,
        plaintext: plaintext.trim(),
        replyToMessageId: context?.replyToMessageId,
        threadRootMessageId: context?.threadRootMessageId,
        attachmentStageIds: attachments?.map((attachment) => attachment.stageId),
      });
      await get().loadMessages(groupUlid);
      if (context?.threadRootMessageId) {
        await get().loadThreadMessages(groupUlid, context.threadRootMessageId);
      }
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
    const trimmed = plaintext.trim();
    if (!trimmed) {
      throw new Error('mobile.messaging.editContentRequired');
    }
    set((state) => ({
      sendingGroups: { ...state.sendingGroups, [groupUlid]: true },
    }));
    try {
      const submission = await messagingSubmitEdit({
        ...messagingAccount(state),
        admissionDomain: 'group',
        conversationId: groupUlid,
        messageId: messageUlid,
        plaintext: trimmed,
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: groupUlid,
            messageId: messageUlid,
            kind: 'edit',
            submission,
            expectedContent: trimmed,
          },
        ),
      }));
      await Promise.allSettled([get().loadMessages(groupUlid)]);
      return submission;
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
      const submission = await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        admissionDomain: 'group',
        conversationId: groupUlid,
        messageId: messageUlid,
        interaction: { kind: 'retract' },
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: groupUlid,
            messageId: messageUlid,
            kind: 'recall',
            submission,
          },
        ),
      }));
      await Promise.allSettled([get().loadMessages(groupUlid)]);
      return submission;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  hideMessageForActor: async (groupUlid, messageUlid) => {
    const state = get();
    try {
      const submission = await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        admissionDomain: 'group',
        conversationId: groupUlid,
        messageId: messageUlid,
        interaction: { kind: 'hideForActor' },
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: groupUlid,
            messageId: messageUlid,
            kind: 'hideForActor',
            submission,
          },
        ),
      }));
      await Promise.allSettled([get().loadMessages(groupUlid)]);
      return submission;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  moderateMessage: async (groupUlid, messageUlid, reasonCode) => {
    const state = get();
    if (!reasonCode.trim()) {
      throw new Error('mobile.messaging.moderationReasonRequired');
    }
    try {
      const submission = await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        admissionDomain: 'group',
        conversationId: groupUlid,
        messageId: messageUlid,
        interaction: { kind: 'moderate', reasonCode },
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: groupUlid,
            messageId: messageUlid,
            kind: 'moderate',
            submission,
          },
        ),
      }));
      await Promise.allSettled([get().loadMessages(groupUlid)]);
      return submission;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  setMessageReaction: async (
    groupUlid,
    messageUlid,
    reaction,
    remove,
    threadRootMessageUlid,
  ) => {
    const state = get();
    try {
      const submission = await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        admissionDomain: 'group',
        conversationId: groupUlid,
        messageId: messageUlid,
        interaction: { kind: 'reaction', reaction, remove },
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: groupUlid,
            messageId: messageUlid,
            kind: 'reaction',
            submission,
            reaction,
            remove,
          },
        ),
      }));
      const refreshes = [get().loadMessages(groupUlid)];
      if (threadRootMessageUlid) {
        refreshes.push(
          get().loadThreadMessages(groupUlid, threadRootMessageUlid),
        );
      }
      await Promise.allSettled(refreshes);
      return submission;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  setMessagePinned: async (
    groupUlid,
    messageUlid,
    remove,
    threadRootMessageUlid,
  ) => {
    const state = get();
    try {
      const submission = await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        admissionDomain: 'group',
        conversationId: groupUlid,
        messageId: messageUlid,
        interaction: { kind: 'pin', remove },
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: groupUlid,
            messageId: messageUlid,
            kind: 'pin',
            submission,
            remove,
          },
        ),
      }));
      const refreshes = [get().loadMessages(groupUlid)];
      if (threadRootMessageUlid) {
        refreshes.push(
          get().loadThreadMessages(groupUlid, threadRootMessageUlid),
        );
      }
      await Promise.allSettled(refreshes);
      return submission;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  markRead: async (groupUlid, upToUlid) => {
    const state = get();
    const generation = messagingScope;
    const request = {};
    const summaryRead = summaryReads.get(groupUlid);
    readCursors.set(groupUlid, request);
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
        admissionDomain: 'group',
        conversationId: groupUlid,
        lastReadSequence: eventSequence,
      });
    }
    if (get().authSession !== state.authSession || messagingScope !== generation
      || readCursors.get(groupUlid) !== request) return;
    if (get().activeGroupUlid !== groupUlid && summaryReads.get(groupUlid) !== summaryRead) return;
    set((state) => ({ unreadCounts: { ...state.unreadCounts, [groupUlid]: 0 } }));
  },

  clearError: () => set({ error: null }),
}));

export function selectGroupConversations(state: GroupState): GroupConversation[] {
  return projectGroupConversations({
    groups: state.groups,
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
    threadMessages: {},
    messageCommandOutcomes: {},
    settings: {},
    unreadCounts: {},
    sendingGroups: {},
    groupCreateOperation: null,
    membershipOperations: {},
    activeGroupUlid: null,
    loading: false,
    error: null,
    lastReconcileAt: null,
  };
}

function mergeGroups(groups: GroupListProjection[], incoming: Group): GroupListProjection[] {
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

function retainGroupRecords<T>(
  records: Readonly<Record<string, T>>,
  groupIds: ReadonlySet<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(records).filter(([groupId]) => groupIds.has(groupId)),
  );
}

function retainGroupThreadRecords(
  records: Readonly<Record<string, GroupMessage[]>>,
  groupIds: ReadonlySet<string>,
): Record<string, GroupMessage[]> {
  return Object.fromEntries(
    Object.entries(records).filter(([, messages]) => (
      messages.length > 0 && messages.every(
        (message) => groupIds.has(message.groupUlid),
      )
    )),
  );
}

export function groupMembershipOperationKey(groupUlid: string, memberPtid: string): string {
  return `${groupUlid}\u0000${memberPtid}`;
}

export function useGroupMembershipOperations() {
  return useGroupStore((state) => state.membershipOperations);
}

function beginGroupMembershipOperations(
  current: Readonly<Record<string, GroupMembershipOperation>>,
  groupUlid: string,
  memberPtids: readonly string[],
  action: GroupMembershipAction,
): Record<string, GroupMembershipOperation> {
  const next = { ...current };
  memberPtids.forEach((memberPtid) => {
    next[groupMembershipOperationKey(groupUlid, memberPtid)] = {
      groupUlid,
      memberPtid,
      action,
      commandId: '',
      phase: 'pending',
    };
  });
  return next;
}

function attachGroupMembershipCommandIds(
  current: Readonly<Record<string, GroupMembershipOperation>>,
  groupUlid: string,
  memberPtids: readonly string[],
  action: GroupMembershipAction,
  commands: readonly MessagingPendingConversationCommandResult[],
): Record<string, GroupMembershipOperation> {
  const next = { ...current };
  memberPtids.forEach((memberPtid, index) => {
    const key = groupMembershipOperationKey(groupUlid, memberPtid);
    const operation = next[key];
    if (operation?.action !== action || operation.phase !== 'pending') return;
    next[key] = {
      ...operation,
      commandId: commands[index]?.commandId ?? operation.commandId,
    };
  });
  return next;
}

function failGroupMembershipOperations(
  current: Readonly<Record<string, GroupMembershipOperation>>,
  groupUlid: string,
  memberPtids: readonly string[],
  action: GroupMembershipAction,
): Record<string, GroupMembershipOperation> {
  const next = { ...current };
  memberPtids.forEach((memberPtid) => {
    const key = groupMembershipOperationKey(groupUlid, memberPtid);
    const operation = next[key];
    if (operation?.action === action) {
      next[key] = { ...operation, phase: 'failed' };
    }
  });
  return next;
}

function reconcileGroupMembershipOperations(
  current: Readonly<Record<string, GroupMembershipOperation>>,
  groupUlid: string,
  members: readonly GroupMember[],
): Record<string, GroupMembershipOperation> {
  const memberPtids = new Set(members.map((member) => member.ptid));
  return Object.fromEntries(Object.entries(current).filter(([, operation]) => {
    if (operation.groupUlid !== groupUlid) return true;
    const projected = memberPtids.has(operation.memberPtid);
    return operation.action === 'add' ? !projected : projected;
  }));
}

function retainGroupMembershipOperations(
  current: Readonly<Record<string, GroupMembershipOperation>>,
  groupIds: ReadonlySet<string>,
): Record<string, GroupMembershipOperation> {
  return Object.fromEntries(
    Object.entries(current).filter(([, operation]) => groupIds.has(operation.groupUlid)),
  );
}

function groupMembershipCommands(
  payload: Record<string, unknown>,
): MessagingPendingConversationCommandResult[] {
  if (!Array.isArray(payload.commands)) return [];
  return payload.commands.flatMap((command) => {
    if (!command || typeof command !== 'object') return [];
    const commandId = String((command as Record<string, unknown>).commandId ?? '');
    return commandId ? [{ commandId, state: 'pending' as const }] : [];
  });
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
    deviceId: session.deviceId,
    lifecycleGeneration: session.lifecycleGeneration,
  };
}

function requireGateway(state: GroupState): GroupGateway {
  if (!state.gateway) {
    throw new SocialApiError({
      method: 'GET',
      path: '/conversation',
      message: 'group gateway is not bound',
    });
  }
  return state.gateway;
}

function normalizeError(error: unknown): SocialApiError {
  if (error instanceof SocialApiError) return error;
  return new SocialApiError({ method: 'UNKNOWN', path: 'group-store', message: readableErrorMessage(error) });
}
