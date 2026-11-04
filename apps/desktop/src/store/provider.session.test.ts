import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderDetail, ProviderListItem } from '../services/desktop_api';

const identity = vi.hoisted(() => ({ sessionEpoch: 1 }));
const api = vi.hoisted(() => ({
  getProvider: vi.fn(), updateProvider: vi.fn(), listProviders: vi.fn(),
  getRuntimeDefault: vi.fn(), getProviderPolicy: vi.fn(), checkProvider: vi.fn(),
  listPersonalProviders: vi.fn(), setRuntimeDefault: vi.fn(),
}));
const loadModels = vi.hoisted(() => vi.fn());
vi.mock('./session', () => ({ useSessionStore: { getState: () => identity } }));
vi.mock('./agent', () => ({ useAgentStore: { getState: () => ({ loadModels }) } }));
vi.mock('../services/desktop_api', () => ({ api }));

import { useProviderStore } from './provider';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const row = {
  id: 'ark', name: 'Ark', description: '', enabled: true, builtin: true,
  has_api_key: true, requires_api_key: true, credential_status: 'configured',
  runtime_kind: 'http', version: 1,
} satisfies ProviderListItem;
const runtimeConfig = { default_model: '', startup_args: [], environment: {}, timeout_seconds: 0 };
const detail: ProviderDetail = {
  ...row, api_key: '', base_url: 'https://provider.test', models: [], home_url: '',
  api_key_url: '', default_base_url: '', cli_command: '', workspace_policy: '', show_checker: true,
  runtime_config: runtimeConfig, default_runtime_config: runtimeConfig,
  adapter_capabilities: {
    model_discovery: false, startup_args: false, environment: false,
    configurable_timeout: false, runtime_capabilities: [],
  },
};

function switchAccount() {
  identity.sessionEpoch++;
  useProviderStore.getState().reset();
}

describe('Provider operations across account changes', () => {
  beforeEach(() => {
    identity.sessionEpoch = 1;
    vi.resetAllMocks();
    useProviderStore.getState().reset();
    useProviderStore.setState({ providers: [row], personalProvidersEnabled: true, managementMode: 'personal' });
  });

  it('does not dispatch a mutation under the new account after an old detail read', async () => {
    const read = deferred<ProviderDetail>();
    api.getProvider.mockReturnValue(read.promise);
    const result = useProviderStore.getState().updateProvider('ark', '', detail.base_url, true)
      .catch((error: Error) => error.message);
    switchAccount();
    read.resolve(detail);
    expect(await result).toBe('provider.error.accountChanged');
    expect(api.updateProvider).not.toHaveBeenCalled();
    expect(useProviderStore.getState().readinessById).toEqual({});
  });

  it('does not roll back the new account when an old optimistic mutation fails', async () => {
    const mutation = deferred<void>();
    useProviderStore.setState({ detail });
    api.updateProvider.mockReturnValue(mutation.promise);
    const result = useProviderStore.getState().toggleProvider('ark', false).catch(() => undefined);
    switchAccount();
    const newRow = { ...row, id: 'personal-b', name: 'Personal B' };
    useProviderStore.setState({ providers: [newRow] });
    mutation.reject(new Error('request failed'));
    await result;
    expect(useProviderStore.getState().providers).toEqual([newRow]);
    expect(useProviderStore.getState().providerLoadingIds.size).toBe(0);
    expect(api.listProviders).not.toHaveBeenCalled();
  });

  it('does not refresh or select models after an old mutation succeeds', async () => {
    const mutation = deferred<void>();
    useProviderStore.setState({ detail });
    api.updateProvider.mockReturnValue(mutation.promise);
    const result = useProviderStore.getState().updateProvider('ark', '', detail.base_url, false)
      .catch((error: Error) => error.message);
    switchAccount();
    mutation.resolve();
    expect(await result).toBe('provider.error.accountChanged');
    expect(api.listProviders).not.toHaveBeenCalled();
    expect(loadModels).not.toHaveBeenCalled();
    expect(useProviderStore.getState().detail).toBeNull();
  });

  it('discards old availability and defaults without selecting a Provider', async () => {
    const list = deferred<ProviderListItem[]>();
    api.listProviders.mockReturnValue(list.promise);
    api.getRuntimeDefault.mockResolvedValue({ providerId: 'ark', modelId: 'a', revision: 1 });
    api.getProviderPolicy.mockResolvedValue({ personal_providers_enabled: true });
    const result = useProviderStore.getState().loadProviders();
    switchAccount();
    list.resolve([row]);
    await result;
    expect(useProviderStore.getState().providers).toEqual([]);
    expect(useProviderStore.getState().runtimeDefault).toBeNull();
    expect(api.getProvider).not.toHaveBeenCalled();
  });
});

describe('Provider projection freshness', () => {
  beforeEach(() => {
    identity.sessionEpoch = 1;
    vi.resetAllMocks();
    useProviderStore.getState().reset();
    api.listProviders.mockResolvedValue([row]);
    api.listPersonalProviders.mockResolvedValue([row]);
    api.getProvider.mockResolvedValue(detail);
    api.getProviderPolicy.mockResolvedValue({ personal_providers_enabled: false });
    api.getRuntimeDefault.mockResolvedValue({ providerId: '', modelId: '', revision: 0 });
  });

  it('does not equate authorization with a successful health check', async () => {
    await useProviderStore.getState().loadProviders();
    expect(useProviderStore.getState().readinessById.ark.status).toBe('unverified');
  });

  it('refreshes a selected detail when one model loses authorization', async () => {
    const model = { id: 'allowed', display_name: 'Allowed', enabled: true };
    api.getProvider.mockResolvedValueOnce({ ...detail, models: [model] });
    await useProviderStore.getState().loadProviders();
    expect(useProviderStore.getState().detail?.models).toHaveLength(1);
    await useProviderStore.getState().loadProviders();
    expect(useProviderStore.getState().detail?.models).toEqual([]);
  });

  it('clears a failed selected detail and permits retry', async () => {
    await useProviderStore.getState().loadProviders();
    api.getProvider.mockRejectedValueOnce(new Error('private backend detail'));
    await useProviderStore.getState().selectProvider(row.id);
    expect(useProviderStore.getState().detail).toBeNull();
    expect(useProviderStore.getState().detailError).toBe(true);
    await useProviderStore.getState().selectProvider(row.id);
    expect(useProviderStore.getState().detail).toEqual(detail);
    expect(useProviderStore.getState().detailError).toBe(false);
  });

  it('fails closed when the list or policy cannot be read', async () => {
    await useProviderStore.getState().loadProviders();
    api.getProviderPolicy.mockRejectedValueOnce(new Error('policy unavailable'));
    await useProviderStore.getState().loadProviders();
    const state = useProviderStore.getState();
    expect(state.providers).toEqual([]);
    expect(state.detail).toBeNull();
    expect(state.personalProvidersEnabled).toBe(false);
    expect(state.listError).toBe(true);
  });

  it('discards an older list that completes after a newer list', async () => {
    const old = deferred<ProviderListItem[]>();
    api.listProviders.mockReturnValueOnce(old.promise).mockResolvedValueOnce([]);
    const first = useProviderStore.getState().loadProviders();
    await useProviderStore.getState().loadProviders();
    old.resolve([row]);
    await first;
    expect(useProviderStore.getState().providers).toEqual([]);
    expect(api.getProvider).not.toHaveBeenCalled();
  });

  it('does not resurrect detail after leaving and returning to the same view', async () => {
    useProviderStore.setState({ providers: [row], personalProvidersEnabled: true });
    api.getProviderPolicy.mockResolvedValue({ personal_providers_enabled: true });
    const old = deferred<ProviderDetail>();
    api.getProvider.mockReturnValueOnce(old.promise);
    const first = useProviderStore.getState().selectProvider(row.id);
    await useProviderStore.getState().setManagementMode('personal');
    await useProviderStore.getState().setManagementMode('authorized');
    old.resolve({ ...detail, name: 'Stale detail' });
    await first;
    expect(useProviderStore.getState().detail?.name).toBe('Ark');
  });

  it('discards older reads of the same selected detail', async () => {
    useProviderStore.setState({ providers: [row] });
    const old = deferred<ProviderDetail>();
    api.getProvider.mockReturnValueOnce(old.promise);
    const first = useProviderStore.getState().selectProvider(row.id);
    await useProviderStore.getState().selectProvider(row.id);
    old.resolve({ ...detail, name: 'Stale detail' });
    await first;
    expect(useProviderStore.getState().detail?.name).toBe('Ark');
  });

  it('discards personal mutation completion after the policy is withdrawn', async () => {
    useProviderStore.setState({
      providers: [row], detail, personalProvidersEnabled: true, managementMode: 'personal',
    });
    const pending = deferred<void>();
    api.updateProvider.mockReturnValue(pending.promise);
    const mutation = useProviderStore.getState().updateProvider(row.id, '', detail.base_url, true)
      .catch((error: Error) => error.message);
    await useProviderStore.getState().loadProviders();
    pending.resolve();
    expect(await mutation).toBe('provider.error.selectionChanged');
    expect(loadModels).not.toHaveBeenCalled();
    expect(useProviderStore.getState().managementMode).toBe('authorized');
  });

  it('does not save a revision-zero default after its read fails', async () => {
    api.getRuntimeDefault.mockRejectedValueOnce(new Error('read failed'));
    await useProviderStore.getState().loadProviders();
    const result = await useProviderStore.getState().setRuntimeDefault('ark', 'allowed')
      .catch((error: Error) => error.message);
    expect(result).toBe('provider.error.defaultUnavailable');
    expect(api.setRuntimeDefault).not.toHaveBeenCalled();
    expect(useProviderStore.getState().providers).toEqual([row]);
  });

  it('serializes default saves and ignores reads started before a save', async () => {
    await useProviderStore.getState().loadProviders();
    const old = deferred<{ providerId: string; modelId: string; revision: number }>();
    api.getRuntimeDefault.mockReturnValueOnce(old.promise);
    const refresh = useProviderStore.getState().loadProviders();
    const pending = deferred<{ providerId: string; modelId: string; revision: number }>();
    api.setRuntimeDefault.mockReturnValue(pending.promise);
    const save = useProviderStore.getState().setRuntimeDefault('ark', 'new');
    const duplicate = await useProviderStore.getState().setRuntimeDefault('ark', 'old')
      .catch((error: Error) => error.message);
    expect(duplicate).toBe('provider.error.defaultSaving');
    pending.resolve({ providerId: 'ark', modelId: 'new', revision: 1 });
    await save;
    old.resolve({ providerId: '', modelId: '', revision: 0 });
    await refresh;
    expect(useProviderStore.getState().runtimeDefault?.modelId).toBe('new');
    expect(api.setRuntimeDefault).toHaveBeenCalledTimes(1);
  });

  it('re-reads the current revision after a rejected default save', async () => {
    await useProviderStore.getState().loadProviders();
    api.setRuntimeDefault.mockRejectedValueOnce(new Error('revision conflict'))
      .mockResolvedValueOnce({ providerId: 'ark', modelId: 'next', revision: 6 });
    api.getRuntimeDefault.mockResolvedValueOnce({ providerId: 'ark', modelId: 'other', revision: 5 });
    await useProviderStore.getState().setRuntimeDefault('ark', 'next').catch(() => undefined);
    await useProviderStore.getState().setRuntimeDefault('ark', 'next');
    expect(api.setRuntimeDefault).toHaveBeenLastCalledWith('ark', 'next', 5);
    expect(useProviderStore.getState().defaultSaving).toBe(false);
  });

  it('discards default save completion and its cleanup across account changes', async () => {
    await useProviderStore.getState().loadProviders();
    const pending = deferred<{ providerId: string; modelId: string; revision: number }>();
    api.setRuntimeDefault.mockReturnValue(pending.promise);
    const save = useProviderStore.getState().setRuntimeDefault('ark', 'next')
      .catch((error: Error) => error.message);
    switchAccount();
    useProviderStore.setState({ defaultSaving: true });
    pending.resolve({ providerId: 'ark', modelId: 'next', revision: 1 });
    expect(await save).toBe('provider.error.accountChanged');
    expect(useProviderStore.getState().runtimeDefault).toBeNull();
    expect(useProviderStore.getState().defaultSaving).toBe(true);
    expect(loadModels).not.toHaveBeenCalled();
  });

  it('invalidates pending reads on reset even if the Session epoch stays the same', async () => {
    const pending = deferred<ProviderListItem[]>();
    api.listProviders.mockReturnValueOnce(pending.promise);
    const read = useProviderStore.getState().loadProviders();
    useProviderStore.getState().reset();
    pending.resolve([row]);
    await read;
    expect(useProviderStore.getState().providers).toEqual([]);
    expect(useProviderStore.getState().defaultStatus).toBe('idle');
  });
});
