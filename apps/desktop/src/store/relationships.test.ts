import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  socialFollow: vi.fn(),
  socialGetFollowers: vi.fn(),
  socialGetFollowing: vi.fn(),
  socialGetRelationship: vi.fn(),
  socialUnfollow: vi.fn(),
}));

vi.mock('../services/social_api', () => mocks);

import { useRelationshipsStore } from './relationships';

describe('relationships mutual-friend projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
