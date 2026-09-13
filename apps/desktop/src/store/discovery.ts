import { createDesktopStore } from './createDesktopStore';
import { api as desktopApi } from '../services/desktop_api';
import { log } from '../utils/logger';

const TAG = 'discovery-store';

// Discovery — user search + "me" caching.
//
// Why a dedicated store and not a hook?
//   - Multiple unrelated UI surfaces want the same search results
//     (composer mention picker, header search box, follow page),
//     and they should share a single in-flight request and the same
//     debounced result set.
//   - "Me" is a one-shot fetch the rest of the app reads cheaply;
//     keeping it here means components don't import the actor API
//     directly for an identity that's effectively a singleton.
//
// We intentionally piggyback on the legacy `actor_search_users` /
// `actor_get_me` Tauri commands (they predate Moments). Wiring those
// through `social.rs` would just be a name-only rename — the wire
// shape is identical.

export interface DiscoveryUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  actorPtid?: string;
  avatar?: string;
  homeStationDomain?: string;
}

export interface MeProfile {
  id: string;
  displayName: string;
  username: string;
  avatar: string;
}

interface DiscoveryState {
  // Last-issued search; the array of matches and the query string
  // that produced them. Single slot — not a multi-query cache,
  // because UI usage is "type, see results, pick one".
  query: string;
  results: DiscoveryUser[];
  total: number;
  searching: boolean;
  searchError?: string;
  usersById: Record<string, DiscoveryUser>;
  profileLoadingById: Record<string, boolean>;

  me?: MeProfile;
  meLoading: boolean;
  meError?: string;

  searchUsers: (q: string) => Promise<void>;
  loadUserProfile: (actorPtid: string, force?: boolean) => Promise<DiscoveryUser | undefined>;
  loadMe: (force?: boolean) => Promise<MeProfile | undefined>;
  reset: () => void;
}

const initialState: Pick<
  DiscoveryState,
  | 'query'
  | 'results'
  | 'total'
  | 'searching'
  | 'searchError'
  | 'usersById'
  | 'profileLoadingById'
  | 'me'
  | 'meLoading'
  | 'meError'
> = {
  query: '',
  results: [],
  total: 0,
  searching: false,
  usersById: {},
  profileLoadingById: {},
  me: undefined,
  meLoading: false,
};

let inFlightSearchToken = 0;
let profileLoadGeneration = 0;

export const useDiscoveryStore = createDesktopStore<DiscoveryState>('discovery', (set, get) => ({
  ...initialState,

  searchUsers: async (q) => {
    const trimmed = q.trim();
    if (!trimmed) {
      // Empty query clears the slate but does NOT call the backend —
      // keeps the "no recent search" UI from flickering.
      inFlightSearchToken += 1;
      set({ query: '', results: [], total: 0, searching: false, searchError: undefined });
      return;
    }
    const token = ++inFlightSearchToken;
    set({ query: trimmed, results: [], total: 0, searching: true, searchError: undefined });
    try {
      const data = await desktopApi.actorSearchActors(trimmed);
      // Drop late results: only honour the *last* search the user issued.
      if (token !== inFlightSearchToken) return;
      const items: DiscoveryUser[] = (data.items ?? []).map((raw) => ({
        id: String(raw.actorPtid ?? ''),
        username: String(raw.username ?? ''),
        displayName: String(raw.displayName ?? raw.username ?? ''),
        email: raw.email ? String(raw.email) : undefined,
        actorPtid: raw.actorPtid ? String(raw.actorPtid) : undefined,
        avatar: raw.avatar ? String(raw.avatar) : undefined,
      }));
      set((state) => ({
        results: items,
        total: data.total ?? items.length,
        searching: false,
        usersById: {
          ...state.usersById,
          ...Object.fromEntries(items.map((item) => [item.id, item])),
        },
      }));
    } catch (err) {
      if (token !== inFlightSearchToken) return;
      log.warn(TAG, 'searchUsers failed', { q: trimmed, err: String(err) });
      set({ searching: false, searchError: String(err) });
    }
  },

  loadUserProfile: async (actorPtid, force = false) => {
    const id = actorPtid.trim();
    if (!id) return undefined;
    const generation = profileLoadGeneration;
    const current = get();
    if (!force && current.usersById[id]) return current.usersById[id];
    if (current.profileLoadingById[id]) return current.usersById[id];

    set((state) => ({
      profileLoadingById: { ...state.profileLoadingById, [id]: true },
    }));
    try {
      const profile = await desktopApi.peerProfileGet(id);
      if (generation !== profileLoadGeneration) return undefined;
      const user: DiscoveryUser = {
        id,
        actorPtid: id,
        username: profile.username,
        displayName: profile.display_name || profile.username,
        avatar: profile.avatar || undefined,
      };
      set((state) => ({
        usersById: { ...state.usersById, [id]: user },
        profileLoadingById: { ...state.profileLoadingById, [id]: false },
      }));
      return user;
    } catch (err) {
      if (generation !== profileLoadGeneration) return undefined;
      log.warn(TAG, 'loadUserProfile failed', { actorPtid: id, err: String(err) });
      set((state) => ({
        profileLoadingById: { ...state.profileLoadingById, [id]: false },
      }));
      return get().usersById[id];
    }
  },

  loadMe: async (force = false) => {
    if (!force && get().me) return get().me;
    if (get().meLoading) return get().me;
    set({ meLoading: true, meError: undefined });
    try {
      const data = await desktopApi.actorGetMyProfile();
      if (!data) {
        set({ meLoading: false });
        return undefined;
      }
      const me: MeProfile = {
        id: String(data.actorPtid ?? ''),
        displayName: String(data.displayName ?? ''),
        username: String(data.username ?? ''),
        avatar: String(data.avatar ?? ''),
      };
      set({ me, meLoading: false });
      return me;
    } catch (err) {
      log.warn(TAG, 'loadMe failed', { err: String(err) });
      set({ meLoading: false, meError: String(err) });
      throw err;
    }
  },

  reset: () => {
    inFlightSearchToken += 1;
    profileLoadGeneration += 1;
    set({ ...initialState });
  },
}));
