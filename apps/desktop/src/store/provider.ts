import { createDesktopStore } from './createDesktopStore';
import {
  api,
  type ProviderDetail,
  type ProviderListItem,
  type ProviderModelConfigInput,
  type ProviderModelCreateData,
  type ProviderRuntimeConfig,
  type RuntimeDefaultSelection,
} from '../services/desktop_api';
import { log } from '../utils/logger';
import { useAgentStore } from './agent';
import {
  mapProviderUIStatus,
  type ProviderReadiness,
} from './providerReadiness';

export {
  isProviderUsable,
  mapProviderUIStatus,
  type ProviderReadiness,
  type ProviderReadinessStatus,
} from './providerReadiness';

interface ProviderState {
  providers: ProviderListItem[];
  selectedId: string | null;
  detail: ProviderDetail | null;
  loading: boolean;
  readinessById: Record<string, ProviderReadiness>;
  runtimeDefault: RuntimeDefaultSelection | null;

  // P0: per-provider operation tracking for optimistic UX
  providerLoadingIds: Set<string>;
  // P0: detail cache to avoid flicker on re-selection
  detailCache: Map<string, ProviderDetail>;

  loadProviders: () => Promise<void>;
  setRuntimeDefault: (providerId: string, modelId: string) => Promise<RuntimeDefaultSelection>;
  selectProvider: (id: string, skipLoading?: boolean) => Promise<void>;
  updateProvider: (
    id: string,
    apiKey: string,
    baseUrl: string,
    enabled: boolean,
    runtimeConfig?: ProviderRuntimeConfig,
  ) => Promise<void>;
  updateProviderRuntimeConfig: (id: string, runtimeConfig: ProviderRuntimeConfig) => Promise<void>;
  toggleProvider: (id: string, enabled: boolean) => Promise<void>;
  checkProvider: (
    id: string,
    apiKey?: string,
    baseUrl?: string,
    model?: string,
  ) => Promise<{ ok: boolean; error?: string; installHint?: string }>;
  createProvider: (data: { id: string; name: string; description?: string; logo?: string; base_url: string; api_key?: string }) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  addModel: (providerId: string, data: ProviderModelCreateData) => Promise<void>;
  updateModel: (providerId: string, modelId: string, data: ProviderModelConfigInput) => Promise<void>;
  deleteModel: (providerId: string, modelId: string) => Promise<void>;
  discoverModels: (providerId: string) => Promise<{ count: number; observedAt?: string }>;
  toggleModel: (providerId: string, modelId: string, enabled: boolean) => Promise<void>;
  // P0: consolidated post-mutation refresh
  refreshAfterMutation: (providerId?: string) => Promise<void>;
}

export const useProviderStore = createDesktopStore<ProviderState>('provider', (set, get) => ({
  providers: [],
  selectedId: null,
  detail: null,
  loading: false,
  readinessById: {},
  runtimeDefault: null,
  providerLoadingIds: new Set<string>(),
  detailCache: new Map<string, ProviderDetail>(),

  loadProviders: async () => {
    set({ loading: true });
    try {
      const [providers, runtimeDefault] = await Promise.all([
        api.listProviders(),
        api.getRuntimeDefault().catch((error) => {
          log.warn('provider', 'Failed to load runtime default', {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }),
      ]);
      set({
        providers,
        runtimeDefault,
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

  setRuntimeDefault: async (providerId, modelId) => {
    const expectedRevision = get().runtimeDefault?.revision ?? 0;
    const runtimeDefault = await api.setRuntimeDefault(
      providerId,
      modelId,
      expectedRevision,
    );
    set({ runtimeDefault });
    await useAgentStore.getState().loadModels();
    return runtimeDefault;
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

  updateProvider: async (
    id: string,
    apiKey: string,
    baseUrl: string,
    enabled: boolean,
    runtimeConfig?: ProviderRuntimeConfig,
  ) => {
    const selectedDetail = get().detail;
    const detail = selectedDetail?.id === id ? selectedDetail : await api.getProvider(id);
    set((state) => ({
      readinessById: { ...state.readinessById, [id]: { status: 'saving' } },
    }));
    try {
      await api.updateProvider(id, {
        api_key: apiKey,
        base_url: baseUrl,
        enabled,
        runtime_config: runtimeConfig
          ?? (detail.runtime_kind === 'cli' ? detail.runtime_config : undefined),
        version: detail.version,
      });
      await get().refreshAfterMutation(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        readinessById: { ...state.readinessById, [id]: { status: 'error', error: message } },
      }));
      throw error;
    }
  },

  updateProviderRuntimeConfig: async (id, runtimeConfig) => {
    const detail = get().detail?.id === id ? get().detail : await api.getProvider(id);
    if (!detail) throw new Error(`Provider not found: ${id}`);
    await get().updateProvider(
      id,
      detail.api_key || '',
      detail.base_url || '',
      detail.enabled,
      runtimeConfig,
    );
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
      let providerDetail: ProviderDetail;
      let apiKey = '';
      let baseUrl = '';

      if (currentDetail && currentDetail.id === id) {
        providerDetail = currentDetail;
      } else {
        providerDetail = await api.getProvider(id);
      }
      apiKey = providerDetail.api_key || '';
      baseUrl = providerDetail.base_url || '';

      await api.updateProvider(id, {
        api_key: apiKey,
        base_url: baseUrl,
        enabled,
        runtime_config: providerDetail.runtime_kind === 'cli'
          ? providerDetail.runtime_config
          : undefined,
        version: providerDetail.version,
      });
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
          [id]: result.ok
            ? { status: 'ready' }
            : { status: 'invalid', error: result.error || result.install_hint },
        },
      }));
      return {
        ok: result.ok,
        error: result.error,
        installHint: result.install_hint,
      };
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

  addModel: async (providerId: string, data: ProviderModelCreateData) => {
    await api.addModel(providerId, data);
    await get().refreshAfterMutation(providerId);
  },

  updateModel: async (providerId: string, modelId: string, data: ProviderModelConfigInput) => {
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

  discoverModels: async (providerId: string) => {
    const result = await api.discoverModels(providerId);
    await get().refreshAfterMutation(providerId);
    return {
      count: Array.isArray(result.models) ? result.models.length : 0,
      observedAt: result.observed_at,
    };
  },

  toggleModel: async (providerId: string, modelId: string, enabled: boolean) => {
    await api.toggleModel(providerId, modelId, enabled);
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
