import { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '../store/session';
import { useOAuth2Store } from '../store/oauth2';
import { globalContext } from '../kernel/global-context';
import { api } from '../services/desktop_api';
import { onSessionRevoked } from '../services/desktop_api';
import { readDesktopPreferenceSync, removeDesktopPreferenceSync, writeDesktopPreferenceSync } from '../storage/desktopClientStorage';
import type { AccountIdentity, AppletProductWindowLaunchContext } from '../services/desktop_api';
import type { AppLifecycle, AppState, SessionUser } from '../types/navigation';

// Warm-resume: if the on-disk session is still valid, skip the account picker
// and go straight to ready. This is the primary path for single-account users
// who just want to continue where they left off (especially on applet pages).
//
// Multi-account safety: if there are multiple accounts with sessions, or if the
// only account requires a PIN, we still show the picker.
const WARM_RESUME_KEY = 'pt.auth.lastActiveAt';
const LAST_ACTIVE_PAGE_KEY = 'pt.nav.lastActivePage';

/** Clear any leftover warm-resume marker (legacy installs). */
export function clearWarmResume(): void {
  try {
    removeDesktopPreferenceSync(WARM_RESUME_KEY);
  } catch {
    // noop
  }
}

/** Persist the current page id so it can be restored on warm resume. */
export function persistLastActivePage(page: string): void {
  writeDesktopPreferenceSync(LAST_ACTIVE_PAGE_KEY, page);
}

/** Read and apply the persisted last-active page into the URL hash. */
function restoreLastActivePage(): void {
  const page = readDesktopPreferenceSync<string>(LAST_ACTIVE_PAGE_KEY);
  if (!page) return;
  const targetHash = `#/${page}`;
  if (window.location.hash !== targetHash) {
    window.history.replaceState(null, '', targetHash);
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

export function useAppLifecycle(): AppLifecycle {
  // Always start at 'onboarding' — auto-login is forbidden by policy.
  const [state, setState] = useState<AppState>('onboarding');
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
      globalContext.runPipeline('session_logout').catch(() => {});
      setRestoredUser(null);
      setState('onboarding');
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
    // On launch, attempt warm resume: if the on-disk session is still valid
    // and belongs to a single non-PIN account, skip the picker entirely.
    // This eliminates the "refresh on every launch" issue for single-user setups.
    const oauth2 = useOAuth2Store.getState();

    api.appletsProductWindowLaunchContext().catch(() => ({ enabled: false })).then((context) => {
      if (activateAppletProductWindowLaunch(context)) {
        const launchUser = appletLaunchContextToSessionUser(context);
        setRestoredUser(launchUser);
        setKnownAccounts([launchUser]);
        setDataReady(true);
        setState('ready');
        return;
      }

      // Try warm resume: restore the existing session without user interaction
      return useSessionStore.getState().restoreSession().then(() => {
        const { authenticated, currentUser } = useSessionStore.getState();
        if (authenticated && currentUser) {
          // Warm resume succeeded — restore last page and go straight to ready
          restoreLastActivePage();
          setRestoredUser({
            name: currentUser.name || currentUser.actorId || 'User',
            email: '',
            accountId: currentUser.actorId,
            hasPin: false,
            hasSession: true,
            provider: currentUser.loginProvider || currentUser.loginMethod,
          });
          setDataReady(true);
          setState('ready');

          // Background profile sync (same as completeLogin)
          api.syncUserProfile().then((result) => {
            if (result?.avatar_url) {
              useSessionStore.getState().updateAvatar(result.avatar_url);
            }
          }).catch(() => {});
          return;
        }

        // Session restore failed — fall back to the account picker
        return Promise.all([
          oauth2.loadAll().catch(() => {}),
          api.accountListRestorable().catch(() => [] as AccountIdentity[]),
        ]).then(([, restorableAccounts]) => {
          if (Array.isArray(restorableAccounts) && restorableAccounts.length > 0) {
            const accounts = restorableAccounts.map(accountToSessionUser);
            accounts.forEach(a => { if (!a.hasPin) a.hasSession = false; });
            setKnownAccounts(accounts);
          }
          setDataReady(true);
        });
      }).catch(() => {
        // restoreSession threw — fall back to picker
        return Promise.all([
          oauth2.loadAll().catch(() => {}),
          api.accountListRestorable().catch(() => [] as AccountIdentity[]),
        ]).then(([, restorableAccounts]) => {
          if (Array.isArray(restorableAccounts) && restorableAccounts.length > 0) {
            const accounts = restorableAccounts.map(accountToSessionUser);
            accounts.forEach(a => { if (!a.hasPin) a.hasSession = false; });
            setKnownAccounts(accounts);
          }
          setDataReady(true);
        });
      });
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
