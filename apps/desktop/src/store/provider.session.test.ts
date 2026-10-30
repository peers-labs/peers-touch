import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderDetail, ProviderListItem } from '../services/desktop_api';

const identity = vi.hoisted(() => ({ sessionEpoch: 1 }));
const api = vi.hoisted(() => ({
  getProvider: vi.fn(), updateProvider: vi.fn(), listProviders: vi.fn(),
  getRuntimeDefault: vi.fn(), getProviderPolicy: vi.fn(), checkProvider: vi.fn(),
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
