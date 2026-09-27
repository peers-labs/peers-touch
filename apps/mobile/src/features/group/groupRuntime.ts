import type { MobileAuthSession } from '../auth/authSession';
import type { GroupState } from './groupStore';

const GROUP_RECONCILE_INTERVAL_MS = 30000;

export interface GroupRuntimeController {
  suspend: () => Promise<void>;
  resume: () => Promise<void>;
  teardown: () => void;
  drain: () => Promise<void>;
}

export interface GroupRuntimeOptions {
  readonly reconcileOnStart?: boolean;
  readonly reconcileOnResume?: boolean;
}

export function startGroupRuntime(
  session: MobileAuthSession,
  getStore: () => GroupState,
  options: GroupRuntimeOptions = {},
): GroupRuntimeController {
  let cancelled = false;
  let suspended = false;
  let reconcileTimer: number | null = null;
  const pendingOperations = new Set<Promise<unknown>>();
  const track = (operation: () => Promise<unknown>): void => {
    const pending = operation().finally(() => {
      pendingOperations.delete(pending);
    });
    pendingOperations.add(pending);
  };

  const start = (reconcile: boolean) => {
    if (cancelled || suspended || reconcileTimer !== null) return;
    if (reconcile) track(() => getStore().reconcile());
    reconcileTimer = window.setInterval(() => {
      if (!cancelled && !suspended) {
        track(() => getStore().reconcile());
      }
    }, GROUP_RECONCILE_INTERVAL_MS);
  };

  const stop = () => {
    if (reconcileTimer === null) return;
    window.clearInterval(reconcileTimer);
    reconcileTimer = null;
  };

  start(options.reconcileOnStart !== false);

  return {
    suspend: async () => {
      if (cancelled || suspended) return;
      suspended = true;
      stop();
      await Promise.allSettled([...pendingOperations]);
    },
    resume: async () => {
      if (cancelled || !suspended) return;
      suspended = false;
      start(options.reconcileOnResume !== false);
      await Promise.allSettled([...pendingOperations]);
    },
    teardown: () => {
      cancelled = true;
      stop();
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
