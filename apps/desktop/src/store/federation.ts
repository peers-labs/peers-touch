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
  AccountContactPolicy,
  AccountDiscoverability,
  AccountProfile,
  FederationContext,
  FederationCatalogEntry,
  ProfileUpdateInput,
  ProfileUpdateResult,
} from '../services/desktop_api';
import { log } from '../utils/logger';
import { currentAuthenticatedActorPtid, useSessionStore } from './session';

let profileMutationQueue: Promise<void> = Promise.resolve();
let projectionGeneration = 0;

interface FederationSessionFence {
  actorPtid: string;
  sessionEpoch: number;
  projectionGeneration: number;
}

function currentFederationSessionFence(): FederationSessionFence | null {
  const actorPtid = currentAuthenticatedActorPtid();
  if (!actorPtid) return null;
  return {
    actorPtid,
    sessionEpoch: useSessionStore.getState().sessionEpoch,
    projectionGeneration,
  };
}

function federationSessionFenceMatches(fence: FederationSessionFence): boolean {
  return projectionGeneration === fence.projectionGeneration
    && currentAuthenticatedActorPtid() === fence.actorPtid
    && useSessionStore.getState().sessionEpoch === fence.sessionEpoch;
}

function serializeProfileMutation(operation: () => Promise<void>): Promise<void> {
  const result = profileMutationQueue.then(operation, operation);
  profileMutationQueue = result.catch(() => undefined);
  return result;
}

function profileOwner(profile: AccountProfile | null): string {
  return profile?.peers_touch.network_id.trim() ?? '';
}

function federationOwnerMatches(
  get: () => FederationState,
  fence: FederationSessionFence,
): boolean {
  return federationSessionFenceMatches(fence)
    && profileOwner(get().self) === fence.actorPtid;
}

export type FederationVisibilityLabel =
  AccountDiscoverability;

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
  setContactPolicy: (policy: AccountContactPolicy) => Promise<void>;
  setFederationVisibility: (
    federationId: string,
    visibility: FederationVisibilityLabel,
  ) => Promise<void>;
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
    const fence = currentFederationSessionFence();
    if (!fence) {
      set({ self: null, loading: false });
      return;
    }
    const wasLoaded = get().self != null;
    if (!wasLoaded) set({ loading: true });
    try {
      const view = await api.profileGet();
      if (!federationSessionFenceMatches(fence)) return;
      set({ self: view, loading: false, lastError: null });
    } catch (err: unknown) {
      if (!federationSessionFenceMatches(fence)) return;
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
    const fence = currentFederationSessionFence();
    if (!fence) {
      set({ federations: [] });
      return;
    }
    try {
      const resp = await api.federationListContexts();
      if (!federationSessionFenceMatches(fence)) return;
      set({ federations: resp.contexts ?? [] });
    } catch (err: unknown) {
      if (!federationSessionFenceMatches(fence)) return;
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('federation', 'refreshFederationContexts failed', { error: msg });
    }
  },

  setVisibility: (label) => {
    const fence = currentFederationSessionFence();
    if (!fence) return Promise.resolve();
    return serializeProfileMutation(async () => {
      if (!federationOwnerMatches(get, fence)) return;
      const prev = get().self!;
      set({ lastError: null });
      try {
        const result = await updateProfileWithConflictRetry(
          prev,
          () => ({ discoverability: label }),
        );
        if (!federationOwnerMatches(get, fence)) return;
        set((state) => ({
          self: newerProfile(state.self, result.profile),
          lastError: null,
        }));
      } catch (err: unknown) {
        if (!federationOwnerMatches(get, fence)) return;
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('federation', 'setVisibility failed', { error: msg, label });
        set({ lastError: msg });
        throw err;
      }
    });
  },

  setContactPolicy: (policy) => {
    const fence = currentFederationSessionFence();
    if (!fence) return Promise.resolve();
    return serializeProfileMutation(async () => {
      if (!federationOwnerMatches(get, fence)) return;
      const prev = get().self!;
      set({ lastError: null });
      try {
        const result = await updateProfileWithConflictRetry(
          prev,
          () => ({ contact_policy: policy }),
        );
        if (!federationOwnerMatches(get, fence)) return;
        set((state) => ({
          self: newerProfile(state.self, result.profile),
          lastError: null,
        }));
      } catch (err: unknown) {
        if (!federationOwnerMatches(get, fence)) return;
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('federation', 'setContactPolicy failed', { error: msg, policy });
        set({ lastError: msg });
        throw err;
      }
    });
  },

  setFederationVisibility: (federationId, visibility) => {
    const fence = currentFederationSessionFence();
    if (!fence) return Promise.resolve();
    return serializeProfileMutation(async () => {
      if (
        !federationId.trim()
        || !federationOwnerMatches(get, fence)
      ) {
        return;
      }
      const prev = get().self!;
      set({ lastError: null });
      try {
        const result = await updateProfileWithConflictRetry(
          prev,
          (profile) => ({
            ...(visibility === 'indexed' && profile.discoverability !== 'indexed'
              ? { discoverability: 'indexed' as const }
              : {}),
            federation_visibility: {
              ...profile.federation_visibility,
              [federationId]: visibility,
            },
          }),
        );
        if (!federationOwnerMatches(get, fence)) return;
        set((state) => ({
          self: newerProfile(state.self, result.profile),
          lastError: null,
        }));
      } catch (err: unknown) {
        if (!federationOwnerMatches(get, fence)) return;
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('federation', 'setFederationVisibility failed', {
          error: msg,
          federationId,
          visibility,
        });
        set({ lastError: msg });
        throw err;
      }
    });
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
    const fence = currentFederationSessionFence();
    if (!fence) return;
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
    if (!federationSessionFenceMatches(fence)) return;
    get().rememberCatalogEntries(
      results.flatMap((result) => (
        result.status === 'fulfilled' && result.value
          ? [result.value]
          : []
      )),
    );
  },

  clearSession: () => {
    projectionGeneration += 1;
    set({
      self: null,
      loading: false,
      lastError: null,
      federations: [],
      actorStationEntries: {},
    });
  },
}));

type ProfileMutation = (
  profile: AccountProfile,
) => Omit<ProfileUpdateInput, 'observed_revision'>;

function newerProfile(
  current: AccountProfile | null,
  candidate: AccountProfile,
): AccountProfile | null {
  if (!current) return null;
  if (
    current.peers_touch.network_id !== candidate.peers_touch.network_id
    || candidate.profile_revision < current.profile_revision
  ) {
    return current;
  }
  return candidate;
}

async function updateProfileWithConflictRetry(
  profile: AccountProfile,
  mutation: ProfileMutation,
): Promise<ProfileUpdateResult> {
  let current = profile;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await api.profileUpdate({
      ...mutation(current),
      observed_revision: current.profile_revision,
    });
    if (result.outcome !== 'PROFILE_UPDATE_OUTCOME_CONFLICT') {
      return result;
    }
    current = result.profile;
  }
  throw new Error('Profile changed concurrently. Please try again.');
}

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
