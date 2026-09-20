import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const session = {
    authenticated: true,
    currentUser: {
      actorPtid: 'ptid:person:old',
      name: 'Old',
      email: '',
      loginMethod: 'password',
    } as {
      actorPtid: string;
      name: string;
      email: string;
      loginMethod: string;
    } | null,
  };
  return {
    order: [] as string[],
    session,
    accountSwitch: vi.fn(),
    authValidateToken: vi.fn(),
    accountListRestorable: vi.fn(),
    accountLoad: vi.fn(),
    loginWithPassword: vi.fn(),
    logout: vi.fn(),
    resetSession: vi.fn(),
    runIdentityPipeline: vi.fn(),
    clearLocalIdentityAction: vi.fn(),
  };
});

vi.stubGlobal('window', {
  location: { hash: '#/agent' },
  history: { replaceState: vi.fn() },
  sessionStorage: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
});

vi.mock('../store/accountIdentity', () => ({
  useAccountIdentityStore: {
    getState: () => ({ load: mocks.accountLoad }),
  },
}));

vi.mock('../store/oauth2', () => ({
  useOAuth2Store: {
    getState: () => ({ loadAll: vi.fn(async () => undefined) }),
  },
}));

vi.mock('../store/session', () => ({
  useSessionStore: {
    getState: () => ({
      ...mocks.session,
      activateAuthenticatedSession: (response: { actor_ptid?: string }) => {
        mocks.order.push('activate');
        mocks.session.currentUser = {
          actorPtid: response.actor_ptid ?? '',
          name: 'New',
          email: '',
          loginMethod: 'password',
        };
      },
      loginWithPassword: mocks.loginWithPassword,
      updateProfile: vi.fn(),
      logout: mocks.logout,
      reset: mocks.resetSession,
    }),
  },
}));

vi.mock('../store/socialChat', () => ({
  useSocialChatStore: {
    getState: () => ({ loadCurrentUserProfile: vi.fn() }),
  },
}));

vi.mock('../services/identity_event', () => ({
  clearLocalIdentityAction: mocks.clearLocalIdentityAction,
  markLocalIdentityAction: vi.fn(),
}));

vi.mock('../services/identityPipeline', () => ({
  runIdentityPipeline: mocks.runIdentityPipeline,
}));

vi.mock('../storage/desktopClientStorage', () => ({
  readDesktopPreferenceSync: vi.fn(() => null),
  removeDesktopPreferenceSync: vi.fn(),
  writeDesktopPreferenceSync: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('./boot', () => ({
  markPhaseEnd: vi.fn(),
  markPhaseStart: vi.fn(),
}));

vi.mock('./events', () => ({
  EVENT: { AUTH_IDENTITY_CHANGED: 'auth.identity_changed' },
  eventBus: { subscribe: vi.fn(() => vi.fn()) },
}));

vi.mock('./global-context', () => ({
  globalContext: {
    bootstrap: vi.fn(),
    setRuntimeAppState: vi.fn(),
  },
}));

vi.mock('../services/desktop_api', () => ({
  api: {
    accountSwitch: mocks.accountSwitch,
    authValidateToken: mocks.authValidateToken,
    syncUserProfile: vi.fn(async () => ({ name: 'New', email: '', avatar_url: '' })),
    accountListRestorable: mocks.accountListRestorable,
  },
  AuthCommandException: class AuthCommandException extends Error {},
  onSessionRevoked: vi.fn(),
}));

vi.mock('../applet/productWindowE2E', () => ({
  setAppletProductWindowLaunchContext: vi.fn(),
}));

const { identityRuntime } = await import('./identityRuntime');

describe('identityRuntime account switch ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.session.authenticated = true;
    mocks.session.currentUser = {
      actorPtid: 'ptid:person:old',
      name: 'Old',
      email: '',
      loginMethod: 'password',
    };
    mocks.accountSwitch.mockImplementation(async () => {
      mocks.order.push('switch');
      return { ok: true };
    });
    mocks.authValidateToken.mockImplementation(async () => {
      mocks.order.push('validate');
      return {
        actor_ptid: 'ptid:person:new',
        session_token: 'token',
        login_method: 'password',
      };
    });
    mocks.runIdentityPipeline.mockImplementation(async () => {
      mocks.order.push(`pipeline:${mocks.session.currentUser?.actorPtid}`);
      return { ok: true, failures: [] };
    });
    mocks.loginWithPassword.mockImplementation(async () => {
      mocks.order.push('session-login');
      mocks.session.currentUser = {
        actorPtid: 'ptid:person:new',
        name: 'New',
        email: '',
        loginMethod: 'password',
      };
      mocks.session.authenticated = true;
    });
    mocks.logout.mockResolvedValue(undefined);
    mocks.accountListRestorable.mockResolvedValue([]);
    mocks.resetSession.mockImplementation(() => {
      mocks.session.currentUser = null;
      mocks.session.authenticated = false;
    });
  });

  it('accepts and completes the session activated by password login', async () => {
    mocks.session.currentUser = null;
    mocks.session.authenticated = false;

    await identityRuntime.loginWithPassword('alice@p.t', 'password');

    expect(mocks.loginWithPassword).toHaveBeenCalledWith('alice@p.t', 'password');
    expect(identityRuntime.getSnapshot().phase.kind).toBe('authenticatedPendingCompletion');

    await identityRuntime.completeCurrentSession();

    expect(identityRuntime.getSnapshot().lifecycle.state).toBe('ready');
    expect(identityRuntime.getSnapshot().lifecycle.authenticated).toBe(true);
  });

  it('cleans the old actor projection before activating the restored actor', async () => {
    await identityRuntime.switchAccount('local-account-new');

    expect(mocks.order.slice(0, 4)).toEqual([
      'switch',
      'validate',
      'pipeline:ptid:person:old',
      'activate',
    ]);
    expect(mocks.runIdentityPipeline).toHaveBeenCalledWith({
      reason: 'switch',
      actorPtid: 'ptid:person:new',
      loginMethod: 'password',
    });
    expect(mocks.session.currentUser?.actorPtid).toBe('ptid:person:new');
  });

  it('clears the authenticated projection when native detached before failing', async () => {
    const detachedFailure = Object.assign(new Error('account switch failed'), {
      details: {
        detached: true,
        reason: 'account_switch_failed_closed',
        stage: 'acquire_new',
      },
    });
    mocks.accountSwitch.mockRejectedValueOnce(detachedFailure);

    await expect(identityRuntime.switchAccount('local-account-new')).rejects.toBe(detachedFailure);

    expect(mocks.authValidateToken).not.toHaveBeenCalled();
    expect(mocks.clearLocalIdentityAction).toHaveBeenCalledOnce();
    expect(mocks.resetSession).toHaveBeenCalledOnce();
    expect(mocks.session.currentUser).toBeNull();
    expect(mocks.session.authenticated).toBe(false);
    expect(identityRuntime.getSnapshot().phase).toEqual({
      kind: 'accountGate',
      reason: 'restore_failed',
    });
    expect(identityRuntime.getSnapshot().lifecycle.authenticated).toBe(false);
    expect(identityRuntime.getSnapshot().lifecycle.restoredUser).toBeNull();
  });

  it('passes the current canonical PTID through revocation cleanup', async () => {
    await identityRuntime.revokeSession();

    expect(mocks.runIdentityPipeline).toHaveBeenCalledWith({
      reason: 'revoked',
      actorPtid: 'ptid:person:old',
      loginMethod: null,
    });
  });

  it('enters the logged-out account gate before propagating cleanup failure', async () => {
    const cleanupError = new Error('logout cleanup failed');
    mocks.logout.mockRejectedValueOnce(cleanupError);

    await expect(identityRuntime.logout()).rejects.toBe(cleanupError);

    expect(identityRuntime.getSnapshot().phase).toEqual({
      kind: 'accountGate',
      reason: 'logout',
    });
    expect(identityRuntime.getSnapshot().lifecycle.authenticated).toBe(false);
  });

  it('preserves a native restorable session while the renderer is unauthenticated', async () => {
    mocks.session.authenticated = false;
    mocks.session.currentUser = null;
    mocks.accountListRestorable.mockResolvedValue([{
      id: 'station:local:password:alice',
      provider: 'password',
      provider_user_id: 'ptid:person:alice',
      name: 'Alice',
      email: 'alice@p.t',
      avatar_url: '',
      avatar_local_path: '',
      profile_url: '',
      created_at: 1,
      last_login_at: 2,
      has_pin: false,
      has_session: true,
    }]);

    await identityRuntime.logout();

    expect(identityRuntime.getSnapshot().lifecycle.knownAccounts).toEqual([
      expect.objectContaining({
        accountId: 'station:local:password:alice',
        hasPin: false,
        hasSession: true,
      }),
    ]);
  });
});
