import { beforeEach, describe, expect, it, vi } from 'vitest';

const settingsStore = vi.hoisted(() => ({
  refreshActiveAccount: vi.fn(),
  loadAgents: vi.fn(),
  loadChatPreferences: vi.fn(),
}));

const sessionStore = vi.hoisted(() => ({
  subscribe: vi.fn(),
}));

vi.mock('../store/settings', () => ({
  useSettingsStore: {
    getState: () => settingsStore,
  },
}));

vi.mock('../store/session', () => ({
  useSessionStore: sessionStore,
}));

import { settingsRuntime } from './settingsRuntime';

describe('settingsRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsStore.refreshActiveAccount.mockResolvedValue(undefined);
    settingsStore.loadAgents.mockResolvedValue(undefined);
    settingsStore.loadChatPreferences.mockResolvedValue(undefined);
    sessionStore.subscribe.mockReturnValue(() => undefined);
  });

  it('bootstraps settings-owned projection data', async () => {
    await settingsRuntime.bootstrap(null);

    expect(settingsStore.refreshActiveAccount).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadAgents).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadChatPreferences).toHaveBeenCalledTimes(1);
  });

  it('reconciles settings-owned projection data', async () => {
    await settingsRuntime.reconcile?.('test');

    expect(settingsStore.refreshActiveAccount).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadAgents).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadChatPreferences).toHaveBeenCalledTimes(1);
  });
});
