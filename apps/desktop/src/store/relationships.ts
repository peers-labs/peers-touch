import { create } from 'zustand';
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
//   - `relations[actorId]` — the viewer's edge to that actor
//     (`following`, `followedBy`, timestamp). The map is sparse and
//     gets populated lazily when a UI surface asks for an actor.
//   - `followersByActor[actorId] / followingByActor[actorId]` —
//     paginated lists rendered on the User profile / mutual-friends
//     drawer. Each list carries its own cursor + loading flag.
//
// We deliberately do NOT call `socialGetRelationship` on every render.
// Components ask `useRelation(actorId)`; if the entry is missing the
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

  loadRelationship: (targetActorId: string) => Promise<Relationship | undefined>;
  follow: (targetActorId: string) => Promise<void>;
  unfollow: (targetActorId: string) => Promise<void>;

  loadFollowers: (actorId: string, refresh?: boolean) => Promise<void>;
  loadFollowing: (actorId: string, refresh?: boolean) => Promise<void>;

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

export const useRelationshipsStore = create<RelationshipsState>((set, get) => ({
  ...initialState,

  loadRelationship: async (targetActorId) => {
    if (get().loading[targetActorId]) return get().relations[targetActorId];
    set((s) => ({ loading: { ...s.loading, [targetActorId]: true } }));
    try {
      const resp = await socialGetRelationship(targetActorId);
      if (resp.relationship) {
        set((s) => ({
          relations: { ...s.relations, [targetActorId]: resp.relationship as Relationship },
          loading: { ...s.loading, [targetActorId]: false },
        }));
        return resp.relationship;
      }
      set((s) => ({ loading: { ...s.loading, [targetActorId]: false } }));
      return undefined;
    } catch (err) {
      log.warn(TAG, 'loadRelationship failed', { targetActorId, err: String(err) });
      set((s) => ({ loading: { ...s.loading, [targetActorId]: false } }));
      throw err;
    }
  },

  follow: async (targetActorId) => {
    // Optimistic flip — server confirms via the response payload.
    set((s) => {
      const prev = s.relations[targetActorId];
      const optimistic: Relationship = {
        ...(prev ?? {
          $typeName: 'peers_touch.model.social.v1.Relationship',
          id: '',
          followedBy: false,
          followedAt: undefined,
        } as Relationship),
        targetActorId,
        following: true,
      };
      return { relations: { ...s.relations, [targetActorId]: optimistic } };
    });
    try {
      const resp = await socialFollow(targetActorId);
      if (resp.relationship) {
        set((s) => ({
          relations: { ...s.relations, [targetActorId]: resp.relationship as Relationship },
        }));
      }
      eventBus.publish(EVENT.RELATIONSHIP_CHANGED, { targetActorId, action: 'follow' });
    } catch (err) {
      // Roll back the optimistic flip on failure so the UI doesn't
      // show a follow button stuck in the wrong state.
      log.warn(TAG, 'follow failed; rolling back', { targetActorId, err: String(err) });
      set((s) => {
        const prev = s.relations[targetActorId];
        if (!prev) return s;
        return {
          relations: { ...s.relations, [targetActorId]: { ...prev, following: false } },
        };
      });
      throw err;
    }
  },

  unfollow: async (targetActorId) => {
    set((s) => {
      const prev = s.relations[targetActorId];
      if (!prev) return s;
      return {
        relations: { ...s.relations, [targetActorId]: { ...prev, following: false } },
      };
    });
    try {
      await socialUnfollow(targetActorId);
      eventBus.publish(EVENT.RELATIONSHIP_CHANGED, { targetActorId, action: 'unfollow' });
    } catch (err) {
      log.warn(TAG, 'unfollow failed; rolling back', { targetActorId, err: String(err) });
      set((s) => {
        const prev = s.relations[targetActorId];
        if (!prev) return s;
        return {
          relations: { ...s.relations, [targetActorId]: { ...prev, following: true } },
        };
      });
      throw err;
    }
  },

  loadFollowers: async (actorId, refresh = false) => {
    const current = get().followersByActor[actorId] ?? emptyList<Follower>();
    if (current.loading) return;
    set((s) => ({
      followersByActor: {
        ...s.followersByActor,
        [actorId]: { ...current, loading: true },
      },
    }));
    try {
      const resp = await socialGetFollowers(
        actorId,
        refresh ? undefined : current.nextCursor || undefined,
      );
      set((s) => {
        const prev = refresh ? [] : (s.followersByActor[actorId]?.items ?? []);
        const seen = new Set(prev.map((f) => f.actorId));
        const merged = [...prev, ...resp.followers.filter((f) => !seen.has(f.actorId))];
        return {
          followersByActor: {
            ...s.followersByActor,
            [actorId]: {
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
      log.warn(TAG, 'loadFollowers failed', { actorId, err: String(err) });
      set((s) => ({
        followersByActor: {
          ...s.followersByActor,
          [actorId]: { ...(s.followersByActor[actorId] ?? emptyList<Follower>()), loading: false },
        },
      }));
      throw err;
    }
  },

  loadFollowing: async (actorId, refresh = false) => {
    const current = get().followingByActor[actorId] ?? emptyList<Following>();
    if (current.loading) return;
    set((s) => ({
      followingByActor: {
        ...s.followingByActor,
        [actorId]: { ...current, loading: true },
      },
    }));
    try {
      const resp = await socialGetFollowing(
        actorId,
        refresh ? undefined : current.nextCursor || undefined,
      );
      set((s) => {
        const prev = refresh ? [] : (s.followingByActor[actorId]?.items ?? []);
        const seen = new Set(prev.map((f) => f.actorId));
        const merged = [...prev, ...resp.following.filter((f) => !seen.has(f.actorId))];
        return {
          followingByActor: {
            ...s.followingByActor,
            [actorId]: {
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
      log.warn(TAG, 'loadFollowing failed', { actorId, err: String(err) });
      set((s) => ({
        followingByActor: {
          ...s.followingByActor,
          [actorId]: { ...(s.followingByActor[actorId] ?? emptyList<Following>()), loading: false },
        },
      }));
      throw err;
    }
  },

  reset: () => set({ ...initialState }),
}));
