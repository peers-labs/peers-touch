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
const profileStore = vi.hoisted(() => ({
  refresh: vi.fn(),
  reset: vi.fn(),
  subscribe: vi.fn(),
}));
const refreshCurrentProfile = vi.hoisted(() => vi.fn());
const pushDevicesStore = vi.hoisted(() => ({ refresh: vi.fn(), reset: vi.fn() }));

vi.mock('../store/pushDevices', () => ({
  usePushDevicesStore: { getState: () => pushDevicesStore },
}));

vi.mock('../store/profile', () => ({
  useProfileStore: {
    getState: () => profileStore,
    subscribe: profileStore.subscribe,
  },
}));
vi.mock('../kernel/identityRuntime', () => ({
  identityRuntime: { refreshCurrentProfile },
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
    profileStore.refresh.mockResolvedValue(undefined);
    profileStore.subscribe.mockReturnValue(() => undefined);
    refreshCurrentProfile.mockResolvedValue(undefined);
    pushDevicesStore.refresh.mockResolvedValue(undefined);
  });

  it('bootstraps settings-owned projection data', async () => {
    await settingsRuntime.bootstrap(null);

    expect(settingsStore.refreshActiveAccount).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadAgents).toHaveBeenCalledTimes(1);
    expect(settingsStore.loadChatPreferences).toHaveBeenCalledTimes(1);
    expect(settingsStore.refreshDevices).toHaveBeenCalledTimes(1);
    expect(settingsStore.refreshNotificationPreferences).toHaveBeenCalledTimes(1);
    expect(profileStore.refresh).toHaveBeenCalledTimes(1);
    expect(pushDevicesStore.refresh).toHaveBeenCalledTimes(1);
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
    expect(pushDevicesStore.reset).toHaveBeenCalledTimes(2);
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

  it('reconciles shell identity once per canonical profile revision', () => {
    let subscriber: ((state: {
      profile: { peers_touch: { network_id: string }; profile_revision: number } | null;
    }) => void) | undefined;
    profileStore.subscribe.mockImplementation((next) => {
      subscriber = next;
      return () => undefined;
    });
    settingsRuntime.install();
    const state = { profile: { peers_touch: { network_id: 'ptid:self' }, profile_revision: 7 } };
    subscriber?.(state);
    subscriber?.(state);
    expect(refreshCurrentProfile).toHaveBeenCalledTimes(1);
    subscriber?.({ profile: { ...state.profile, profile_revision: 8 } });
    expect(refreshCurrentProfile).toHaveBeenCalledTimes(2);
    settingsRuntime.teardown();
  });
});
