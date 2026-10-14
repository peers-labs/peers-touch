// settings runtime — owns the small, cross-tab settings state that the
// Settings page needs *synchronously* on first paint.
//
// Specifically:
//   • activeAccount snapshot (drives the Security section's "Set PIN /
//     Change PIN" affordance — we don't want a round-trip on first
//     click). Refreshed on bootstrap and when the session changes.
//   • agents list (used by the General tab; small payload, mirrors the
//     existing `loadAgents` action on `useSettingsStore`).
//   • authorized devices and notification preferences, both scoped to
//     the authenticated actor and reconciled independently of page mounts.
//
// Heavier per-section data (tools and search providers) is
// loaded lazily by individual sections via `kernel/usePrefetch`,
// scheduled onto the `pages:prewarm` idle window. That keeps the boot
// path lean while still warming sections before the user clicks them.

import { useSettingsStore } from '../store/settings';
import { useSessionStore } from '../store/session';
import type { RuntimeDescriptor } from '../kernel/runtime';

let unsubscribeSession: (() => void) | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
const SETTINGS_RECONCILE_INTERVAL_MS = 60_000;

async function refreshSessionProjection(): Promise<void> {
  if (!useSessionStore.getState().authenticated) return;
  const store = useSettingsStore.getState();
  await Promise.allSettled([
    store.refreshActiveAccount(),
    store.refreshDevices(),
    store.refreshNotificationPreferences(),
  ]);
}

export const settingsRuntime: RuntimeDescriptor = {
  id: 'settings',
  scope: 'app',
  install(): void {
    if (unsubscribeSession) return;
    let lastSessionKey: string | null = null;
    unsubscribeSession = useSessionStore.subscribe((state) => {
      const actorPtid = state.authenticated ? state.currentUser?.actorPtid ?? null : null;
      const sessionKey = actorPtid ? `${actorPtid}\0${state.sessionEpoch}` : null;
      if (sessionKey === lastSessionKey) return;
      lastSessionKey = sessionKey;
      const store = useSettingsStore.getState();
      store.clearSessionProjection();
      if (actorPtid) {
        void refreshSessionProjection();
      }
    });
    reconcileTimer = globalThis.setInterval(() => {
      void refreshSessionProjection();
    }, SETTINGS_RECONCILE_INTERVAL_MS);
  },
  teardown(): void {
    if (unsubscribeSession) {
      unsubscribeSession();
      unsubscribeSession = null;
    }
    if (reconcileTimer) {
      globalThis.clearInterval(reconcileTimer);
      reconcileTimer = null;
    }
  },
  async bootstrap(_actorId: string | null): Promise<void> {
    const store = useSettingsStore.getState();
    const authenticated = useSessionStore.getState().authenticated;
    if (!authenticated) {
      store.clearSessionProjection();
    }
    await Promise.allSettled([
      store.loadAgents(),
      store.loadChatPreferences(),
      ...(authenticated ? [refreshSessionProjection()] : []),
    ]);
  },
  async reconcile(): Promise<void> {
    const store = useSettingsStore.getState();
    const session = useSessionStore.getState();
    if (!session.authenticated) {
      store.clearSessionProjection();
    }
    await Promise.allSettled([
      store.loadAgents(),
      store.loadChatPreferences(),
      ...(session.authenticated ? [refreshSessionProjection()] : []),
    ]);
  },
};
