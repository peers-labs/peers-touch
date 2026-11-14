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
import { useSessionStore } from './session';

export interface FederationActorStationCandidate {
  actorPtid: string;
  federationId: string;
  username: string;
}

export function isRawStationAuthority(value: string): boolean {
  if (/^https?:\/\//i.test(value)) return true;
  if (/\s/.test(value)) return false;
  return (
    /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(value)
    || /^\[[0-9a-f:]+\](?::\d+)?$/i.test(value)
    || /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?$/i.test(value)
  );
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
    const name = actorEntry.homeStationName.trim();
    return isRawStationAuthority(name) ? '' : name;
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
  rememberCatalogEntries: (entries: readonly FederationCatalogEntry[]) => void;
  resolveActorStations: (
    candidates: readonly FederationActorStationCandidate[],
  ) => Promise<void>;
  /** Drop session-bound state (called by FederationRuntime on logout). */
  clearSession: () => void;
}

let resetGeneration = 0;
const currentScope = () => `${useSessionStore.getState().sessionEpoch}:${resetGeneration}`;

export const useFederationStore = createDesktopStore<FederationState>('federation', (set, get) => ({
  self: null,
  loading: false,
  lastError: null,
  federations: [],
  actorStationEntries: {},

  refreshSelf: async () => {
    const scope = currentScope();
    const wasLoaded = get().self != null;
    if (!wasLoaded) set({ loading: true });
    try {
      const view = await api.profileGet();
      if (scope !== currentScope()) return;
      set({ self: view, loading: false, lastError: null });
    } catch (err: unknown) {
      if (scope !== currentScope()) return;
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('federation', 'refreshSelf failed', { error: msg });
      set((state) => ({
        loading: false,
        lastError: msg,
        self: state.self,
      }));
      throw err;
    }
  },

  refreshFederationContexts: async () => {
    const scope = currentScope();
    try {
      const resp = await api.federationListContexts();
      if (scope !== currentScope()) return;
      set({ federations: resp.contexts ?? [] });
    } catch (err: unknown) {
      if (scope !== currentScope()) return;
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('federation', 'refreshFederationContexts failed', { error: msg });
      set({ lastError: msg });
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
    const scope = currentScope();
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
    if (scope !== currentScope()) return;
    get().rememberCatalogEntries(
      results.flatMap((result) => (
        result.status === 'fulfilled' && result.value
          ? [result.value]
          : []
      )),
    );
  },

  clearSession: () => {
    resetGeneration++;
    set({
      self: null,
      loading: false,
      lastError: null,
      federations: [],
      actorStationEntries: {},
    });
  },
}));

/** Selector helpers — keep components free of `useFederationStore` plumbing. */
export const selectFederationHandle = (s: FederationState): string =>
  s.self?.federated_handle ?? '';
