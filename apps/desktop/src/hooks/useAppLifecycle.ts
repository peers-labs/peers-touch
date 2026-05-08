import { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '../store/session';
import { useOAuth2Store } from '../store/oauth2';
import { globalContext } from '../kernel/global-context';
import { api } from '../services/desktop_api';
import { onSessionRevoked } from '../services/desktop_api';
import type { AccountIdentity } from '../services/desktop_api';
import type { AppLifecycle, AppState, SessionUser } from '../types/navigation';

// Warm-resume / auto-login on launch is intentionally disabled.
// Project policy: every launch (including dev-dual where two windows boot
// simultaneously) MUST land on the account picker. Even with a single known
// account the user explicitly selects it. This keeps multi-account isolation
// observable and prevents two windows in dev-dual from silently materialising
// as the same identity from a shared on-disk session blob.
const WARM_RESUME_KEY = 'pt.auth.lastActiveAt';

/** Clear any leftover warm-resume marker (legacy installs). */
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
    hasSession: account.has_session,
    provider: account.provider,
  };
}

export function useAppLifecycle(): AppLifecycle {
  // Always start at 'onboarding' — auto-login is forbidden by policy.
  const [state, setState] = useState<AppState>('onboarding');
  const [restoredUser, setRestoredUser] = useState<SessionUser | null>(null);
  const [knownAccounts, setKnownAccounts] = useState<SessionUser[]>([]);
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    // Drop any legacy warm-resume marker so older clients converge on the
    // new "always show picker" policy on first launch.
    clearWarmResume();
    globalContext.bootstrap().catch(() => {});
  }, []);

  // Global auth guard: if the backend revokes/expires the session, exit to onboarding.
  useEffect(() => {
    const off = onSessionRevoked(() => {
      clearWarmResume();
      void (async () => {
        try {
          const active = await api.accountGetActive();
          if (active?.id) await api.accountClearSession(active.id);
        } catch {
          // Keep revocation handling moving even if the local account file is unavailable.
        }
        globalContext.runPipeline('session_logout').catch(() => {});
        setRestoredUser(null);
        setState('onboarding');
      })();
    });
    const unsub = useSessionStore.subscribe((s) => {
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

  // Re-fetch account list whenever we land on onboarding so the account
  // picker always reflects the latest identities.json data (names, avatars).
  useEffect(() => {
    if (state !== 'onboarding') return;
    api.accountListRestorable().then((accounts) => {
      if (Array.isArray(accounts) && accounts.length > 0) {
        const mapped = accounts.map(accountToSessionUser);
        const { authenticated } = useSessionStore.getState();
        // Non-PIN accounts share a single session.json; when the active session
        // is gone, their token shadows are also gone. PIN-protected accounts
        // each have their own per-account encrypted_session that is independent
        // from the in-memory session, so keep their hasSession flag intact.
        if (!authenticated) {
          mapped.forEach(a => { if (!a.hasPin) a.hasSession = false; });
        }
        setKnownAccounts(mapped);
      } else {
        setKnownAccounts([]);
      }
    }).catch(() => {});
  }, [state]);

  useEffect(() => {
    if (state === 'ready') {
      globalContext.setRuntimeAppState('ready');
    } else {
      globalContext.setRuntimeAppState('booting');
    }
  }, [state]);

  useEffect(() => {
    // On launch, do NOT auto-restore the in-memory session. We only need the
    // OAuth2 connections (for the picker UI) and the on-disk identities list
    // so the user can choose an account explicitly.
    const oauth2 = useOAuth2Store.getState();

    Promise.all([
      oauth2.loadAll().catch(() => {}),
      api.accountListRestorable().catch(() => [] as AccountIdentity[]),
    ]).then(([, restorableAccounts]) => {
      // Load all accounts that have restorable sessions. Since the in-memory
      // session was intentionally NOT restored, treat all non-PIN accounts as
      // having no live session (they share the global session.json and we
      // refuse to silently adopt it). PIN-protected accounts keep their flag
      // because their encrypted_session is independent and unlock requires
      // explicit PIN entry by the user.
      if (Array.isArray(restorableAccounts) && restorableAccounts.length > 0) {
        const accounts = restorableAccounts.map(accountToSessionUser);
        accounts.forEach(a => { if (!a.hasPin) a.hasSession = false; });
        setKnownAccounts(accounts);
      }

      setDataReady(true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const completeLogin = useCallback(() => {
    // Guard: never enter ready state without a valid authenticated session
    const { authenticated } = useSessionStore.getState();
    if (!authenticated) return;

    useOAuth2Store.getState().loadAll().catch(() => {});

    // Background: sync user profile from Station (downloads avatar to local cache).
    // Update session store avatar so sidebar reflects the latest.
    api.syncUserProfile().then((result) => {
      if (result?.avatar_url) {
        useSessionStore.getState().updateAvatar(result.avatar_url);
      }
    }).catch(() => {});
    setState('ready');
  }, []);

  return { state, restoredUser, knownAccounts, dataReady, completeLogin };
}
