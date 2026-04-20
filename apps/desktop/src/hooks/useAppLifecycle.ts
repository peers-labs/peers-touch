import { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '../store/session';
import { useOAuth2Store } from '../store/oauth2';
import { globalContext } from '../kernel/global-context';
import { api } from '../services/desktop_api';
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
      if (authenticated && currentUser) {
        setRestoredUser({
          name: currentUser.name || 'User',
          email: currentUser.email || '',
          avatar: currentUser.avatarUrl,
        });
      }

      // Load all accounts that have restorable sessions
      if (Array.isArray(restorableAccounts) && restorableAccounts.length > 0) {
        setKnownAccounts(restorableAccounts.map(accountToSessionUser));
      }

      setDataReady(true);

      if (warm && authenticated && currentUser) {
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
