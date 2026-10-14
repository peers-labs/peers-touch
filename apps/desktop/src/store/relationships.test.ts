import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialRelationshipCommandResultKind } from '../gen/proto/domain/social/relationship_pb';

const mocks = vi.hoisted(() => ({
  socialFollow: vi.fn(),
  socialGetFollowers: vi.fn(),
  socialGetFollowing: vi.fn(),
  socialGetRelationship: vi.fn(),
  socialListBlockedActors: vi.fn(),
  socialUnblockActor: vi.fn(),
  socialUnfollow: vi.fn(),
  currentActorPtid: 'ptid:self' as string | null,
  sessionEpoch: 1,
}));

vi.mock('../services/social_api', () => mocks);
vi.mock('./session', () => ({
  currentAuthenticatedActorPtid: () => mocks.currentActorPtid,
  useSessionStore: {
    getState: () => ({ sessionEpoch: mocks.sessionEpoch }),
  },
}));

import { EVENT, eventBus } from '../kernel/events';
import { useRelationshipsStore } from './relationships';

describe('relationships mutual-friend projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentActorPtid = 'ptid:self';
    mocks.sessionEpoch = 1;
    useRelationshipsStore.getState().reset();
  });

  it('loads every page and projects only bidirectional follow edges', async () => {
    mocks.socialGetFollowers
      .mockResolvedValueOnce({
        followers: [
          { actorPtid: 'ptid:alice', displayName: 'Alice' },
          { actorPtid: 'ptid:follower-only', displayName: 'Follower only' },
        ],
        nextCursor: 'followers-page-2',
        total: 3,
      })
      .mockResolvedValueOnce({
        followers: [
          { actorPtid: 'ptid:carol', displayName: 'Carol' },
        ],
        nextCursor: '',
        total: 3,
      });
    mocks.socialGetFollowing
      .mockResolvedValueOnce({
        following: [
          { actorPtid: 'ptid:alice', displayName: 'Alice' },
        ],
        nextCursor: 'following-page-2',
        total: 3,
      })
      .mockResolvedValueOnce({
        following: [
          { actorPtid: 'ptid:carol', displayName: 'Carol' },
          { actorPtid: 'ptid:following-only', displayName: 'Following only' },
        ],
        nextCursor: '',
        total: 3,
      });

    await useRelationshipsStore.getState().loadMutualFriends('ptid:self', true);

    expect(
      useRelationshipsStore.getState().mutualFriends.map((friend) => friend.actorPtid),
    ).toEqual(['ptid:alice', 'ptid:carol']);
    expect(
      useRelationshipsStore.getState().followersByActor['ptid:self']?.items
        .map((follower) => follower.actorPtid),
    ).toEqual(['ptid:alice', 'ptid:follower-only', 'ptid:carol']);
    expect(mocks.socialGetFollowers).toHaveBeenNthCalledWith(
      2,
      'ptid:self',
      'followers-page-2',
      100,
    );
    expect(mocks.socialGetFollowing).toHaveBeenNthCalledWith(
      2,
      'ptid:self',
      'following-page-2',
      100,
    );
  });

  it('does not let a stale actor response replace the current projection', async () => {
    let resolveOldFollowers: ((value: unknown) => void) | undefined;
    const oldFollowers = new Promise((resolve) => {
      resolveOldFollowers = resolve;
    });
    mocks.socialGetFollowers.mockImplementation((actorPtid: string) => (
      actorPtid === 'ptid:old'
        ? oldFollowers
        : Promise.resolve({
            followers: [{ actorPtid: 'ptid:new-friend' }],
            nextCursor: '',
            total: 1,
          })
    ));
    mocks.socialGetFollowing.mockImplementation((actorPtid: string) => Promise.resolve({
      following: [{
        actorPtid: actorPtid === 'ptid:old' ? 'ptid:old-friend' : 'ptid:new-friend',
      }],
      nextCursor: '',
      total: 1,
    }));

    const staleLoad = useRelationshipsStore.getState().loadMutualFriends('ptid:old', true);
    await useRelationshipsStore.getState().loadMutualFriends('ptid:new', true);
    resolveOldFollowers?.({
      followers: [{ actorPtid: 'ptid:old-friend' }],
      nextCursor: '',
      total: 1,
    });
    await staleLoad;

    expect(useRelationshipsStore.getState().mutualFriendsActorPtid).toBe('ptid:new');
    expect(useRelationshipsStore.getState().mutualFriends).toEqual([
      expect.objectContaining({ actorPtid: 'ptid:new-friend' }),
    ]);
  });

  it('drops an in-flight follower page after the relationship scope resets', async () => {
    let resolveFollowers: ((value: unknown) => void) | undefined;
    mocks.socialGetFollowers.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFollowers = resolve;
    }));

    const staleLoad = useRelationshipsStore.getState().loadFollowers(
      'ptid:old',
      true,
    );
    useRelationshipsStore.getState().reset();
    resolveFollowers?.({
      followers: [{ actorPtid: 'ptid:old-follower' }],
      nextCursor: '',
      total: 1,
    });
    await staleLoad;

    expect(useRelationshipsStore.getState().followersByActor).toEqual({});
  });

  it('loads the complete blocked-account projection across cursor pages', async () => {
    mocks.socialListBlockedActors
      .mockResolvedValueOnce({
        items: [{
          actor: { ptid: 'ptid:alice', acct: '@alice@example.com' },
          revision: 1n,
          homeStationPeerId: 'station-alice',
        }],
        nextCursor: 'page-2',
        revision: 1n,
      })
      .mockResolvedValueOnce({
        items: [{
          actor: { ptid: 'ptid:bob', acct: '@bob@example.com' },
          revision: 2n,
          homeStationPeerId: 'station-bob',
        }],
        nextCursor: '',
        revision: 2n,
      });

    await useRelationshipsStore.getState().loadBlockedActors();

    expect(
      useRelationshipsStore.getState().blockedActors.map(
        (item) => item.actor?.ptid,
      ),
    ).toEqual(['ptid:alice', 'ptid:bob']);
    expect(mocks.socialListBlockedActors).toHaveBeenNthCalledWith(
      2,
      'page-2',
      100,
    );
  });

  it('does not let a prior session replace blocked actors after same-actor reauthentication', async () => {
    let resolveStale: ((value: unknown) => void) | undefined;
    mocks.socialListBlockedActors.mockReturnValueOnce(new Promise((resolve) => {
      resolveStale = resolve;
    }));

    const staleLoad = useRelationshipsStore.getState().loadBlockedActors();
    mocks.sessionEpoch += 1;
    useRelationshipsStore.setState({
      blockedActors: [{
        $typeName: 'peers_touch.model.social.v1.BlockedActorProjection',
        actor: {
          $typeName: 'peers_touch.model.actor.v1.ActorRef',
          ptid: 'ptid:new-session',
          acct: '@new-session@example.com',
          kind: 1,
        },
        revision: 1n,
        homeStationPeerId: 'station-new',
      }],
      blockedActorsLoading: false,
    });
    resolveStale?.({
      items: [{
        actor: { ptid: 'ptid:stale', acct: '@stale.example.com' },
        revision: 1n,
        homeStationPeerId: 'station-stale',
      }],
      nextCursor: '',
      revision: 1n,
    });
    await staleLoad;

    expect(
      useRelationshipsStore.getState().blockedActors.map((item) => item.actor?.ptid),
    ).toEqual(['ptid:new-session']);
  });

  it('unblocks with the projected revision and refreshes authoritative state', async () => {
    mocks.socialUnblockActor.mockResolvedValue({
      result: { kind: SocialRelationshipCommandResultKind.COMMITTED },
    });
    mocks.socialListBlockedActors.mockResolvedValue({
      items: [],
      nextCursor: '',
      revision: 8n,
    });
    useRelationshipsStore.setState({
      blockedActors: [{
        $typeName: 'peers_touch.model.social.v1.BlockedActorProjection',
        actor: {
          $typeName: 'peers_touch.model.actor.v1.ActorRef',
          ptid: 'ptid:alice',
          acct: '@alice@example.com',
          kind: 1,
        },
        revision: 7n,
        homeStationPeerId: 'station-alice',
      }],
    });
    const publishSpy = vi
      .spyOn(eventBus, 'publish')
      .mockImplementation(() => undefined);

    await useRelationshipsStore.getState().unblockActor('ptid:alice');

    expect(mocks.socialUnblockActor).toHaveBeenCalledWith({
      targetActorPtid: 'ptid:alice',
      targetHomeStationPeerId: 'station-alice',
      observedRevision: 7,
    });
    expect(useRelationshipsStore.getState().blockedActors).toEqual([]);
    expect(publishSpy).toHaveBeenCalledWith(EVENT.RELATIONSHIP_CHANGED, {
      targetActorPtid: 'ptid:alice',
      action: 'unblock',
    });
  });

  it('keeps the blocked projection when Station rejects the command', async () => {
    mocks.socialUnblockActor.mockResolvedValue({
      result: { kind: SocialRelationshipCommandResultKind.REJECTED },
    });
    useRelationshipsStore.setState({
      blockedActors: [{
        $typeName: 'peers_touch.model.social.v1.BlockedActorProjection',
        actor: {
          $typeName: 'peers_touch.model.actor.v1.ActorRef',
          ptid: 'ptid:alice',
          acct: '@alice@example.com',
          kind: 1,
        },
        revision: 7n,
        homeStationPeerId: 'station-alice',
      }],
    });

    await expect(
      useRelationshipsStore.getState().unblockActor('ptid:alice'),
    ).rejects.toThrow('settings.privacy.unblockRejected');
    expect(useRelationshipsStore.getState().blockedActors).toHaveLength(1);
    expect(mocks.socialListBlockedActors).not.toHaveBeenCalled();
  });

  it('does not publish or mutate the replacement session after a stale unblock completes', async () => {
    let resolveUnblock: ((value: unknown) => void) | undefined;
    mocks.socialUnblockActor.mockReturnValueOnce(new Promise((resolve) => {
      resolveUnblock = resolve;
    }));
    useRelationshipsStore.setState({
      blockedActors: [{
        $typeName: 'peers_touch.model.social.v1.BlockedActorProjection',
        actor: {
          $typeName: 'peers_touch.model.actor.v1.ActorRef',
          ptid: 'ptid:alice',
          acct: '@alice@example.com',
          kind: 1,
        },
        revision: 7n,
        homeStationPeerId: 'station-alice',
      }],
    });
    const publishSpy = vi
      .spyOn(eventBus, 'publish')
      .mockImplementation(() => undefined);

    const staleUnblock = useRelationshipsStore.getState().unblockActor('ptid:alice');
    mocks.sessionEpoch += 1;
    useRelationshipsStore.setState({
      blockedActors: [],
      blockedActorsError: null,
      blockedActorMutatingPtid: null,
    });
    resolveUnblock?.({
      result: { kind: SocialRelationshipCommandResultKind.COMMITTED },
    });
    await staleUnblock;

    expect(useRelationshipsStore.getState().blockedActors).toEqual([]);
    expect(useRelationshipsStore.getState().blockedActorsError).toBeNull();
    expect(useRelationshipsStore.getState().blockedActorMutatingPtid).toBeNull();
    expect(publishSpy).not.toHaveBeenCalled();
    expect(mocks.socialListBlockedActors).not.toHaveBeenCalled();
  });
});
