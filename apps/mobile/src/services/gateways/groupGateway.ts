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
  updateGroup: (groupUlid: string, input: UpdateGroupInput) => Promise<CommandOutcome<{ group?: Group }>>;
  dissolveGroup: (groupUlid: string) => Promise<CommandOutcome<Record<string, unknown>>>;

  // Members
  listMembers: (groupUlid: string) => Promise<CommandOutcome<GroupMembersResult>>;
  inviteMembers: (groupUlid: string, inviteePtids: string[]) => Promise<CommandOutcome<Record<string, unknown>>>;
  leaveGroup: (groupUlid: string) => Promise<CommandOutcome<Record<string, unknown>>>;
  removeMember: (groupUlid: string, actorPtid: string) => Promise<CommandOutcome<Record<string, unknown>>>;
  updateMember: (groupUlid: string, actorPtid: string, input: UpdateGroupMemberInput) => Promise<CommandOutcome<{ member?: GroupMember }>>;
  updateMyNickname: (groupUlid: string, nickname: string) => Promise<CommandOutcome<{ member?: GroupMember }>>;
  transferOwnership: (groupUlid: string, nextOwnerPtid: string) => Promise<CommandOutcome<{ group?: Group }>>;

  // Settings
  getMySettings: (groupUlid: string) => Promise<CommandOutcome<GroupSettings>>;
  updateMySettings: (groupUlid: string, input: UpdateGroupSettingsInput) => Promise<CommandOutcome<Record<string, unknown>>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGroupGateway(session: MobileAuthSession): GroupGateway {
  const { command } = createGatewayTransport(session);

  return {
    // --- Group lifecycle ---
    updateGroup: (groupUlid, input) =>
      command({
        method: 'PUT',
        path: '/group-chat/update',
        body: {
          group_ulid: groupUlid,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.muted !== undefined ? { muted: input.muted } : {}),
        },
      }),

    dissolveGroup: (groupUlid) =>
      command({ method: 'POST', path: '/group-chat/dissolve', body: { group_ulid: groupUlid } }),

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
      command({ method: 'POST', path: '/group-chat/invite', body: { group_ulid: groupUlid, invitee_ptids: inviteePtids } }),

    leaveGroup: (groupUlid) =>
      command({ method: 'POST', path: '/group-chat/leave', body: { group_ulid: groupUlid } }),

    removeMember: (groupUlid, actorPtid) =>
      command({ method: 'POST', path: '/group-chat/member/remove', body: { group_ulid: groupUlid, actor_ptid: actorPtid } }),

    updateMember: (groupUlid, actorPtid, input) =>
      command({
        method: 'PUT',
        path: '/group-chat/member/update',
        body: {
          group_ulid: groupUlid,
          actor_ptid: actorPtid,
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.muted !== undefined ? { muted: input.muted } : {}),
          ...(input.mutedUntil !== undefined ? { muted_until: new Date(input.mutedUntil).toISOString() } : {}),
        },
      }),

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
      command({ method: 'POST', path: '/group-chat/ownership/transfer', body: { group_ulid: groupUlid, next_owner_ptid: nextOwnerPtid } }),

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
