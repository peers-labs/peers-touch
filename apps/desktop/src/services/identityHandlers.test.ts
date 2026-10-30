import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IdentityChangePayload, IdentityTransition } from './identityPipeline';

const mocks = vi.hoisted(() => ({
  authenticated: true,
  currentActorPtid: 'ptid:peer:alice' as string | null,
  handlers: new Map<string, (payload: IdentityChangePayload & Partial<Pick<IdentityTransition, 'previousScope'>>) => Promise<void>>(),
  invalidate: vi.fn(),
  storage: vi.fn(),
  sessionReset: vi.fn(),
  socialReset: vi.fn(),
  notificationReset: vi.fn(),
  navigationBadgeReset: vi.fn(),
  accountReset: vi.fn(),
  chatReset: vi.fn(),
  toolReset: vi.fn(),
  sidebarReset: vi.fn(),
  globalContextReset: vi.fn(),
  restoreSession: vi.fn(),
}));

vi.mock('./identityPipeline', () => ({
  registerIdentityHandler: (
    name: string,
    handler: (payload: IdentityChangePayload) => Promise<void>,
  ) => {
    mocks.handlers.set(name, handler);
  },
}));

vi.mock('./desktop_api', () => ({
  AuthCommandException: class AuthCommandException extends Error {},
}));

vi.mock('../store/session', () => ({
  useSessionStore: {
    getState: () => ({
      authenticated: mocks.authenticated,
      currentUser: mocks.currentActorPtid
        ? { actorPtid: mocks.currentActorPtid }
        : null,
      reset: mocks.sessionReset,
      restoreSession: mocks.restoreSession,
    }),
  },
}));

vi.mock('../store/socialChat', () => ({
  useSocialChatStore: {
    getState: () => ({ reset: mocks.socialReset }),
  },
}));

vi.mock('../store/notification', () => ({
  useNotificationStore: {
    getState: () => ({ reset: mocks.notificationReset }),
  },
}));

vi.mock('../store/navigationBadges', () => ({
  useNavigationBadgeStore: {
    getState: () => ({ reset: mocks.navigationBadgeReset }),
  },
}));

vi.mock('../store/accountIdentity', () => ({
  useAccountIdentityStore: {
    getState: () => ({ reset: mocks.accountReset }),
  },
}));

vi.mock('../store/chat', () => ({
  useChatStore: {
    getState: () => ({ reset: mocks.chatReset }),
  },
}));

vi.mock('../runtimes/toolRuntime', () => ({
  toolRuntime: {
    reset: mocks.toolReset,
  },
}));

vi.mock('../store/sidebar', () => ({
  useSidebarStore: {
    getState: () => ({ reset: mocks.sidebarReset }),
  },
}));

vi.mock('../kernel/global-context/store', () => ({
  useGlobalContextStore: {
    getState: () => ({ reset: mocks.globalContextReset }),
  },
}));

vi.mock('../storage/desktopClientStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/desktopClientStorage')>();
  return {
  ...actual,
  createDesktopClientStorageRuntime: (scope: unknown) => {
    mocks.storage(scope);
    return ({
    kernel: {
      invalidateDomains: mocks.invalidate,
    },
  });
  },
  };
});

vi.mock('../store/settings', () => ({
  useSettingsStore: { getState: () => ({ resetPersonalization: vi.fn() }) },
}));
vi.mock('../i18n', () => ({ resetPersonalizedLanguage: vi.fn(async () => undefined) }));

await import('./identityHandlers');

describe('identity handler actor-scoped projection cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticated = true;
    mocks.currentActorPtid = 'ptid:peer:alice';
  });

  it('clears actor-scoped stores before switching accounts', async () => {
    const handler = mocks.handlers.get('clear-zustand-stores');
    expect(handler).toBeDefined();

    const payload: IdentityChangePayload = {
      reason: 'switch',
      actorPtid: 'ptid:peer:bob',
      loginMethod: 'password',
    };
    await handler?.(payload);

    expect(mocks.sessionReset).toHaveBeenCalledOnce();
    expect(mocks.socialReset).toHaveBeenCalledOnce();
    expect(mocks.notificationReset).toHaveBeenCalledOnce();
    expect(mocks.navigationBadgeReset).toHaveBeenCalledOnce();
    expect(mocks.chatReset).toHaveBeenCalledOnce();
    expect(mocks.toolReset).toHaveBeenCalledOnce();
  });

  it('preserves actor-scoped stores when unlocking the same account', async () => {
    const handler = mocks.handlers.get('clear-zustand-stores');
    expect(handler).toBeDefined();

    const payload: IdentityChangePayload = {
      reason: 'unlock',
      actorPtid: 'ptid:peer:alice',
      loginMethod: 'password',
    };
    await handler?.(payload);

    expect(mocks.sessionReset).not.toHaveBeenCalled();
    expect(mocks.socialReset).not.toHaveBeenCalled();
    expect(mocks.notificationReset).not.toHaveBeenCalled();
    expect(mocks.navigationBadgeReset).not.toHaveBeenCalled();
  });

  it('does not restore a switched account twice', async () => {
    const handler = mocks.handlers.get('refresh-current-session');
    expect(handler).toBeDefined();

    await handler?.({
      reason: 'switch',
      actorPtid: 'ptid:peer:bob',
      loginMethod: 'password',
    });

    expect(mocks.restoreSession).not.toHaveBeenCalled();
  });

  it('preserves an already activated login session', async () => {
    const handler = mocks.handlers.get('refresh-current-session');
    expect(handler).toBeDefined();

    await handler?.({
      reason: 'login',
      actorPtid: 'ptid:peer:alice',
      loginMethod: 'password',
    });

    expect(mocks.restoreSession).not.toHaveBeenCalled();
  });

  it('does not restore a PIN-unlocked session twice', async () => {
    mocks.authenticated = false;
    mocks.currentActorPtid = null;
    const handler = mocks.handlers.get('refresh-current-session');
    expect(handler).toBeDefined();

    await handler?.({
      reason: 'unlock',
      actorPtid: 'ptid:peer:alice',
      loginMethod: 'password',
    });

    expect(mocks.restoreSession).not.toHaveBeenCalled();
  });

  it.each(['logout', 'revoked', 'switch'] as const)('deletes only the outgoing Station and actor on %s', async (reason) => {
    await mocks.handlers.get('clear-client-storage-caches')?.({
      reason, actorPtid: reason === 'logout' ? null : 'ptid:peer:bob', loginMethod: null,
      previousScope: { actorPtid: 'ptid:peer:alice', stationPeerId: 'station-a', sessionEpoch: 1 },
    });
    expect(mocks.storage).toHaveBeenCalledExactlyOnceWith({ ptid: 'ptid:peer:alice', stationPeerId: 'station-a' });
    expect(mocks.invalidate).toHaveBeenCalledWith(expect.arrayContaining(['config.preference']));
  });

  it('preserves preferences on same-actor unlock and never clears app scope', async () => {
    const handler = mocks.handlers.get('clear-client-storage-caches');
    await handler?.({
      reason: 'unlock', actorPtid: 'ptid:peer:alice', loginMethod: null,
      previousScope: { actorPtid: 'ptid:peer:alice', stationPeerId: 'station-a', sessionEpoch: 1 },
    });
    await handler?.({ reason: 'logout', actorPtid: null, loginMethod: null, previousScope: null });
    expect(mocks.storage).not.toHaveBeenCalled();
  });

  it('hard-deletes outgoing preferences while preserving another actor and L3 registry', async () => {
    const rows = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      get length() { return rows.size; },
      key: (index: number) => [...rows.keys()][index] ?? null,
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => { rows.set(key, value); },
      removeItem: (key: string) => { rows.delete(key); },
    } });
    try {
      const actual = await vi.importActual<typeof import('../storage/desktopClientStorage')>('../storage/desktopClientStorage');
      const outgoing = actual.createDesktopClientStorageRuntime({ ptid: 'ptid:peer:alice', stationPeerId: 'station-a' });
      const other = actual.createDesktopClientStorageRuntime({ ptid: 'ptid:peer:bob', stationPeerId: 'station-a' });
      const app = actual.createDesktopAppStorageRuntime();
      await outgoing.repositories.chatPreferences.write('language', { language: 'zh-CN' });
      await other.repositories.chatPreferences.write('language', { language: 'en' });
      await app.repositories.stationRegistry.write('active', { station: 'station-a' });
      mocks.invalidate.mockImplementationOnce((domains) => outgoing.kernel.invalidateDomains(domains));
      await mocks.handlers.get('clear-client-storage-caches')?.({
        reason: 'logout', actorPtid: null, loginMethod: null,
        previousScope: { actorPtid: 'ptid:peer:alice', stationPeerId: 'station-a', sessionEpoch: 1 },
      });
      expect(await outgoing.repositories.chatPreferences.readValue('language')).toBeNull();
      expect(await other.repositories.chatPreferences.readValue('language')).toEqual({ language: 'en' });
      expect(await app.repositories.stationRegistry.readValue('active')).toEqual({ station: 'station-a' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
