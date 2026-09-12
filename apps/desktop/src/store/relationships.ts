import { createDesktopStore } from './createDesktopStore';
import {
  socialFollow,
  socialGetFollowers,
  socialGetFollowing,
  socialGetRelationship,
  socialUnfollow,
} from '../services/social_api';
import type {
  Follower,
  Following,
  Relationship,
} from '../gen/proto/domain/social/relationship_pb';
import { EVENT, eventBus } from '../kernel/events';
import { log } from '../utils/logger';
import {
  projectMutualFriends,
  type MutualFriendProjection,
} from './friendshipProjection';

const TAG = 'relationships-store';
const RELATIONSHIP_PAGE_SIZE = 100;

// Per-actor relationship cache:
//   - `relations[actorPtid]` — the viewer's edge to that actor
//     (`following`, `followedBy`, timestamp). The map is sparse and
//     gets populated lazily when a UI surface asks for an actor.
//   - `followersByActor[actorPtid] / followingByActor[actorPtid]` —
//     paginated lists rendered on the User profile / mutual-friends
//     drawer. Each list carries its own cursor + loading flag.
//
// We deliberately do NOT call `socialGetRelationship` on every render.
// Components ask `useRelation(actorPtid)`; if the entry is missing the
// hook fires a single `loadRelationship` call. Repeated reads are
// cache-hits.

export interface RelationListState<T> {
  items: T[];
  nextCursor: string;
  total: number;
  loading: boolean;
  loadedAt?: number;
}

const emptyList = <T>(): RelationListState<T> => ({
  items: [],
  nextCursor: '',
  total: 0,
  loading: false,
});

interface RelationshipsState {
  // viewer's edge to a given target actor (sparse cache).
  relations: Record<string, Relationship>;
  loading: Record<string, boolean>;

  followersByActor: Record<string, RelationListState<Follower>>;
  followingByActor: Record<string, RelationListState<Following>>;
  mutualFriends: MutualFriendProjection[];
  mutualFriendsActorPtid: string | null;
  mutualFriendsLoading: boolean;
  mutualFriendsLoadedAt?: number;
  mutualFriendsError: string | null;

  loadRelationship: (targetActorPtid: string) => Promise<Relationship | undefined>;
  follow: (targetActorPtid: string) => Promise<void>;
  unfollow: (targetActorPtid: string) => Promise<void>;

  loadFollowers: (actorPtid: string, refresh?: boolean) => Promise<void>;
  loadFollowing: (actorPtid: string, refresh?: boolean) => Promise<void>;
  loadMutualFriends: (actorPtid: string, refresh?: boolean) => Promise<void>;
  resetMutualFriends: () => void;

  reset: () => void;
}

const initialState: Pick<
  RelationshipsState,
  | 'relations'
  | 'loading'
  | 'followersByActor'
  | 'followingByActor'
  | 'mutualFriends'
  | 'mutualFriendsActorPtid'
  | 'mutualFriendsLoading'
  | 'mutualFriendsLoadedAt'
  | 'mutualFriendsError'
> = {
  relations: {},
  loading: {},
  followersByActor: {},
  followingByActor: {},
  mutualFriends: [],
  mutualFriendsActorPtid: null,
  mutualFriendsLoading: false,
  mutualFriendsLoadedAt: undefined,
  mutualFriendsError: null,
};

async function loadAllFollowers(actorPtid: string): Promise<Follower[]> {
  const followers: Follower[] = [];
  const seenActorPtids = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const response = await socialGetFollowers(actorPtid, cursor, RELATIONSHIP_PAGE_SIZE);
    for (const follower of response.followers) {
      if (!follower.actorPtid || seenActorPtids.has(follower.actorPtid)) continue;
      seenActorPtids.add(follower.actorPtid);
      followers.push(follower);
    }
    const nextCursor = response.nextCursor || undefined;
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error('social_get_followers returned a repeated cursor');
    }
    if (nextCursor) seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return followers;
}

async function loadAllFollowing(actorPtid: string): Promise<Following[]> {
  const following: Following[] = [];
  const seenActorPtids = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const response = await socialGetFollowing(actorPtid, cursor, RELATIONSHIP_PAGE_SIZE);
    for (const candidate of response.following) {
      if (!candidate.actorPtid || seenActorPtids.has(candidate.actorPtid)) continue;
      seenActorPtids.add(candidate.actorPtid);
      following.push(candidate);
    }
    const nextCursor = response.nextCursor || undefined;
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error('social_get_following returned a repeated cursor');
    }
    if (nextCursor) seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return following;
}

export const useRelationshipsStore = createDesktopStore<RelationshipsState>('relationships', (set, get) => ({
  ...initialState,

  loadRelationship: async (targetActorPtid) => {
    if (get().loading[targetActorPtid]) return get().relations[targetActorPtid];
    set((s) => ({ loading: { ...s.loading, [targetActorPtid]: true } }));
    try {
      const resp = await socialGetRelationship(targetActorPtid);
      if (resp.relationship) {
        set((s) => ({
          relations: { ...s.relations, [targetActorPtid]: resp.relationship as Relationship },
          loading: { ...s.loading, [targetActorPtid]: false },
        }));
        return resp.relationship;
      }
      set((s) => ({ loading: { ...s.loading, [targetActorPtid]: false } }));
      return undefined;
    } catch (err) {
      log.warn(TAG, 'loadRelationship failed', { targetActorPtid, err: String(err) });
      set((s) => ({ loading: { ...s.loading, [targetActorPtid]: false } }));
      throw err;
    }
  },

  follow: async (targetActorPtid) => {
    // Optimistic flip — server confirms via the response payload.
    set((s) => {
      const prev = s.relations[targetActorPtid];
      const optimistic: Relationship = {
        ...(prev ?? {
          $typeName: 'peers_touch.model.social.v1.Relationship',
          id: '',
          followedBy: false,
          followedAt: undefined,
        } as Relationship),
        targetActorPtid,
        following: true,
      };
      return { relations: { ...s.relations, [targetActorPtid]: optimistic } };
    });
    try {
      const resp = await socialFollow(targetActorPtid);
      if (resp.relationship) {
        set((s) => ({
          relations: { ...s.relations, [targetActorPtid]: resp.relationship as Relationship },
        }));
      }
      eventBus.publish(EVENT.RELATIONSHIP_CHANGED, { targetActorPtid, action: 'follow' });
    } catch (err) {
      // Roll back the optimistic flip on failure so the UI doesn't
      // show a follow button stuck in the wrong state.
      log.warn(TAG, 'follow failed; rolling back', { targetActorPtid, err: String(err) });
      set((s) => {
        const prev = s.relations[targetActorPtid];
        if (!prev) return s;
        return {
          relations: { ...s.relations, [targetActorPtid]: { ...prev, following: false } },
        };
      });
      throw err;
    }
  },

  unfollow: async (targetActorPtid) => {
    set((s) => {
      const prev = s.relations[targetActorPtid];
      if (!prev) return s;
      return {
        relations: { ...s.relations, [targetActorPtid]: { ...prev, following: false } },
      };
    });
    try {
      await socialUnfollow(targetActorPtid);
      eventBus.publish(EVENT.RELATIONSHIP_CHANGED, { targetActorPtid, action: 'unfollow' });
    } catch (err) {
      log.warn(TAG, 'unfollow failed; rolling back', { targetActorPtid, err: String(err) });
      set((s) => {
        const prev = s.relations[targetActorPtid];
        if (!prev) return s;
        return {
          relations: { ...s.relations, [targetActorPtid]: { ...prev, following: true } },
        };
      });
      throw err;
    }
  },

  loadFollowers: async (actorPtid, refresh = false) => {
    const current = get().followersByActor[actorPtid] ?? emptyList<Follower>();
    if (current.loading) return;
    set((s) => ({
      followersByActor: {
        ...s.followersByActor,
        [actorPtid]: { ...current, loading: true },
      },
    }));
    try {
      const resp = await socialGetFollowers(
        actorPtid,
        refresh ? undefined : current.nextCursor || undefined,
      );
      set((s) => {
        const prev = refresh ? [] : (s.followersByActor[actorPtid]?.items ?? []);
        const seen = new Set(prev.map((f) => f.actorPtid));
        const merged = [...prev, ...resp.followers.filter((f) => !seen.has(f.actorPtid))];
        return {
          followersByActor: {
            ...s.followersByActor,
            [actorPtid]: {
              items: merged,
              nextCursor: resp.nextCursor,
              total: resp.total,
              loading: false,
              loadedAt: Date.now(),
            },
          },
        };
      });
    } catch (err) {
      log.warn(TAG, 'loadFollowers failed', { actorPtid, err: String(err) });
      set((s) => ({
        followersByActor: {
          ...s.followersByActor,
          [actorPtid]: { ...(s.followersByActor[actorPtid] ?? emptyList<Follower>()), loading: false },
        },
      }));
      throw err;
    }
  },

  loadFollowing: async (actorPtid, refresh = false) => {
    const current = get().followingByActor[actorPtid] ?? emptyList<Following>();
    if (current.loading) return;
    set((s) => ({
      followingByActor: {
        ...s.followingByActor,
        [actorPtid]: { ...current, loading: true },
      },
    }));
    try {
      const resp = await socialGetFollowing(
        actorPtid,
        refresh ? undefined : current.nextCursor || undefined,
      );
      set((s) => {
        const prev = refresh ? [] : (s.followingByActor[actorPtid]?.items ?? []);
        const seen = new Set(prev.map((f) => f.actorPtid));
        const merged = [...prev, ...resp.following.filter((f) => !seen.has(f.actorPtid))];
        return {
          followingByActor: {
            ...s.followingByActor,
            [actorPtid]: {
              items: merged,
              nextCursor: resp.nextCursor,
              total: resp.total,
              loading: false,
              loadedAt: Date.now(),
            },
          },
        };
      });
    } catch (err) {
      log.warn(TAG, 'loadFollowing failed', { actorPtid, err: String(err) });
      set((s) => ({
        followingByActor: {
          ...s.followingByActor,
          [actorPtid]: { ...(s.followingByActor[actorPtid] ?? emptyList<Following>()), loading: false },
        },
      }));
      throw err;
    }
  },

  loadMutualFriends: async (actorPtid, refresh = false) => {
    const normalizedActorPtid = actorPtid.trim();
    if (!normalizedActorPtid) return;
    const current = get();
    if (
      current.mutualFriendsLoading
      && current.mutualFriendsActorPtid === normalizedActorPtid
    ) {
      return;
    }
    if (
      !refresh
      && current.mutualFriendsActorPtid === normalizedActorPtid
      && current.mutualFriendsLoadedAt
    ) {
      return;
    }

    set({
      mutualFriendsActorPtid: normalizedActorPtid,
      mutualFriendsLoading: true,
      mutualFriendsError: null,
    });
    try {
      const [followers, following] = await Promise.all([
        loadAllFollowers(normalizedActorPtid),
        loadAllFollowing(normalizedActorPtid),
      ]);
      if (get().mutualFriendsActorPtid !== normalizedActorPtid) return;
      set({
        mutualFriends: projectMutualFriends(followers, following),
        mutualFriendsLoading: false,
        mutualFriendsLoadedAt: Date.now(),
        mutualFriendsError: null,
      });
    } catch (err) {
      log.warn(TAG, 'loadMutualFriends failed', {
        actorPtid: normalizedActorPtid,
        err: String(err),
      });
      if (get().mutualFriendsActorPtid === normalizedActorPtid) {
        set({
          mutualFriendsLoading: false,
          mutualFriendsError: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  },

  resetMutualFriends: () => set({
    mutualFriends: [],
    mutualFriendsActorPtid: null,
    mutualFriendsLoading: false,
    mutualFriendsLoadedAt: undefined,
    mutualFriendsError: null,
  }),

  reset: () => set({ ...initialState }),
}));
