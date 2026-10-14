import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  accountGetActive: vi.fn(),
  notificationPreferences: vi.fn(),
  notificationPreferencesUpdate: vi.fn(),
}));
const session = vi.hoisted(() => ({
  actorPtid: 'ptid:self' as string | null,
  sessionEpoch: 1,
}));

vi.mock('../services/desktop_api', () => ({
  api,
}));

vi.mock('../services/tool-service', () => ({
  toolService: {
    list: vi.fn(),
  },
}));

vi.mock('./session', () => ({
  currentAuthenticatedActorPtid: () => session.actorPtid,
  useSessionStore: {
    getState: () => ({
      sessionEpoch: session.sessionEpoch,
    }),
  },
}));

import { useSettingsStore } from './settings';

describe('settings notification preference projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.actorPtid = 'ptid:self';
    session.sessionEpoch = 1;
    useSettingsStore.setState({
      notificationPreferences: [],
      notificationPreferencesRevision: 0,
      notificationPreferencesLoading: false,
      notificationPreferencesError: null,
      notificationPreferenceSavingCategory: null,
    });
  });

  it('loads the Station-authored preference snapshot', async () => {
    api.notificationPreferences.mockResolvedValue({
      preferences: [{
        actorPtid: 'ptid:self',
        category: 1,
        enabled: true,
        pushEnabled: true,
        soundEnabled: false,
        updatedAt: '2026-10-14T00:00:00Z',
      }],
      notificationPreferencesRevision: 7,
    });

    await useSettingsStore.getState().refreshNotificationPreferences();

    expect(useSettingsStore.getState()).toMatchObject({
      notificationPreferencesRevision: 7,
      notificationPreferencesLoading: false,
      notificationPreferencesError: null,
    });
    expect(useSettingsStore.getState().notificationPreferences).toHaveLength(1);
  });

  it('applies the authoritative conflict snapshot and reports the conflict', async () => {
    useSettingsStore.setState({
      notificationPreferences: [{
        actorPtid: 'ptid:self',
        category: 1,
        enabled: true,
        pushEnabled: true,
        soundEnabled: true,
        updatedAt: '2026-10-14T00:00:00Z',
      }],
      notificationPreferencesRevision: 7,
    });
    api.notificationPreferencesUpdate.mockResolvedValue({
      outcome: 'NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_CONFLICT',
      snapshot: {
        preferences: [{
          actorPtid: 'ptid:self',
          category: 1,
          enabled: false,
          pushEnabled: false,
          soundEnabled: false,
          updatedAt: '2026-10-14T00:01:00Z',
        }],
        notificationPreferencesRevision: 8,
      },
    });

    await expect(
      useSettingsStore.getState().updateNotificationPreference(1, {
        enabled: true,
        pushEnabled: false,
        soundEnabled: true,
      }),
    ).rejects.toThrow('notification.preferences.conflict');

    expect(api.notificationPreferencesUpdate).toHaveBeenCalledWith({
      updates: [{
        category: 1,
        enabled: true,
        pushEnabled: false,
        soundEnabled: true,
      }],
      observedRevision: 7,
    });
    expect(useSettingsStore.getState()).toMatchObject({
      notificationPreferencesRevision: 8,
      notificationPreferencesError: 'notification.preferences.conflict',
      notificationPreferenceSavingCategory: null,
    });
    expect(useSettingsStore.getState().notificationPreferences[0]?.enabled).toBe(false);
  });

  it('does not let a stale refresh roll back a newer mutation snapshot', async () => {
    let resolveRefresh!: (value: {
      preferences: Array<{
        actorPtid: string;
        category: number;
        enabled: boolean;
        pushEnabled: boolean;
        soundEnabled: boolean;
        updatedAt: string;
      }>;
      notificationPreferencesRevision: number;
    }) => void;
    api.notificationPreferences.mockReturnValueOnce(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    useSettingsStore.setState({
      notificationPreferences: [{
        actorPtid: 'ptid:self',
        category: 1,
        enabled: true,
        pushEnabled: true,
        soundEnabled: true,
        updatedAt: '2026-10-14T00:00:00Z',
      }],
      notificationPreferencesRevision: 7,
    });
    api.notificationPreferencesUpdate.mockResolvedValueOnce({
      outcome: 'NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_APPLIED',
      snapshot: {
        preferences: [{
          actorPtid: 'ptid:self',
          category: 1,
          enabled: false,
          pushEnabled: false,
          soundEnabled: false,
          updatedAt: '2026-10-14T00:02:00Z',
        }],
        notificationPreferencesRevision: 8,
      },
    });

    const refresh = useSettingsStore.getState().refreshNotificationPreferences();
    await useSettingsStore.getState().updateNotificationPreference(1, {
      enabled: false,
      pushEnabled: false,
      soundEnabled: false,
    });
    resolveRefresh({
      preferences: [{
        actorPtid: 'ptid:self',
        category: 1,
        enabled: true,
        pushEnabled: true,
        soundEnabled: true,
        updatedAt: '2026-10-14T00:01:00Z',
      }],
      notificationPreferencesRevision: 7,
    });
    await refresh;

    expect(useSettingsStore.getState()).toMatchObject({
      notificationPreferencesRevision: 8,
      notificationPreferencesLoading: false,
    });
    expect(useSettingsStore.getState().notificationPreferences[0]?.enabled).toBe(false);
  });

  it('drops a notification snapshot from the previous authenticated actor', async () => {
    let resolveSnapshot!: (value: {
      preferences: Array<{
        actorPtid: string;
        category: number;
        enabled: boolean;
        pushEnabled: boolean;
        soundEnabled: boolean;
        updatedAt: string;
      }>;
      notificationPreferencesRevision: number;
    }) => void;
    api.notificationPreferences.mockReturnValue(new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));

    const refresh = useSettingsStore.getState().refreshNotificationPreferences();
    session.actorPtid = 'ptid:other';
    session.sessionEpoch += 1;
    resolveSnapshot({
      preferences: [{
        actorPtid: 'ptid:self',
        category: 1,
        enabled: true,
        pushEnabled: true,
        soundEnabled: true,
        updatedAt: '2026-10-14T00:02:00Z',
      }],
      notificationPreferencesRevision: 9,
    });
    await refresh;

    expect(useSettingsStore.getState().notificationPreferences).toEqual([]);
    expect(useSettingsStore.getState().notificationPreferencesRevision).toBe(0);
  });

  it('drops an active-account snapshot from the previous authenticated actor', async () => {
    let resolveAccount!: (value: {
      id: string;
      provider: string;
      provider_user_id: string;
      name: string;
      email: string;
      avatar_url: string;
      profile_url: string;
      created_at: string;
      last_login_at: string;
      has_pin: boolean;
      has_session: boolean;
    }) => void;
    api.accountGetActive.mockReturnValue(new Promise((resolve) => {
      resolveAccount = resolve;
    }));
    useSettingsStore.setState({ activeAccount: null });

    const refresh = useSettingsStore.getState().refreshActiveAccount();
    session.actorPtid = 'ptid:other';
    session.sessionEpoch += 1;
    resolveAccount({
      id: 'account-alice',
      provider: 'password',
      provider_user_id: 'ptid:self',
      name: 'Alice',
      email: '',
      avatar_url: '',
      profile_url: '',
      created_at: '',
      last_login_at: '',
      has_pin: false,
      has_session: true,
    });
    await refresh;

    expect(useSettingsStore.getState().activeAccount).toBeNull();
  });

  it('clears every actor-scoped settings projection atomically', () => {
    useSettingsStore.setState({
      activeAccount: {
        id: 'account-alice',
        provider: 'password',
        provider_user_id: 'ptid:self',
        name: 'Alice',
        email: '',
        avatar_url: '',
        profile_url: '',
        created_at: '',
        last_login_at: '',
        has_pin: false,
        has_session: true,
      },
      currentDeviceId: 'device-1',
      notificationPreferencesRevision: 8,
    });

    useSettingsStore.getState().clearSessionProjection();

    expect(useSettingsStore.getState()).toMatchObject({
      activeAccount: null,
      devices: [],
      currentDeviceId: '',
      notificationPreferences: [],
      notificationPreferencesRevision: 0,
    });
  });
});
