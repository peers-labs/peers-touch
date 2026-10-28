import { beforeEach, describe, expect, it, vi } from 'vitest';

const settingsStore = vi.hoisted(() => ({
  refreshActiveAccount: vi.fn(),
  loadAgents: vi.fn(),
  loadChatPreferences: vi.fn(),
  loadProviderPreferences: vi.fn(),
  resetPersonalization: vi.fn(),
}));

const sessionStore = vi.hoisted(() => ({
  subscribe: vi.fn(),
}));

const i18n = vi.hoisted(() => ({
  applyPersonalizedLanguage: vi.fn().mockResolvedValue(undefined),
  resetPersonalizedLanguage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../store/settings', () => ({
  useSettingsStore: {
    getState: () => settingsStore,
  },
}));

vi.mock('../store/session', () => ({
  useSessionStore: sessionStore,
}));

vi.mock('../i18n', () => ({
  applyPersonalizedLanguage: i18n.applyPersonalizedLanguage,
  resetPersonalizedLanguage: i18n.resetPersonalizedLanguage,
}));

import { settingsRuntime } from './settingsRuntime';

describe('settingsRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsStore.refreshActiveAccount.mockResolvedValue(undefined);
    settingsStore.loadAgents.mockResolvedValue(undefined);
    settingsStore.loadChatPreferences.mockResolvedValue(undefined);
    settingsStore.loadProviderPreferences.mockResolvedValue(undefined);
    sessionStore.subscribe.mockReturnValue(() => undefined);
  });

  it('is session scoped so its bootstrap runs per authenticated actor', () => {
    expect(settingsRuntime.scope).toBe('session');
  });

  it('bootstraps actor-scoped projection data and applies the actor language', async () => {
    await settingsRuntime.bootstrap('actor-a');

    expect(settingsStore.refreshActiveAccount).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadAgents).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadChatPreferences).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadProviderPreferences).toHaveBeenCalledTimes(1);
    expect(i18n.applyPersonalizedLanguage).toHaveBeenCalledWith('actor-a');
  });

  it('does not apply actor language without an identity', async () => {
    await settingsRuntime.bootstrap(null);

    expect(i18n.applyPersonalizedLanguage).not.toHaveBeenCalled();
  });

  it('tears personalization back to defaults on logout / actor switch', () => {
    settingsRuntime.teardown();

    expect(settingsStore.resetPersonalization).toHaveBeenCalledTimes(1);
    expect(i18n.resetPersonalizedLanguage).toHaveBeenCalledTimes(1);
  });

  it('reconciles settings-owned projection data', async () => {
    await settingsRuntime.reconcile?.('test');

    expect(settingsStore.refreshActiveAccount).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadAgents).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadChatPreferences).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadProviderPreferences).toHaveBeenCalledTimes(1);
  });
});
