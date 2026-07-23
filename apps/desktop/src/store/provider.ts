import { createDesktopStore } from './createDesktopStore';
import { api, type ProviderListItem, type ProviderDetail } from '../services/desktop_api';
import { log } from '../utils/logger';
import { useAgentStore } from './agent';

interface ProviderState {
  providers: ProviderListItem[];
  selectedId: string | null;
  detail: ProviderDetail | null;
  loading: boolean;

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
}

export const useProviderStore = createDesktopStore<ProviderState>('provider', (set, get) => ({
  providers: [],
  selectedId: null,
  detail: null,
  loading: false,

  loadProviders: async () => {
    try {
      const providers = await api.listProviders();
      set({ providers });
      if (!get().selectedId && providers.length > 0) {
        get().selectProvider(providers[0].id);
      }
    } catch (e) {
      log.error('provider', 'Failed to load providers', e);
    }
  },

  selectProvider: async (id: string, skipLoading?: boolean) => {
    set({ selectedId: id });
    if (!skipLoading) {
      set({ loading: true });
    }
    try {
      const detail = await api.getProvider(id);
      if (get().selectedId === id) {
        set({ detail, loading: false });
      }
    } catch (e) {
      log.error('provider', 'Failed to load provider detail', e);
      if (get().selectedId === id) {
        set({ loading: false });
      }
    }
  },

  updateProvider: async (id: string, apiKey: string, baseUrl: string, enabled: boolean) => {
    await api.updateProvider(id, { api_key: apiKey, base_url: baseUrl, enabled });
    await get().loadProviders();
    if (get().selectedId === id) {
      await get().selectProvider(id, true);
    }
    useAgentStore.getState().loadModels();
  },

  toggleProvider: async (id: string, enabled: boolean) => {
    const currentDetail = get().detail;
    let apiKey = '';
    let baseUrl = '';

    if (currentDetail && currentDetail.id === id) {
      apiKey = currentDetail.api_key || '';
      baseUrl = currentDetail.base_url || '';
    } else {
      const d = await api.getProvider(id);
      apiKey = d.api_key || '';
      baseUrl = d.base_url || '';
    }

    await api.updateProvider(id, { api_key: apiKey, base_url: baseUrl, enabled });
    await get().loadProviders();
    if (get().selectedId === id) {
      await get().selectProvider(id, true);
    }
    useAgentStore.getState().loadModels();
  },

  checkProvider: async (id: string, apiKey?: string, baseUrl?: string, model?: string) => {
    return api.checkProvider(id, { api_key: apiKey, base_url: baseUrl, model });
  },

  createProvider: async (data) => {
    const created = await api.createProvider(data);
    await get().loadProviders();
    const nextId = created?.provider?.id || data.id;
    get().selectProvider(nextId);
  },

  deleteProvider: async (id: string) => {
    await api.deleteProvider(id);
    set({ selectedId: null, detail: null });
    await get().loadProviders();
    useAgentStore.getState().loadModels();
  },

  addModel: async (providerId: string, data: { id: string; display_name?: string; type?: string; context_window?: number; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean; enabled?: boolean }) => {
    await api.addModel(providerId, data);
    if (get().selectedId === providerId) {
      await get().selectProvider(providerId, true);
    }
    useAgentStore.getState().loadModels();
  },

  updateModel: async (providerId: string, modelId: string, data: { display_name?: string; type?: string; context_window?: number; enabled?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean }) => {
    await api.updateModel(providerId, modelId, data);
    if (get().selectedId === providerId) {
      await get().selectProvider(providerId, true);
    }
    useAgentStore.getState().loadModels();
  },

  deleteModel: async (providerId: string, modelId: string) => {
    await api.deleteModel(providerId, modelId);
    if (get().selectedId === providerId) {
      await get().selectProvider(providerId, true);
    }
    useAgentStore.getState().loadModels();
  },

  fetchRemoteModels: async (providerId: string, apiKey?: string, baseUrl?: string) => {
    return api.fetchRemoteModels(providerId, { api_key: apiKey, base_url: baseUrl });
  },

  toggleModel: async (providerId: string, modelId: string, enabled: boolean) => {
    await api.toggleModel(providerId, modelId, enabled);
    if (get().selectedId === providerId) {
      await get().selectProvider(providerId, true);
    }
    useAgentStore.getState().loadModels();
  },

  toggleAllModels: async (providerId: string, enabled: boolean) => {
    await api.toggleAllModels(providerId, enabled);
    if (get().selectedId === providerId) {
      await get().selectProvider(providerId, true);
    }
    useAgentStore.getState().loadModels();
  },
}));
