// Agent Groups store — manages collections of agents that collaborate.
//
// v1 persists to localStorage. Station integration is deferred.

import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';

const STORAGE_KEY = 'peers-ai-agent-groups';

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

  loadGroups: () => void;
  createGroup: (input: AgentGroupCreate) => AgentGroup;
  updateGroup: (id: string, updates: Partial<Pick<AgentGroup, 'name' | 'description' | 'orchestrationMode'>>) => void;
  deleteGroup: (id: string) => void;
  addMember: (groupId: string, agentId: string) => void;
  removeMember: (groupId: string, agentId: string) => void;
  reorderMembers: (groupId: string, memberAgentIds: string[]) => void;
}

function generateId(): string {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function persistGroups(groups: AgentGroup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch (error) {
    log.error('agentGroups', 'Failed to persist groups to localStorage', { error });
  }
}

function loadFromStorage(): AgentGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentGroup[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (error) {
    log.error('agentGroups', 'Failed to load groups from localStorage', { error });
    return [];
  }
}

export const useAgentGroupsStore = createDesktopStore<AgentGroupsState>('agentGroups', (set, get) => ({
  groups: [],

  loadGroups: () => {
    const groups = loadFromStorage();
    set({ groups });
    log.info('agentGroups', 'Groups loaded from storage', { count: groups.length });
  },

  createGroup: (input: AgentGroupCreate) => {
    const now = Date.now();
    const group: AgentGroup = {
      id: generateId(),
      name: input.name,
      description: input.description || '',
      memberAgentIds: input.memberAgentIds || [],
      orchestrationMode: input.orchestrationMode || 'sequential',
      createdAt: now,
      updatedAt: now,
    };
    const next = [...get().groups, group];
    set({ groups: next });
    persistGroups(next);
    log.info('agentGroups', 'Group created', { id: group.id, name: group.name });
    return group;
  },

  updateGroup: (id, updates) => {
    const next = get().groups.map((g) =>
      g.id === id ? { ...g, ...updates, updatedAt: Date.now() } : g,
    );
    set({ groups: next });
    persistGroups(next);
    log.info('agentGroups', 'Group updated', { id, updates: Object.keys(updates) });
  },

  deleteGroup: (id) => {
    const next = get().groups.filter((g) => g.id !== id);
    set({ groups: next });
    persistGroups(next);
    log.info('agentGroups', 'Group deleted', { id });
  },

  addMember: (groupId, agentId) => {
    const next = get().groups.map((g) => {
      if (g.id !== groupId) return g;
      if (g.memberAgentIds.includes(agentId)) return g;
      return { ...g, memberAgentIds: [...g.memberAgentIds, agentId], updatedAt: Date.now() };
    });
    set({ groups: next });
    persistGroups(next);
  },

  removeMember: (groupId, agentId) => {
    const next = get().groups.map((g) => {
      if (g.id !== groupId) return g;
      return { ...g, memberAgentIds: g.memberAgentIds.filter((id) => id !== agentId), updatedAt: Date.now() };
    });
    set({ groups: next });
    persistGroups(next);
  },

  reorderMembers: (groupId, memberAgentIds) => {
    const next = get().groups.map((g) => {
      if (g.id !== groupId) return g;
      return { ...g, memberAgentIds, updatedAt: Date.now() };
    });
    set({ groups: next });
    persistGroups(next);
  },
}));
