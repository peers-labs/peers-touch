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

const TAG = 'relationships-store';

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

  loadRelationship: (targetActorPtid: string) => Promise<Relationship | undefined>;
  follow: (targetActorPtid: string) => Promise<void>;
  unfollow: (targetActorPtid: string) => Promise<void>;

  loadFollowers: (actorPtid: string, refresh?: boolean) => Promise<void>;
  loadFollowing: (actorPtid: string, refresh?: boolean) => Promise<void>;

  reset: () => void;
}

const initialState: Pick<
  RelationshipsState,
  'relations' | 'loading' | 'followersByActor' | 'followingByActor'
> = {
  relations: {},
  loading: {},
  followersByActor: {},
  followingByActor: {},
};

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

  reset: () => set({ ...initialState }),
}));
