// Federation runtime — owns the long-lived federation projection.
//
// Three jobs:
//
//   1. Bootstrap on first boot:
//        • fetch /actor/federation/health (public; safe pre-login)
//        • if a session is already present, also fetch /me
//   2. Track the authenticated-actor edge:
//        • on login → fetch /me
//        • on logout → clear session-bound state (health stays warm)
//   3. Poll /health on a back-off curve:
//        • fast (every 3 s) until ready=true → catch the cold-start
//          window so the splash banner clears as soon as the routing
//          table fills.
//        • slow (every 5 min) once ready, just to detect drift after
//          the bootstrap subserver loses peers (e.g. Wi-Fi flap).
//
// Scope is `app` because /health is identity-independent and survives
// across logout/login transitions. The login/logout transitions are
// driven by the session subscription installed in `install()`.
//
// Contract notes:
//   • Pages are pure renderers — they read the store, never call
//     `api.federation*` directly.
//   • The /health timer is started in `install()` and stopped in
//     `teardown()` so HMR / test reloads don't leak intervals.
//   • Re-entrant calls to `bootstrap` are guarded by the kernel
//     runtime registry; the implementation is also idempotent.

import type { RuntimeDescriptor } from '../kernel/runtime';
import { useSessionStore } from '../store/session';
import { useFederationStore } from '../store/federation';
import { log } from '../utils/logger';

/** Tick used while ready=false — fast enough to clear the splash gate
 *  within a few seconds of the routing table filling. */
const HEALTH_TICK_FAST_MS = 3_000;
/** Tick used after ready=true — once a minute is plenty for drift. */
const HEALTH_TICK_SLOW_MS = 5 * 60 * 1000;

let unsubscribeSession: (() => void) | null = null;
let healthTimer: ReturnType<typeof setTimeout> | null = null;
let lastActorPtid: string | null = null;

function scheduleHealthTick(): void {
  if (healthTimer != null) return;
  const ready = useFederationStore.getState().health?.ready ?? false;
  const delay = ready ? HEALTH_TICK_SLOW_MS : HEALTH_TICK_FAST_MS;
  healthTimer = setTimeout(async () => {
    healthTimer = null;
    try {
      await useFederationStore.getState().refreshHealth();
    } finally {
      // Re-arm — the next interval picks up the latest readiness.
      scheduleHealthTick();
    }
  }, delay);
}

function stopHealthTick(): void {
  if (healthTimer != null) {
    clearTimeout(healthTimer);
    healthTimer = null;
  }
}

export const federationRuntime: RuntimeDescriptor = {
  id: 'federation',
  scope: 'app',

  install(): void {
    if (unsubscribeSession) return;

    unsubscribeSession = useSessionStore.subscribe((state) => {
      const nextActorPtid = state.authenticated
        ? state.currentUser?.actorPtid ?? null
        : null;
      if (nextActorPtid === lastActorPtid) return;
      lastActorPtid = nextActorPtid;

      if (nextActorPtid) {
        void useFederationStore.getState().refreshSelf();
        void useFederationStore.getState().refreshFederations();
      } else {
        // Logout edge: drop session-scoped state so the splash returns
        // to its pre-login projection. Health survives.
        useFederationStore.getState().clearSession();
      }
    });

    // Boot the /health polling loop. The first tick fires on the next
    // turn of the event loop via the timer, but bootstrap() also calls
    // refreshHealth() once eagerly so the splash sees data ASAP.
    scheduleHealthTick();
    log.debug('federation', 'runtime installed');
  },

  teardown(): void {
    if (unsubscribeSession) {
      unsubscribeSession();
      unsubscribeSession = null;
    }
    stopHealthTick();
    lastActorPtid = null;
    log.debug('federation', 'runtime torn down');
  },

  async bootstrap(actorPtid: string | null): Promise<void> {
    const store = useFederationStore.getState();
    const tasks: Promise<unknown>[] = [store.refreshHealth()];
    // app-scope bootstrap is invoked once with `null`; later, the
    // session subscriber drives /me on the auth edge. If the session
    // is already present at boot (e.g. restored from disk), pick it
    // up here so the first paint after a relaunch has /me data.
    const session = useSessionStore.getState();
    const restoredActor = actorPtid ?? (session.authenticated
      ? session.currentUser?.actorPtid ?? null
      : null);
    if (restoredActor) {
      tasks.push(store.refreshSelf());
      tasks.push(store.refreshFederations());
      lastActorPtid = restoredActor;
    }
    await Promise.allSettled(tasks);
  },

  async reconcile(reason: string): Promise<void> {
    log.debug('federation', 'reconcile', { reason });
    const store = useFederationStore.getState();
    const tasks: Promise<unknown>[] = [store.refreshHealth()];
    if (lastActorPtid) {
      tasks.push(store.refreshSelf());
      tasks.push(store.refreshFederations());
    }
    await Promise.allSettled(tasks);
  },
};
