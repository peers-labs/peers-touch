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
  FederationSummary,
  CreateFederationResponse,
  DeleteFederationResponse,
  FederationCatalogEntry,
  JoinFederationResponse,
  LeaveFederationResponse,
  MemberStationView,
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
  federationId?: string;
  stationPeerId?: string;
  actorStationEntries: Readonly<Record<string, FederationCatalogEntry>>;
  memberStationsByFederation: Readonly<Record<string, readonly MemberStationView[]>>;
}): string {
  const stationPeerId = input.stationPeerId?.trim() || '';
  const federationId = input.federationId?.trim() || '';
  const actorEntry = input.actorPtid
    ? input.actorStationEntries[input.actorPtid]
    : undefined;
  if (
    actorEntry?.homeStationName.trim()
    && (!stationPeerId || actorEntry.homeStationPeerId.trim() === stationPeerId)
  ) {
    return actorEntry.homeStationName.trim();
  }

  const scopedStations = federationId
    ? input.memberStationsByFederation[federationId] ?? []
    : Object.values(input.memberStationsByFederation).flat();
  const memberStation = scopedStations.find(
    (station) => station.stationPeerId.trim() === stationPeerId,
  );
  if (memberStation?.stationName.trim()) return memberStation.stationName.trim();
  return '';
}

export interface FederationState {
  /** GET /actor/federation/me snapshot, null while logged out / not yet loaded. */
  self: FederationSelfView | null;
  /** GET /actor/federation/health snapshot, populated even pre-login. */
  health: FederationHealthView | null;
  /** True while the very first /me + /health round-trip is in flight. */
  loading: boolean;
  /** Last error surface; rendered by Settings when non-empty. */
  lastError: string | null;
  /** Detailed federation list from governance subserver. */
  federations: FederationSummary[];
  /** Authoritative Station directory, scoped by Federation ID. */
  memberStationsByFederation: Record<string, MemberStationView[]>;
  /** Actor-resolved Station names retained from authoritative catalog rows. */
  actorStationEntries: Record<string, FederationCatalogEntry>;

  refreshSelf: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  refreshFederations: () => Promise<void>;
  setVisibility: (label: FederationVisibilityLabel) => Promise<void>;
  createFederation: (name: string, description?: string, policyType?: string) => Promise<CreateFederationResponse>;
  joinFederation: (params: { federationEndpoint?: string; federationId?: string; message?: string }) => Promise<JoinFederationResponse>;
  leaveFederation: (federationId: string, reason?: string) => Promise<LeaveFederationResponse>;
  deleteFederation: (federationId: string) => Promise<DeleteFederationResponse>;
  listMemberStations: (federationId: string) => Promise<MemberStationView[]>;
  rememberCatalogEntries: (entries: readonly FederationCatalogEntry[]) => void;
  resolveActorStations: (
    candidates: readonly FederationActorStationCandidate[],
  ) => Promise<void>;
  /** Drop session-bound state (called by FederationRuntime on logout). */
  clearSession: () => void;
}

export const useFederationStore = createDesktopStore<FederationState>('federation', (set, get) => ({
  self: null,
  health: null,
  loading: false,
  lastError: null,
  federations: [],
  memberStationsByFederation: {},
  actorStationEntries: {},

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
      log.debug('federation', 'refreshHealth failed', { error: msg });
    }
  },

  refreshFederations: async () => {
    try {
      const resp = await api.federationListFederations();
      const federations = resp.federations ?? [];
      const stationResults = await Promise.allSettled(
        federations.map(async (federation) => ({
          federationId: federation.federationId,
          stations: (
            await api.federationListMemberStations(federation.federationId)
          ).stations ?? [],
        })),
      );
      set((state) => {
        const memberStationsByFederation: Record<string, MemberStationView[]> = {};
        stationResults.forEach((result, index) => {
          const federationId = federations[index]?.federationId ?? '';
          if (!federationId) return;
          memberStationsByFederation[federationId] = result.status === 'fulfilled'
            ? result.value.stations
            : state.memberStationsByFederation[federationId] ?? [];
        });
        return {
          federations,
          memberStationsByFederation,
        };
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('federation', 'refreshFederations failed', { error: msg });
    }
  },

  setVisibility: async (label) => {
    const prev = get().self;
    if (prev) {
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
      set({ self: prev, lastError: msg });
      throw err;
    }
  },

  createFederation: async (name, description, policyType) => {
    const resp = await api.federationCreate({
      name,
      description: description ?? '',
      policy_type: policyType ?? 'single_admin',
    });
    await get().refreshSelf();
    await get().refreshFederations();
    return resp;
  },

  joinFederation: async (params) => {
    const resp = await api.federationJoin({
      federation_endpoint: params.federationEndpoint ?? '',
      federation_id: params.federationId ?? '',
      message: params.message ?? '',
    });
    await get().refreshSelf();
    await get().refreshFederations();
    return resp;
  },

  leaveFederation: async (federationId, reason) => {
    const resp = await api.federationLeave({
      federation_id: federationId,
      reason: reason ?? '',
    });
    await get().refreshSelf();
    await get().refreshFederations();
    return resp;
  },

  deleteFederation: async (federationId) => {
    const resp = await api.federationDelete({
      federation_id: federationId,
    });
    await get().refreshSelf();
    await get().refreshFederations();
    return resp;
  },

  listMemberStations: async (federationId) => {
    const resp = await api.federationListMemberStations(federationId);
    const stations = resp.stations ?? [];
    set((state) => ({
      memberStationsByFederation: {
        ...state.memberStationsByFederation,
        [federationId]: stations,
      },
    }));
    return stations;
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
      memberStationsByFederation: {},
      actorStationEntries: {},
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
