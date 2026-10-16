import { createDesktopStore } from './createDesktopStore';
import {
  socialBlockActor,
  socialFollow,
  socialGetFollowers,
  socialGetFollowing,
  socialGetRelationship,
  socialGetRelationshipStatus,
  socialListBlockedActors,
  socialUnblockActor,
  socialUnfollow,
  type SocialRelationshipMutationInput,
} from '../services/social_api';
import {
  SocialRelationshipCommandResultKind,
  type BlockedActorProjection,
  type Follower,
  type Following,
  type Relationship,
  type SocialRelationshipProjection,
} from '../gen/proto/domain/social/relationship_pb';
import { EVENT, eventBus } from '../kernel/events';
import { log } from '../utils/logger';
import { currentAuthenticatedActorPtid, useSessionStore } from './session';
import {
  projectMutualFriends,
  type MutualFriendProjection,
} from './friendshipProjection';

const TAG = 'relationships-store';
const RELATIONSHIP_PAGE_SIZE = 100;
let relationshipsGeneration = 0;
const BLOCKED_ACTOR_PAGE_SIZE = 100;

interface RelationshipSessionFence {
  actorPtid: string;
  sessionEpoch: number;
}

function currentRelationshipSessionFence(): RelationshipSessionFence | null {
  const actorPtid = currentAuthenticatedActorPtid();
  if (!actorPtid) return null;
  return {
    actorPtid,
    sessionEpoch: useSessionStore.getState().sessionEpoch,
  };
}

function relationshipSessionFenceMatches(fence: RelationshipSessionFence): boolean {
  return currentAuthenticatedActorPtid() === fence.actorPtid
    && useSessionStore.getState().sessionEpoch === fence.sessionEpoch;
}

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
  blockedActors: BlockedActorProjection[];
  blockedActorsLoading: boolean;
  blockedActorsLoadedAt?: number;
  blockedActorsError: string | null;
  blockedActorMutatingPtid: string | null;
  blockedActorMutationGeneration: number;
  blockedActorsReadGeneration: number;
  relationshipPolicies: Record<string, SocialRelationshipProjection>;
  relationshipPolicyLoading: Record<string, boolean>;
  relationshipPolicyErrors: Record<string, string>;
  relationshipPolicyReadGeneration: Record<string, number>;

  loadRelationship: (targetActorPtid: string) => Promise<Relationship | undefined>;
  follow: (targetActorPtid: string) => Promise<void>;
  unfollow: (targetActorPtid: string) => Promise<void>;

  loadFollowers: (actorPtid: string, refresh?: boolean) => Promise<void>;
  loadFollowing: (actorPtid: string, refresh?: boolean) => Promise<void>;
  loadMutualFriends: (actorPtid: string, refresh?: boolean) => Promise<void>;
  loadBlockedActors: (refresh?: boolean) => Promise<void>;
  loadRelationshipPolicy: (targetActorPtid: string, refresh?: boolean) => Promise<void>;
  setActorBlocked: (input: SocialRelationshipMutationInput, blocked: boolean, expectedSessionEpoch?: number) => Promise<void>;
  unblockActor: (targetActorPtid: string, expectedSessionEpoch?: number) => Promise<void>;
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
  | 'blockedActors'
  | 'blockedActorsLoading'
  | 'blockedActorsLoadedAt'
  | 'blockedActorsError'
  | 'blockedActorMutatingPtid'
  | 'blockedActorMutationGeneration'
  | 'blockedActorsReadGeneration'
  | 'relationshipPolicies'
  | 'relationshipPolicyLoading'
  | 'relationshipPolicyErrors'
  | 'relationshipPolicyReadGeneration'
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
  blockedActors: [],
  blockedActorsLoading: false,
  blockedActorsLoadedAt: undefined,
  blockedActorsError: null,
  blockedActorMutatingPtid: null,
  blockedActorMutationGeneration: 0,
  blockedActorsReadGeneration: 0,
  relationshipPolicies: {},
  relationshipPolicyLoading: {},
  relationshipPolicyErrors: {},
  relationshipPolicyReadGeneration: {},
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

async function loadAllBlockedActors(): Promise<BlockedActorProjection[]> {
  const blockedActors: BlockedActorProjection[] = [];
  const seenActorPtids = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const response = await socialListBlockedActors(
      cursor,
      BLOCKED_ACTOR_PAGE_SIZE,
    );
    for (const item of response.items) {
      const actorPtid = item.actor?.ptid.trim() ?? '';
      if (!actorPtid || seenActorPtids.has(actorPtid)) continue;
      seenActorPtids.add(actorPtid);
      blockedActors.push(item);
    }
    const nextCursor = response.nextCursor || undefined;
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error('social_list_blocked_actors returned a repeated cursor');
    }
    if (nextCursor) seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return blockedActors;
}

export const useRelationshipsStore = createDesktopStore<RelationshipsState>('relationships', (set, get) => ({
  ...initialState,

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

  loadRelationshipPolicy: async (targetActorPtid, refresh = false) => {
    const fence = currentRelationshipSessionFence();
    if (!fence || !targetActorPtid || targetActorPtid === fence.actorPtid) return;
    const state = get();
    if (!refresh && (state.relationshipPolicyLoading[targetActorPtid] || state.relationshipPolicies[targetActorPtid])) return;
    const generation = (state.relationshipPolicyReadGeneration[targetActorPtid] ?? 0) + 1;
    set((current) => ({
      relationshipPolicyLoading: { ...current.relationshipPolicyLoading, [targetActorPtid]: true },
      relationshipPolicyErrors: { ...current.relationshipPolicyErrors, [targetActorPtid]: '' },
      relationshipPolicyReadGeneration: { ...current.relationshipPolicyReadGeneration, [targetActorPtid]: generation },
    }));
    const currentRead = () => relationshipSessionFenceMatches(fence)
      && get().relationshipPolicyReadGeneration[targetActorPtid] === generation;
    try {
      const response = await socialGetRelationshipStatus(targetActorPtid);
      if (!currentRead()) return;
      const policy = response.relationship;
      if (!policy || policy.targetActor?.ptid !== targetActorPtid) throw new Error('social.blockedActor.unavailable');
      const cached = get().relationshipPolicies[targetActorPtid];
      if (cached && policy.revision < cached.revision) return;
      set((current) => ({
        relationshipPolicies: { ...current.relationshipPolicies, [targetActorPtid]: policy },
      }));
    } catch (error) {
      if (!currentRead()) return;
      set((current) => ({
        relationshipPolicyErrors: {
          ...current.relationshipPolicyErrors,
          [targetActorPtid]: error instanceof Error ? error.message : String(error),
        },
      }));
      throw error;
    } finally {
      if (currentRead()) set((current) => ({
        relationshipPolicyLoading: { ...current.relationshipPolicyLoading, [targetActorPtid]: false },
      }));
    }
  },

  loadBlockedActors: async (refresh = false) => {
    const fence = currentRelationshipSessionFence();
    if (!fence) {
      set({
        blockedActors: [],
        blockedActorsLoading: false,
        blockedActorsLoadedAt: undefined,
        blockedActorsError: null,
      });
      return;
    }
    if (!refresh && get().blockedActorsLoading) return;
    const readGeneration = get().blockedActorsReadGeneration + 1;
    set({
      blockedActorsLoading: true,
      blockedActorsError: null,
      blockedActorsReadGeneration: readGeneration,
    });
    const currentRead = () => relationshipSessionFenceMatches(fence)
      && get().blockedActorsReadGeneration === readGeneration;
    try {
      const blockedActors = await loadAllBlockedActors();
      if (!currentRead()) return;
      set({
        blockedActors,
        blockedActorsLoading: false,
        blockedActorsLoadedAt: Date.now(),
        blockedActorsError: null,
      });
    } catch (err) {
      if (!currentRead()) return;
      const error = err instanceof Error ? err.message : String(err);
      log.warn(TAG, 'loadBlockedActors failed', { error });
      set({
        blockedActorsLoading: false,
        blockedActorsError: error,
      });
      throw err;
    }
  },

  setActorBlocked: async (input, blocked, expectedSessionEpoch) => {
    const { targetActorPtid, targetHomeStationPeerId, observedRevision } = input;
    const fence = currentRelationshipSessionFence();
    if (!fence) throw new Error('settings.privacy.sessionUnavailable');
    if (expectedSessionEpoch !== undefined && expectedSessionEpoch !== fence.sessionEpoch) {
      throw new Error('settings.privacy.sessionUnavailable');
    }
    if (!targetActorPtid || targetActorPtid === fence.actorPtid || !targetHomeStationPeerId) {
      throw new Error('social.blockedActor.unavailable');
    }
    if (!Number.isSafeInteger(observedRevision) || observedRevision < 0) {
      throw new Error('social.blockedActor.invalidRevision');
    }
    if (get().blockedActorMutatingPtid) throw new Error('social.blockedActor.busy');

    const mutationGeneration = get().blockedActorMutationGeneration + 1;
    set((current) => ({
      blockedActorMutatingPtid: targetActorPtid,
      blockedActorMutationGeneration: mutationGeneration,
      blockedActorsError: null,
      blockedActorsReadGeneration: current.blockedActorsReadGeneration + 1,
      blockedActorsLoading: false,
      relationshipPolicyReadGeneration: {
        ...current.relationshipPolicyReadGeneration,
        [targetActorPtid]: (current.relationshipPolicyReadGeneration[targetActorPtid] ?? 0) + 1,
      },
      relationshipPolicyLoading: { ...current.relationshipPolicyLoading, [targetActorPtid]: false },
    }));
    try {
      const response = await (blocked ? socialBlockActor : socialUnblockActor)(input);
      if (!relationshipSessionFenceMatches(fence)) return;
      const kind = response.result?.kind
        ?? SocialRelationshipCommandResultKind.UNSPECIFIED;
      if (
        kind !== SocialRelationshipCommandResultKind.COMMITTED
        && kind !== SocialRelationshipCommandResultKind.DUPLICATE
      ) {
        throw new Error(
          kind === SocialRelationshipCommandResultKind.CONFLICT
            ? blocked ? 'social.blockedActor.conflict' : 'settings.privacy.unblockConflict'
            : blocked ? 'social.blockedActor.rejected' : 'settings.privacy.unblockRejected',
        );
      }
      const projection = response.result?.projection;
      if (
        !projection
        || projection.targetActor?.ptid !== targetActorPtid
        || projection.blockedByViewer !== blocked
        || projection.targetHomeStationPeerId !== targetHomeStationPeerId
        || projection.revision < BigInt(observedRevision)
      ) throw new Error('social.blockedActor.unavailable');
      set((current) => ({
        relationshipPolicies: { ...current.relationshipPolicies, [targetActorPtid]: projection },
        relationshipPolicyErrors: { ...current.relationshipPolicyErrors, [targetActorPtid]: '' },
        relationshipPolicyReadGeneration: {
          ...current.relationshipPolicyReadGeneration,
          [targetActorPtid]: (current.relationshipPolicyReadGeneration[targetActorPtid] ?? 0) + 1,
        },
        relationshipPolicyLoading: { ...current.relationshipPolicyLoading, [targetActorPtid]: false },
      }));
      eventBus.publish(EVENT.RELATIONSHIP_CHANGED, {
        targetActorPtid,
        action: blocked ? 'block' : 'unblock',
      });
      await get().loadBlockedActors(true);
    } catch (err) {
      if (!relationshipSessionFenceMatches(fence)) return;
      const error = err instanceof Error ? err.message : String(err);
      log.warn(TAG, 'setActorBlocked failed', { targetActorPtid, blocked, error });
      set({ blockedActorsError: error });
      throw err;
    } finally {
      if (relationshipSessionFenceMatches(fence)) {
        set((state) => (
          state.blockedActorMutationGeneration === mutationGeneration
            ? { blockedActorMutatingPtid: null }
            : state
        ));
      }
    }
  },

  unblockActor: async (targetActorPtid, expectedSessionEpoch) => {
    const blocked = get().blockedActors.find((item) => item.actor?.ptid === targetActorPtid);
    if (!blocked) throw new Error('social.blockedActor.unavailable');
    await get().setActorBlocked({
      targetActorPtid,
      targetHomeStationPeerId: blocked.homeStationPeerId,
      observedRevision: Number(blocked.revision),
    }, false, expectedSessionEpoch);
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
    set({ ...initialState });
  },
}));
