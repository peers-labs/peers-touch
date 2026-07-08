// Federation projection store (Tier A1).
//
// Owns three pieces of long-lived state visible to Desktop UI:
//
//   • `self`   — current actor's federation identity snapshot
//                (FederationSelfView from /actor/federation/me).
//                Only present when the user is logged in; cleared on
//                logout via the FederationRuntime teardown path.
//   • `health` — periodic FederationHealthView snapshot. Populated even
//                pre-login; the splash banner reads it to decide whether
//                to grey out federation-dependent entry points.
//   • `lastError` — most recent error message from a federation call.
//                Surfaced by the Settings panel so the user gets a hint
//                when /me failed; never used for control flow.
//
// The store is intentionally thin: the FederationRuntime drives all
// fetching. Pages and components are pure consumers via selectors.
//
// `setVisibility` is the one mutation entry point. It performs an
// optimistic update on `self` (so the dropdown reflects the user's
// choice immediately) and rolls back on failure. The Station echoes
// the post-mutation FederationSelfView, which we copy back into the
// store on success — this makes `locator_seq` stay correct across
// flips without a follow-up GET.

import { createDesktopStore } from './createDesktopStore';
import { api } from '../services/desktop_api';
import type {
  FederationHealthView,
  FederationSelfView,
} from '../services/desktop_api';
import { log } from '../utils/logger';

export type FederationVisibilityLabel =
  | 'hidden'
  | 'by_handle'
  | 'indexed';

export interface FederationState {
  /** GET /actor/federation/me snapshot, null while logged out / not yet loaded. */
  self: FederationSelfView | null;
  /** GET /actor/federation/health snapshot, populated even pre-login. */
  health: FederationHealthView | null;
  /** True while the very first /me + /health round-trip is in flight. */
  loading: boolean;
  /** Last error surface; rendered by Settings when non-empty. */
  lastError: string | null;

  refreshSelf: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  setVisibility: (label: FederationVisibilityLabel) => Promise<void>;
  /** Drop session-bound state (called by FederationRuntime on logout). */
  clearSession: () => void;
}

export const useFederationStore = createDesktopStore<FederationState>('federation', (set, get) => ({
  self: null,
  health: null,
  loading: false,
  lastError: null,

  refreshSelf: async () => {
    const wasLoaded = get().self != null;
    if (!wasLoaded) set({ loading: true });
    try {
      const view = await api.federationGetSelf();
      set({ self: view, loading: false, lastError: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('federation', 'refreshSelf failed', { error: msg });
      set((state) => ({
        loading: false,
        // Don't clobber a previously-good snapshot on a transient failure;
        // the UI keeps rendering the last-known identity until next tick.
        lastError: msg,
        self: state.self,
      }));
    }
  },

  refreshHealth: async () => {
    try {
      const view = await api.federationHealth();
      set({ health: view });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Health failures are normal during boot before Station is ready;
      // we keep the last successful snapshot and just log.
      log.debug('federation', 'refreshHealth failed', { error: msg });
    }
  },

  setVisibility: async (label) => {
    const prev = get().self;
    if (prev) {
      // Optimistic UI: render the new label immediately.
      set({
        self: {
          ...prev,
          visibilityLabel: label,
        },
        lastError: null,
      });
    }
    try {
      const echo = await api.federationUpdateVisibility(label);
      set({ self: echo, lastError: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('federation', 'setVisibility failed', { error: msg, label });
      // Roll back the optimistic update so the dropdown returns to its
      // previous state and the error is surfaced.
      set({ self: prev, lastError: msg });
      throw err;
    }
  },

  clearSession: () =>
    set({
      self: null,
      loading: false,
      lastError: null,
      // Health is not session-bound — the routing table is the same
      // pre/post login. Keep it warm.
    }),
}));

/** Selector helpers — keep components free of `useFederationStore` plumbing. */
export const selectFederationReady = (s: FederationState): boolean =>
  s.health?.ready ?? false;

export const selectFederationHandle = (s: FederationState): string =>
  s.self?.federatedHandle ?? '';

export const selectFederationVisibility = (
  s: FederationState,
): FederationVisibilityLabel => {
  const label = s.self?.visibilityLabel;
  if (label === 'hidden' || label === 'by_handle' || label === 'indexed') {
    return label;
  }
  return 'by_handle';
};
