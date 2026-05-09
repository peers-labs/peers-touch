// search runtime — owns the long-lived `useSearchStore.sources` cache.
//
// `loadSources` reads the stable list of search backends from the
// Station; it is cheap, idempotent, and benefits from being warm by
// the time the user focuses the search bar. The runtime is `app`-scope
// because the source list is identity-independent and survives across
// logout / login transitions.
//
// `reset()` is intentionally NOT called from `teardown()`: search
// query/result state should survive tab switches (this was the legacy
// page-mount cleanup bug — `SearchPage` reset itself on unmount,
// destroying the user's results when they navigated away). On logout
// the user lands back on the picker, so the page is unmounted from the
// view tree but the runtime stays installed and the next login simply
// reuses the cached sources.

import { useSearchStore } from '../store/search';
import type { RuntimeDescriptor } from '../kernel/runtime';

export const searchRuntime: RuntimeDescriptor = {
  id: 'search',
  scope: 'app',
  install(): void {
    // No subscriptions / timers; search has no realtime side-channel.
  },
  teardown(): void {
    // Intentional no-op (see header comment).
  },
  async bootstrap(): Promise<void> {
    await useSearchStore.getState().loadSources();
  },
  async reconcile(): Promise<void> {
    // Search sources are static; no-op until backend exposes a change
    // signal worth honoring.
  },
};
