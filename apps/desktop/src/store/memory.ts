import { create } from 'zustand';
import { api, type Memory, type Persona, type ScoredMemory, type MemoryStats } from '../services/desktop_api';
import { log } from '../utils/logger';

interface MemoryState {
  memories: Memory[];
  total: number;
  loading: boolean;
  layer: string | undefined;
  page: number;
  pageSize: number;
  editingMemoryId: string | null;
  editingContent: string;
  persona: Persona | null;
  stats: MemoryStats | null;
}

interface MemoryActions {
  loadMemories: (params?: {
    layer?: string;
    page?: number;
    page_size?: number;
    agent_id?: string;
    period?: '24h' | '7d' | '30d' | '90d';
  }) => Promise<void>;
  searchMemories: (query: string, opts?: {
    layers?: string[];
    limit?: number;
    agent_id?: string;
  }) => Promise<ScoredMemory[]>;
  deleteMemory: (id: string) => Promise<void>;
  updateMemory: (id: string, content: string) => Promise<void>;
  setEditingMemory: (id: string | null) => void;
  setEditingContent: (content: string) => void;
  setLayer: (layer: string | undefined) => void;
  setPage: (page: number) => void;
  loadPersona: (agentId?: string) => Promise<void>;
  loadStats: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

type MemoryStore = MemoryState & MemoryActions;

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  memories: [],
  total: 0,
  loading: false,
  layer: undefined,
  page: 1,
  pageSize: 20,
  editingMemoryId: null,
  editingContent: '',
  persona: null,
  stats: null,

  loadMemories: async (params) => {
    const { layer, page, pageSize } = get();
    set({ loading: true });
    try {
      const result = await api.listMemories({
        layer: params?.layer ?? layer,
        page: params?.page ?? page,
        page_size: params?.page_size ?? pageSize,
        agent_id: params?.agent_id,
        period: params?.period,
      });
      set({
        memories: result.memories,
        total: result.total,
        loading: false,
      });
    } catch (err) {
      log.error('memory', 'loadMemories failed', err);
      set({ loading: false });
    }
  },

  searchMemories: async (query, opts) => {
    try {
      const result = await api.searchMemories(
        query,
        opts?.layers,
        opts?.limit,
        opts?.agent_id,
      );
      return result.results;
    } catch (err) {
      log.error('memory', 'searchMemories failed', err);
      return [];
    }
  },

  deleteMemory: async (id) => {
    const { memories } = get();
    const previous = memories;
    set({ memories: memories.filter((m) => m.id !== id) });
    try {
      await api.deleteMemory(id);
    } catch (err) {
      log.error('memory', 'deleteMemory failed', err);
      set({ memories: previous });
      throw err;
    }
  },

  updateMemory: async (id, content) => {
    const { memories } = get();
    const previous = memories;
    const contentObj: Record<string, unknown> = { text: content };
    set({
      memories: memories.map((m) => (m.id === id ? { ...m, content: contentObj } : m)),
      editingMemoryId: null,
      editingContent: '',
    });
    try {
      await api.updateMemory(id, content);
    } catch (err) {
      log.error('memory', 'updateMemory failed', err);
      set({ memories: previous });
      throw err;
    }
  },

  setEditingMemory: (id) => {
    const { memories } = get();
    const memory = id ? memories.find((m) => m.id === id) : null;
    const text = memory?.content
      ? (typeof memory.content === 'string' ? memory.content : (memory.content as Record<string, unknown>).text as string ?? '')
      : '';
    set({
      editingMemoryId: id,
      editingContent: text,
    });
  },

  setEditingContent: (content) => set({ editingContent: content }),

  setLayer: (layer) => set({ layer, page: 1 }),

  setPage: (page) => set({ page }),

  loadPersona: async (agentId) => {
    try {
      const result = await api.getPersona(agentId);
      set({ persona: result.persona });
    } catch (err) {
      log.error('memory', 'loadPersona failed', err);
    }
  },

  loadStats: async () => {
    try {
      const result = await api.getMemoryStats();
      set({ stats: result });
    } catch (err) {
      log.error('memory', 'loadStats failed', err);
    }
  },

  refreshAll: async () => {
    const { loadMemories, loadStats } = get();
    await Promise.all([loadMemories(), loadStats()]);
  },
}));
