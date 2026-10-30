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
import { DEFAULT_READY_PAGE, type AppLifecycle, type SessionUser } from '../types/navigation';
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
  type IdentityReadiness,
} from './identityLifecycle';
import { avatarAssets, type AvatarPrepareStatus } from '../services/avatarAssets';
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

function restoreLastActivePage(preservePage: boolean): void {
  if (!preservePage) {
    window.history.replaceState(null, '', `#/${DEFAULT_READY_PAGE}`);
    return;
  }
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
    avatarLocalPath: account.avatar_local_path || undefined,
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
    avatarLocalPath: current.avatarLocalPath,
    avatarState: current.avatarState,
    profileRevision: current.profileRevision,
    hasSession: true,
    provider: current.loginProvider || current.loginMethod,
  };
}

/**
 * Merge an authoritative Station profile into the session seed user.
 *
 * The native response carries a typed `avatar_state` and canonical
 * `avatar_identity`: an authoritative ABSENT (empty identity) clears the
 * avatar projection instead of falling back to the seed (the old
 * `profile.avatar_url || user.avatar` swallowed ABSENT and kept stale images).
 * Legacy responses without those fields keep the historical URL merge.
 */
function userWithSyncedProfile(
  user: SessionUser,
  profile: Awaited<ReturnType<typeof api.syncUserProfile>>,
): SessionUser {
  const canonical = profile.avatar_identity;
  const hasCanonicalIdentity = typeof canonical === 'string';
  const identity = hasCanonicalIdentity
    ? canonical.trim()
    : (profile.avatar_url || user.avatar || '').trim();
  let avatarState: SessionUser['avatarState'];
  if (profile.avatar_state) {
    avatarState = profile.avatar_state;
  } else if (hasCanonicalIdentity) {
    avatarState = identity ? 'ready' : 'absent';
  } else {
    avatarState = user.avatarState;
  }
  return {
    ...user,
    name: profile.name || user.name,
    email: profile.email || user.email,
    avatar: identity || undefined,
    avatarLocalPath: profile.avatar_local_path ?? user.avatarLocalPath,
    avatarState,
    profileRevision: typeof profile.profile_revision === 'number'
      ? profile.profile_revision
      : user.profileRevision,
  };
}

type FreshCompletionPolicy = 'local-decode' | 'network-sync';

/** Fresh OAuth/PIN completion waits up to 2s from the user action. */
const FRESH_COMPLETION_BUDGET_MS = 2_000;
/**
 * Fresh password completion and restored edges wait only for a local
 * last-good/login-response decode. The network profile reconciliation runs
 * in the background and never blocks the shell.
 */
const LOCAL_AVATAR_DECODE_BUDGET_MS = 250;

interface SessionFence {
  epoch: number;
  actorPtid: string;
}

interface PendingCompletion {
  policy: FreshCompletionPolicy;
  fence: SessionFence;
  /** Network/account reconciliation. Never blocks password completion. */
  closure: Promise<void>;
  /** Avatar readiness gate the completion action waits on. */
  avatarGate: Promise<AvatarPrepareStatus>;
}

function captureSessionFence(): SessionFence | null {
  const { sessionEpoch, currentUser } = useSessionStore.getState();
  if (!currentUser?.actorPtid) return null;
  return { epoch: sessionEpoch, actorPtid: currentUser.actorPtid };
}

function fenceIsLive(fence: SessionFence | null): boolean {
  if (!fence) return false;
  const { sessionEpoch, currentUser } = useSessionStore.getState();
  return sessionEpoch === fence.epoch && currentUser?.actorPtid === fence.actorPtid;
}

function avatarQueryForUser(user: SessionUser, fence: SessionFence | null) {
  const { currentUser } = useSessionStore.getState();
  return {
    identity: user.avatar ?? '',
    actorPtid: fence?.actorPtid ?? currentUser?.actorPtid ?? null,
    stationScope: null as string | null,
    profileRevision: user.profileRevision ?? null,
    epoch: fence?.epoch ?? useSessionStore.getState().sessionEpoch,
    localPath: user.avatarLocalPath ?? currentUser?.avatarLocalPath ?? null,
  };
}

function avatarPresentationStatus(status: string): IdentityReadiness['avatar'] {
  if (status === 'ready') return 'remoteKnown';
  if (status === 'absent') return 'absent';
  return 'degraded';
}

function timeoutSignal(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    setTimeout(() => resolve('timeout'), Math.max(0, ms));
  });
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

function isOAuthAcknowledgementPending(error: unknown): boolean {
  return error instanceof AuthCommandException
    && error.code === 'UNAUTHORIZED'
    && error.details?.reason === 'oauth_acknowledgement_pending';
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

  private oauthAcknowledgementRetryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Fresh-login completion closure (profile/account/avatar). Lives while the
   * phase is `authenticatedPendingCompletion`; `completeCurrentSession`
   * bounds it with the 2s fresh-edge budget before LOGIN_COMPLETED.
   */
  private pendingCompletion: PendingCompletion | null = null;

  /** Shared in-flight completion; prevents double tap / racing PIN actions. */
  private completionInFlight: Promise<void> | null = null;

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
    if (this.oauthAcknowledgementRetryTimer) {
      clearTimeout(this.oauthAcknowledgementRetryTimer);
      this.oauthAcknowledgementRetryTimer = null;
    }
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
      if (isOAuthAcknowledgementPending(error)) {
        this.oauthAcknowledgementRetryTimer = setTimeout(() => {
          this.oauthAcknowledgementRetryTimer = null;
          void this.resolveSession(source);
        }, 2000);
        return;
      }
      await this.loadAuthGate(classifyRestoreFailure(error), false);
    }
  };

  completeCurrentSession = async (): Promise<void> => {
    // Re-entrant calls (double tap / PIN + skip racing) share one completion.
    if (this.completionInFlight) return this.completionInFlight;
    this.completionInFlight = this.runCompleteCurrentSession().finally(() => {
      this.completionInFlight = null;
    });
    return this.completionInFlight;
  };

  private async runCompleteCurrentSession(): Promise<void> {
    const { authenticated } = useSessionStore.getState();
    if (!authenticated) return;
    const user = currentSessionUser();
    if (!user) return;

    // The budget starts at the user action and covers Station binding plus
    // the avatar gate; only the remaining budget is spent on the gate.
    const pending = this.pendingCompletion;
    const budget = pending?.policy === 'local-decode'
      ? LOCAL_AVATAR_DECODE_BUDGET_MS
      : FRESH_COMPLETION_BUDGET_MS;
    const deadline = Date.now() + budget;

    await api.stationBindingComplete();
    useOAuth2Store.getState().loadAll().catch(() => {});

    if (this.phase.kind === 'authenticatedPendingCompletion') {
      const completed = await this.settleFreshCompletion(user, deadline);
      if (!completed) return; // fenced by a newer session; it owns completion
      this.restoredUser = user;
      this.dataReady = true;
      this.dispatch({ type: 'LOGIN_COMPLETED', user: currentSessionUser() ?? user });
      return;
    }
    await this.acceptAuthenticatedEdge(identityAuthenticatedEdge('completed_login', user));
  }

  /**
   * Production password path: the login card drives the Station access-gate
   * chain itself, but the authenticated edge MUST still close through the
   * identity state machine. Called right after the session store lands the
   * password session, before the PIN decision UI runs.
   */
  freshPasswordAuthenticated = async (): Promise<void> => {
    await this.acceptAuthenticatedEdgeFromCurrentSession('fresh_login', 'local-decode');
  };

  /**
   * Settle the pending fresh closure under the remaining edge budget.
   *
   * Password edges wait only for the 250ms local decode gate while profile
   * reconciliation continues in the background; OAuth edges wait for the
   * network closure + decode (2s). A lapsed budget or a late older session
   * enters the shell degraded without dispatching stale state.
   */
  private settleFreshCompletion = async (seedUser: SessionUser, deadline: number): Promise<boolean> => {
    const pending = this.pendingCompletion;
    this.pendingCompletion = null;
    if (!pending) {
      this.dispatchAvatarPresentation('ready');
      return true;
    }
    // A newer login/switch superseded this closure; never complete or paint
    // the old actor.
    if (!fenceIsLive(pending.fence)) {
      log.warn('identity', 'fresh completion fenced by a newer session; dropping completion', {
        actorPtid: seedUser.accountId,
      });
      return false;
    }

    const remainingMs = Math.max(0, deadline - Date.now());
    if (pending.policy === 'local-decode') {
      const outcome = await Promise.race([
        pending.avatarGate,
        timeoutSignal(remainingMs),
      ]);
      if (outcome === 'timeout') {
        this.dispatch({ type: 'AVATAR_PRESENTATION_UPDATED', status: 'degraded' });
        // Decode may still finish; adopt it only while the fence is live.
        void pending.avatarGate.then((status) => {
          if (fenceIsLive(pending.fence)) this.dispatchAvatarPresentation(status);
        });
      } else {
        this.dispatchAvatarPresentation(outcome);
      }
      // Network closure is intentionally not awaited; it updates the
      // authenticated phase in the background under its own fence.
      return fenceIsLive(pending.fence);
    }

    const settled = await Promise.race([
      pending.avatarGate.then((status) => status as AvatarPrepareStatus | 'timeout'),
      timeoutSignal(remainingMs),
    ]);
    if (!fenceIsLive(pending.fence)) {
      return false;
    }
    if (settled === 'timeout') {
      log.warn('identity', 'fresh completion budget lapsed; entering shell degraded', {
        actorPtid: seedUser.accountId,
      });
      this.dispatch({ type: 'AVATAR_PRESENTATION_UPDATED', status: 'degraded' });
      void pending.avatarGate.then((status) => {
        if (fenceIsLive(pending.fence)) this.dispatchAvatarPresentation(status);
      });
      return true;
    }
    this.dispatchAvatarPresentation(settled);
    return true;
  };

  private dispatchAvatarPresentation(status: AvatarPrepareStatus | 'ready' | 'absent'): void {
    this.dispatch({
      type: 'AVATAR_PRESENTATION_UPDATED',
      status: avatarPresentationStatus(status),
    });
  }

  loginWithPassword = async (account: string, password: string): Promise<void> => {
    const session = useSessionStore.getState();
    const decision = await session.accessStart();
    const gate = currentGate(decision);
    if (
      !decision.attemptId
      || !gate
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
    await session.accessSubmitLogin(decision.attemptId, gate, account, password);
    await this.acceptAuthenticatedEdgeFromCurrentSession('fresh_login', 'local-decode');
  };

  loginWithOAuthBridge = async (): Promise<void> => {
    const sessionId = useOAuth2Store.getState().completedLoopbackSessionId;
    if (!sessionId) {
      throw new AuthCommandException({
        code: 'UNAUTHORIZED',
        message: 'oauth loopback session is missing',
      });
    }
    await useSessionStore.getState().loginWithOAuth('oauth');
    await this.acceptAuthenticatedEdgeFromCurrentSession('fresh_login', 'network-sync');
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
    await this.reconcileAuthenticatedIdentity(user, 'completed_login', captureSessionFence());
  };

  refreshCurrentProfile = async (fallbackAvatar?: string): Promise<void> => {
    const user = currentSessionUser();
    if (!user) return;
    // Fence captured before the first await; a newer login/switch drops all
    // resulting writes and events.
    const fence = captureSessionFence();
    this.dispatch({ type: 'PROFILE_SYNC_STARTED' });
    let refreshedUser = user;
    try {
      const profile = await api.syncUserProfile();
      if (!fenceIsLive(fence)) return;
      refreshedUser = userWithSyncedProfile(user, profile);
      useSessionStore.getState().updateProfile({
        name: refreshedUser.name,
        email: refreshedUser.email,
        avatarUrl: refreshedUser.avatar,
        avatarLocalPath: refreshedUser.avatarLocalPath,
        avatarState: refreshedUser.avatarState,
        profileRevision: refreshedUser.profileRevision,
      }, fence ?? undefined);
      this.restoredUser = refreshedUser;
      this.dispatch({ type: 'PROFILE_SYNC_SUCCEEDED', user: refreshedUser });
    } catch (error) {
      if (!fallbackAvatar) {
        if (fenceIsLive(fence)) this.dispatch({ type: 'PROFILE_SYNC_FAILED' });
        throw error;
      }
      if (!fenceIsLive(fence)) return;
      // The fallback entry point shares the canonical typed contract; an
      // authoritative ABSENT must not silently resurrect a stale avatar.
      const synced = await api.accountSyncAvatar(fallbackAvatar);
      if (!fenceIsLive(fence)) return;
      if (synced.state !== 'absent') {
        refreshedUser = {
          ...user,
          avatar: synced.identity || fallbackAvatar,
          avatarLocalPath: synced.local_path ?? user.avatarLocalPath,
          avatarState: synced.state === 'ready' ? 'ready' : 'failed',
        };
      } else {
        refreshedUser = { ...user, avatar: undefined, avatarState: 'absent' };
      }
      useSessionStore.getState().updateProfile({
        name: refreshedUser.name,
        email: refreshedUser.email,
        avatarUrl: refreshedUser.avatar,
        avatarLocalPath: refreshedUser.avatarLocalPath,
        avatarState: refreshedUser.avatarState,
      }, fence ?? undefined);
      this.restoredUser = refreshedUser;
      this.dispatch({ type: 'PROFILE_SYNC_SUCCEEDED', user: refreshedUser });
    }

    if (!fenceIsLive(fence)) return;
    this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_STARTED' });
    try {
      await useAccountIdentityStore.getState().load();
      if (!fenceIsLive(fence)) return;
      const refreshedAccounts = await loadKnownAccountUsers();
      if (!fenceIsLive(fence)) return;
      this.knownAccounts = refreshedAccounts.length > 0 ? refreshedAccounts : [refreshedUser];
      this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_SUCCEEDED', user: currentSessionUser() ?? refreshedUser });
    } catch {
      if (fenceIsLive(fence)) this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_FAILED' });
    }
    if (fenceIsLive(fence)) {
      await useSocialChatStore.getState().loadCurrentUserProfile();
    }
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
    if (this.oauthAcknowledgementRetryTimer) {
      clearTimeout(this.oauthAcknowledgementRetryTimer);
      this.oauthAcknowledgementRetryTimer = null;
    }
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
    freshPolicy: FreshCompletionPolicy = 'network-sync',
  ): Promise<void> => {
    const user = currentSessionUser();
    if (!user) return;
    await this.acceptAuthenticatedEdge(identityAuthenticatedEdge(kind, user), freshPolicy);
  };

  private acceptAuthenticatedEdge = async (
    edge: IdentityAuthenticatedEdge,
    freshPolicy: FreshCompletionPolicy = 'network-sync',
  ): Promise<void> => {
    markRendererAuthenticated();
    if (edge.kind !== 'applet_launch') {
      restoreLastActivePage(edge.kind === 'restored_session' && this.initialBootReason === 'renderer_reload');
    }
    this.restoredUser = edge.user;
    this.knownAccounts = [edge.user];
    this.dataReady = true;
    // Capture the session/actor before any await so late responses from an
    // older login can never overwrite the current projection.
    const fence = captureSessionFence();
    log.info('identity', 'authenticated edge accepted', {
      edge: edge.kind,
      completion: edge.completion,
      actorPtid: useSessionStore.getState().currentUser?.actorPtid,
    });
    this.dispatch(edge.event);

    if (edge.kind === 'applet_launch') {
      // Synthetic applet actors carry no avatar; skip all asset preparation.
      return;
    }

    if (edge.kind === 'fresh_login') {
      this.beginFreshCompletion(edge.user, freshPolicy, fence);
      return;
    }

    // Restored/PIN/switch edges show the shell immediately with a neutral
    // placeholder; only a local last-good decode gates the first paint (250ms),
    // network reconciliation continues in the background.
    const localQuery = avatarQueryForUser(edge.user, fence);
    void avatarAssets
      .prepare(localQuery, {
        budgetMs: LOCAL_AVATAR_DECODE_BUDGET_MS,
        localOnly: true,
      })
      .then((result) => {
        if (!fenceIsLive(fence)) return;
        if (result.status === 'ready' || result.status === 'absent' || result.status === 'degraded') {
          this.dispatchAvatarPresentation(result.status);
        }
      });
    await this.reconcileAuthenticatedIdentity(edge.user, edge.kind, fence);
  };

  /**
   * Start the pending-completion closure for a fresh edge. Password edges only
   * gate the 250ms local decode fast lane (the login response already carries
   * the materialized path) while profile/account reconciliation runs in the
   * background; OAuth edges gate canonical profile sync + decode under 2s.
   */
  private beginFreshCompletion(
    seedUser: SessionUser,
    policy: FreshCompletionPolicy,
    fence: SessionFence | null,
  ): void {
    // Any older pending closure is superseded; the new edge owns completion.
    this.pendingCompletion = null;
    if (!fence) {
      log.warn('identity', 'fresh edge without a session fence; skipping avatar gate');
      void this.reconcileAuthenticatedIdentity(seedUser, 'fresh_login', null);
      return;
    }

    let avatarGate: Promise<AvatarPrepareStatus>;
    if (policy === 'local-decode') {
      avatarGate = avatarAssets
        .prepare(avatarQueryForUser(seedUser, fence), {
          budgetMs: LOCAL_AVATAR_DECODE_BUDGET_MS,
          localOnly: true,
          force: true,
        })
        .then((result) => result.status);
      const closure = this.reconcileAuthenticatedIdentity(seedUser, 'fresh_login', fence)
        .then(() => undefined);
      this.pendingCompletion = { policy, fence, closure, avatarGate };
      return;
    }

    const gate = this.reconcileAuthenticatedIdentity(seedUser, 'fresh_login', fence)
      .then((reconciled) => {
        if (!fenceIsLive(fence)) return 'fenced' as const;
        return avatarAssets
          .prepare(avatarQueryForUser(reconciled, fence), {
            budgetMs: FRESH_COMPLETION_BUDGET_MS,
            force: true,
          })
          .then((result) => result.status);
      });
    this.pendingCompletion = {
      policy,
      fence,
      closure: gate.then(() => undefined),
      avatarGate: gate,
    };
  }

  private reconcileAuthenticatedIdentity = async (
    seedUser: SessionUser,
    edgeKind: IdentityAuthenticatedEdge['kind'],
    edgeFence: SessionFence | null,
  ): Promise<SessionUser> => {
    // Fence captured at closure start (callers that did not already capture
    // one get the current session). Every await below is re-checked against it.
    const fence = edgeFence ?? captureSessionFence();
    let reconciledUser = seedUser;

    this.dispatch({ type: 'PROFILE_SYNC_STARTED' });
    try {
      const profile = await api.syncUserProfile();
      if (!fenceIsLive(fence)) {
        // Late profile from an older login/switch: drop without touching
        // either the session mirror or reducer substates.
        log.warn('identity', 'profile sync response fenced; dropping', { edge: edgeKind });
        return seedUser;
      }
      reconciledUser = userWithSyncedProfile(reconciledUser, profile);
      useSessionStore.getState().updateProfile({
        name: reconciledUser.name,
        email: reconciledUser.email,
        avatarUrl: reconciledUser.avatar,
        avatarLocalPath: reconciledUser.avatarLocalPath,
        avatarState: reconciledUser.avatarState,
        profileRevision: reconciledUser.profileRevision,
      }, fence ?? undefined);
      this.restoredUser = reconciledUser;
      this.dispatch({ type: 'PROFILE_SYNC_SUCCEEDED', user: reconciledUser });
    } catch (error) {
      // Keep the same-actor last-good avatar; never blank it on sync failure.
      log.warn('identity', 'profile sync failed during authenticated reconciliation', {
        edge: edgeKind,
        actorPtid: useSessionStore.getState().currentUser?.actorPtid,
        error: String(error),
      });
      if (fenceIsLive(fence)) {
        this.dispatch({ type: 'PROFILE_SYNC_FAILED' });
      }
    }

    if (!fenceIsLive(fence)) return seedUser;

    this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_STARTED' });
    try {
      await useAccountIdentityStore.getState().load();
      if (!fenceIsLive(fence)) return seedUser;
      const refreshedAccounts = await loadKnownAccountUsers();
      if (!fenceIsLive(fence)) return seedUser;
      this.knownAccounts = refreshedAccounts.length > 0 ? refreshedAccounts : [reconciledUser];
      const latestUser = currentSessionUser() ?? reconciledUser;
      this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_SUCCEEDED', user: latestUser });
    } catch (error) {
      log.warn('identity', 'account cache refresh failed during authenticated reconciliation', {
        edge: edgeKind,
        actorPtid: useSessionStore.getState().currentUser?.actorPtid,
        error: String(error),
      });
      if (fenceIsLive(fence)) {
        this.dispatch({ type: 'ACCOUNT_CACHE_REFRESH_FAILED' });
      }
    }
    return reconciledUser;
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
      freshPasswordAuthenticated: this.freshPasswordAuthenticated,
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
