import { createDesktopStore } from './createDesktopStore';
import { chatService, type Session } from '../services/chat-service';
import { api } from '../services/desktop_api';
import { useAgentStore } from './agent';
import { log } from '../utils/logger';
import { resolveI18nValue } from '../i18n/index';
import { createAgentDraftKey, isAgentDraftKey } from './agentDraft';

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

export type TopicSearchMode = 'title' | 'content';
export type TopicSortBy = 'updated_at' | 'created_at';

interface AgentTopicState {
  topicsByAgentId: Record<string, AgentTopic[]>;
  activeAgentId: string;
  loadingAgentIds: Record<string, boolean>;
  generatingTitleKeys: Record<string, boolean>;
  titleHistoryByKey: Record<string, TopicTitleHistory>;
  lastError?: string;
  searchQuery: string;
  searchMode: TopicSearchMode;
  sortBy: TopicSortBy;

  getTopicsForAgent: (agentId: string) => AgentTopic[];
  loadTopicsForAgent: (agentId: string, reason?: string) => Promise<AgentTopic[]>;
  reconcileSelectedAgentTopics: (reason?: string) => Promise<void>;
  upsertTopics: (agentId: string, sessions: Session[]) => void;
  createDraftTopic: (agentId: string, agentName: string, title: string) => AgentTopic;
  promoteDraftTopic: (agentId: string, draftKey: string, session: Session) => void;
  deleteTopic: (key: string) => Promise<void>;
  renameTopic: (key: string, title: string) => Promise<void>;
  smartRenameTopic: (key: string) => Promise<{ title: string }>;
  revertGeneratedTitle: (key: string) => Promise<void>;
  duplicateTopic: (key: string) => Promise<void>;
  pinTopic: (key: string, pinned: boolean) => Promise<void>;
  favoriteTopic: (key: string, favorite: boolean) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: TopicSearchMode) => void;
  setSortBy: (sortBy: TopicSortBy) => void;
  resetProjection: () => void;
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
    pinned: session.pinned ?? previous?.pinned ?? false,
    favorite: session.favorite ?? previous?.favorite ?? false,
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
  searchQuery: '',
  searchMode: 'title',
  sortBy: 'updated_at',

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
      const drafts = (get().topicsByAgentId[agentId] || []).filter((topic) =>
        isAgentDraftKey(topic.key),
      );
      const topics = [
        ...drafts,
        ...sessions.map((session) => normalizeTopic(session, existingByKey.get(session.key))),
      ];
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
    const key = createAgentDraftKey(agentId);
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

  promoteDraftTopic: (agentId: string, draftKey: string, session: Session) => {
    if (!agentId || !isAgentDraftKey(draftKey)) return;
    set((state) => {
      const topics = state.topicsByAgentId[agentId] || [];
      const draftIndex = topics.findIndex((topic) => topic.key === draftKey);
      const existingRealIndex = topics.findIndex((topic) => topic.key === session.key);
      if (draftIndex < 0 && existingRealIndex >= 0) return state;

      const draft = draftIndex >= 0 ? topics[draftIndex] : undefined;
      const promoted = normalizeTopic(
        {
          ...session,
          id: session.key,
          key: session.key,
          title: session.title || draft?.title || '',
          created_at: draft?.created_at || session.created_at,
        },
        draft,
      );
      const next = topics.filter(
        (topic) => topic.key !== draftKey && topic.key !== session.key,
      );
      next.splice(draftIndex >= 0 ? draftIndex : 0, 0, promoted);
      return {
        activeAgentId: agentId,
        topicsByAgentId: { ...state.topicsByAgentId, [agentId]: next },
      };
    });
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

  pinTopic: async (key: string, pinned: boolean) => {
    const before = get().topicsByAgentId;
    set((state) => ({
      topicsByAgentId: replaceTopic(state.topicsByAgentId, key, (topic) => ({
        ...topic,
        pinned,
      })),
    }));
    try {
      await api.pinSession(key, pinned);
    } catch (error) {
      log.warn('agentTopics', 'Failed to persist pin state, rolling back', { key, pinned, error: String(error) });
      set({ topicsByAgentId: before });
    }
  },

  favoriteTopic: async (key: string, favorite: boolean) => {
    const before = get().topicsByAgentId;
    set((state) => ({
      topicsByAgentId: replaceTopic(state.topicsByAgentId, key, (topic) => ({
        ...topic,
        favorite,
      })),
    }));
    try {
      await api.favoriteSession(key, favorite);
    } catch (error) {
      log.warn('agentTopics', 'Failed to persist favorite state, rolling back', { key, favorite, error: String(error) });
      set({ topicsByAgentId: before });
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  setSearchMode: (mode: TopicSearchMode) => {
    set({ searchMode: mode });
  },

  setSortBy: (sortBy: TopicSortBy) => {
    set({ sortBy });
  },

  resetProjection: () => {
    set({
      topicsByAgentId: {},
      activeAgentId: '',
      loadingAgentIds: {},
      generatingTitleKeys: {},
      titleHistoryByKey: {},
      lastError: undefined,
      searchQuery: '',
      searchMode: 'title',
      sortBy: 'updated_at',
    });
  },
}));
