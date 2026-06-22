// settings runtime — owns the small, cross-tab settings state that the
// Settings page needs *synchronously* on first paint.
//
// Specifically:
//   • activeAccount snapshot (drives the Security section's "Set PIN /
//     Change PIN" affordance — we don't want a round-trip on first
//     click). Refreshed on bootstrap and when the session changes.
//   • agents list (used by the General tab; small payload, mirrors the
//     existing `loadAgents` action on `useSettingsStore`).
//
// Heavier per-section data (statistics, tools, search providers) is
// loaded lazily by individual sections via `kernel/usePrefetch`,
// scheduled onto the `pages:prewarm` idle window. That keeps the boot
// path lean while still warming sections before the user clicks them.

import { useSettingsStore } from '../store/settings';
import { useSessionStore } from '../store/session';
import type { RuntimeDescriptor } from '../kernel/runtime';

let unsubscribeSession: (() => void) | null = null;

export const settingsRuntime: RuntimeDescriptor = {
  id: 'settings',
  scope: 'app',
  install(): void {
    if (unsubscribeSession) return;
    let lastActorId: string | null = null;
    unsubscribeSession = useSessionStore.subscribe((state) => {
      const actorId = state.authenticated ? state.currentUser?.actorId ?? null : null;
      if (actorId === lastActorId) return;
      lastActorId = actorId;
      // Account-shape may change on login/logout/PIN edits; keep the
      // settings projection in lockstep.
      void useSettingsStore.getState().refreshActiveAccount();
    });
  },
  teardown(): void {
    if (unsubscribeSession) {
      unsubscribeSession();
      unsubscribeSession = null;
    }
  },
  async bootstrap(): Promise<void> {
    const store = useSettingsStore.getState();
    await Promise.allSettled([
      store.refreshActiveAccount(),
      store.loadAgents(),
      store.loadChatPreferences(),
    ]);
  },
  async reconcile(): Promise<void> {
    const store = useSettingsStore.getState();
    await Promise.allSettled([
      store.refreshActiveAccount(),
      store.loadAgents(),
      store.loadChatPreferences(),
    ]);
  },
};
