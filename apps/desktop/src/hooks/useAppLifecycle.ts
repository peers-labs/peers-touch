import { useEffect, useSyncExternalStore } from 'react';
import { identityRuntime } from '../kernel/identityRuntime';
import { useSessionStore } from '../store/session';
import type { AppLifecycle, AppState } from '../types/navigation';

export { clearWarmResume, persistLastActivePage } from '../kernel/identityRuntime';

export function lifecycleNeedsSessionRevalidation(state: AppState, authenticated: boolean): boolean {
  return state === 'ready' && !authenticated;
}

export function useAppLifecycle(): AppLifecycle {
  const sessionAuthenticated = useSessionStore((state) => state.authenticated);
  const snapshot = useSyncExternalStore(
    identityRuntime.subscribe,
    identityRuntime.getSnapshot,
    identityRuntime.getSnapshot,
  );

  useEffect(() => {
    identityRuntime.boot();
  }, []);

  useEffect(() => {
    identityRuntime.revalidateIfNeeded();
  }, [sessionAuthenticated, snapshot.lifecycle.authenticated, snapshot.lifecycle.state]);

  return snapshot.lifecycle;
}
