// settings runtime — owns the small, cross-section settings state that the
// Settings page needs *synchronously* on first paint.
//
// Session-scoped: bootstrap runs on the authenticated-actor edge and teardown
// runs on logout/actor switch. Identity-scoped personalization (L2: language,
// chat shortcut, provider list filter) is read per actor and reset to
// identity-independent defaults on teardown, so a shared device never shows
// one actor's personalization to the next sign-in.
//
// Specifically:
//   • activeAccount snapshot (drives the Security section's "Set PIN /
//     Change PIN" affordance — we don't want a round-trip on first
//     click). Refreshed on bootstrap and when the session changes.
//   • agents list (used by the General tab; small payload, mirrors the
//     existing `loadAgents` action on `useSettingsStore`).
//   • actor personalization such as Provider list filtering and the chat
//     screenshot shortcut, loaded before the Settings page becomes visible.
//
// Heavier per-section data (statistics, tools, search providers) is
// loaded lazily by individual sections via `kernel/usePrefetch`,
// scheduled onto the `pages:prewarm` idle window. That keeps the boot
// path lean while still warming sections before the user clicks them.

import { useSettingsStore } from '../store/settings';
import { useSessionStore } from '../store/session';
import type { RuntimeDescriptor } from '../kernel/runtime';
import {
  applyPersonalizedLanguage,
  resetPersonalizedLanguage,
} from '../i18n';

let unsubscribeSession: (() => void) | null = null;

export const settingsRuntime: RuntimeDescriptor = {
  id: 'settings',
  scope: 'session',
  install(): void {
    if (unsubscribeSession) return;
    let lastActorPtid: string | null = null;
    unsubscribeSession = useSessionStore.subscribe((state) => {
      const actorPtid = state.authenticated ? state.currentUser?.actorPtid ?? null : null;
      if (actorPtid === lastActorPtid) return;
      lastActorPtid = actorPtid;
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
    // Logout / actor switch must not leave one actor's personalization
    // visible to the next sign-in on this device.
    useSettingsStore.getState().resetPersonalization();
    void resetPersonalizedLanguage();
  },
  async bootstrap(actorPtid): Promise<void> {
    const store = useSettingsStore.getState();
    const loads = [
      store.refreshActiveAccount(),
      store.loadAgents(),
      store.loadChatPreferences(),
      store.loadProviderPreferences(),
    ];
    if (actorPtid) {
      loads.push(applyPersonalizedLanguage(actorPtid));
    }
    await Promise.allSettled(loads);
  },
  async reconcile(): Promise<void> {
    const store = useSettingsStore.getState();
    await Promise.allSettled([
      store.refreshActiveAccount(),
      store.loadAgents(),
      store.loadChatPreferences(),
      store.loadProviderPreferences(),
    ]);
  },
};
