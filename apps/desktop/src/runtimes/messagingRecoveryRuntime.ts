import type { RuntimeDescriptor } from '../kernel/runtime';
import { useMessagingRecoveryStore } from '../store/messagingRecovery';
import { useSessionStore } from '../store/session';
import { log } from '../utils/logger';

let unsubscribeSession: (() => void) | null = null;
let activeActorId: string | null = null;

async function reconcileAuthenticatedRecovery(): Promise<void> {
  const session = useSessionStore.getState();
  const actorId = session.authenticated ? session.currentUser?.actorId ?? null : null;
  if (!actorId) {
    activeActorId = null;
    useMessagingRecoveryStore.getState().reset();
    return;
  }
  activeActorId = actorId;
  await useMessagingRecoveryStore.getState().refresh();
}

export const messagingRecoveryRuntime: RuntimeDescriptor = {
  id: 'messaging-recovery',
  scope: 'session',

  install(): void {
    if (unsubscribeSession) return;
    unsubscribeSession = useSessionStore.subscribe((session) => {
      const actorId = session.authenticated ? session.currentUser?.actorId ?? null : null;
      if (actorId === activeActorId) return;
      void reconcileAuthenticatedRecovery().catch((error) => {
        log.warn('messaging-recovery', 'identity-edge reconciliation failed', { error });
      });
    });
  },

  teardown(): void {
    unsubscribeSession?.();
    unsubscribeSession = null;
    activeActorId = null;
    useMessagingRecoveryStore.getState().reset();
  },

  async bootstrap(): Promise<void> {
    await reconcileAuthenticatedRecovery();
  },

  async reconcile(): Promise<void> {
    await reconcileAuthenticatedRecovery();
  },
};
