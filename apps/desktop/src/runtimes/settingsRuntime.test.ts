import { beforeEach, describe, expect, it, vi } from 'vitest';

const settingsStore = vi.hoisted(() => ({
  refreshActiveAccount: vi.fn(),
  loadAgents: vi.fn(),
  loadChatPreferences: vi.fn(),
  refreshDevices: vi.fn(),
  refreshNotificationPreferences: vi.fn(),
  clearSessionProjection: vi.fn(),
}));

const sessionStore = vi.hoisted(() => ({
  subscribe: vi.fn(),
  getState: vi.fn(),
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
    settingsStore.refreshDevices.mockResolvedValue(undefined);
    settingsStore.refreshNotificationPreferences.mockResolvedValue(undefined);
    sessionStore.subscribe.mockReturnValue(() => undefined);
    sessionStore.getState.mockReturnValue({ authenticated: true });
  });

  it('bootstraps settings-owned projection data', async () => {
    await settingsRuntime.bootstrap(null);

    expect(settingsStore.refreshActiveAccount).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadAgents).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadChatPreferences).toHaveBeenCalledTimes(1);
    expect(settingsStore.refreshDevices).toHaveBeenCalledTimes(1);
    expect(settingsStore.refreshNotificationPreferences).toHaveBeenCalledTimes(1);
  });

  it('reconciles settings-owned projection data', async () => {
    await settingsRuntime.reconcile?.('test');

    expect(settingsStore.refreshActiveAccount).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadAgents).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadChatPreferences).toHaveBeenCalledTimes(1);
    expect(settingsStore.refreshDevices).toHaveBeenCalledTimes(1);
    expect(settingsStore.refreshNotificationPreferences).toHaveBeenCalledTimes(1);
  });

  it('clears actor-scoped projections when the authenticated actor leaves', () => {
    let subscriber: ((state: {
      authenticated: boolean;
      currentUser: { actorPtid: string } | null;
      sessionEpoch: number;
    }) => void) | undefined;
    sessionStore.subscribe.mockImplementation((next) => {
      subscriber = next;
      return () => undefined;
    });

    settingsRuntime.install();
    subscriber?.({
      authenticated: true,
      currentUser: { actorPtid: 'ptid:alice' },
      sessionEpoch: 1,
    });
    subscriber?.({
      authenticated: false,
      currentUser: null,
      sessionEpoch: 2,
    });

    expect(settingsStore.refreshDevices).toHaveBeenCalledTimes(1);
    expect(settingsStore.refreshNotificationPreferences).toHaveBeenCalledTimes(1);
    expect(settingsStore.clearSessionProjection).toHaveBeenCalledTimes(2);
    settingsRuntime.teardown();
  });

  it('clears the previous actor before refreshing a direct account switch', () => {
    let subscriber: ((state: {
      authenticated: boolean;
      currentUser: { actorPtid: string } | null;
      sessionEpoch: number;
    }) => void) | undefined;
    sessionStore.subscribe.mockImplementation((next) => {
      subscriber = next;
      return () => undefined;
    });

    settingsRuntime.install();
    subscriber?.({
      authenticated: true,
      currentUser: { actorPtid: 'ptid:alice' },
      sessionEpoch: 1,
    });
    vi.clearAllMocks();

    subscriber?.({
      authenticated: true,
      currentUser: { actorPtid: 'ptid:bob' },
      sessionEpoch: 2,
    });

    expect(settingsStore.clearSessionProjection).toHaveBeenCalledBefore(
      settingsStore.refreshActiveAccount,
    );
    expect(settingsStore.refreshDevices).toHaveBeenCalledTimes(1);
    expect(settingsStore.refreshNotificationPreferences).toHaveBeenCalledTimes(1);
    settingsRuntime.teardown();
  });
});
