import type { MobileAuthSession } from '../auth/authSession';
import type { GroupState } from './groupStore';

const GROUP_RECONCILE_INTERVAL_MS = 30000;

export interface GroupRuntimeController {
  teardown: () => void;
  drain: () => Promise<void>;
}

export function startGroupRuntime(
  session: MobileAuthSession,
  getStore: () => GroupState,
): GroupRuntimeController {
  let cancelled = false;
  const pendingOperations = new Set<Promise<unknown>>();
  const track = (operation: () => Promise<unknown>): void => {
    const pending = operation().finally(() => {
      pendingOperations.delete(pending);
    });
    pendingOperations.add(pending);
  };

  track(() => getStore().reconcile());
  const reconcileTimer = window.setInterval(() => {
    if (!cancelled) {
      track(() => getStore().reconcile());
    }
  }, GROUP_RECONCILE_INTERVAL_MS);

  return {
    teardown: () => {
      cancelled = true;
      window.clearInterval(reconcileTimer);
    },
    drain: async () => {
      await Promise.allSettled([...pendingOperations]);
      if (
        getStore().authSession === session
        || getStore().authSession === null
      ) {
        getStore().bindSession(null);
      }
    },
  };
}
