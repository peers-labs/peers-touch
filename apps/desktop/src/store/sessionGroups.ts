// Session Groups store — manages user-defined topic/session groups within an agent.
//
// v1 persists to localStorage. A topic can belong to at most one group (or be ungrouped).

import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';

const STORAGE_KEY = 'peers-ai-session-groups';

export interface SessionGroup {
  id: string;
  name: string;
  agentId: string;
  topicKeys: string[];
  sortOrder: number;
  createdAt: number;
}

interface SessionGroupState {
  groups: SessionGroup[];
}

interface SessionGroupActions {
  loadGroups: () => void;
  createGroup: (agentId: string, name: string) => string;
  renameGroup: (groupId: string, name: string) => void;
  deleteGroup: (groupId: string) => void;
  addTopicToGroup: (groupId: string, topicKey: string) => void;
  removeTopicFromGroup: (groupId: string, topicKey: string) => void;
  moveTopicToGroup: (topicKey: string, targetGroupId: string | null) => void;
  reorderGroups: (groupIds: string[]) => void;
  getGroupsForAgent: (agentId: string) => SessionGroup[];
  getGroupForTopic: (topicKey: string) => SessionGroup | undefined;
}

type SessionGroupStore = SessionGroupState & SessionGroupActions;

function generateId(): string {
  return `sg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function persistGroups(groups: SessionGroup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch (error) {
    log.error('sessionGroups', 'Failed to persist session groups to localStorage', { error });
  }
}

function loadFromStorage(): SessionGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionGroup[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (error) {
    log.error('sessionGroups', 'Failed to load session groups from localStorage', { error });
    return [];
  }
}

/**
 * Removes a topic key from all groups to enforce the "at most one group" invariant.
 */
function removeTopicFromAllGroups(groups: SessionGroup[], topicKey: string): SessionGroup[] {
  return groups.map((g) => {
    if (!g.topicKeys.includes(topicKey)) return g;
    return { ...g, topicKeys: g.topicKeys.filter((k) => k !== topicKey) };
  });
}

export const useSessionGroupStore = createDesktopStore<SessionGroupStore>('sessionGroups', (set, get) => ({
  groups: [],

  loadGroups: () => {
    const groups = loadFromStorage();
    set({ groups });
    log.info('sessionGroups', 'Session groups loaded from storage', { count: groups.length });
  },

  createGroup: (agentId: string, name: string): string => {
    const id = generateId();
    const maxOrder = get().groups
      .filter((g) => g.agentId === agentId)
      .reduce((max, g) => Math.max(max, g.sortOrder), -1);
    const group: SessionGroup = {
      id,
      name,
      agentId,
      topicKeys: [],
      sortOrder: maxOrder + 1,
      createdAt: Date.now(),
    };
    const next = [...get().groups, group];
    set({ groups: next });
    persistGroups(next);
    log.info('sessionGroups', 'Session group created', { id, name, agentId });
    return id;
  },

  renameGroup: (groupId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = get().groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g));
    set({ groups: next });
    persistGroups(next);
    log.info('sessionGroups', 'Session group renamed', { groupId, name: trimmed });
  },

  deleteGroup: (groupId: string) => {
    const next = get().groups.filter((g) => g.id !== groupId);
    set({ groups: next });
    persistGroups(next);
    log.info('sessionGroups', 'Session group deleted', { groupId });
  },

  addTopicToGroup: (groupId: string, topicKey: string) => {
    // Enforce single-group invariant: remove from any existing group first
    let groups = removeTopicFromAllGroups(get().groups, topicKey);
    groups = groups.map((g) => {
      if (g.id !== groupId) return g;
      if (g.topicKeys.includes(topicKey)) return g;
      return { ...g, topicKeys: [...g.topicKeys, topicKey] };
    });
    set({ groups });
    persistGroups(groups);
  },

  removeTopicFromGroup: (groupId: string, topicKey: string) => {
    const next = get().groups.map((g) => {
      if (g.id !== groupId) return g;
      return { ...g, topicKeys: g.topicKeys.filter((k) => k !== topicKey) };
    });
    set({ groups: next });
    persistGroups(next);
  },

  moveTopicToGroup: (topicKey: string, targetGroupId: string | null) => {
    let groups = removeTopicFromAllGroups(get().groups, topicKey);
    if (targetGroupId) {
      groups = groups.map((g) => {
        if (g.id !== targetGroupId) return g;
        return { ...g, topicKeys: [...g.topicKeys, topicKey] };
      });
    }
    set({ groups });
    persistGroups(groups);
  },

  reorderGroups: (groupIds: string[]) => {
    const next = get().groups.map((g) => {
      const idx = groupIds.indexOf(g.id);
      if (idx === -1) return g;
      return { ...g, sortOrder: idx };
    });
    set({ groups: next });
    persistGroups(next);
  },

  getGroupsForAgent: (agentId: string): SessionGroup[] => {
    return get()
      .groups.filter((g) => g.agentId === agentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  getGroupForTopic: (topicKey: string): SessionGroup | undefined => {
    return get().groups.find((g) => g.topicKeys.includes(topicKey));
  },
}));
