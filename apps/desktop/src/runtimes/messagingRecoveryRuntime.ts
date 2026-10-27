import type { RuntimeDescriptor } from '../kernel/runtime';
import { EVENT, eventBus } from '../kernel/events';
import { useMessagingRecoveryStore } from '../store/messagingRecovery';
import { useSessionStore } from '../store/session';
import { log } from '../utils/logger';

let unsubscribeSession: (() => void) | null = null;
let unsubscribeStation: (() => void) | null = null;
let reconciliationTimer: ReturnType<typeof setInterval> | null = null;
let activeActorPtid: string | null = null;
let activeSessionEpoch: number | null = null;

async function reconcileAuthenticatedRecovery(): Promise<void> {
  const session = useSessionStore.getState();
  const actorPtid = session.authenticated ? session.currentUser?.actorPtid ?? null : null;
  if (!actorPtid) {
    activeActorPtid = null;
    activeSessionEpoch = null;
    useMessagingRecoveryStore.getState().reset();
    return;
  }
  if (actorPtid !== activeActorPtid || session.sessionEpoch !== activeSessionEpoch) {
    useMessagingRecoveryStore.getState().reset();
  }
  activeActorPtid = actorPtid;
  activeSessionEpoch = session.sessionEpoch;
  const recovery = useMessagingRecoveryStore.getState();
  if (recovery.loading || recovery.creating || recovery.restoring) return;
  await useMessagingRecoveryStore.getState().refresh();
}

export const messagingRecoveryRuntime: RuntimeDescriptor = {
  id: 'messaging-recovery',
  scope: 'session',

  install(): void {
    if (unsubscribeSession) return;
    unsubscribeSession = useSessionStore.subscribe((session) => {
      const actorPtid = session.authenticated ? session.currentUser?.actorPtid ?? null : null;
      if (actorPtid === activeActorPtid && session.sessionEpoch === activeSessionEpoch) return;
      void reconcileAuthenticatedRecovery().catch((error) => {
        log.warn('messaging-recovery', 'identity-edge reconciliation failed', { error });
      });
    });
    unsubscribeStation = eventBus.subscribe(EVENT.STATION_ACTIVE_CHANGED, () => {
      activeActorPtid = null;
      activeSessionEpoch = null;
      useMessagingRecoveryStore.getState().reset();
      void reconcileAuthenticatedRecovery().catch((error) => {
        log.warn('messaging-recovery', 'Station-edge reconciliation failed', { error });
      });
    });
    reconciliationTimer = setInterval(() => {
      void reconcileAuthenticatedRecovery().catch((error) => {
        log.warn('messaging-recovery', 'periodic reconciliation failed', { error });
      });
    }, 30_000);
  },

  teardown(): void {
    if (reconciliationTimer) clearInterval(reconciliationTimer);
    reconciliationTimer = null;
    unsubscribeSession?.();
    unsubscribeSession = null;
    unsubscribeStation?.();
    unsubscribeStation = null;
    activeActorPtid = null;
    activeSessionEpoch = null;
    useMessagingRecoveryStore.getState().reset();
  },

  async bootstrap(): Promise<void> {
    await reconcileAuthenticatedRecovery();
  },

  async reconcile(): Promise<void> {
    await reconcileAuthenticatedRecovery();
  },
};
