import type { RuntimeDescriptor } from '../kernel/runtime';
import { useMessagingRecoveryStore } from '../store/messagingRecovery';
import { useSessionStore } from '../store/session';
import { log } from '../utils/logger';

let unsubscribeSession: (() => void) | null = null;
let activeActorPtid: string | null = null;

async function reconcileAuthenticatedRecovery(): Promise<void> {
  const session = useSessionStore.getState();
  const actorPtid = session.authenticated ? session.currentUser?.actorPtid ?? null : null;
  if (!actorPtid) {
    activeActorPtid = null;
    useMessagingRecoveryStore.getState().reset();
    return;
  }
  activeActorPtid = actorPtid;
  await useMessagingRecoveryStore.getState().refresh();
}

export const messagingRecoveryRuntime: RuntimeDescriptor = {
  id: 'messaging-recovery',
  scope: 'session',

  install(): void {
    if (unsubscribeSession) return;
    unsubscribeSession = useSessionStore.subscribe((session) => {
      const actorPtid = session.authenticated ? session.currentUser?.actorPtid ?? null : null;
      if (actorPtid === activeActorPtid) return;
      void reconcileAuthenticatedRecovery().catch((error) => {
        log.warn('messaging-recovery', 'identity-edge reconciliation failed', { error });
      });
    });
  },

  teardown(): void {
    unsubscribeSession?.();
    unsubscribeSession = null;
    activeActorPtid = null;
    useMessagingRecoveryStore.getState().reset();
  },

  async bootstrap(): Promise<void> {
    await reconcileAuthenticatedRecovery();
  },

  async reconcile(): Promise<void> {
    await reconcileAuthenticatedRecovery();
  },
};
