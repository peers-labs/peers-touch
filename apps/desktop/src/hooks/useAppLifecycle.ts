import { useCallback, useEffect, useState } from 'react';
import { useOAuth2Store } from '../store/oauth2';
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

  useEffect(() => {
    const store = useOAuth2Store.getState();
    Promise.all([
      store.restoreSession().catch(() => {}),
      store.loadAll().catch(() => {}),
    ]).then(() => {
      const { authenticated, connections } = useOAuth2Store.getState();
      if (authenticated) {
        const active = connections.find(
          (c) => c.status === 'active' && c.user_id && c.user_id !== 'unknown',
        );
        if (active) {
          setRestoredUser({
            name: active.user_name || active.user_id || 'User',
            email: active.email || '',
            avatar: active.avatar_url,
          });
        }
      }
      setDataReady(true);
    });
  }, []);

  const completeLogin = useCallback(() => {
    useOAuth2Store.getState().loadAll();
    setState('ready');
  }, []);

  return { state, restoredUser, dataReady, completeLogin };
}
