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
    stationList: vi.fn(),
    stationSetActive: vi.fn(),
    accountListRestorable: vi.fn(),
    accountLoad: vi.fn(),
    loginWithPassword: vi.fn(),
    loginWithOAuth: vi.fn(),
    restoreSession: vi.fn(),
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
    getState: () => ({
      completedLoopbackSessionId: 'lp-completed',
      loadAll: vi.fn(async () => undefined),
    }),
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
      loginWithOAuth: mocks.loginWithOAuth,
      restoreSession: mocks.restoreSession,
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
    stationList: mocks.stationList,
    stationSetActive: mocks.stationSetActive,
    syncUserProfile: vi.fn(async () => ({ name: 'New', email: '', avatar_url: '' })),
    accountListRestorable: mocks.accountListRestorable,
  },
  AuthCommandException: class AuthCommandException extends Error {
    code: string;
    details?: Record<string, unknown>;

    constructor(error: { code: string; message: string; details?: Record<string, unknown> }) {
      super(error.message);
      this.code = error.code;
      this.details = error.details;
    }
  },
  onSessionRevoked: vi.fn(),
}));

vi.mock('../applet/productWindowE2E', () => ({
  setAppletProductWindowLaunchContext: vi.fn(),
}));

const { AuthCommandException } = await import('../services/desktop_api');
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
    mocks.stationList.mockResolvedValue({
      active_url: 'http://station.test',
      binding: {
        bound_url: 'http://station.test',
        phase: 'bound',
      },
    });
    mocks.stationSetActive.mockResolvedValue(undefined);
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
    mocks.loginWithOAuth.mockImplementation(async () => {
      mocks.order.push('oauth-session-login');
      mocks.session.currentUser = {
        actorPtid: 'ptid:person:new',
        name: 'New',
        email: '',
        loginMethod: 'oauth',
      };
      mocks.session.authenticated = true;
    });
    mocks.restoreSession.mockResolvedValue(undefined);
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

  it('routes OAuth through the session lifecycle before accepting the actor', async () => {
    mocks.session.currentUser = null;
    mocks.session.authenticated = false;

    await identityRuntime.loginWithOAuthBridge();

    expect(mocks.loginWithOAuth).toHaveBeenCalledWith('oauth');
    expect(identityRuntime.getSnapshot().phase.kind).toBe('authenticatedPendingCompletion');
    expect(mocks.session.currentUser).toMatchObject({
      actorPtid: 'ptid:person:new',
    });
  });

  it('retries a pending OAuth acknowledgement without opening the account gate', async () => {
    vi.useFakeTimers();
    mocks.session.currentUser = null;
    mocks.session.authenticated = false;
    mocks.restoreSession
      .mockRejectedValueOnce(new AuthCommandException({
        code: 'UNAUTHORIZED',
        message: 'oauth session activation pending',
        details: { reason: 'oauth_acknowledgement_pending' },
      }))
      .mockImplementationOnce(async () => {
        mocks.session.currentUser = {
          actorPtid: 'ptid:person:new',
          name: 'New',
          email: '',
          loginMethod: 'oauth',
        };
        mocks.session.authenticated = true;
      });

    await identityRuntime.resolveSession('disk');
    expect(identityRuntime.getSnapshot().phase.kind).toBe('resolvingSession');
    expect(mocks.restoreSession).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);

    expect(mocks.restoreSession).toHaveBeenCalledTimes(2);
    expect(identityRuntime.getSnapshot().phase.kind).toBe('authenticated');
    vi.useRealTimers();
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
