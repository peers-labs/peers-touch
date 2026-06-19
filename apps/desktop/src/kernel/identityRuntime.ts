import { useAccountIdentityStore } from '../store/accountIdentity';
import { useOAuth2Store } from '../store/oauth2';
import { useSessionStore } from '../store/session';
import { markLocalIdentityAction } from '../services/identity_event';
import { runIdentityPipeline } from '../services/identityPipeline';
import { removeDesktopPreferenceSync } from '../storage/desktopClientStorage';
import type { AppLifecycle, AppState, SessionUser } from '../types/navigation';
import { markPhaseEnd, markPhaseStart } from './boot';
import { EVENT, eventBus } from './events';
import { globalContext } from './global-context';
import {
  DEFAULT_IDENTITY_POLICY,
  identityPhaseAllowsReady,
  identityPhaseNeedsAuthGate,
  identityReducer,
  shouldResolveSessionOnBoot,
  type IdentityAuthGateReason,
  type IdentityBootReason,
  type IdentityEvent,
  type IdentityPhase,
} from './identityLifecycle';
import {
  api,
  AuthCommandException,
  onSessionRevoked,
  type AccountIdentity,
  type AppletProductWindowLaunchContext,
} from '../services/desktop_api';

const WARM_RESUME_KEY = 'pt.auth.lastActiveAt';
const RENDERER_AUTH_MARKER_KEY = 'pt.identity.rendererAuthenticated';

export function clearWarmResume(): void {
  try {
    removeDesktopPreferenceSync(WARM_RESUME_KEY);
  } catch {
    // noop
  }
}

function readRendererBootReason(): IdentityBootReason {
  try {
    return window.sessionStorage.getItem(RENDERER_AUTH_MARKER_KEY) === '1'
      ? 'renderer_reload'
      : 'cold_launch';
  } catch {
    return 'cold_launch';
  }
}

function markRendererAuthenticated(): void {
  try {
    window.sessionStorage.setItem(RENDERER_AUTH_MARKER_KEY, '1');
  } catch {
    // sessionStorage may be unavailable in test shells.
  }
}

function clearRendererAuthenticated(): void {
  try {
    window.sessionStorage.removeItem(RENDERER_AUTH_MARKER_KEY);
  } catch {
    // sessionStorage may be unavailable in test shells.
  }
}

function accountToSessionUser(account: AccountIdentity): SessionUser {
  return {
    name: account.name || account.provider_user_id || 'User',
    email: account.email || '',
    avatar: account.avatar_url || undefined,
    accountId: account.id,
    hasPin: account.has_pin,
    hasSession: account.has_session,
    provider: account.provider,
  };
}

async function loadKnownAccountUsers(sessionAuthenticated: boolean): Promise<SessionUser[]> {
  const accounts = await api.accountListRestorable();
  if (!Array.isArray(accounts) || accounts.length === 0) return [];
  const mapped = accounts.map(accountToSessionUser);
  if (!sessionAuthenticated) {
    mapped.forEach((account) => {
      if (!account.hasPin) account.hasSession = false;
    });
  }
  return mapped;
}

function appletLaunchContextToSessionUser(context: AppletProductWindowLaunchContext): SessionUser {
  const actorId = context.actorId || 'applet-product-window-certification';
  return {
    name: context.name || actorId,
    email: context.email || '',
    accountId: `applet-product-window-certification:${actorId}`,
    hasPin: false,
    hasSession: true,
    provider: context.loginMethod || 'product-window-certification',
  };
}

function activateAppletProductWindowLaunch(context: AppletProductWindowLaunchContext): boolean {
  if (!context.enabled || !context.appletId || !context.actorId) return false;

  const loginMethod = context.loginMethod || 'product-window-certification';
  useSessionStore.getState().activateAppletLaunchSession({
    actorId: context.actorId,
    name: context.name || context.actorId,
    email: context.email || '',
    loginMethod,
    loginProvider: loginMethod,
  });

  const targetHash = `#/applet:${context.appletId}`;
  if (window.location.hash !== targetHash) {
    window.history.replaceState(null, '', targetHash);
  }
  return true;
}

function currentSessionUser(): SessionUser | null {
  const current = useSessionStore.getState().currentUser;
  if (!current?.actorId) return null;
  return {
    name: current.name || current.actorId,
    email: current.email || '',
    avatar: current.avatarUrl,
    hasSession: true,
    provider: current.loginProvider || current.loginMethod,
  };
}

function userWithSyncedProfile(
  user: SessionUser,
  profile: Awaited<ReturnType<typeof api.syncUserProfile>>,
): SessionUser {
  return {
    ...user,
    name: profile.name || user.name,
    email: profile.email || user.email,
    avatar: profile.avatar_url || user.avatar,
  };
}

function appStateFromIdentity(phase: IdentityPhase): AppState {
  if (identityPhaseAllowsReady(phase)) return 'ready';
  if (phase.kind === 'resolvingSession') return 'resuming';
  return 'onboarding';
}

function classifyRestoreFailure(error: unknown): IdentityAuthGateReason {
  if (error instanceof AuthCommandException && error.code === 'UNAUTHORIZED') {
    const details = error.details as { reason?: string } | undefined;
    if (details?.reason === 'pin_required') return 'pin_required';
    if (details?.reason === 'session_missing' || details?.reason === 'token_missing') {
      return 'session_missing';
    }
  }
  return 'restore_failed';
}

interface IdentityRuntimeSnapshot {
  phase: IdentityPhase;
  lifecycle: AppLifecycle;
}

type IdentityRuntimeListener = () => void;

class IdentityRuntime {
  private initialBootReason = readRendererBootReason();

  private phase: IdentityPhase = {
    kind: 'booting',
    reason: this.initialBootReason,
  };

  private restoredUser: SessionUser | null = null;

  private knownAccounts: SessionUser[] = [];

  private dataReady = false;

  private bootStarted = false;

  private listeners = new Set<IdentityRuntimeListener>();

  private authGateIdentityUnsubscribe: (() => void) | null = null;

  private snapshot: IdentityRuntimeSnapshot;

  constructor() {
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: IdentityRuntimeListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): IdentityRuntimeSnapshot => this.snapshot;

  boot = (): void => {
    if (this.bootStarted) return;
    this.bootStarted = true;

    clearWarmResume();
    globalContext.bootstrap().catch(() => {});
    onSessionRevoked(() => {
      void this.revokeSession();
    });

    const bootReason = this.initialBootReason;
    this.dispatch({ type: 'BOOT_STARTED', reason: bootReason });
    this.dispatch({ type: 'LAUNCH_CONTEXT_CHECK_STARTED' });
    markPhaseStart('identity');

    api.appletsProductWindowLaunchContext().catch(() => ({ enabled: false })).then((context) => {
      if (activateAppletProductWindowLaunch(context)) {
        const launchUser = appletLaunchContextToSessionUser(context);
        markRendererAuthenticated();
        this.restoredUser = launchUser;
        this.knownAccounts = [launchUser];
        this.dataReady = true;
        this.dispatch({ type: 'APPLET_LAUNCH_AUTHENTICATED', user: launchUser });
        void this.reconcileAuthenticatedIdentity(launchUser);
        markPhaseEnd('identity', { state: 'authenticated', reason: 'applet_launch' });
        return;
      }

      if (shouldResolveSessionOnBoot(bootReason, DEFAULT_IDENTITY_POLICY)) {
        return this.resolveSession('live').finally(() => {
          markPhaseEnd('identity', {
            state: useSessionStore.getState().authenticated ? 'authenticated' : 'accountGate',
            reason: bootReason,
          });
        });
      }

      return this.loadAuthGate('cold_policy', false).finally(() => {
        markPhaseEnd('identity', { state: 'accountGate', reason: bootReason });
      });
    });
  };

  resolveSession = async (source: 'live' | 'disk' | 'applet'): Promise<void> => {
    this.dispatch({ type: 'SESSION_RESOLVE_STARTED', source });
    try {
      await useSessionStore.getState().restoreSession();
      const user = currentSessionUser();
      if (!user) {
        await this.loadAuthGate('session_missing', false);
        return;
      }
      await this.acceptAuthenticatedEdge({ event: { type: 'SESSION_RESTORED', source: 'restore', user }, user });
    } catch (error) {
      await this.loadAuthGate(classifyRestoreFailure(error), false);
    }
  };

  completeCurrentSession = async (): Promise<void> => {
    const { authenticated } = useSessionStore.getState();
    if (!authenticated) return;
    const user = currentSessionUser();
    if (!user) return;

    useOAuth2Store.getState().loadAll().catch(() => {});
    await this.acceptAuthenticatedEdge({ event: { type: 'LOGIN_SUCCEEDED', user }, user });
  };

  loginWithPassword = async (account: string, password: string): Promise<void> => {
    markLocalIdentityAction();
    const resp = await api.authLogin({ account, password });
    await runIdentityPipeline({
      reason: 'login',
      actorId: resp.actor_id ?? null,
      loginMethod: 'password',
    });
  };

  loginWithOAuthBridge = async (): Promise<void> => {
    markLocalIdentityAction();
    const resp = await api.ensureStationSession();
    const method = (resp.login_method as string) || 'oauth';
    await runIdentityPipeline({
      reason: 'oauth_bridge',
      actorId: resp.actor_id ?? null,
      loginMethod: method,
    });
  };

  switchAccount = async (accountId: string): Promise<void> => {
    markLocalIdentityAction();
    await api.accountSwitch(accountId);
    const restored = await api.authRestoreSession();
    await runIdentityPipeline({
      reason: 'switch',
      actorId: restored.actor_id ?? accountId,
      loginMethod: restored.login_method ?? null,
    });
    await useAccountIdentityStore.getState().load();
    const user = currentSessionUser();
    if (!user) return;
    await this.acceptAuthenticatedEdge({
      event: { type: 'SESSION_RESTORED', source: 'switch', user },
      user,
    });
  };

  unlockWithPin = async (accountId: string, pin: string): Promise<void> => {
    markLocalIdentityAction();
    const resp = await api.accountUnlock(accountId, pin);
    await runIdentityPipeline({
      reason: 'unlock',
      actorId: resp.actor_id ?? null,
      loginMethod: resp.login_method ?? null,
    });
    await useAccountIdentityStore.getState().load();
    const user = currentSessionUser();
    if (!user) return;
    await this.acceptAuthenticatedEdge({
      event: { type: 'SESSION_RESTORED', source: 'unlock', user },
      user,
    });
  };

  refreshCurrentProfile = async (fallbackAvatar?: string): Promise<void> => {
    const user = currentSessionUser();
    if (!user) return;
    this.dispatch({ type: 'PROFILE_SYNC_STARTED' });
    let refreshedUser = user;
    try {
      const profile = await api.syncUserProfile();
      refreshedUser = userWithSyncedProfile(user, profile);
      useSessionStore.getState().updateProfile({
        name: refreshedUser.name,
        email: refreshedUser.email,
        avatarUrl: refreshedUser.avatar,
      });
      this.restoredUser = refreshedUser;
      this.dispatch({ type: 'PROFILE_SYNC_SUCCEEDED', user: refreshedUser });
    } catch (error) {
      if (!fallbackAvatar) throw error;
      await api.accountSyncAvatar(fallbackAvatar);
      refreshedUser = { ...user, avatar: fallbackAvatar };
      useSessionStore.getState().updateProfile({
        name: refreshedUser.name,
        email: refreshedUser.email,
        avatarUrl: fallbackAvatar,
      });
      this.restoredUser = refreshedUser;
      this.dispatch({ type: 'PROFILE_SYNC_SUCCEEDED', user: refreshedUser });
    }

    this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_STARTED' });
    try {
      await useAccountIdentityStore.getState().load();
      const refreshedAccounts = await loadKnownAccountUsers(true);
      this.knownAccounts = refreshedAccounts.length > 0 ? refreshedAccounts : [refreshedUser];
      this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_SUCCEEDED', user: currentSessionUser() ?? refreshedUser });
    } catch {
      this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_FAILED' });
    }
  };

  revokeSession = async (): Promise<void> => {
    this.dispatch({ type: 'SESSION_REVOKED', reason: 'revoked' });
    await this.loadAuthGate('revoked', true);
  };

  revalidateIfNeeded = (): void => {
    const state = this.snapshot.lifecycle.state;
    const { authenticated } = useSessionStore.getState();
    if (state !== 'ready' || authenticated) return;
    this.resolveSession('live').catch(() => {});
  };

  private acceptAuthenticatedEdge = async (input: { event: IdentityEvent; user: SessionUser }): Promise<void> => {
    markRendererAuthenticated();
    this.restoredUser = input.user;
    this.knownAccounts = [input.user];
    this.dataReady = true;
    this.dispatch(input.event);
    await this.reconcileAuthenticatedIdentity(input.user);
  };

  private reconcileAuthenticatedIdentity = async (seedUser: SessionUser): Promise<void> => {
    let reconciledUser = seedUser;

    this.dispatch({ type: 'PROFILE_SYNC_STARTED' });
    try {
      const profile = await api.syncUserProfile();
      reconciledUser = userWithSyncedProfile(reconciledUser, profile);
      useSessionStore.getState().updateProfile({
        name: reconciledUser.name,
        email: reconciledUser.email,
        avatarUrl: reconciledUser.avatar,
      });
      this.restoredUser = reconciledUser;
      this.dispatch({ type: 'PROFILE_SYNC_SUCCEEDED', user: reconciledUser });
    } catch {
      this.dispatch({ type: 'PROFILE_SYNC_FAILED' });
    }

    this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_STARTED' });
    try {
      await useAccountIdentityStore.getState().load();
      const refreshedAccounts = await loadKnownAccountUsers(true);
      this.knownAccounts = refreshedAccounts.length > 0 ? refreshedAccounts : [reconciledUser];
      const latestUser = currentSessionUser() ?? reconciledUser;
      this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_SUCCEEDED', user: latestUser });
    } catch {
      this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_FAILED' });
    }
  };

  private loadAuthGate = async (
    reason: IdentityAuthGateReason,
    runLogoutPipeline: boolean,
  ): Promise<void> => {
    clearWarmResume();
    clearRendererAuthenticated();
    this.restoredUser = null;
    this.dispatch({ type: 'ACCOUNT_GATE_READY', reason });
    if (runLogoutPipeline) {
      globalContext.runPipeline('session_logout').catch(() => {});
    }
    const oauth2 = useOAuth2Store.getState();
    const [, restorableAccounts] = await Promise.all([
      oauth2.loadAll().catch(() => {}),
      loadKnownAccountUsers(false).catch(() => [] as SessionUser[]),
    ]);
    this.knownAccounts = restorableAccounts;
    this.dataReady = true;
    this.installAuthGateIdentityRefresh();
    this.emit();
  };

  private installAuthGateIdentityRefresh(): void {
    if (!identityPhaseNeedsAuthGate(this.phase)) {
      this.authGateIdentityUnsubscribe?.();
      this.authGateIdentityUnsubscribe = null;
      return;
    }
    if (this.authGateIdentityUnsubscribe) return;
    const refreshKnownAccounts = () => {
      const { authenticated } = useSessionStore.getState();
      loadKnownAccountUsers(authenticated).then((accounts) => {
        this.knownAccounts = accounts;
        this.emit();
      }).catch(() => {
        this.knownAccounts = [];
        this.emit();
      });
    };
    refreshKnownAccounts();
    this.authGateIdentityUnsubscribe = eventBus.subscribe(EVENT.AUTH_IDENTITY_CHANGED, refreshKnownAccounts);
  }

  private dispatch(event: IdentityEvent): void {
    this.phase = identityReducer(this.phase, event);
    this.installAuthGateIdentityRefresh();
    globalContext.setRuntimeAppState(identityPhaseAllowsReady(this.phase) ? 'ready' : 'booting');
    this.emit();
  }

  private buildSnapshot(): IdentityRuntimeSnapshot {
    const lifecycle: AppLifecycle = {
      state: appStateFromIdentity(this.phase),
      authenticated: identityPhaseAllowsReady(this.phase),
      restoredUser: this.restoredUser,
      knownAccounts: this.knownAccounts,
      dataReady: this.dataReady,
      completeLogin: this.completeCurrentSession,
      loginWithPassword: this.loginWithPassword,
      loginWithOAuthBridge: this.loginWithOAuthBridge,
      switchAccount: this.switchAccount,
      unlockWithPin: this.unlockWithPin,
      refreshCurrentProfile: this.refreshCurrentProfile,
    };
    return {
      phase: this.phase,
      lifecycle,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((listener) => listener());
  }
}

export const identityRuntime = new IdentityRuntime();
