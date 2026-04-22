import { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '../store/session';
import { useOAuth2Store } from '../store/oauth2';
import { globalContext } from '../kernel/global-context';
import { api } from '../services/desktop_api';
import { onSessionRevoked } from '../services/desktop_api';
import type { AccountIdentity } from '../services/desktop_api';
import type { AppLifecycle, AppState, SessionUser } from '../types/navigation';

const WARM_RESUME_KEY = 'pt.auth.lastActiveAt';
const WARM_RESUME_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function isWarmResume(): boolean {
  try {
    const stored = localStorage.getItem(WARM_RESUME_KEY);
    if (!stored) return false;
    const elapsed = Date.now() - Number(stored);
    return elapsed < WARM_RESUME_THRESHOLD_MS;
  } catch {
    return false;
  }
}

function touchActivity(): void {
  try {
    localStorage.setItem(WARM_RESUME_KEY, String(Date.now()));
  } catch {
    // noop
  }
}

/** Clear warm-resume marker so next reload lands on onboarding. */
export function clearWarmResume(): void {
  try {
    localStorage.removeItem(WARM_RESUME_KEY);
  } catch {
    // noop
  }
}

function accountToSessionUser(account: AccountIdentity): SessionUser {
  return {
    name: account.name || account.provider_user_id || 'User',
    email: account.email || '',
    avatar: account.avatar_url || undefined,
    accountId: account.id,
    hasPin: account.has_pin,
    provider: account.provider,
  };
}

export function useAppLifecycle(): AppLifecycle {
  const warm = isWarmResume();
  const [state, setState] = useState<AppState>(warm ? 'resuming' : 'onboarding');
  const [restoredUser, setRestoredUser] = useState<SessionUser | null>(null);
  const [knownAccounts, setKnownAccounts] = useState<SessionUser[]>([]);
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    globalContext.bootstrap().catch(() => {});
  }, []);

  // Global auth guard: if the backend revokes/expires the session, exit to onboarding.
  useEffect(() => {
    const off = onSessionRevoked(() => {
      clearWarmResume();
      // Clear global snapshot slice; session store is cleared by App handler.
      globalContext.runPipeline('session_logout').catch(() => {});
      setRestoredUser(null);
      setState('onboarding');
    });
    const unsub = useSessionStore.subscribe((s) => {
      // Defensive: if auth flips false while in ready, ensure we don't keep showing app pages.
      if (!s.authenticated) {
        clearWarmResume();
        setRestoredUser(null);
        setState('onboarding');
      }
    });
    return () => {
      off();
      unsub();
    };
  }, []);

  useEffect(() => {
    if (state === 'ready') {
      globalContext.setRuntimeAppState('ready');
    } else {
      globalContext.setRuntimeAppState('booting');
    }
  }, [state]);

  useEffect(() => {
    const session = useSessionStore.getState();
    const oauth2 = useOAuth2Store.getState();

    Promise.all([
      session.restoreSession().catch(() => {}),
      oauth2.loadAll().catch(() => {}),
      api.accountListRestorable().catch(() => [] as AccountIdentity[]),
    ]).then(([, , restorableAccounts]) => {
      const { currentUser, authenticated } = useSessionStore.getState();
      // Only set restoredUser when the session has real identity data.
      // A session restored from a stale local token may have an empty name/actorId —
      // in that case we must NOT show "Welcome back" and should fall through to login.
      const hasRealIdentity = authenticated && currentUser && currentUser.actorId;
      if (hasRealIdentity) {
        const displayName = currentUser.name?.trim() || currentUser.email?.trim() || '';
        if (displayName) {
          setRestoredUser({
            name: displayName,
            email: currentUser.email || '',
            avatar: currentUser.avatarUrl,
          });
        }
      }

      // Load all accounts that have restorable sessions
      if (Array.isArray(restorableAccounts) && restorableAccounts.length > 0) {
        setKnownAccounts(restorableAccounts.map(accountToSessionUser));
      }

      setDataReady(true);

      if (warm && hasRealIdentity) {
        touchActivity();
        setState('ready');
      } else if (warm) {
        // Warm resume failed — session expired or missing, fall back to onboarding
        clearWarmResume();
        setState('onboarding');
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const completeLogin = useCallback(() => {
    // Guard: never enter ready state without a valid authenticated session
    const { authenticated } = useSessionStore.getState();
    if (!authenticated) return;

    touchActivity();
    useOAuth2Store.getState().loadAll().catch(() => {});
    setState('ready');
  }, []);

  return { state, restoredUser, knownAccounts, dataReady, completeLogin };
}
