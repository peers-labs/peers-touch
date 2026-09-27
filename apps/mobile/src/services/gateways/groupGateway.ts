/**
 * groupGateway.ts — Group domain API gateway
 *
 * Wraps group lifecycle, membership, and settings APIs behind a typed
 * gateway with JSON quarantine and command outcome adapters.
 *
 * groupRuntime remains a subordinate projection descriptor to socialProjection;
 * this gateway provides the data layer for the group runtime.
 */

import type { MobileAuthSession } from '../../features/auth/authSession';
import type { Group, GroupMember } from '../../gen/proto/domain/chat/group_chat_pb';
import type { ChatBackgroundId } from '../../features/social/socialApiTypes';
import { normalizeChatBackgroundId } from '../../features/social/socialApiTypes';
import { readableErrorMessage } from '../../features/social/socialTypes';
import {
  messagingDissolveConversation,
  messagingMembershipTransition,
  messagingSubmitLeaveIntent,
  messagingTransferOwnership,
  messagingUpdateConversation,
  messagingUpdateMemberAuthority,
  type MessagingMemberAuthorityResult,
  type MessagingPendingConversationCommandResult,
} from '../mobileCommands';
import {
  createGatewayTransport,
  type CommandOutcome,
} from './gatewayTypes';

// ---------------------------------------------------------------------------
// Raw JSON shapes from Station (quarantined inside this module)
// ---------------------------------------------------------------------------

interface ListConversationMembersRaw {
  members?: Array<Record<string, unknown>>;
}

interface GroupSettingsRaw {
  isMuted?: boolean;
  is_muted?: boolean;
  isPinned?: boolean;
  is_pinned?: boolean;
  myNickname?: string;
  my_nickname?: string;
  showMemberNickname?: boolean;
  show_member_nickname?: boolean;
  alertEnabled?: boolean;
  alert_enabled?: boolean;
  background?: unknown;
  clearedAtUnixMs?: number;
  cleared_at_unix_ms?: number;
}

// ---------------------------------------------------------------------------
// Gateway output types (clean domain objects)
// ---------------------------------------------------------------------------

export interface GroupListResult {
  readonly groups: Group[];
  readonly total: number;
}

export interface GroupMembersResult {
  readonly members: GroupMember[];
  readonly total: number;
}

export interface GroupSettings {
  readonly isMuted: boolean;
  readonly isPinned: boolean;
  readonly myNickname: string;
  readonly showMemberNickname: boolean;
  readonly alertEnabled: boolean;
  readonly background: ChatBackgroundId;
  readonly clearedAt: number;
}

export interface CreateGroupInput {
  readonly name: string;
  readonly description?: string;
  readonly initialMemberPtids: string[];
  readonly federationId: string;
}

export interface UpdateGroupInput {
  readonly name?: string;
  readonly description?: string;
  readonly muted?: boolean;
}

export interface UpdateGroupMemberInput {
  readonly role?: number;
  readonly muted?: boolean;
  readonly mutedUntil?: number;
}

export interface UpdateGroupSettingsInput {
  readonly isMuted?: boolean;
  readonly isPinned?: boolean;
  readonly showMemberNickname?: boolean;
  readonly alertEnabled?: boolean;
  readonly background?: ChatBackgroundId;
  readonly clearedAt?: number;
}

// ---------------------------------------------------------------------------
// Group gateway interface
// ---------------------------------------------------------------------------

export interface GroupGateway {
  // Group lifecycle
  updateGroup: (
    groupUlid: string,
    input: UpdateGroupInput,
  ) => Promise<CommandOutcome<{ command?: MessagingPendingConversationCommandResult }>>;
  dissolveGroup: (
    groupUlid: string,
  ) => Promise<CommandOutcome<{ command?: MessagingPendingConversationCommandResult }>>;

  // Members
  listMembers: (groupUlid: string) => Promise<CommandOutcome<GroupMembersResult>>;
  inviteMembers: (groupUlid: string, inviteePtids: string[]) => Promise<CommandOutcome<Record<string, unknown>>>;
  leaveGroup: (groupUlid: string) => Promise<CommandOutcome<Record<string, unknown>>>;
  removeMember: (groupUlid: string, actorPtid: string) => Promise<CommandOutcome<Record<string, unknown>>>;
  updateMember: (groupUlid: string, actorPtid: string, input: UpdateGroupMemberInput) => Promise<CommandOutcome<{ authority: MessagingMemberAuthorityResult }>>;
  updateMyNickname: (groupUlid: string, nickname: string) => Promise<CommandOutcome<{ member?: GroupMember }>>;
  transferOwnership: (groupUlid: string, nextOwnerPtid: string) => Promise<CommandOutcome<{ authority: MessagingMemberAuthorityResult }>>;

  // Settings
  getMySettings: (groupUlid: string) => Promise<CommandOutcome<GroupSettings>>;
  updateMySettings: (groupUlid: string, input: UpdateGroupSettingsInput) => Promise<CommandOutcome<Record<string, unknown>>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGroupGateway(session: MobileAuthSession): GroupGateway {
  const { command } = createGatewayTransport(session, 'group');

  return {
    // --- Group lifecycle ---
    updateGroup: (groupUlid, input) =>
      invokeConversationUpdate(groupUlid, input, session),

    dissolveGroup: (groupUlid) => invokeConversationDissolve(groupUlid, session),

    // --- Members ---
    listMembers: async (groupUlid) => {
      const result = await command<ListConversationMembersRaw>({
        method: 'GET',
        path: '/conversation/members',
        query: { conversation_id: groupUlid },
      });
      if (!result.ok) return result;
      const members = (result.data.members ?? []).map((member) =>
        conversationMemberToGroupMember(member, groupUlid));
      return { ok: true, data: { members, total: members.length } };
    },

    inviteMembers: (groupUlid, inviteePtids) =>
      invokeMembershipTransitions(
        groupUlid,
        inviteePtids,
        'add_actor',
        session,
      ),

    leaveGroup: (groupUlid) => invokeSelfLeave(groupUlid, session),

    removeMember: (groupUlid, actorPtid) =>
      invokeMembershipTransitions(
        groupUlid,
        [actorPtid],
        'remove_actor',
        session,
      ),

    updateMember: (groupUlid, actorPtid, input) =>
      invokeMemberAuthorityUpdate(groupUlid, actorPtid, input, session),

    updateMyNickname: (groupUlid, nickname) =>
      command({
        method: 'PUT',
        path: '/conversation/member/settings',
        body: {
          conversation_id: groupUlid,
          settings: { nickname },
        },
      }),

    transferOwnership: (groupUlid, nextOwnerPtid) =>
      invokeOwnershipTransfer(groupUlid, nextOwnerPtid, session),

    // --- Settings ---
    getMySettings: async (groupUlid) => {
      const result = await command<{ settings?: GroupSettingsRaw }>({
        method: 'GET',
        path: '/conversation/member/settings',
        query: { conversation_id: groupUlid },
      });
      if (!result.ok) return result;
      return { ok: true, data: normalizeGroupSettings(result.data.settings ?? result.data) };
    },

    updateMySettings: (groupUlid, input) =>
      command({
        method: 'PUT',
        path: '/conversation/member/settings',
        body: {
          conversation_id: groupUlid,
          settings: {
            ...(input.isMuted !== undefined ? { muted: input.isMuted } : {}),
            ...(input.isPinned !== undefined ? { pinned: input.isPinned } : {}),
            ...(input.alertEnabled !== undefined ? { alert_enabled: input.alertEnabled } : {}),
            ...(input.background !== undefined ? { background: input.background } : {}),
            ...(input.clearedAt !== undefined ? { cleared_at_ms: input.clearedAt } : {}),
          },
        },
      }),
  };
}

// ---------------------------------------------------------------------------
// JSON quarantine normalizer (private)
// ---------------------------------------------------------------------------

async function invokeSelfLeave(
  conversationId: string,
  session: MobileAuthSession,
): Promise<CommandOutcome<Record<string, unknown>>> {
  try {
    const intent = await messagingSubmitLeaveIntent({
      stationPeerId: session.stationPeerId,
      actorPtid: session.actorRef.ptid,
      deviceId: session.deviceId,
      lifecycleGeneration: session.lifecycleGeneration,
      conversationId,
    });
    return {
      ok: true,
      data: {
        intentId: intent.intentId,
        state: intent.state,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'GROUP_SELF_LEAVE_INTENT_FAILED',
        message: readableErrorMessage(error),
        method: 'INVOKE',
        path: 'messaging_submit_leave_intent',
      },
    };
  }
}

async function invokeConversationUpdate(
  conversationId: string,
  input: UpdateGroupInput,
  session: MobileAuthSession,
): Promise<CommandOutcome<{ command: MessagingPendingConversationCommandResult }>> {
  if (input.muted !== undefined) {
    return {
      ok: false,
      error: {
        code: 'GROUP_WIDE_MUTE_OWNER_BLOCKED',
        message: 'mobile.group.operationUpdateFailed',
        method: 'INVOKE',
        path: 'messaging_update_conversation',
      },
    };
  }
  try {
    const command = await messagingUpdateConversation({
      stationPeerId: session.stationPeerId,
      actorPtid: session.actorRef.ptid,
      deviceId: session.deviceId,
      lifecycleGeneration: session.lifecycleGeneration,
      conversationId,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
    return { ok: true, data: { command } };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'GROUP_UPDATE_COMMAND_FAILED',
        message: readableErrorMessage(error),
        method: 'INVOKE',
        path: 'messaging_update_conversation',
      },
    };
  }
}

async function invokeConversationDissolve(
  conversationId: string,
  session: MobileAuthSession,
): Promise<CommandOutcome<{ command: MessagingPendingConversationCommandResult }>> {
  try {
    const command = await messagingDissolveConversation({
      stationPeerId: session.stationPeerId,
      actorPtid: session.actorRef.ptid,
      deviceId: session.deviceId,
      lifecycleGeneration: session.lifecycleGeneration,
      conversationId,
    });
    return { ok: true, data: { command } };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'GROUP_DISSOLVE_COMMAND_FAILED',
        message: readableErrorMessage(error),
        method: 'INVOKE',
        path: 'messaging_dissolve_conversation',
      },
    };
  }
}

async function invokeMemberAuthorityUpdate(
  conversationId: string,
  targetPtid: string,
  input: UpdateGroupMemberInput,
  session: MobileAuthSession,
): Promise<CommandOutcome<{ authority: MessagingMemberAuthorityResult }>> {
  try {
    const authority = await messagingUpdateMemberAuthority({
      stationPeerId: session.stationPeerId,
      actorPtid: session.actorRef.ptid,
      deviceId: session.deviceId,
      lifecycleGeneration: session.lifecycleGeneration,
      conversationId,
      targetPtid,
      ...(input.role !== undefined ? { role: memberAuthorityRole(input.role) } : {}),
      ...(input.muted !== undefined ? { muted: input.muted } : {}),
      ...(input.mutedUntil !== undefined
        ? { mutedUntilUnixMs: input.mutedUntil }
        : {}),
    });
    return { ok: true, data: { authority } };
  } catch (error) {
    return memberAuthorityFailure(
      error,
      'messaging_update_member_authority',
    );
  }
}

async function invokeOwnershipTransfer(
  conversationId: string,
  nextOwnerPtid: string,
  session: MobileAuthSession,
): Promise<CommandOutcome<{ authority: MessagingMemberAuthorityResult }>> {
  try {
    const authority = await messagingTransferOwnership({
      stationPeerId: session.stationPeerId,
      actorPtid: session.actorRef.ptid,
      deviceId: session.deviceId,
      lifecycleGeneration: session.lifecycleGeneration,
      conversationId,
      nextOwnerPtid,
    });
    return { ok: true, data: { authority } };
  } catch (error) {
    return memberAuthorityFailure(error, 'messaging_transfer_ownership');
  }
}

function memberAuthorityRole(role: number): 'member' | 'admin' {
  if (role === 1) return 'member';
  if (role === 2) return 'admin';
  throw new Error('mobile.group.memberAuthorityRoleInvalid');
}

function memberAuthorityFailure<T>(
  error: unknown,
  path: string,
): CommandOutcome<T> {
  const native = error as Partial<{ code: string }>;
  return {
    ok: false,
    error: {
      code: native.code ?? 'GROUP_MEMBER_AUTHORITY_COMMAND_FAILED',
      message: readableErrorMessage(error),
      method: 'INVOKE',
      path,
    },
  };
}

async function invokeMembershipTransitions(
  conversationId: string,
  targetPtids: string[],
  action: 'add_actor' | 'remove_actor',
  session: MobileAuthSession,
): Promise<CommandOutcome<Record<string, unknown>>> {
  try {
    const commands: MessagingPendingConversationCommandResult[] = [];
    for (const targetPtid of targetPtids) {
      commands.push(await messagingMembershipTransition({
        stationPeerId: session.stationPeerId,
        actorPtid: session.actorRef.ptid,
        deviceId: session.deviceId,
        lifecycleGeneration: session.lifecycleGeneration,
        conversationId,
        action,
        targetPtid,
        ...(action === 'add_actor' ? { role: 'member' as const } : {}),
      }));
    }
    return { ok: true, data: { commands } };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'GROUP_MEMBERSHIP_COMMAND_FAILED',
        message: readableErrorMessage(error),
        method: 'INVOKE',
        path: 'messaging_membership_transition',
      },
    };
  }
}

function normalizeGroupSettings(payload: unknown): GroupSettings {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  return {
    isMuted: Boolean(record.muted ?? record.isMuted ?? record.is_muted),
    isPinned: Boolean(record.pinned ?? record.isPinned ?? record.is_pinned),
    myNickname: String(record.nickname ?? record.myNickname ?? record.my_nickname ?? ''),
    showMemberNickname: Boolean(record.showMemberNickname ?? record.show_member_nickname),
    alertEnabled: (record.alertEnabled ?? record.alert_enabled) !== false,
    background: normalizeChatBackgroundId(record.background),
    clearedAt: Number(
      record.clearedAtMs
      ?? record.cleared_at_ms
      ?? record.clearedAtUnixMs
      ?? record.cleared_at_unix_ms
      ?? 0,
    ),
  };
}

function conversationMemberToGroupMember(
  payload: Record<string, unknown>,
  fallbackConversationId: string,
): GroupMember {
  return {
    ...payload,
    groupUlid: String(
      payload.conversationId
      ?? payload.conversation_id
      ?? fallbackConversationId,
    ),
    ptid: String(payload.ptid ?? ''),
    role: Number(payload.role ?? 0),
    nickname: String(payload.nickname ?? ''),
    muted: Boolean(payload.muted),
    mutedUntil: payload.mutedUntil ?? payload.muted_until,
    joinedAt: payload.joinedAt ?? payload.joined_at,
    invitedBy: String(payload.invitedByPtid ?? payload.invited_by_ptid ?? ''),
    actorHomeStationPeerId: String(
      payload.actorHomeStationPeerId
      ?? payload.actor_home_station_peer_id
      ?? '',
    ),
    actorHomeStationDomain: String(
      payload.actorHomeStationDomain
      ?? payload.actor_home_station_domain
      ?? '',
    ),
  } as GroupMember;
}
