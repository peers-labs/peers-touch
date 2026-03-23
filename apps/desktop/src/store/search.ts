import { create } from 'zustand';
import { api } from '../services/api';
import type {
  SearchSource,
  SearchResultItem,
} from '../services/api';

interface SearchState {
  query: string;
  activeSource: string;
  sources: SearchSource[];
  sourceResults: Record<string, SearchResultItem[]>;
  loadingPerSource: Record<string, boolean>;
  aiAnswer: string;
  aiSources: Array<{ title: string; source: string; url: string }>;
  aiLoading: boolean;

  setQuery: (q: string) => void;
  setActiveSource: (source: string) => void;
  loadSources: () => Promise<void>;
  searchAll: (query: string) => void;
  search: (query: string, source: string) => Promise<void>;
  aiSearch: (query: string, web?: boolean) => Promise<void>;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  activeSource: 'all',
  sources: [],
  sourceResults: {},
  loadingPerSource: {},
  aiAnswer: '',
  aiSources: [],
  aiLoading: false,

  setQuery: (q) => set({ query: q }),

  setActiveSource: (source) => {
    const { query, sourceResults, aiAnswer, loadingPerSource } = get();
    set({ activeSource: source });

    if (!query) return;

    if (source === 'ai') {
      if (!aiAnswer && !get().aiLoading) {
        get().aiSearch(query, false);
      }
      return;
    }

    if (source === 'all') {
      const hasAny = Object.keys(sourceResults).length > 0;
      const isAnyLoading = Object.values(loadingPerSource).some(Boolean);
      if (!hasAny && !isAnyLoading) {
        get().searchAll(query);
      }
      return;
    }

    if (sourceResults[source] !== undefined || loadingPerSource[source]) {
      return;
    }
    get().search(query, source);
  },

  loadSources: async () => {
    try {
      const sources = await api.searchSources();
      set({ sources });
    } catch {
      // keep empty
    }
  },

  searchAll: (query: string) => {
    if (!query.trim()) return;
    const { sources, query: prevQuery } = get();
    const isNewQuery = query !== prevQuery;

    const newLoading: Record<string, boolean> = {};
    for (const s of sources) newLoading[s.id] = true;

    set({
      query,
      ...(isNewQuery ? { sourceResults: {}, aiAnswer: '', aiSources: [] } : {}),
      loadingPerSource: newLoading,
    });

    for (const source of sources) {
      if (!isNewQuery && get().sourceResults[source.id] !== undefined) {
        set((state) => ({
          loadingPerSource: { ...state.loadingPerSource, [source.id]: false },
        }));
        continue;
      }

      api.search(query, source.id, 20)
        .then((res) => {
          if (get().query !== query) return;
          set((state) => ({
            sourceResults: { ...state.sourceResults, [source.id]: res.results || [] },
            loadingPerSource: { ...state.loadingPerSource, [source.id]: false },
          }));
        })
        .catch(() => {
          if (get().query !== query) return;
          set((state) => ({
            sourceResults: { ...state.sourceResults, [source.id]: [] },
            loadingPerSource: { ...state.loadingPerSource, [source.id]: false },
          }));
        });
    }
  },

  search: async (query: string, source: string) => {
    if (!query.trim()) return;
    const prevQuery = get().query;
    const isNewQuery = query !== prevQuery;

    set({
      query,
      ...(isNewQuery ? { sourceResults: {}, aiAnswer: '', aiSources: [] } : {}),
      loadingPerSource: { ...get().loadingPerSource, [source]: true },
    });

    try {
      const res = await api.search(query, source, 20);
      if (get().query !== query) return;
      set((state) => ({
        sourceResults: { ...state.sourceResults, [source]: res.results || [] },
        loadingPerSource: { ...state.loadingPerSource, [source]: false },
      }));
    } catch {
      if (get().query !== query) return;
      set((state) => ({
        sourceResults: { ...state.sourceResults, [source]: [] },
        loadingPerSource: { ...state.loadingPerSource, [source]: false },
      }));
    }
  },

  aiSearch: async (query, web = false) => {
    if (!query.trim()) return;
    const prevQuery = get().query;
    const isNewQuery = query !== prevQuery;
    set({
      aiLoading: true,
      query,
      aiAnswer: '',
      aiSources: [],
      ...(isNewQuery ? { sourceResults: {}, loadingPerSource: {} } : {}),
    });
    try {
      const res = await api.aiSearch(query, web);
      if (get().query !== query) return;
      set({ aiAnswer: res.answer, aiSources: res.sources, aiLoading: false });
    } catch {
      if (get().query !== query) return;
      set({ aiAnswer: 'Search failed. Please check your provider configuration.', aiSources: [], aiLoading: false });
    }
  },

  reset: () =>
    set({
      query: '',
      activeSource: 'all',
      sourceResults: {},
      loadingPerSource: {},
      aiAnswer: '',
      aiSources: [],
      aiLoading: false,
    }),
}));
