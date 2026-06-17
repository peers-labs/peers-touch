import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useSessionStore } from '../store/session';
import { useOAuth2Store } from '../store/oauth2';
import { useAccountIdentityStore } from '../store/accountIdentity';
import { EVENT, eventBus } from '../kernel/events';
import { globalContext } from '../kernel/global-context';
import {
  DEFAULT_IDENTITY_POLICY,
  identityPhaseAllowsReady,
  identityPhaseNeedsAuthGate,
  identityReducer,
  shouldResolveSessionOnBoot,
  type IdentityAuthGateReason,
  type IdentityBootReason,
  type IdentityPhase,
} from '../kernel/identityLifecycle';
import { markPhaseEnd, markPhaseStart } from '../kernel/boot';
import { api, AuthCommandException, onSessionRevoked } from '../services/desktop_api';
import { removeDesktopPreferenceSync } from '../storage/desktopClientStorage';
import type { AccountIdentity, AppletProductWindowLaunchContext } from '../services/desktop_api';
import type { AppLifecycle, AppState, SessionUser } from '../types/navigation';

const WARM_RESUME_KEY = 'pt.auth.lastActiveAt';
const RENDERER_AUTH_MARKER_KEY = 'pt.identity.rendererAuthenticated';

/** Clear any leftover warm-resume marker (legacy installs). */
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

export function lifecycleNeedsSessionRevalidation(state: AppState, authenticated: boolean): boolean {
  return state === 'ready' && !authenticated;
}

export function useAppLifecycle(): AppLifecycle {
  const initialBootReasonRef = useRef<IdentityBootReason>(readRendererBootReason());
  const [identityPhase, dispatchIdentity] = useReducer(identityReducer, {
    kind: 'booting',
    reason: initialBootReasonRef.current,
  } satisfies IdentityPhase);
  const state = appStateFromIdentity(identityPhase);
  const [restoredUser, setRestoredUser] = useState<SessionUser | null>(null);
  const [knownAccounts, setKnownAccounts] = useState<SessionUser[]>([]);
  const [dataReady, setDataReady] = useState(false);
  const sessionAuthenticated = useSessionStore((s) => s.authenticated);
  const revalidatingSessionRef = useRef(false);
  const bootStartedRef = useRef(false);

  const loadAuthGate = useCallback(async (
    reason: IdentityAuthGateReason,
    runLogoutPipeline: boolean,
  ) => {
    clearWarmResume();
    clearRendererAuthenticated();
    setRestoredUser(null);
    dispatchIdentity({ type: 'ACCOUNT_GATE_READY', reason });
    if (runLogoutPipeline) {
      globalContext.runPipeline('session_logout').catch(() => {});
    }
    const oauth2 = useOAuth2Store.getState();
    const [, restorableAccounts] = await Promise.all([
      oauth2.loadAll().catch(() => {}),
      loadKnownAccountUsers(false).catch(() => [] as SessionUser[]),
    ]);
    setKnownAccounts(restorableAccounts);
    setDataReady(true);
  }, []);

  const resolveSession = useCallback(async (source: 'live' | 'disk' | 'applet') => {
    dispatchIdentity({ type: 'SESSION_RESOLVE_STARTED', source });
    try {
      await useSessionStore.getState().restoreSession();
      const user = currentSessionUser();
      if (!user) {
        await loadAuthGate('session_missing', false);
        return;
      }
      markRendererAuthenticated();
      setRestoredUser(user);
      setKnownAccounts([user]);
      setDataReady(true);
      dispatchIdentity({ type: 'SESSION_RESTORED', source: 'restore', user });
    } catch (error) {
      await loadAuthGate(classifyRestoreFailure(error), false);
    }
  }, [loadAuthGate]);

  useEffect(() => {
    clearWarmResume();
    globalContext.bootstrap().catch(() => {});
  }, []);

  useEffect(() => {
    const off = onSessionRevoked(() => {
      dispatchIdentity({ type: 'SESSION_REVOKED', reason: 'revoked' });
      loadAuthGate('revoked', true).catch(() => {});
    });
    return off;
  }, [loadAuthGate]);

  useEffect(() => {
    if (!lifecycleNeedsSessionRevalidation(state, sessionAuthenticated)) return;
    if (revalidatingSessionRef.current) return;

    revalidatingSessionRef.current = true;
    resolveSession('live').finally(() => {
      revalidatingSessionRef.current = false;
    });
  }, [resolveSession, sessionAuthenticated, state]);

  useEffect(() => {
    if (!identityPhaseNeedsAuthGate(identityPhase)) return;
    let cancelled = false;
    const refreshKnownAccounts = () => {
      const { authenticated } = useSessionStore.getState();
      loadKnownAccountUsers(authenticated).then((accounts) => {
        if (!cancelled) setKnownAccounts(accounts);
      }).catch(() => {
        if (!cancelled) setKnownAccounts([]);
      });
    };
    refreshKnownAccounts();
    const unsubscribeIdentity = eventBus.subscribe(EVENT.AUTH_IDENTITY_CHANGED, refreshKnownAccounts);
    return () => {
      cancelled = true;
      unsubscribeIdentity();
    };
  }, [identityPhase]);

  useEffect(() => {
    if (identityPhaseAllowsReady(identityPhase)) {
      globalContext.setRuntimeAppState('ready');
    } else {
      globalContext.setRuntimeAppState('booting');
    }
  }, [identityPhase]);

  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    const bootReason = initialBootReasonRef.current;
    dispatchIdentity({ type: 'BOOT_STARTED', reason: bootReason });
    dispatchIdentity({ type: 'LAUNCH_CONTEXT_CHECK_STARTED' });
    markPhaseStart('identity');

    api.appletsProductWindowLaunchContext().catch(() => ({ enabled: false })).then((context) => {
      if (activateAppletProductWindowLaunch(context)) {
        const launchUser = appletLaunchContextToSessionUser(context);
        markRendererAuthenticated();
        setRestoredUser(launchUser);
        setKnownAccounts([launchUser]);
        setDataReady(true);
        dispatchIdentity({ type: 'APPLET_LAUNCH_AUTHENTICATED', user: launchUser });
        markPhaseEnd('identity', { state: 'authenticated', reason: 'applet_launch' });
        return;
      }

      if (shouldResolveSessionOnBoot(bootReason, DEFAULT_IDENTITY_POLICY)) {
        return resolveSession('live').finally(() => {
          markPhaseEnd('identity', {
            state: useSessionStore.getState().authenticated ? 'authenticated' : 'accountGate',
            reason: bootReason,
          });
        });
      }

      return loadAuthGate('cold_policy', false).finally(() => {
        markPhaseEnd('identity', { state: 'accountGate', reason: bootReason });
      });
    });
  }, [loadAuthGate, resolveSession]);

  const completeLogin = useCallback(() => {
    const { authenticated } = useSessionStore.getState();
    if (!authenticated) return;
    const user = currentSessionUser();
    if (!user) return;

    markRendererAuthenticated();
    setRestoredUser(user);
    dispatchIdentity({ type: 'LOGIN_SUCCEEDED', user });

    useOAuth2Store.getState().loadAll().catch(() => {});

    // Background: sync user profile from Station (downloads avatar to local cache).
    // Update session store avatar so sidebar reflects the latest.
    api.syncUserProfile().then((result) => {
      if (result?.avatar_url) {
        useSessionStore.getState().updateAvatar(result.avatar_url);
      }
      return useAccountIdentityStore.getState().load();
    }).catch(() => {});
  }, []);

  return {
    state,
    authenticated: identityPhaseAllowsReady(identityPhase),
    restoredUser,
    knownAccounts,
    dataReady,
    completeLogin,
  };
}
