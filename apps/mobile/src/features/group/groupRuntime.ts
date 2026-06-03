import type { MobileAuthSession } from '../auth/authSession';
import { startGroupE2eeRuntime, type GroupE2eeRuntimeController } from './groupE2eeRuntime';
import type { GroupState } from './groupStore';

const GROUP_RECONCILE_INTERVAL_MS = 30000;

export interface GroupRuntimeController extends GroupE2eeRuntimeController {
  teardown: () => void;
}

export function startGroupRuntime(session: MobileAuthSession, getStore: () => GroupState): GroupRuntimeController {
  let cancelled = false;

  getStore().reconcile();
  const e2eeRuntime = startGroupE2eeRuntime(session, getStore);
  const reconcileTimer = window.setInterval(() => {
    if (!cancelled) {
      void getStore().reconcile().then(() => e2eeRuntime.repairEncryptedMessages());
    }
  }, GROUP_RECONCILE_INTERVAL_MS);

  return {
    consumeSkdmControlMessage: e2eeRuntime.consumeSkdmControlMessage,
    repairEncryptedMessages: e2eeRuntime.repairEncryptedMessages,
    rotateAfterMembershipChange: e2eeRuntime.rotateAfterMembershipChange,
    sendEncryptedMessage: e2eeRuntime.sendEncryptedMessage,
    teardown: () => {
      cancelled = true;
      e2eeRuntime.teardown();
      window.clearInterval(reconcileTimer);
    },
  };
}
