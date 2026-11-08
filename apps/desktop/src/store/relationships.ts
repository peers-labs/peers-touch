import { createDesktopStore } from './createDesktopStore';
import {
  socialFollow,
  socialGetFollowers,
  socialGetFollowing,
  socialGetRelationship,
  socialUnfollow,
  socialGetRelationshipStatus,
  socialBlockActor,
  socialUnblockActor,
} from '../services/social_api';
import type {
  Follower,
  Following,
  Relationship,
  SocialRelationshipProjection,
  BlockedActorProjection,
} from '../gen/proto/domain/social/relationship_pb';
import { SocialRelationshipAction, SocialRelationshipCommandResultKind, BlockedActorProjectionSchema } from '../gen/proto/domain/social/relationship_pb';
import { create } from '@bufbuild/protobuf';
import { loadAllSocialBlockedActors } from '../services/socialRelationshipPages';
import { EVENT, eventBus } from '../kernel/events';
import { log } from '../utils/logger';
import {
  projectMutualFriends,
  type MutualFriendProjection,
} from './friendshipProjection';

const TAG = 'relationships-store';
const RELATIONSHIP_PAGE_SIZE = 100;
let relationshipsGeneration = 0;
const statusReads = new Map<string, Promise<SocialRelationshipProjection>>();
const blockFlights = new Map<string, { blocked: boolean; completion: Promise<void> }>();
let blockedRead: Promise<void> | null = null;
let blockProjectionVersion = 0;

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
  statuses: Record<string, SocialRelationshipProjection>;
  statusErrors: Record<string, string>;
  blockPending: Record<string, boolean>;
  blockedActors: Record<string, BlockedActorProjection>;
  blockedActorsLoadedAt?: number;
  blockedActorsError: string | null;

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
  loadRelationshipStatus: (targetActorPtid: string) => Promise<SocialRelationshipProjection>;
  setBlocked: (targetActorPtid: string, blocked: boolean) => Promise<void>;
  reconcileRelationships: () => Promise<void>;
  loadBlockedActors: (refresh?: boolean) => Promise<void>;

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
  | 'statuses'
  | 'statusErrors'
  | 'blockPending'
  | 'blockedActors'
  | 'blockedActorsLoadedAt'
  | 'blockedActorsError'
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
  statuses: {},
  statusErrors: {},
  blockPending: {},
  blockedActors: {},
  blockedActorsLoadedAt: undefined,
  blockedActorsError: null,
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

  loadBlockedActors: async (refresh = false) => {
    const generation = relationshipsGeneration;
    if (blockedRead) {
      if (!refresh) return blockedRead;
      await blockedRead.catch(() => {});
      if (generation !== relationshipsGeneration) throw new Error('SOCIAL_SESSION_STALE');
    }
    const version = blockProjectionVersion;
    const assertScope = () => {
      if (generation !== relationshipsGeneration) throw new Error('SOCIAL_SESSION_STALE');
      if (version !== blockProjectionVersion) throw new Error('SOCIAL_RELATIONSHIP_READ_SUPERSEDED');
    };
    const read = loadAllSocialBlockedActors(assertScope).then(items => {
      assertScope();
      set({
        blockedActors: Object.fromEntries(items.map(item => [item.actor!.ptid, item])),
        blockedActorsLoadedAt: Date.now(), blockedActorsError: null,
      });
    }).catch(error => {
      if (generation === relationshipsGeneration && version === blockProjectionVersion) {
        set({ blockedActorsError: String(error) });
      }
      throw error;
    }).finally(() => { if (blockedRead === read) blockedRead = null; });
    blockedRead = read;
    await read;
  },

  loadRelationshipStatus: async targetActorPtid => {
    const existing = statusReads.get(targetActorPtid);
    if (existing) return existing;
    const generation = relationshipsGeneration;
    const read = socialGetRelationshipStatus(targetActorPtid).then(response => {
      if (generation !== relationshipsGeneration) throw new Error('SOCIAL_SESSION_STALE');
      const status = response.relationship;
      if (!status || status.targetActor?.ptid !== targetActorPtid || status.revision < 0n) {
        throw new Error('SOCIAL_RELATIONSHIP_PROJECTION_INVALID');
      }
      const previous = get().statuses[targetActorPtid];
      set(s => ({
        statuses: { ...s.statuses, [targetActorPtid]: status },
        statusErrors: Object.fromEntries(Object.entries(s.statusErrors).filter(([id]) => id !== targetActorPtid)),
      }));
      if (previous && previous.blockedByViewer !== status.blockedByViewer) {
        eventBus.publish(EVENT.RELATIONSHIP_CHANGED, {
          targetActorPtid, action: status.blockedByViewer ? 'block' : 'unblock',
        });
      }
      return status;
    }).catch(error => {
      if (generation === relationshipsGeneration) set(s => ({
        statusErrors: { ...s.statusErrors, [targetActorPtid]: String(error) },
      }));
      throw error;
    }).finally(() => { if (statusReads.get(targetActorPtid) === read) statusReads.delete(targetActorPtid); });
    statusReads.set(targetActorPtid, read);
    return read;
  },

  setBlocked: async (targetActorPtid, blocked) => {
    const existing = blockFlights.get(targetActorPtid);
    if (existing) {
      if (existing.blocked !== blocked) throw new Error('SOCIAL_RELATIONSHIP_MUTATION_PENDING');
      return existing.completion;
    }
    const generation = relationshipsGeneration;
    const assertScope = () => {
      if (generation !== relationshipsGeneration) throw new Error('SOCIAL_SESSION_STALE');
    };
    set(s => ({ blockPending: { ...s.blockPending, [targetActorPtid]: true } }));
    const flight = (async () => {
      const observed = await get().loadRelationshipStatus(targetActorPtid);
      assertScope();
      if (observed.blockedByViewer === blocked) return;
      if (!observed.targetHomeStationPeerId) throw new Error('SOCIAL_RELATIONSHIP_HOME_UNAVAILABLE');
      const input = {
        targetActorPtid, targetHomeStationPeerId: observed.targetHomeStationPeerId,
        observedRevision: observed.revision,
      };
      const response = await (blocked ? socialBlockActor(input) : socialUnblockActor(input));
      assertScope();
      const result = response.result;
      const status = result?.projection;
      const event = result?.event;
      if (!result || ![
        SocialRelationshipCommandResultKind.COMMITTED,
        SocialRelationshipCommandResultKind.DUPLICATE,
      ].includes(result.kind) || !status || !event
        || status.targetActor?.ptid !== targetActorPtid || status.blockedByViewer !== blocked
        || status.targetHomeStationPeerId !== observed.targetHomeStationPeerId
        || event.targetActor?.ptid !== targetActorPtid || event.blocked !== blocked
        || event.action !== (blocked ? SocialRelationshipAction.BLOCK : SocialRelationshipAction.UNBLOCK)
        || event.revision !== status.revision || status.revision <= observed.revision) {
        throw new Error('SOCIAL_RELATIONSHIP_NOT_CONFIRMED');
      }
      blockProjectionVersion += 1;
      set(s => ({
        statuses: { ...s.statuses, [targetActorPtid]: status },
        blockedActors: blocked ? { ...s.blockedActors, [targetActorPtid]: create(BlockedActorProjectionSchema, {
          actor: event.targetActor, revision: event.revision, blockedAt: event.committedAt,
          homeStationPeerId: status.targetHomeStationPeerId,
        }) } : Object.fromEntries(Object.entries(s.blockedActors).filter(([id]) => id !== targetActorPtid)),
      }));
      eventBus.publish(EVENT.RELATIONSHIP_CHANGED, { targetActorPtid, action: blocked ? 'block' : 'unblock' });
    })().catch(async error => {
      if (generation === relationshipsGeneration) {
        await get().loadRelationshipStatus(targetActorPtid).catch(() => {});
      }
      throw error;
    }).finally(() => {
      if (blockFlights.get(targetActorPtid)?.completion === flight) blockFlights.delete(targetActorPtid);
      if (generation === relationshipsGeneration) set(s => ({
        blockPending: { ...s.blockPending, [targetActorPtid]: false },
      }));
    });
    blockFlights.set(targetActorPtid, { blocked, completion: flight });
    await flight;
  },

  reconcileRelationships: async () => {
    const generation = relationshipsGeneration;
    const ids = [...new Set([...Object.keys(get().relations), ...Object.keys(get().statuses)])];
    for (let index = 0; index < ids.length; index += 6) {
      if (generation !== relationshipsGeneration) return;
      await Promise.allSettled(ids.slice(index, index + 6).flatMap(id => [
        get().loadRelationship(id), get().loadRelationshipStatus(id),
      ]));
    }
  },

  loadRelationship: async (targetActorPtid) => {
    const generation = relationshipsGeneration;
    if (get().loading[targetActorPtid]) return get().relations[targetActorPtid];
    set((s) => ({ loading: { ...s.loading, [targetActorPtid]: true } }));
    try {
      const resp = await socialGetRelationship(targetActorPtid);
      if (generation !== relationshipsGeneration) return undefined;
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
      if (generation !== relationshipsGeneration) return undefined;
      set((s) => ({ loading: { ...s.loading, [targetActorPtid]: false } }));
      throw err;
    }
  },

  follow: async (targetActorPtid) => {
    const generation = relationshipsGeneration;
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
      if (generation !== relationshipsGeneration) return;
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
      if (generation !== relationshipsGeneration) return;
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
    const generation = relationshipsGeneration;
    set((s) => {
      const prev = s.relations[targetActorPtid];
      if (!prev) return s;
      return {
        relations: { ...s.relations, [targetActorPtid]: { ...prev, following: false } },
      };
    });
    try {
      await socialUnfollow(targetActorPtid);
      if (generation !== relationshipsGeneration) return;
      eventBus.publish(EVENT.RELATIONSHIP_CHANGED, { targetActorPtid, action: 'unfollow' });
    } catch (err) {
      log.warn(TAG, 'unfollow failed; rolling back', { targetActorPtid, err: String(err) });
      if (generation !== relationshipsGeneration) return;
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
    const generation = relationshipsGeneration;
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
      if (generation !== relationshipsGeneration) return;
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
      if (generation !== relationshipsGeneration) return;
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
    const generation = relationshipsGeneration;
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
      if (generation !== relationshipsGeneration) return;
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
      if (generation !== relationshipsGeneration) return;
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
    const generation = relationshipsGeneration;
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
      if (
        generation !== relationshipsGeneration
        || get().mutualFriendsActorPtid !== normalizedActorPtid
      ) return;
      const loadedAt = Date.now();
      set((state) => ({
        followersByActor: {
          ...state.followersByActor,
          [normalizedActorPtid]: {
            items: followers,
            nextCursor: '',
            total: followers.length,
            loading: false,
            loadedAt,
          },
        },
        mutualFriends: projectMutualFriends(followers, following),
        mutualFriendsLoading: false,
        mutualFriendsLoadedAt: loadedAt,
        mutualFriendsError: null,
      }));
    } catch (err) {
      log.warn(TAG, 'loadMutualFriends failed', {
        actorPtid: normalizedActorPtid,
        err: String(err),
      });
      if (
        generation === relationshipsGeneration
        && get().mutualFriendsActorPtid === normalizedActorPtid
      ) {
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

  reset: () => {
    relationshipsGeneration += 1;
    blockProjectionVersion += 1;
    blockedRead = null;
    statusReads.clear();
    blockFlights.clear();
    set({ ...initialState });
  },
}));
