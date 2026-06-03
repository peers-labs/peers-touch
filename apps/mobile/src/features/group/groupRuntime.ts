import type { MobileAuthSession } from '../auth/authSession';
import type { GroupState } from './groupStore';

const GROUP_RECONCILE_INTERVAL_MS = 30000;

export interface GroupRuntimeController {
  teardown: () => void;
}

export function startGroupRuntime(_session: MobileAuthSession, store: GroupState): GroupRuntimeController {
  let cancelled = false;

  store.reconcile();
  const reconcileTimer = window.setInterval(() => {
    if (!cancelled) void store.reconcile();
  }, GROUP_RECONCILE_INTERVAL_MS);

  return {
    teardown: () => {
      cancelled = true;
      window.clearInterval(reconcileTimer);
    },
  };
}
