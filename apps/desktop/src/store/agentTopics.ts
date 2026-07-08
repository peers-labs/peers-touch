import { createDesktopStore } from './createDesktopStore';
import { chatService, type Session } from '../services/chat-service';
import { useAgentStore } from './agent';
import { log } from '../utils/logger';
import { resolveI18nValue } from '../i18n/index';

export type TopicTitleState = 'untitled' | 'manual' | 'generating' | 'generated' | 'failed';

export interface AgentTopic extends Session {
  titleState: TopicTitleState;
  previousTitle?: string;
  titleError?: string;
  titleUpdatedAt?: string;
}

interface TopicTitleHistory {
  previousTitle: string;
  generatedTitle: string;
  generatedAt: string;
}

interface AgentTopicState {
  topicsByAgentId: Record<string, AgentTopic[]>;
  activeAgentId: string;
  loadingAgentIds: Record<string, boolean>;
  generatingTitleKeys: Record<string, boolean>;
  titleHistoryByKey: Record<string, TopicTitleHistory>;
  lastError?: string;

  getTopicsForAgent: (agentId: string) => AgentTopic[];
  loadTopicsForAgent: (agentId: string, reason?: string) => Promise<AgentTopic[]>;
  reconcileSelectedAgentTopics: (reason?: string) => Promise<void>;
  upsertTopics: (agentId: string, sessions: Session[]) => void;
  createDraftTopic: (agentId: string, agentName: string, title: string) => AgentTopic;
  deleteTopic: (key: string) => Promise<void>;
  renameTopic: (key: string, title: string) => Promise<void>;
  smartRenameTopic: (key: string) => Promise<{ title: string }>;
  revertGeneratedTitle: (key: string) => Promise<void>;
  duplicateTopic: (key: string) => Promise<void>;
}

function toISODate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function normalizeTopic(session: Session, previous?: AgentTopic): AgentTopic {
  const title = resolveI18nValue(session.title)?.trim() || '';
  return {
    ...session,
    title,
    created_at: toISODate(session.created_at),
    updated_at: toISODate(session.updated_at),
    titleState: previous?.titleState ?? (title ? 'manual' : 'untitled'),
    previousTitle: previous?.previousTitle,
    titleError: previous?.titleError,
    titleUpdatedAt: previous?.titleUpdatedAt,
  };
}

function replaceTopic(
  topicsByAgentId: Record<string, AgentTopic[]>,
  key: string,
  update: (topic: AgentTopic) => AgentTopic,
): Record<string, AgentTopic[]> {
  let changed = false;
  const next: Record<string, AgentTopic[]> = {};
  for (const [agentId, topics] of Object.entries(topicsByAgentId)) {
    next[agentId] = topics.map((topic) => {
      if (topic.key !== key) return topic;
      changed = true;
      return update(topic);
    });
  }
  return changed ? next : topicsByAgentId;
}

function removeTopic(
  topicsByAgentId: Record<string, AgentTopic[]>,
  key: string,
): Record<string, AgentTopic[]> {
  const next: Record<string, AgentTopic[]> = {};
  for (const [agentId, topics] of Object.entries(topicsByAgentId)) {
    next[agentId] = topics.filter((topic) => topic.key !== key);
  }
  return next;
}

function findSelectedAgentId(): string {
  const { agents, selectedAgent } = useAgentStore.getState();
  return agents.find((agent) => agent.name === selectedAgent)?.id || '';
}

export const useAgentTopicStore = createDesktopStore<AgentTopicState>('agentTopics', (set, get) => ({
  topicsByAgentId: {},
  activeAgentId: '',
  loadingAgentIds: {},
  generatingTitleKeys: {},
  titleHistoryByKey: {},

  getTopicsForAgent: (agentId: string) => get().topicsByAgentId[agentId] || [],

  loadTopicsForAgent: async (agentId: string, reason = 'manual') => {
    if (!agentId) return [];
    log.info('agentTopics', 'loading agent topics', { agentId, reason });
    set((state) => ({
      activeAgentId: agentId,
      loadingAgentIds: { ...state.loadingAgentIds, [agentId]: true },
      lastError: undefined,
    }));
    try {
      const sessions = await chatService.listAgentSessions(agentId);
      const existingByKey = new Map((get().topicsByAgentId[agentId] || []).map((topic) => [topic.key, topic]));
      const topics = sessions.map((session) => normalizeTopic(session, existingByKey.get(session.key)));
      set((state) => ({
        topicsByAgentId: { ...state.topicsByAgentId, [agentId]: topics },
        loadingAgentIds: { ...state.loadingAgentIds, [agentId]: false },
      }));
      return topics;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('agentTopics', 'failed to load agent topics', { agentId, reason, error: message });
      set((state) => ({
        loadingAgentIds: { ...state.loadingAgentIds, [agentId]: false },
        lastError: message,
      }));
      return [];
    }
  },

  reconcileSelectedAgentTopics: async (reason = 'reconcile') => {
    const agentId = findSelectedAgentId();
    if (!agentId) return;
    await get().loadTopicsForAgent(agentId, reason);
  },

  upsertTopics: (agentId: string, sessions: Session[]) => {
    if (!agentId) return;
    set((state) => {
      const existing = new Map((state.topicsByAgentId[agentId] || []).map((topic) => [topic.key, topic]));
      for (const session of sessions) {
        existing.set(session.key, normalizeTopic(session, existing.get(session.key)));
      }
      return {
        activeAgentId: agentId,
        topicsByAgentId: { ...state.topicsByAgentId, [agentId]: Array.from(existing.values()) },
      };
    });
  },

  createDraftTopic: (agentId: string, agentName: string, title: string) => {
    const now = new Date().toISOString();
    const key = `agent:${agentName}:${Date.now()}`;
    const topic: AgentTopic = {
      id: key,
      key,
      agent_name: agentName,
      title,
      message_count: 0,
      created_at: now,
      updated_at: now,
      titleState: 'untitled',
    };
    set((state) => ({
      activeAgentId: agentId,
      topicsByAgentId: {
        ...state.topicsByAgentId,
        [agentId]: [topic, ...(state.topicsByAgentId[agentId] || [])],
      },
    }));
    return topic;
  },

  deleteTopic: async (key: string) => {
    const before = get().topicsByAgentId;
    set((state) => ({ topicsByAgentId: removeTopic(state.topicsByAgentId, key) }));
    try {
      await chatService.deleteSession(key);
    } catch (error) {
      set({ topicsByAgentId: before });
      throw error;
    }
  },

  renameTopic: async (key: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const before = get().topicsByAgentId;
    set((state) => ({
      topicsByAgentId: replaceTopic(state.topicsByAgentId, key, (topic) => ({
        ...topic,
        title: nextTitle,
        titleState: 'manual',
        previousTitle: topic.title,
        titleError: undefined,
        titleUpdatedAt: new Date().toISOString(),
      })),
    }));
    try {
      await chatService.renameSession(key, nextTitle);
    } catch (error) {
      set({ topicsByAgentId: before });
      throw error;
    }
  },

  smartRenameTopic: async (key: string) => {
    const before = get().topicsByAgentId;
    let previousTitle = '';
    set((state) => ({
      generatingTitleKeys: { ...state.generatingTitleKeys, [key]: true },
      topicsByAgentId: replaceTopic(state.topicsByAgentId, key, (topic) => {
        previousTitle = topic.title;
        return { ...topic, titleState: 'generating', titleError: undefined };
      }),
    }));
    try {
      const result = await chatService.smartRenameSession(key);
      const generatedAt = new Date().toISOString();
      set((state) => ({
        generatingTitleKeys: { ...state.generatingTitleKeys, [key]: false },
        titleHistoryByKey: {
          ...state.titleHistoryByKey,
          [key]: { previousTitle, generatedTitle: result.title, generatedAt },
        },
        topicsByAgentId: replaceTopic(state.topicsByAgentId, key, (topic) => ({
          ...topic,
          title: result.title,
          titleState: 'generated',
          previousTitle,
          titleError: undefined,
          titleUpdatedAt: generatedAt,
        })),
      }));
      return { title: result.title };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        generatingTitleKeys: { ...state.generatingTitleKeys, [key]: false },
        topicsByAgentId: replaceTopic(before, key, (topic) => ({
          ...topic,
          titleState: 'failed',
          titleError: message,
        })),
      }));
      throw error;
    }
  },

  revertGeneratedTitle: async (key: string) => {
    const history = get().titleHistoryByKey[key];
    if (!history) return;
    await get().renameTopic(key, history.previousTitle);
    set((state) => {
      const nextHistory = { ...state.titleHistoryByKey };
      delete nextHistory[key];
      return { titleHistoryByKey: nextHistory };
    });
  },

  duplicateTopic: async (key: string) => {
    await chatService.duplicateSession(key);
    const agentId = get().activeAgentId || findSelectedAgentId();
    if (agentId) await get().loadTopicsForAgent(agentId, 'duplicate');
  },
}));
