import { createDesktopStore } from './createDesktopStore';
import { api, type ProviderListItem, type ProviderDetail } from '../services/desktop_api';
import { log } from '../utils/logger';
import { useAgentStore } from './agent';

export type ProviderReadinessStatus =
  | 'loading'
  | 'unconfigured'
  | 'saving'
  | 'checking'
  | 'ready'
  | 'invalid'
  | 'unavailable'
  | 'error';

export interface ProviderReadiness {
  status: ProviderReadinessStatus;
  error?: string;
}

interface ProviderState {
  providers: ProviderListItem[];
  selectedId: string | null;
  detail: ProviderDetail | null;
  loading: boolean;
  readinessById: Record<string, ProviderReadiness>;

  // P0: per-provider operation tracking for optimistic UX
  providerLoadingIds: Set<string>;
  // P0: detail cache to avoid flicker on re-selection
  detailCache: Map<string, ProviderDetail>;

  loadProviders: () => Promise<void>;
  selectProvider: (id: string, skipLoading?: boolean) => Promise<void>;
  updateProvider: (id: string, apiKey: string, baseUrl: string, enabled: boolean) => Promise<void>;
  toggleProvider: (id: string, enabled: boolean) => Promise<void>;
  checkProvider: (id: string, apiKey?: string, baseUrl?: string, model?: string) => Promise<{ ok: boolean; error?: string }>;
  createProvider: (data: { id: string; name: string; description?: string; logo?: string; base_url: string; api_key?: string }) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  addModel: (providerId: string, data: { id: string; display_name?: string; type?: string; context_window?: number; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean; enabled?: boolean }) => Promise<void>;
  updateModel: (providerId: string, modelId: string, data: { display_name?: string; type?: string; context_window?: number; enabled?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean }) => Promise<void>;
  deleteModel: (providerId: string, modelId: string) => Promise<void>;
  fetchRemoteModels: (providerId: string, apiKey?: string, baseUrl?: string) => Promise<{ ok: boolean; models?: string[]; error?: string }>;
  toggleModel: (providerId: string, modelId: string, enabled: boolean) => Promise<void>;
  toggleAllModels: (providerId: string, enabled: boolean) => Promise<void>;
  // P0: consolidated post-mutation refresh
  refreshAfterMutation: (providerId?: string) => Promise<void>;
}

export function mapProviderUIStatus(provider: ProviderListItem): ProviderReadiness {
  if (!provider.enabled) {
    return { status: 'unavailable' };
  }
  if (provider.requires_api_key && !provider.has_api_key) {
    return { status: 'unconfigured' };
  }
  return { status: 'ready' };
}

export const useProviderStore = createDesktopStore<ProviderState>('provider', (set, get) => ({
  providers: [],
  selectedId: null,
  detail: null,
  loading: false,
  readinessById: {},
  providerLoadingIds: new Set<string>(),
  detailCache: new Map<string, ProviderDetail>(),

  loadProviders: async () => {
    set({ loading: true });
    try {
      const providers = await api.listProviders();
      set({
        providers,
        loading: false,
        readinessById: Object.fromEntries(providers.map((provider) => [provider.id, mapProviderUIStatus(provider)])),
      });
      if (!get().selectedId && providers.length > 0) {
        void get().selectProvider(providers[0].id);
      }
    } catch (e) {
      log.error('provider', 'Failed to load providers', e);
      set({ loading: false });
    }
  },

  selectProvider: async (id: string, skipLoading?: boolean) => {
    set({ selectedId: id });

    // Serve cached detail instantly to avoid flicker on re-selection
    const cached = get().detailCache.get(id);
    if (cached) {
      set({ detail: cached });
    }

    if (!skipLoading && !cached) {
      set({ loading: true });
    }
    try {
      const detail = await api.getProvider(id);
      if (get().selectedId === id) {
        // Update cache
        const nextCache = new Map(get().detailCache);
        nextCache.set(id, detail);
        set({ detail, loading: false, detailCache: nextCache });
      }
    } catch (e) {
      log.error('provider', 'Failed to load provider detail', e);
      if (get().selectedId === id) {
        set({ loading: false });
      }
    }
  },

  updateProvider: async (id: string, apiKey: string, baseUrl: string, enabled: boolean) => {
    const detail = get().detail;
    const version = detail?.id === id ? detail.version : 0;
    set((state) => ({
      readinessById: { ...state.readinessById, [id]: { status: 'saving' } },
    }));
    try {
      await api.updateProvider(id, { api_key: apiKey, base_url: baseUrl, enabled, version });
      await get().refreshAfterMutation(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        readinessById: { ...state.readinessById, [id]: { status: 'error', error: message } },
      }));
      throw error;
    }
  },

  toggleProvider: async (id: string, enabled: boolean) => {
    // Optimistic update: immediately reflect in providers list
    const prevProviders = get().providers;
    set({
      providers: prevProviders.map((p) => (p.id === id ? { ...p, enabled } : p)),
      providerLoadingIds: new Set([...get().providerLoadingIds, id]),
    });

    try {
      const currentDetail = get().detail;
      let apiKey = '';
      let baseUrl = '';
      let version = 0;

      if (currentDetail && currentDetail.id === id) {
        apiKey = currentDetail.api_key || '';
        baseUrl = currentDetail.base_url || '';
        version = currentDetail.version;
      } else {
        const d = await api.getProvider(id);
        apiKey = d.api_key || '';
        baseUrl = d.base_url || '';
        version = d.version;
      }

      await api.updateProvider(id, { api_key: apiKey, base_url: baseUrl, enabled, version });
      await get().refreshAfterMutation(id);
    } catch (e) {
      // Revert optimistic update on failure
      set({ providers: prevProviders });
      log.error('provider', 'Failed to toggle provider', e);
      throw e;
    } finally {
      const loadingIds = new Set(get().providerLoadingIds);
      loadingIds.delete(id);
      set({ providerLoadingIds: loadingIds });
    }
  },

  checkProvider: async (id: string, apiKey?: string, baseUrl?: string, model?: string) => {
    set((state) => ({
      readinessById: { ...state.readinessById, [id]: { status: 'checking' } },
    }));
    try {
      const result = await api.checkProvider(id, { api_key: apiKey, base_url: baseUrl, model });
      set((state) => ({
        readinessById: {
          ...state.readinessById,
          [id]: result.ok ? { status: 'ready' } : { status: 'invalid', error: result.error },
        },
      }));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        readinessById: { ...state.readinessById, [id]: { status: 'error', error: message } },
      }));
      throw error;
    }
  },

  createProvider: async (data) => {
    const created = await api.createProvider(data);
    await get().loadProviders();
    const nextId = created?.provider?.id || data.id;
    get().selectProvider(nextId);
  },

  deleteProvider: async (id: string) => {
    await api.deleteProvider(id);
    // Clear from cache
    const nextCache = new Map(get().detailCache);
    nextCache.delete(id);
    set({ selectedId: null, detail: null, detailCache: nextCache });
    await get().loadProviders();
    await useAgentStore.getState().loadModels();
  },

  addModel: async (providerId: string, data: { id: string; display_name?: string; type?: string; context_window?: number; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean; enabled?: boolean }) => {
    await api.addModel(providerId, data);
    await get().refreshAfterMutation(providerId);
  },

  updateModel: async (providerId: string, modelId: string, data: { display_name?: string; type?: string; context_window?: number; enabled?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean }) => {
    await api.updateModel(providerId, modelId, data);
    await get().refreshAfterMutation(providerId);
  },

  deleteModel: async (providerId: string, modelId: string) => {
    await api.deleteModel(providerId, modelId);
    const detail = get().detail;
    if (detail && detail.id === providerId) {
      set({ detail: { ...detail, models: detail.models.filter((m) => m.id !== modelId) } });
    }
    await useAgentStore.getState().loadModels();
  },

  fetchRemoteModels: async (providerId: string, apiKey?: string, baseUrl?: string) => {
    return api.fetchRemoteModels(providerId, { api_key: apiKey, base_url: baseUrl });
  },

  toggleModel: async (providerId: string, modelId: string, enabled: boolean) => {
    await api.toggleModel(providerId, modelId, enabled);
    await get().refreshAfterMutation(providerId);
  },

  toggleAllModels: async (providerId: string, enabled: boolean) => {
    await api.toggleAllModels(providerId, enabled);
    await get().refreshAfterMutation(providerId);
  },

  refreshAfterMutation: async (providerId?: string) => {
    await get().loadProviders();
    const activeId = providerId ?? get().selectedId;
    if (activeId && get().selectedId === activeId) {
      await get().selectProvider(activeId, true);
    }
    await useAgentStore.getState().loadModels();
  },
}));
