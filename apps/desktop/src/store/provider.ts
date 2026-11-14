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
import { useSessionStore } from './session';
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
  listError: boolean;
  detailLoading: boolean;
  detailError: boolean;
  readinessById: Record<string, ProviderReadiness>;
  runtimeDefault: RuntimeDefaultSelection | null;
  defaultStatus: 'idle' | 'loading' | 'ready' | 'error';
  defaultSaving: boolean;
  personalProvidersEnabled: boolean;
  managementMode: 'authorized' | 'personal';
  setManagementMode: (mode: 'authorized' | 'personal') => Promise<void>;
  reset: () => void;

  // P0: per-provider operation tracking for optimistic UX
  providerLoadingIds: Set<string>;
  loadProviders: () => Promise<void>;
  loadRuntimeDefault: () => Promise<void>;
  setRuntimeDefault: (providerId: string, modelId: string) => Promise<RuntimeDefaultSelection>;
  selectProvider: (id: string) => Promise<void>;
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
  refreshAfterMutation: () => Promise<void>;
}

export const useProviderStore = createDesktopStore<ProviderState>('provider', (set, get) => {
  let viewGeneration = 0;
  let listRequest = 0;
  let detailRequest = 0;
  let defaultRequest = 0;
  let resetGeneration = 0;

  function accountOperation() {
    const epoch = useSessionStore.getState().sessionEpoch;
    const generation = resetGeneration;
    const current = () => epoch === useSessionStore.getState().sessionEpoch && generation === resetGeneration;
    const assertCurrent = () => {
      if (!current()) throw new Error('provider.error.accountChanged');
    };
    return { current, assertCurrent };
  }

  function providerOperation() {
    const account = accountOperation();
    const generation = viewGeneration;
    const current = () => account.current() && generation === viewGeneration
      && get().managementMode === 'personal' && get().personalProvidersEnabled;
    const assertCurrent = () => {
      account.assertCurrent();
      if (!current()) throw new Error('provider.error.selectionChanged');
    };
    assertCurrent();
    return { current, assertCurrent };
  }

  function clearView() {
    viewGeneration++;
    detailRequest++;
    return {
      providers: [], selectedId: null, detail: null, detailLoading: false, detailError: false,
      readinessById: {}, providerLoadingIds: new Set<string>(),
    };
  }

  return {
  providers: [],
  selectedId: null,
  detail: null,
  loading: false,
  listError: false,
  detailLoading: false,
  detailError: false,
  readinessById: {},
  runtimeDefault: null,
  defaultStatus: 'idle',
  defaultSaving: false,
  personalProvidersEnabled: false,
  managementMode: 'authorized',
  reset: () => {
    resetGeneration++;
    listRequest++;
    defaultRequest++;
    set({
      ...clearView(), loading: false, listError: false,
      runtimeDefault: null, personalProvidersEnabled: false, managementMode: 'authorized',
      defaultStatus: 'idle', defaultSaving: false,
    });
  },
  setManagementMode: async (mode) => {
    if (mode === 'personal' && !get().personalProvidersEnabled) return;
    if (mode === get().managementMode) return;
    set({ ...clearView(), managementMode: mode, listError: false });
    await get().loadProviders();
  },
  providerLoadingIds: new Set<string>(),

  loadProviders: async () => {
    const account = accountOperation();
    const request = ++listRequest;
    const generation = viewGeneration;
    const mode = get().managementMode;
    const current = () => account.current() && request === listRequest && generation === viewGeneration;
    set({ loading: true, listError: false });
    const defaultRead = get().loadRuntimeDefault();
    try {
      const [authorized, policy] = await Promise.all([
        api.listProviders(),
        api.getProviderPolicy(),
      ]);
      if (!current()) return;
      const personalProvidersEnabled = policy.personal_providers_enabled;
      let providers = authorized;
      if (mode === 'personal' && personalProvidersEnabled) {
        const shared = new Set(authorized.filter((p) => p.owner_scope === 'station').map((p) => p.id));
        providers = (await api.listPersonalProviders()).filter((p) => !shared.has(p.id));
      }
      if (!current()) return;
      const nextMode = personalProvidersEnabled ? mode : 'authorized';
      const changedMode = mode !== nextMode;
      if (changedMode) set(clearView());
      const selectedId = providers.some((p) => p.id === get().selectedId)
        ? get().selectedId : providers[0]?.id ?? null;
      set({
        providers,
        personalProvidersEnabled,
        managementMode: nextMode,
        loading: false,
        readinessById: Object.fromEntries(providers.map((provider) => [provider.id, mapProviderUIStatus(provider)])),
      });
      if (selectedId) {
        await get().selectProvider(selectedId);
      } else {
        detailRequest++;
        set({ selectedId: null, detail: null, detailLoading: false, detailError: false });
      }
    } catch (e) {
      if (!current()) return;
      log.warn('provider', 'Provider projection unavailable');
      set({ ...clearView(), loading: false, listError: true,
        personalProvidersEnabled: false, managementMode: 'authorized' });
    } finally {
      await defaultRead;
    }
  },

  loadRuntimeDefault: async () => {
    if (get().defaultSaving) return;
    const account = accountOperation();
    const request = ++defaultRequest;
    const current = () => account.current() && request === defaultRequest;
    // A background refresh may retain the last known revision; an initial
    // or failed read cannot supply revision zero for a subsequent write.
    if (get().defaultStatus !== 'ready') set({ defaultStatus: 'loading' });
    try {
      const runtimeDefault = await api.getRuntimeDefault();
      if (current()) set({ runtimeDefault, defaultStatus: 'ready' });
    } catch {
      if (current()) set({ runtimeDefault: null, defaultStatus: 'error' });
    }
  },

  setRuntimeDefault: async (providerId, modelId) => {
    const account = accountOperation();
    if (get().defaultSaving) throw new Error('provider.error.defaultSaving');
    if (get().defaultStatus !== 'ready') throw new Error('provider.error.defaultUnavailable');
    const expectedRevision = get().runtimeDefault?.revision ?? 0;
    defaultRequest++;
    set({ defaultSaving: true });
    try {
      const runtimeDefault = await api.setRuntimeDefault(providerId, modelId, expectedRevision);
      account.assertCurrent();
      set({ runtimeDefault, defaultStatus: 'ready' });
      await useAgentStore.getState().loadModels();
      account.assertCurrent();
      return runtimeDefault;
    } catch (error) {
      if (account.current()) {
        set({ defaultSaving: false, defaultStatus: 'loading' });
        await get().loadRuntimeDefault();
      }
      throw error;
    } finally {
      if (account.current()) set({ defaultSaving: false });
    }
  },

  selectProvider: async (id: string) => {
    if (!get().providers.some((p) => p.id === id)) return;
    const account = accountOperation();
    const generation = viewGeneration;
    const request = ++detailRequest;
    const mode = get().managementMode;
    const current = () => account.current() && generation === viewGeneration
      && request === detailRequest && get().selectedId === id;
    set({ selectedId: id, detail: get().detail?.id === id ? get().detail : null,
      detailLoading: true, detailError: false });
    try {
      const detail = await api.getProvider(id, mode === 'personal');
      if (current()) {
        if (detail.id !== id) throw new Error('provider detail identity mismatch');
        set({ detail, detailLoading: false });
      }
    } catch {
      if (current()) {
        log.warn('provider', 'Selected provider projection unavailable');
        set({ detail: null, detailLoading: false, detailError: true });
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
    const operation = providerOperation();
    const selectedDetail = get().detail;
    const detail = selectedDetail?.id === id ? selectedDetail : await api.getProvider(id, true);
    operation.assertCurrent();
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
      operation.assertCurrent();
      await get().refreshAfterMutation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (operation.current()) set((state) => ({
        readinessById: { ...state.readinessById, [id]: { status: 'error', error: message } },
      }));
      throw error;
    }
  },

  updateProviderRuntimeConfig: async (id, runtimeConfig) => {
    const operation = providerOperation();
    const detail = get().detail?.id === id ? get().detail : await api.getProvider(id, true);
    operation.assertCurrent();
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
    const operation = providerOperation();
    set({
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
        providerDetail = await api.getProvider(id, true);
      }
      operation.assertCurrent();
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
      operation.assertCurrent();
      await get().refreshAfterMutation();
    } catch (e) {
      log.error('provider', 'Failed to toggle provider', e);
      throw e;
    } finally {
      if (operation.current()) {
        const loadingIds = new Set(get().providerLoadingIds);
        loadingIds.delete(id);
        set({ providerLoadingIds: loadingIds });
      }
    }
  },

  checkProvider: async (id: string, apiKey?: string, baseUrl?: string, model?: string) => {
    const operation = providerOperation();
    set((state) => ({
      readinessById: { ...state.readinessById, [id]: { status: 'checking' } },
    }));
    try {
      const result = await api.checkProvider(id, { api_key: apiKey, base_url: baseUrl, model });
      operation.assertCurrent();
      if (operation.current()) set((state) => ({
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
      if (operation.current()) set((state) => ({
        readinessById: { ...state.readinessById, [id]: { status: 'error', error: message } },
      }));
      throw error;
    }
  },

  createProvider: async (data) => {
    const operation = providerOperation();
    const created = await api.createProvider(data);
    operation.assertCurrent();
    await get().loadProviders();
    operation.assertCurrent();
    const nextId = created?.provider?.id || data.id;
    await get().selectProvider(nextId);
  },

  deleteProvider: async (id: string) => {
    const operation = providerOperation();
    await api.deleteProvider(id);
    operation.assertCurrent();
    detailRequest++;
    set({ selectedId: null, detail: null, detailLoading: false, detailError: false });
    await get().loadProviders();
    operation.assertCurrent();
    await useAgentStore.getState().loadModels();
  },

  addModel: async (providerId: string, data: ProviderModelCreateData) => {
    const operation = providerOperation();
    await api.addModel(providerId, data);
    operation.assertCurrent();
    await get().refreshAfterMutation();
  },

  updateModel: async (providerId: string, modelId: string, data: ProviderModelConfigInput) => {
    const operation = providerOperation();
    await api.updateModel(providerId, modelId, data);
    operation.assertCurrent();
    await get().refreshAfterMutation();
  },

  deleteModel: async (providerId: string, modelId: string) => {
    const operation = providerOperation();
    await api.deleteModel(providerId, modelId);
    operation.assertCurrent();
    await get().refreshAfterMutation();
  },

  discoverModels: async (providerId: string) => {
    const operation = providerOperation();
    const result = await api.discoverModels(providerId);
    operation.assertCurrent();
    await get().refreshAfterMutation();
    return {
      count: Array.isArray(result.models) ? result.models.length : 0,
      observedAt: result.observed_at,
    };
  },

  toggleModel: async (providerId: string, modelId: string, enabled: boolean) => {
    const operation = providerOperation();
    await api.toggleModel(providerId, modelId, enabled);
    operation.assertCurrent();
    await get().refreshAfterMutation();
  },

  refreshAfterMutation: async () => {
    const operation = providerOperation();
    await get().loadProviders();
    operation.assertCurrent();
    await useAgentStore.getState().loadModels();
  },
  };
});
