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

interface ListGroupsRaw {
  groups?: Group[];
  total?: number;
}

interface ListGroupMembersRaw {
  members?: GroupMember[];
  total?: number;
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
  createGroup: (input: CreateGroupInput) => Promise<CommandOutcome<{ group?: Group }>>;
  updateGroup: (groupUlid: string, input: UpdateGroupInput) => Promise<CommandOutcome<{ group?: Group }>>;
  listGroups: (limit?: number, offset?: number) => Promise<CommandOutcome<GroupListResult>>;
  dissolveGroup: (groupUlid: string) => Promise<CommandOutcome<Record<string, unknown>>>;

  // Members
  listMembers: (groupUlid: string, limit?: number, offset?: number) => Promise<CommandOutcome<GroupMembersResult>>;
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
    createGroup: (input) =>
      command({
        method: 'POST',
        path: '/group-chat/create',
        body: {
          name: input.name,
          description: input.description ?? '',
          type: 1,
          visibility: 2,
          initial_member_ptids: input.initialMemberPtids,
        },
      }),

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

    listGroups: async (limit = 50, offset = 0) => {
      const result = await command<ListGroupsRaw>({
        method: 'GET',
        path: '/group-chat/list',
        query: { limit, offset },
      });
      if (!result.ok) return result;
      const groups = result.data.groups ?? [];
      return { ok: true, data: { groups, total: result.data.total ?? groups.length } };
    },

    dissolveGroup: (groupUlid) =>
      command({ method: 'POST', path: '/group-chat/dissolve', body: { group_ulid: groupUlid } }),

    // --- Members ---
    listMembers: async (groupUlid, limit = 100, offset = 0) => {
      const result = await command<ListGroupMembersRaw>({
        method: 'GET',
        path: '/group-chat/members',
        query: { group_ulid: groupUlid, limit, offset },
      });
      if (!result.ok) return result;
      const members = result.data.members ?? [];
      return { ok: true, data: { members, total: result.data.total ?? members.length } };
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
      command({ method: 'PUT', path: '/group-chat/member/nickname', body: { group_ulid: groupUlid, nickname } }),

    transferOwnership: (groupUlid, nextOwnerPtid) =>
      command({ method: 'POST', path: '/group-chat/ownership/transfer', body: { group_ulid: groupUlid, next_owner_ptid: nextOwnerPtid } }),

    // --- Settings ---
    getMySettings: async (groupUlid) => {
      const result = await command<GroupSettingsRaw>({
        method: 'GET',
        path: '/group-chat/my-settings',
        query: { group_ulid: groupUlid },
      });
      if (!result.ok) return result;
      return { ok: true, data: normalizeGroupSettings(result.data) };
    },

    updateMySettings: (groupUlid, input) =>
      command({
        method: 'PUT',
        path: '/group-chat/my-settings',
        body: {
          group_ulid: groupUlid,
          ...(input.isMuted !== undefined ? { is_muted: input.isMuted } : {}),
          ...(input.isPinned !== undefined ? { is_pinned: input.isPinned } : {}),
          ...(input.showMemberNickname !== undefined ? { show_member_nickname: input.showMemberNickname } : {}),
          ...(input.alertEnabled !== undefined ? { alert_enabled: input.alertEnabled } : {}),
          ...(input.background !== undefined ? { background: input.background } : {}),
          ...(input.clearedAt !== undefined ? { cleared_at_unix_ms: input.clearedAt } : {}),
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
    isMuted: Boolean(record.isMuted ?? record.is_muted),
    isPinned: Boolean(record.isPinned ?? record.is_pinned),
    myNickname: String(record.myNickname ?? record.my_nickname ?? ''),
    showMemberNickname: Boolean(record.showMemberNickname ?? record.show_member_nickname),
    alertEnabled: (record.alertEnabled ?? record.alert_enabled) !== false,
    background: normalizeChatBackgroundId(record.background),
    clearedAt: Number(record.clearedAtUnixMs ?? record.cleared_at_unix_ms ?? 0),
  };
}
