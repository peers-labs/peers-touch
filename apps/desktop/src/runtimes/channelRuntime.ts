import type { RuntimeDescriptor } from '../kernel/runtime';
import {
  ChannelRequesterAuthorizationStatus,
} from '../gen/proto/domain/channel/channel_pb';
import { EVENT, eventBus } from '../kernel/events';
import { useChannelStore } from '../store/channel';
import { useSessionStore } from '../store/session';
import { log } from '../utils/logger';

const CHANNEL_RECONCILE_INTERVAL_MS = 30_000;
const CHANNEL_AUTH_RECONCILE_INTERVAL_MS = 2_000;

let installed = false;
let activeActorPtid: string | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let authorizationReconcileTimer: ReturnType<typeof setInterval> | null = null;
let reconcileInFlight: Promise<void> | null = null;
let unsubscribeSession: (() => void) | null = null;
let unsubscribers: Array<() => void> = [];

function authenticatedActorPtid(): string | null {
  const session = useSessionStore.getState();
  return session.authenticated ? session.currentUser?.actorPtid ?? null : null;
}

async function reconcileProjection(reason: string): Promise<void> {
  if (!installed || !activeActorPtid) return;
  if (reconcileInFlight) return reconcileInFlight;
  const actorPtid = activeActorPtid;
  const operation = (async () => {
    await useChannelStore.getState().loadBindings(reason);
    if (!installed || activeActorPtid !== actorPtid) return;
    const selectedBindingId = useChannelStore.getState().selectedBindingId;
    if (selectedBindingId) {
      await useChannelStore
        .getState()
        .loadBindingDetail(selectedBindingId, reason);
    }
  })();
  reconcileInFlight = operation;
  try {
    await operation;
  } finally {
    if (reconcileInFlight === operation) reconcileInFlight = null;
  }
}

function reconcileDetached(reason: string): void {
  void reconcileProjection(reason).catch((error) => {
    log.warn('channelRuntime', 'Channel reconciliation failed', {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function activateActor(actorPtid: string | null, reason: string): void {
  if (activeActorPtid === actorPtid) return;
  activeActorPtid = actorPtid;
  reconcileInFlight = null;
  useChannelStore.getState().setActorScope(actorPtid);
  if (actorPtid) reconcileDetached(reason);
}

function installSubscriptions(): void {
  if (!unsubscribeSession) {
    unsubscribeSession = useSessionStore.subscribe(() => {
      activateActor(authenticatedActorPtid(), 'identity-change');
    });
  }
  if (unsubscribers.length === 0) {
    unsubscribers = [
      eventBus.subscribe(EVENT.REALTIME_RESYNC, () => {
        reconcileDetached('realtime-resync');
      }),
      eventBus.subscribe(EVENT.OAUTH_CONNECTIONS_CHANGED, () => {
        reconcileDetached('oauth-changed');
      }),
    ];
  }
}

function clearSubscriptions(): void {
  unsubscribeSession?.();
  unsubscribeSession = null;
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

function installTimer(): void {
  if (reconcileTimer !== null) return;
  reconcileTimer = setInterval(() => {
    reconcileDetached('periodic');
  }, CHANNEL_RECONCILE_INTERVAL_MS);
  authorizationReconcileTimer = setInterval(() => {
    const state = useChannelStore.getState();
    const bindingId = state.selectedBindingId;
    if (!bindingId || state.detailLoadingByBindingId[bindingId]) return;
    const authorization =
      state.detailsByBindingId[bindingId]?.requesterAuthorization;
    if (
      authorization?.status
      !== ChannelRequesterAuthorizationStatus.PENDING
    ) {
      return;
    }
    void state.loadBindingDetail(
      bindingId,
      'requester-authorization-pending',
    );
  }, CHANNEL_AUTH_RECONCILE_INTERVAL_MS);
}

function clearTimer(): void {
  if (reconcileTimer !== null) clearInterval(reconcileTimer);
  if (authorizationReconcileTimer !== null) {
    clearInterval(authorizationReconcileTimer);
  }
  reconcileTimer = null;
  authorizationReconcileTimer = null;
}

export function refreshChannelProjection(
  reason = 'user',
): Promise<void> {
  return reconcileProjection(reason);
}

export async function refreshChannelBinding(
  bindingId: string,
  reason = 'user',
): Promise<void> {
  if (!installed || !activeActorPtid) return;
  await Promise.all([
    useChannelStore.getState().loadBindings(reason),
    useChannelStore.getState().loadBindingDetail(bindingId, reason),
  ]);
}

export const channelRuntime: RuntimeDescriptor = {
  id: 'channel',
  scope: 'app',
  install() {
    if (installed) return;
    installed = true;
    installSubscriptions();
    installTimer();
    activateActor(authenticatedActorPtid(), 'install');
  },
  teardown() {
    if (!installed) {
      useChannelStore.getState().reset();
      return;
    }
    installed = false;
    activeActorPtid = null;
    reconcileInFlight = null;
    clearTimer();
    clearSubscriptions();
    useChannelStore.getState().reset();
  },
  async bootstrap() {
    activateActor(authenticatedActorPtid(), 'bootstrap');
    await reconcileProjection('bootstrap');
  },
  async reconcile(reason) {
    await reconcileProjection(reason);
  },
};
