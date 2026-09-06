import type { MobileAuthSession } from '../auth/authSession';
import type { GroupState } from './groupStore';

const GROUP_RECONCILE_INTERVAL_MS = 30000;

export interface GroupRuntimeController {
  teardown: () => void;
}

export function startGroupRuntime(
  _session: MobileAuthSession,
  getStore: () => GroupState,
): GroupRuntimeController {
  let cancelled = false;

  getStore().reconcile();
  const reconcileTimer = window.setInterval(() => {
    if (!cancelled) {
      void getStore().reconcile();
    }
  }, GROUP_RECONCILE_INTERVAL_MS);

  return {
    teardown: () => {
      cancelled = true;
      window.clearInterval(reconcileTimer);
    },
  };
}
