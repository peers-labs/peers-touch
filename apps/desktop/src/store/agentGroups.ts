// Agent Groups store — manages collections of agents that collaborate.
//
// Station-backed (O1/O2): CRUD + member management persist to Station via the
// ecosystem agent-group API. Members are carried as an ordered id array; reorder
// is a full-array update. Mutations refresh the list from Station truth.

import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import { api, type StationAgentGroupRow } from '../services/desktop_api';

export type OrchestrationMode = 'sequential' | 'parallel' | 'router';

export interface AgentGroup {
  id: string;
  name: string;
  description: string;
  memberAgentIds: string[];
  orchestrationMode: OrchestrationMode;
  createdAt: number;
  updatedAt: number;
}

export interface AgentGroupCreate {
  name: string;
  description?: string;
  memberAgentIds?: string[];
  orchestrationMode?: OrchestrationMode;
}

interface AgentGroupsState {
  groups: AgentGroup[];

  loadGroups: () => Promise<void>;
  createGroup: (input: AgentGroupCreate) => Promise<void>;
  updateGroup: (id: string, updates: Partial<Pick<AgentGroup, 'name' | 'description' | 'orchestrationMode'>>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  addMember: (groupId: string, agentId: string) => Promise<void>;
  removeMember: (groupId: string, agentId: string) => Promise<void>;
  reorderMembers: (groupId: string, memberAgentIds: string[]) => Promise<void>;
}

function parseMemberIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeMode(mode: string): OrchestrationMode {
  return mode === 'parallel' || mode === 'router' ? mode : 'sequential';
}

// Maps the raw Station row (Go PascalCase) into the UI AgentGroup shape.
function rowToGroup(row: StationAgentGroupRow): AgentGroup {
  return {
    id: row.ID,
    name: row.Name,
    description: row.Description || '',
    memberAgentIds: parseMemberIds(row.MemberAgentIDs),
    orchestrationMode: normalizeMode(row.OrchestrationMode),
    createdAt: new Date(row.CreatedAt).getTime(),
    updatedAt: new Date(row.UpdatedAt).getTime(),
  };
}

export const useAgentGroupsStore = createDesktopStore<AgentGroupsState>('agentGroups', (set, get) => ({
  groups: [],

  loadGroups: async () => {
    try {
      const rows = await api.listAgentGroupsRemote();
      set({ groups: rows.map(rowToGroup) });
      log.info('agentGroups', 'Groups loaded from Station', { count: rows.length });
    } catch (error) {
      log.error('agentGroups', 'Failed to load groups from Station', { error });
    }
  },

  createGroup: async (input: AgentGroupCreate) => {
    try {
      await api.createAgentGroupRemote({
        name: input.name,
        description: input.description,
        member_agent_ids: input.memberAgentIds || [],
        orchestration_mode: input.orchestrationMode || 'sequential',
      });
      await get().loadGroups();
      log.info('agentGroups', 'Group created', { name: input.name });
    } catch (error) {
      log.error('agentGroups', 'Failed to create group', { error });
    }
  },

  updateGroup: async (id, updates) => {
    const current = get().groups.find((g) => g.id === id);
    if (!current) return;
    try {
      await api.updateAgentGroupRemote({
        id,
        name: updates.name ?? current.name,
        description: updates.description ?? current.description,
        member_agent_ids: current.memberAgentIds,
        orchestration_mode: updates.orchestrationMode ?? current.orchestrationMode,
      });
      await get().loadGroups();
      log.info('agentGroups', 'Group updated', { id, updates: Object.keys(updates) });
    } catch (error) {
      log.error('agentGroups', 'Failed to update group', { id, error });
    }
  },

  deleteGroup: async (id) => {
    try {
      await api.deleteAgentGroupRemote(id);
      await get().loadGroups();
      log.info('agentGroups', 'Group deleted', { id });
    } catch (error) {
      log.error('agentGroups', 'Failed to delete group', { id, error });
    }
  },

  addMember: async (groupId, agentId) => {
    const group = get().groups.find((g) => g.id === groupId);
    if (!group || group.memberAgentIds.includes(agentId)) return;
    await get().reorderMembers(groupId, [...group.memberAgentIds, agentId]);
  },

  removeMember: async (groupId, agentId) => {
    const group = get().groups.find((g) => g.id === groupId);
    if (!group) return;
    await get().reorderMembers(groupId, group.memberAgentIds.filter((id) => id !== agentId));
  },

  reorderMembers: async (groupId, memberAgentIds) => {
    const group = get().groups.find((g) => g.id === groupId);
    if (!group) return;
    try {
      await api.updateAgentGroupRemote({
        id: groupId,
        name: group.name,
        description: group.description,
        member_agent_ids: memberAgentIds,
        orchestration_mode: group.orchestrationMode,
      });
      await get().loadGroups();
    } catch (error) {
      log.error('agentGroups', 'Failed to update group members', { groupId, error });
    }
  },
}));
