// Federation projection store (Tier A1).
//
// Owns the read-only Federation context and connection projection. Actor identity
// and discoverability are loaded and mutated through the canonical profile API;
// Federation lifecycle governance remains Station operator-only.
//
// The runtime drives reads, while components render state and dispatch explicit
// user actions.

import { createDesktopStore } from './createDesktopStore';
import { api } from '../services/desktop_api';
import type {
  AccountProfile,
  FederationContext,
  FederationCatalogEntry,
} from '../services/desktop_api';
import { log } from '../utils/logger';

export type FederationVisibilityLabel =
  | 'hidden'
  | 'by_handle'
  | 'indexed';

export interface FederationActorStationCandidate {
  actorPtid: string;
  federationId: string;
  username: string;
}

export function resolveFederationStationName(input: {
  actorPtid?: string;
  stationPeerId?: string;
  actorStationEntries: Readonly<Record<string, FederationCatalogEntry>>;
}): string {
  const stationPeerId = input.stationPeerId?.trim() || '';
  const actorEntry = input.actorPtid
    ? input.actorStationEntries[input.actorPtid]
    : undefined;
  if (
    actorEntry?.homeStationName.trim()
    && (!stationPeerId || actorEntry.homeStationPeerId.trim() === stationPeerId)
  ) {
    return actorEntry.homeStationName.trim();
  }
  return '';
}

export interface FederationState {
  /** Canonical /actor/profile snapshot, null while logged out or loading. */
  self: AccountProfile | null;
  /** True while the first profile round-trip is in flight. */
  loading: boolean;
  /** Last profile or context error rendered by Settings. */
  lastError: string | null;
  /** Station-provided Federation contexts available to this actor. */
  federations: FederationContext[];
  /** Actor-resolved Station names retained from authoritative catalog rows. */
  actorStationEntries: Record<string, FederationCatalogEntry>;

  refreshSelf: () => Promise<void>;
  refreshFederationContexts: () => Promise<void>;
  setVisibility: (label: FederationVisibilityLabel) => Promise<void>;
  rememberCatalogEntries: (entries: readonly FederationCatalogEntry[]) => void;
  resolveActorStations: (
    candidates: readonly FederationActorStationCandidate[],
  ) => Promise<void>;
  /** Drop session-bound state (called by FederationRuntime on logout). */
  clearSession: () => void;
}

export const useFederationStore = createDesktopStore<FederationState>('federation', (set, get) => ({
  self: null,
  loading: false,
  lastError: null,
  federations: [],
  actorStationEntries: {},

  refreshSelf: async () => {
    const wasLoaded = get().self != null;
    if (!wasLoaded) set({ loading: true });
    try {
      const view = await api.profileGet();
      set({ self: view, loading: false, lastError: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('federation', 'refreshSelf failed', { error: msg });
      set((state) => ({
        loading: false,
        lastError: msg,
        self: state.self,
      }));
    }
  },

  refreshFederationContexts: async () => {
    try {
      const resp = await api.federationListContexts();
      set({ federations: resp.contexts ?? [] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('federation', 'refreshFederationContexts failed', { error: msg });
    }
  },

  setVisibility: async (label) => {
    const prev = get().self;
    if (!prev) return;
    set({ self: { ...prev, discoverability: label }, lastError: null });
    try {
      const result = await api.profileUpdate({
        observed_revision: prev.profile_revision,
        discoverability: label,
      });
      set({ self: result.profile, lastError: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('federation', 'setVisibility failed', { error: msg, label });
      set({ self: prev, lastError: msg });
      throw err;
    }
  },

  rememberCatalogEntries: (entries) => {
    set((state) => {
      const actorStationEntries = { ...state.actorStationEntries };
      for (const entry of entries) {
        if (
          !entry.actorPtid.trim()
          || !entry.homeStationPeerId.trim()
          || !entry.homeStationName.trim()
        ) {
          continue;
        }
        actorStationEntries[entry.actorPtid] = entry;
      }
      return { actorStationEntries };
    });
  },

  resolveActorStations: async (candidates) => {
    const unresolved = candidates.filter((candidate) => (
      candidate.actorPtid.trim()
      && candidate.federationId.trim()
      && candidate.username.trim()
      && !get().actorStationEntries[candidate.actorPtid]?.homeStationName.trim()
    ));
    const results = await Promise.allSettled(
      unresolved.map(async (candidate) => {
        const response = await api.federationCatalogSearch({
          federation_id: candidate.federationId,
          prefix: candidate.username,
          page_size: 20,
        });
        return (response.entries ?? []).find(
          (entry) => entry.actorPtid === candidate.actorPtid,
        );
      }),
    );
    get().rememberCatalogEntries(
      results.flatMap((result) => (
        result.status === 'fulfilled' && result.value
          ? [result.value]
          : []
      )),
    );
  },

  clearSession: () =>
    set({
      self: null,
      loading: false,
      lastError: null,
      federations: [],
      actorStationEntries: {},
    }),
}));

/** Selector helpers — keep components free of `useFederationStore` plumbing. */
export const selectFederationHandle = (s: FederationState): string =>
  s.self?.federated_handle ?? '';

export const selectFederationVisibility = (
  s: FederationState,
): FederationVisibilityLabel => {
  const label = s.self?.discoverability;
  if (label === 'hidden' || label === 'by_handle' || label === 'indexed') {
    return label;
  }
  return 'by_handle';
};
