import { useAccountIdentityStore } from '../store/accountIdentity';
import { useOAuth2Store } from '../store/oauth2';
import { useSessionStore } from '../store/session';
import { useSocialChatStore } from '../store/socialChat';
import { clearLocalIdentityAction, markLocalIdentityAction } from '../services/identity_event';
import { runIdentityPipeline } from '../services/identityPipeline';
import {
  accessDecisionMessage,
  currentGate,
  isAccessActionRequired,
  isLoginGate,
} from '../services/accessGate';
import { readDesktopPreferenceSync, removeDesktopPreferenceSync, writeDesktopPreferenceSync } from '../storage/desktopClientStorage';
import type { AppLifecycle, SessionUser } from '../types/navigation';
import { log } from '../utils/logger';
import { markPhaseEnd, markPhaseStart } from './boot';
import { EVENT, eventBus } from './events';
import { globalContext } from './global-context';
import {
  DEFAULT_IDENTITY_POLICY,
  appStateFromIdentity,
  identityAuthenticatedEdge,
  identityPhaseAllowsReady,
  identityPhaseNeedsAuthGate,
  identityReducer,
  resolveBootSessionPolicy,
  type IdentityAuthGateReason,
  type IdentityAuthenticatedEdge,
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
import { setAppletProductWindowLaunchContext } from '../applet/productWindowE2E';

const WARM_RESUME_KEY = 'pt.auth.lastActiveAt';
const LAST_ACTIVE_PAGE_KEY = 'pt.nav.lastActivePage';
const RENDERER_AUTH_MARKER_KEY = 'pt.identity.rendererAuthenticated';
const APPLET_PRODUCT_WINDOW_LAUNCH_CONTEXT_TIMEOUT_MS = 5_000;

export async function resolveAppletProductWindowLaunchContext(
  request: Promise<AppletProductWindowLaunchContext>,
  timeoutMs = APPLET_PRODUCT_WINDOW_LAUNCH_CONTEXT_TIMEOUT_MS,
): Promise<AppletProductWindowLaunchContext> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
          reject(new Error('applet product window launch context timed out'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

// #region debug-point A-D:foundation-launch-context
function reportFoundationLaunchContextDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown>,
): void {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;
  void fetch('http://127.0.0.1:7778/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-identity-boot',
      runId: 'pre-fix',
      hypothesisId,
      location: 'identityRuntime.ts:boot',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

// #region debug-point C-D:forbidden-actor-account-gate
function reportFoundationForbiddenActorAccountGateDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown>,
): void {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;
  void fetch('http://127.0.0.1:7795/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-forbidden-actor-account-gate',
      runId: 'pre-fix',
      hypothesisId,
      location: 'identityRuntime.ts:logout',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

export function clearWarmResume(): void {
  try {
    removeDesktopPreferenceSync(WARM_RESUME_KEY);
  } catch {
    // noop
  }
}

export function persistLastActivePage(page: string): void {
  writeDesktopPreferenceSync(LAST_ACTIVE_PAGE_KEY, page);
}

function restoreLastActivePage(): void {
  if (window.location.hash) return;
  const page = readDesktopPreferenceSync<string>(LAST_ACTIVE_PAGE_KEY);
  if (!page) return;
  window.history.replaceState(null, '', `#/${page}`);
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

async function loadKnownAccountUsers(): Promise<SessionUser[]> {
  const accounts = await api.accountListRestorable();
  if (!Array.isArray(accounts) || accounts.length === 0) return [];
  const mapped = accounts.map(accountToSessionUser);
  return mapped;
}

function appletLaunchContextToSessionUser(context: AppletProductWindowLaunchContext): SessionUser {
  const actorPtid = context.actorPtid || 'applet-product-window-certification';
  return {
    name: context.name || actorPtid,
    email: context.email || '',
    accountId: `applet-product-window-certification:${actorPtid}`,
    hasPin: false,
    hasSession: true,
    provider: context.loginMethod || 'product-window-certification',
  };
}

function activateAppletProductWindowLaunch(context: AppletProductWindowLaunchContext): boolean {
  if (!context.enabled || !context.appletId || !context.actorPtid) return false;

  setAppletProductWindowLaunchContext(context);
  const loginMethod = context.loginMethod || 'product-window-certification';
  useSessionStore.getState().activateAppletLaunchSession({
    actorPtid: context.actorPtid,
    name: context.name || context.actorPtid,
    email: context.email || '',
    loginMethod,
    loginProvider: loginMethod,
  });

  const targetHash = context.mode === 'lifecycle-smoothness' && context.startPage === 'applets'
    ? '#/applets'
    : `#/applet:${context.appletId}`;
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }
  return true;
}

function currentSessionUser(): SessionUser | null {
  const current = useSessionStore.getState().currentUser;
  if (!current?.actorPtid) return null;
  return {
    name: current.name || current.actorPtid,
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

function isDetachedAccountSwitchFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('details' in error)) return false;
  const details = (error as { details?: unknown }).details;
  return typeof details === 'object'
    && details !== null
    && 'detached' in details
    && details.detached === true;
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

    const launchContextStartedAt = performance.now();
    reportFoundationLaunchContextDebug('A', 'launch-context-started', {
      bootReason,
    });
    resolveAppletProductWindowLaunchContext(
      api.appletsProductWindowLaunchContext(),
    ).then((context) => {
      reportFoundationLaunchContextDebug('A-D', 'launch-context-resolved', {
        bootReason,
        durationMs: Math.round(performance.now() - launchContextStartedAt),
        enabled: context.enabled,
      });
      return context;
    }).catch((error: unknown) => {
      reportFoundationLaunchContextDebug('A-D', 'launch-context-rejected', {
        bootReason,
        durationMs: Math.round(performance.now() - launchContextStartedAt),
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return { enabled: false };
    }).then((context) => {
      if (activateAppletProductWindowLaunch(context)) {
        const launchUser = appletLaunchContextToSessionUser(context);
        void this.acceptAuthenticatedEdge(identityAuthenticatedEdge('applet_launch', launchUser));
        markPhaseEnd('identity', { state: 'authenticated', reason: 'applet_launch' });
        return;
      }

      const bootResolution = resolveBootSessionPolicy(bootReason, DEFAULT_IDENTITY_POLICY);
      if (bootResolution.kind === 'resolveSession') {
        return this.resolveSession(bootResolution.source).finally(() => {
          markPhaseEnd('identity', {
            state: useSessionStore.getState().authenticated ? 'authenticated' : 'accountGate',
            reason: bootReason,
          });
        });
      }

      return this.loadAuthGate(bootResolution.reason, false).finally(() => {
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
      await api.stationBindingComplete();
      await this.acceptAuthenticatedEdgeFromCurrentSession(source === 'applet' ? 'applet_launch' : 'restored_session');
    } catch (error) {
      await this.loadAuthGate(classifyRestoreFailure(error), false);
    }
  };

  completeCurrentSession = async (): Promise<void> => {
    const { authenticated } = useSessionStore.getState();
    if (!authenticated) return;
    const user = currentSessionUser();
    if (!user) return;

    await api.stationBindingComplete();
    useOAuth2Store.getState().loadAll().catch(() => {});
    if (this.phase.kind === 'authenticatedPendingCompletion') {
      this.restoredUser = user;
      this.dataReady = true;
      this.dispatch({ type: 'LOGIN_COMPLETED', user });
      return;
    }
    await this.acceptAuthenticatedEdge(identityAuthenticatedEdge('completed_login', user));
  };

  loginWithPassword = async (account: string, password: string): Promise<void> => {
    const session = useSessionStore.getState();
    const decision = await session.accessStart();
    const gate = currentGate(decision);
    if (
      !decision.attemptId
      || !isAccessActionRequired(decision)
      || !isLoginGate(gate)
    ) {
      throw new AuthCommandException({
        code: 'FORBIDDEN',
        message:
          accessDecisionMessage(decision)
          || 'Station access requires another gate before password login',
        details: {
          reason: 'access_gate_action_required',
          gate_id: gate?.gateId ?? null,
        },
      });
    }
    await session.accessSubmitLogin(decision.attemptId, account, password);
    await this.acceptAuthenticatedEdgeFromCurrentSession('fresh_login');
  };

  loginWithOAuthBridge = async (): Promise<void> => {
    const sessionId = useOAuth2Store.getState().completedLoopbackSessionId;
    if (!sessionId) {
      throw new AuthCommandException({
        code: 'UNAUTHORIZED',
        message: 'oauth loopback session is missing',
      });
    }
    markLocalIdentityAction();
    const resp = await api.ensureStationSession();
    useSessionStore.getState().activateAuthenticatedSession(resp);
    const method = (resp.login_method as string) || 'oauth';
    await runIdentityPipeline({
      reason: 'oauth_bridge',
      actorPtid: resp.actor_ptid ?? null,
      loginMethod: method,
    });
    await this.acceptAuthenticatedEdgeFromCurrentSession('fresh_login');
  };

  switchAccount = async (accountId: string): Promise<void> => {
    markLocalIdentityAction();
    try {
      await api.accountSwitch(accountId);
    } catch (error) {
      clearLocalIdentityAction();
      if (isDetachedAccountSwitchFailure(error)) {
        useSessionStore.getState().reset();
        await this.loadAuthGate('restore_failed', false);
      }
      throw error;
    }
    const restored = await api.authValidateToken({});
    await runIdentityPipeline({
      reason: 'switch',
      actorPtid: restored.actor_ptid ?? null,
      loginMethod: restored.login_method ?? null,
    });
    useSessionStore.getState().activateAuthenticatedSession(restored);
    await useAccountIdentityStore.getState().load();
    await this.acceptAuthenticatedEdgeFromCurrentSession('account_switch');
  };

  unlockWithPin = async (accountId: string, pin: string): Promise<void> => {
    this.dispatch({ type: 'SESSION_RESOLVE_STARTED', source: 'live' });
    markLocalIdentityAction();
    let resp: Awaited<ReturnType<typeof api.accountUnlock>>;
    try {
      resp = await api.accountUnlock(accountId, pin);
    } catch (error) {
      clearLocalIdentityAction();
      this.dispatch({ type: 'PIN_REQUIRED', accountId });
      throw error;
    }
    await runIdentityPipeline({
      reason: 'unlock',
      actorPtid: resp.actor_ptid ?? null,
      loginMethod: resp.login_method ?? null,
    });
    useSessionStore.getState().activateAuthenticatedSession(resp);
    await useAccountIdentityStore.getState().load();
    await this.acceptAuthenticatedEdgeFromCurrentSession('pin_unlock');
  };

  beginPinRecovery = (recoveryId: string, targetLocalAccountId: string, provider: string): void => {
    this.dispatch({ type: 'PIN_RECOVERY_REQUESTED', recoveryId, targetLocalAccountId, provider });
  };

  cancelPinRecovery = (): void => {
    this.dispatch({ type: 'PIN_RECOVERY_CANCELLED' });
  };

  completePinRecovery = async (): Promise<void> => {
    const user = currentSessionUser();
    if (!user) {
      this.dispatch({ type: 'PIN_RECOVERY_COMMIT_FAILED' });
      return;
    }
    this.dispatch({ type: 'PIN_RECOVERY_COMMITTED', user });
    await this.reconcileAuthenticatedIdentity(user, 'completed_login');
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
      const refreshedAccounts = await loadKnownAccountUsers();
      this.knownAccounts = refreshedAccounts.length > 0 ? refreshedAccounts : [refreshedUser];
      this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_SUCCEEDED', user: currentSessionUser() ?? refreshedUser });
    } catch {
      this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_FAILED' });
    }
    await useSocialChatStore.getState().loadCurrentUserProfile();
  };

  revokeSession = async (): Promise<void> => {
    const actorPtid = useSessionStore.getState().currentUser?.actorPtid ?? null;
    this.dispatch({ type: 'SESSION_REVOKED', reason: 'revoked' });
    await runIdentityPipeline({
      reason: 'revoked',
      actorPtid,
      loginMethod: null,
    });
    await this.loadAuthGate('revoked', false);
  };

  logout = async (): Promise<void> => {
    // #region debug-point C-D:forbidden-actor-identity-logout
    reportFoundationForbiddenActorAccountGateDebug('C-D', 'logout-entered', {
      phaseKind: this.phase.kind,
      lifecycleState: this.snapshot.lifecycle.state,
      dataReady: this.dataReady,
      authenticated: useSessionStore.getState().authenticated,
    });
    // #endregion
    this.dispatch({ type: 'LOGOUT_REQUESTED' });
    // #region debug-point C-D:forbidden-actor-identity-logout-requested
    reportFoundationForbiddenActorAccountGateDebug(
      'C-D',
      'logout-requested-dispatched',
      {
        phaseKind: this.phase.kind,
        lifecycleState: this.snapshot.lifecycle.state,
        authenticated: useSessionStore.getState().authenticated,
      },
    );
    // #endregion
    let cleanupError: unknown;
    try {
      await useSessionStore.getState().logout();
      // #region debug-point C-D:forbidden-actor-session-logout-resolved
      reportFoundationForbiddenActorAccountGateDebug(
        'C-D',
        'session-logout-resolved',
        {
          phaseKind: this.phase.kind,
          authenticated: useSessionStore.getState().authenticated,
        },
      );
      // #endregion
    } catch (error) {
      cleanupError = error;
      // #region debug-point C-D:forbidden-actor-session-logout-rejected
      reportFoundationForbiddenActorAccountGateDebug(
        'C-D',
        'session-logout-rejected',
        {
          phaseKind: this.phase.kind,
          authenticated: useSessionStore.getState().authenticated,
          errorType: error instanceof Error ? error.name : typeof error,
        },
      );
      // #endregion
    }
    await this.loadAuthGate('logout', false);
    // #region debug-point A-D:forbidden-actor-account-gate-loaded
    reportFoundationForbiddenActorAccountGateDebug(
      'A-D',
      'account-gate-loaded',
      {
        phaseKind: this.phase.kind,
        lifecycleState: this.snapshot.lifecycle.state,
        dataReady: this.dataReady,
        authenticated: useSessionStore.getState().authenticated,
        knownAccountCount: this.knownAccounts.length,
        cleanupErrorPresent: cleanupError !== undefined,
      },
    );
    // #endregion
    if (cleanupError) {
      throw cleanupError;
    }
  };

  revalidateIfNeeded = (): void => {
    const state = this.snapshot.lifecycle.state;
    const { authenticated } = useSessionStore.getState();
    if (state !== 'ready' || authenticated) return;
    this.resolveSession('live').catch(() => {});
  };

  private acceptAuthenticatedEdgeFromCurrentSession = async (
    kind: Parameters<typeof identityAuthenticatedEdge>[0],
  ): Promise<void> => {
    const user = currentSessionUser();
    if (!user) return;
    await this.acceptAuthenticatedEdge(identityAuthenticatedEdge(kind, user));
  };

  private acceptAuthenticatedEdge = async (edge: IdentityAuthenticatedEdge): Promise<void> => {
    markRendererAuthenticated();
    if (edge.kind !== 'applet_launch') {
      restoreLastActivePage();
    }
    this.restoredUser = edge.user;
    this.knownAccounts = [edge.user];
    this.dataReady = true;
    log.info('identity', 'authenticated edge accepted', {
      edge: edge.kind,
      completion: edge.completion,
      actorPtid: useSessionStore.getState().currentUser?.actorPtid,
    });
    this.dispatch(edge.event);
    await this.reconcileAuthenticatedIdentity(edge.user, edge.kind);
  };

  private reconcileAuthenticatedIdentity = async (
    seedUser: SessionUser,
    edgeKind: IdentityAuthenticatedEdge['kind'],
  ): Promise<void> => {
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
    } catch (error) {
      log.warn('identity', 'profile sync failed during authenticated reconciliation', {
        edge: edgeKind,
        actorPtid: useSessionStore.getState().currentUser?.actorPtid,
        error: String(error),
      });
      this.dispatch({ type: 'PROFILE_SYNC_FAILED' });
    }

    this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_STARTED' });
    try {
      await useAccountIdentityStore.getState().load();
      const refreshedAccounts = await loadKnownAccountUsers();
      this.knownAccounts = refreshedAccounts.length > 0 ? refreshedAccounts : [reconciledUser];
      const latestUser = currentSessionUser() ?? reconciledUser;
      this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_SUCCEEDED', user: latestUser });
    } catch (error) {
      log.warn('identity', 'account cache refresh failed during authenticated reconciliation', {
        edge: edgeKind,
        actorPtid: useSessionStore.getState().currentUser?.actorPtid,
        error: String(error),
      });
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
      loadKnownAccountUsers().catch(() => [] as SessionUser[]),
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
      loadKnownAccountUsers().then((accounts) => {
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
      beginPinRecovery: this.beginPinRecovery,
      cancelPinRecovery: this.cancelPinRecovery,
      completePinRecovery: this.completePinRecovery,
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
