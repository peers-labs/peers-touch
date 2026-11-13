import { create } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SocialRelationshipProjectionSchema,
  SocialRelationshipAction,
  BlockedActorProjectionSchema,
  SocialRelationshipCommandResultKind as ResultKind,
} from '../gen/proto/domain/social/relationship_pb';
import { EVENT, eventBus } from '../kernel/events';
import { useRelationshipsStore } from './relationships';

const api = vi.hoisted(() => ({
  status: vi.fn(), block: vi.fn(), unblock: vi.fn(), relationship: vi.fn(),
  followers: vi.fn(), following: vi.fn(), follow: vi.fn(), unfollow: vi.fn(),
  blocked: vi.fn(),
}));
vi.mock('../services/social_api', () => ({
  socialGetRelationshipStatus: api.status, socialBlockActor: api.block, socialUnblockActor: api.unblock,
  socialGetRelationship: api.relationship, socialFollow: api.follow, socialUnfollow: api.unfollow,
  socialGetFollowers: api.followers, socialGetFollowing: api.following,
  socialListBlockedActors: api.blocked,
}));
vi.mock('../utils/logger', () => ({ log: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../storage/desktopClientStorage', () => ({ readDesktopPreferenceSync: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('CustomEvent', class extends Event {
    detail: unknown;
    constructor(type: string, init: { detail: unknown }) { super(type); this.detail = init.detail; }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('relationships mutual-friend projection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useRelationshipsStore.getState().reset();
  });

  it('loads every page and projects only bidirectional follow edges', async () => {
    api.followers.mockResolvedValueOnce({
      followers: [
        { actorPtid: 'ptid:alice', displayName: 'Alice' },
        { actorPtid: 'ptid:follower-only', displayName: 'Follower only' },
      ], nextCursor: 'followers-page-2', total: 3,
    }).mockResolvedValueOnce({
      followers: [{ actorPtid: 'ptid:carol', displayName: 'Carol' }], nextCursor: '', total: 3,
    });
    api.following.mockResolvedValueOnce({
      following: [{ actorPtid: 'ptid:alice', displayName: 'Alice' }], nextCursor: 'following-page-2', total: 3,
    }).mockResolvedValueOnce({
      following: [
        { actorPtid: 'ptid:carol', displayName: 'Carol' },
        { actorPtid: 'ptid:following-only', displayName: 'Following only' },
      ], nextCursor: '', total: 3,
    });
    await useRelationshipsStore.getState().loadMutualFriends('ptid:self', true);
    expect(useRelationshipsStore.getState().mutualFriends.map(friend => friend.actorPtid))
      .toEqual(['ptid:alice', 'ptid:carol']);
    expect(useRelationshipsStore.getState().followersByActor['ptid:self']?.items.map(follower => follower.actorPtid))
      .toEqual(['ptid:alice', 'ptid:follower-only', 'ptid:carol']);
    expect(api.followers).toHaveBeenNthCalledWith(2, 'ptid:self', 'followers-page-2', 100);
    expect(api.following).toHaveBeenNthCalledWith(2, 'ptid:self', 'following-page-2', 100);
  });

  it('does not let a stale actor response replace the current projection', async () => {
    let resolveOldFollowers!: (value: unknown) => void;
    const oldFollowers = new Promise(resolve => { resolveOldFollowers = resolve; });
    api.followers.mockImplementation((actorPtid: string) => actorPtid === 'ptid:old'
      ? oldFollowers : Promise.resolve({ followers: [{ actorPtid: 'ptid:new-friend' }], nextCursor: '', total: 1 }));
    api.following.mockImplementation((actorPtid: string) => Promise.resolve({
      following: [{ actorPtid: actorPtid === 'ptid:old' ? 'ptid:old-friend' : 'ptid:new-friend' }],
      nextCursor: '', total: 1,
    }));
    const staleLoad = useRelationshipsStore.getState().loadMutualFriends('ptid:old', true);
    await useRelationshipsStore.getState().loadMutualFriends('ptid:new', true);
    resolveOldFollowers({ followers: [{ actorPtid: 'ptid:old-friend' }], nextCursor: '', total: 1 });
    await staleLoad;
    expect(useRelationshipsStore.getState().mutualFriendsActorPtid).toBe('ptid:new');
    expect(useRelationshipsStore.getState().mutualFriends).toEqual([
      expect.objectContaining({ actorPtid: 'ptid:new-friend' }),
    ]);
  });

  it('drops an in-flight follower page after the relationship scope resets', async () => {
    let resolveFollowers!: (value: unknown) => void;
    api.followers.mockImplementationOnce(() => new Promise(resolve => { resolveFollowers = resolve; }));
    const staleLoad = useRelationshipsStore.getState().loadFollowers('ptid:old', true);
    useRelationshipsStore.getState().reset();
    resolveFollowers({ followers: [{ actorPtid: 'ptid:old-follower' }], nextCursor: '', total: 1 });
    await staleLoad;
    expect(useRelationshipsStore.getState().followersByActor).toEqual({});
  });
});

const status = (blocked = false, revision = 0n, target = 'ptid:bob') => create(SocialRelationshipProjectionSchema, {
  targetActor: { ptid: target }, targetHomeStationPeerId: 'home-bob',
  blockedByViewer: blocked, revision, interactionAllowed: !blocked,
});
function result(blocked: boolean, revision: bigint, kind = ResultKind.COMMITTED, target = 'ptid:bob') {
  return { result: { kind, projection: status(blocked, revision, target),
    event: { targetActor: { ptid: target }, revision, blocked,
      action: blocked ? SocialRelationshipAction.BLOCK : SocialRelationshipAction.UNBLOCK } } };
}

describe('authoritative relationship commands', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useRelationshipsStore.getState().reset();
    api.status.mockResolvedValue({ relationship: status() });
    api.relationship.mockResolvedValue({});
    api.blocked.mockResolvedValue({ items: [], nextCursor: '', revision: 0n });
  });

  it('uses the full bigint revision and publishes only the committed projection', async () => {
    const revision = 9_007_199_254_740_993n;
    api.status.mockResolvedValue({ relationship: status(false, revision) });
    api.block.mockResolvedValue(result(true, revision + 1n));
    const seen = vi.fn();
    const release = eventBus.subscribe(EVENT.RELATIONSHIP_CHANGED, seen);
    try {
      await useRelationshipsStore.getState().setBlocked('ptid:bob', true);
      expect(api.block).toHaveBeenCalledWith({
        targetActorPtid: 'ptid:bob', targetHomeStationPeerId: 'home-bob', observedRevision: revision,
      });
      expect(useRelationshipsStore.getState().statuses['ptid:bob'].blockedByViewer).toBe(true);
      expect(seen).toHaveBeenCalledWith({ targetActorPtid: 'ptid:bob', action: 'block' });
    } finally { release(); }
  });

  it('accepts a matching duplicate and routes unblock through the original command', async () => {
    api.status.mockResolvedValue({ relationship: status(true, 1n) });
    api.unblock.mockResolvedValue(result(false, 2n, ResultKind.DUPLICATE));
    await useRelationshipsStore.getState().setBlocked('ptid:bob', false);
    expect(api.unblock).toHaveBeenCalledTimes(1);
    expect(useRelationshipsStore.getState().statuses['ptid:bob'].blockedByViewer).toBe(false);
  });

  it('rejects conflict, wrong target and unchanged revision without a success event', async () => {
    const seen = vi.fn();
    const release = eventBus.subscribe(EVENT.RELATIONSHIP_CHANGED, seen);
    try {
      for (const response of [
        result(true, 1n, ResultKind.CONFLICT), result(true, 1n, ResultKind.COMMITTED, 'ptid:other'),
        result(true, 0n),
      ]) {
        api.block.mockResolvedValueOnce(response);
        await expect(useRelationshipsStore.getState().setBlocked('ptid:bob', true))
          .rejects.toThrow('SOCIAL_RELATIONSHIP_NOT_CONFIRMED');
      }
      expect(seen).not.toHaveBeenCalled();
      expect(useRelationshipsStore.getState().statuses['ptid:bob'].blockedByViewer).toBe(false);
    } finally { release(); }
  });

  it('fences an account change before a late command can publish', async () => {
    let complete!: (value: ReturnType<typeof result>) => void;
    api.block.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const pending = useRelationshipsStore.getState().setBlocked('ptid:bob', true);
    await vi.waitFor(() => expect(api.block).toHaveBeenCalledTimes(1));
    useRelationshipsStore.getState().reset();
    complete(result(true, 1n));
    await expect(pending).rejects.toThrow('SOCIAL_SESSION_STALE');
    expect(useRelationshipsStore.getState().statuses).toEqual({});
    expect(useRelationshipsStore.getState().blockPending).toEqual({});
  });

  it('deduplicates pending commands and reconciles sparse cached statuses', async () => {
    api.block.mockResolvedValue(result(true, 1n));
    await Promise.all([
      useRelationshipsStore.getState().setBlocked('ptid:bob', true),
      useRelationshipsStore.getState().setBlocked('ptid:bob', true),
    ]);
    expect(api.block).toHaveBeenCalledTimes(1);
    api.status.mockResolvedValue({ relationship: status(true, 1n) });
    await useRelationshipsStore.getState().reconcileRelationships();
    expect(api.relationship).toHaveBeenCalledWith('ptid:bob');
    expect(useRelationshipsStore.getState().statuses['ptid:bob'].blockedByViewer).toBe(true);
  });

  it('loads the complete blocked set and removes actors absent from authoritative readback', async () => {
    api.blocked.mockResolvedValueOnce({
      items: [{ actor: { ptid: 'ptid:bob' }, revision: 1n }], nextCursor: 'next', revision: 1n,
    }).mockResolvedValueOnce({
      items: [{ actor: { ptid: 'ptid:carol' }, revision: 2n }], nextCursor: '', revision: 2n,
    });
    await useRelationshipsStore.getState().loadBlockedActors();
    expect(Object.keys(useRelationshipsStore.getState().blockedActors)).toEqual(['ptid:bob', 'ptid:carol']);
    expect(api.blocked).toHaveBeenLastCalledWith('next', 100);
    await useRelationshipsStore.getState().loadBlockedActors();
    expect(useRelationshipsStore.getState().blockedActors).toEqual({});
  });

  it('retains the prior complete blocked set after a failed continuation', async () => {
    useRelationshipsStore.setState({
      blockedActors: { 'ptid:previous': create(BlockedActorProjectionSchema, {
        actor: { ptid: 'ptid:previous' }, revision: 1n,
      }) },
    });
    api.blocked.mockResolvedValueOnce({
      items: [{ actor: { ptid: 'ptid:bob' }, revision: 1n }], nextCursor: 'next', revision: 1n,
    }).mockRejectedValueOnce(new Error('offline'));
    await expect(useRelationshipsStore.getState().loadBlockedActors()).rejects.toThrow('offline');
    expect(Object.keys(useRelationshipsStore.getState().blockedActors)).toEqual(['ptid:previous']);
  });

  it('does not allow an older blocked-list read to undo a committed block', async () => {
    let complete!: (value: unknown) => void;
    api.blocked.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const read = useRelationshipsStore.getState().loadBlockedActors();
    const rejected = expect(read).rejects.toThrow('SOCIAL_RELATIONSHIP_READ_SUPERSEDED');
    api.block.mockResolvedValue(result(true, 1n));
    await useRelationshipsStore.getState().setBlocked('ptid:bob', true);
    complete({ items: [], nextCursor: '', revision: 0n });
    await rejected;
    expect(Object.keys(useRelationshipsStore.getState().blockedActors)).toEqual(['ptid:bob']);
  });

  it('rejects the opposite intent while a command is pending', async () => {
    let complete!: (value: ReturnType<typeof result>) => void;
    api.block.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const pending = useRelationshipsStore.getState().setBlocked('ptid:bob', true);
    await vi.waitFor(() => expect(api.block).toHaveBeenCalledTimes(1));
    await expect(useRelationshipsStore.getState().setBlocked('ptid:bob', false))
      .rejects.toThrow('SOCIAL_RELATIONSHIP_MUTATION_PENDING');
    complete(result(true, 1n));
    await pending;
  });

  it('publishes the original invalidation when reconciliation discovers a dropped block event', async () => {
    await useRelationshipsStore.getState().loadRelationshipStatus('ptid:bob');
    const seen = vi.fn();
    const release = eventBus.subscribe(EVENT.RELATIONSHIP_CHANGED, seen);
    try {
      api.status.mockResolvedValue({ relationship: status(true, 1n) });
      await useRelationshipsStore.getState().loadRelationshipStatus('ptid:bob');
      expect(seen).toHaveBeenCalledWith({ targetActorPtid: 'ptid:bob', action: 'block' });
    } finally { release(); }
  });

  it.each([true, false])('retains revision N+1 after a status read during pending blocked=%s', async blocked => {
    const before = status(!blocked, 10n);
    api.status.mockResolvedValueOnce({ relationship: before });
    let commit!: (value: ReturnType<typeof result>) => void;
    const command = blocked ? api.block : api.unblock;
    command.mockReturnValueOnce(new Promise(resolve => { commit = resolve; }));
    const mutation = useRelationshipsStore.getState().setBlocked('ptid:bob', blocked);
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    let finishRead!: (value: unknown) => void;
    api.status.mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
    const read = useRelationshipsStore.getState().loadRelationshipStatus('ptid:bob');
    const seen = vi.fn();
    const release = eventBus.subscribe(EVENT.RELATIONSHIP_CHANGED, seen);
    try {
      commit(result(blocked, 11n));
      await mutation;
      const retained = useRelationshipsStore.getState().statuses['ptid:bob'];
      finishRead({ relationship: before });
      expect(await read).toBe(retained);
      expect(useRelationshipsStore.getState().statuses['ptid:bob']).toBe(retained);
      expect(Boolean(useRelationshipsStore.getState().blockedActors['ptid:bob'])).toBe(blocked);
      expect(seen.mock.calls).toEqual([[{ targetActorPtid: 'ptid:bob', action: blocked ? 'block' : 'unblock' }]]);
    } finally { release(); }
  });
});
