import { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '../store/session';
import { useOAuth2Store } from '../store/oauth2';
import { useAccountIdentityStore } from '../store/accountIdentity';
import { globalContext } from '../kernel/global-context';
import type { AppLifecycle, AppState, SessionUser } from '../types/navigation';

export function useAppLifecycle(): AppLifecycle {
  const [state, setState] = useState<AppState>('onboarding');
  const [restoredUser, setRestoredUser] = useState<SessionUser | null>(null);
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    globalContext.bootstrap().catch(() => {});
  }, []);

  useEffect(() => {
    if (state === 'onboarding') {
      globalContext.setRuntimeAppState('booting');
    } else {
      globalContext.setRuntimeAppState('ready');
    }
  }, [state]);

  // Restore session from BFF and load OAuth connections in parallel.
  // Identity comes from the SessionStore (single source of truth),
  // not from OAuth connections.
  useEffect(() => {
    const session = useSessionStore.getState();
    const oauth2 = useOAuth2Store.getState();

    Promise.all([
      session.restoreSession().catch(() => {}),
      oauth2.loadAll().catch(() => {}),
    ]).then(() => {
      const { currentUser, authenticated } = useSessionStore.getState();
      if (authenticated && currentUser) {
        setRestoredUser({
          name: currentUser.name || 'User',
          email: currentUser.email || '',
          avatar: currentUser.avatarUrl,
        });
      }
      setDataReady(true);
    });
  }, []);

  // When login completes:
  // 1. Refresh accountIdentity and OAuth connections for the current user
  // 2. Transition to ready state
  const completeLogin = useCallback(() => {
    useAccountIdentityStore.getState().load().catch(() => {});
    useOAuth2Store.getState().loadAll().catch(() => {});
    setState('ready');
  }, []);

  return { state, restoredUser, dataReady, completeLogin };
}
