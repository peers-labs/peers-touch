import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFederationStore } from '../../store/federation';

const { session, privateState, posts, chat, reconcile } = vi.hoisted(() => ({
  session: { currentUser: { actorPtid: 'alice' } },
  privateState: { platform: 'native', scope: { actorPtid: 'alice' } },
  posts: { postsById: {} as Record<string, { authorPtid: string; author?: { displayName: string } }> },
  chat: {
    currentUserPtid: 'alice',
    currentUserProfile: { displayName: 'Current Alice', username: 'alice' },
    peerProfiles: {} as Record<string, {
      display_name: string; username: string; home_station_peer_id: string; home_station_domain: string;
    }>,
  },
  reconcile: vi.fn(),
}));

vi.mock('../../store/session', () => ({ useSessionStore: { getState: () => session } }));
vi.mock('../../store/privateMoments', () => ({ usePrivateMomentsStore: { getState: () => privateState } }));
vi.mock('../../store/moments', () => ({ useMomentsStore: { getState: () => posts } }));
vi.mock('../../store/socialChat', () => ({ useSocialChatStore: { getState: () => chat } }));
vi.mock('../../runtimes/momentsRuntime', () => ({ reconcileMomentsProjection: reconcile }));

import { feedSearchIdentities, reconcileFeedProjection } from './feedObservation';

describe('original Social feed observation authority', () => {
  beforeEach(() => {
    session.currentUser = { actorPtid: 'alice' };
    privateState.platform = 'native';
    privateState.scope.actorPtid = 'alice';
    posts.postsById = { post: { authorPtid: 'alice', author: { displayName: 'Stale transport' } } };
    chat.currentUserPtid = 'alice';
    chat.peerProfiles = {};
    useFederationStore.setState({
      self: { home_station_peer_id: 'station-a', home_station_domain: 'a.test' } as never,
      actorStationEntries: {},
    });
    reconcile.mockReset();
  });

  it('reads the current self profile and matching catalog without transport fallback', async () => {
    chat.peerProfiles.alice = {
      display_name: 'Stale peer', username: 'stale', home_station_peer_id: 'old', home_station_domain: 'old.test',
    };
    useFederationStore.setState({
      actorStationEntries: { alice: {
        actorPtid: 'alice', homeStationPeerId: 'station-a', homeStationName: 'Current Station',
      } as never },
    });
    await expect(feedSearchIdentities({ postIds: ['post'] })).resolves.toEqual({
      identities: [{
        postId: 'post', actorPtid: 'alice', displayName: 'Current Alice', username: 'alice',
        homeStationName: 'Current Station', homeStationDomain: 'a.test',
      }],
    });
  });

  it('reads the remote canonical profile and rejects a catalog for its old Station', async () => {
    posts.postsById.post.authorPtid = 'bob';
    chat.peerProfiles.bob = {
      display_name: 'Current Bob', username: 'bob', home_station_peer_id: 'station-b', home_station_domain: 'b.test',
    };
    useFederationStore.setState({
      actorStationEntries: { bob: {
        actorPtid: 'bob', homeStationPeerId: 'old-station', homeStationName: 'Old Station',
      } as never },
    });
    const result = await feedSearchIdentities({ postIds: ['post'] });
    expect(result.identities[0]).toMatchObject({
      actorPtid: 'bob', displayName: 'Current Bob', homeStationDomain: 'b.test', homeStationName: '',
    });
  });

  it('does not invent a missing author profile or accept an unacquired post', async () => {
    posts.postsById.post.authorPtid = 'bob';
    expect((await feedSearchIdentities({ postIds: ['post'] })).identities[0].displayName).toBe('');
    await expect(feedSearchIdentities({ postIds: ['missing'] })).rejects.toThrow('authorIdentityMissing');
    await expect(feedSearchIdentities({ postIds: [] })).rejects.toThrow('postIdMissing');
  });

  it('dispatches exactly the original runtime and propagates its failure', async () => {
    await expect(reconcileFeedProjection()).resolves.toEqual({ reconciled: true });
    expect(reconcile).toHaveBeenCalledExactlyOnceWith('acceptance-social-feed-stability');
    reconcile.mockRejectedValueOnce(new Error('native read failed'));
    await expect(reconcileFeedProjection()).rejects.toThrow('native read failed');
  });

  it('rejects unsupported or mismatched native identity before any refresh', async () => {
    for (const state of [
      { platform: 'browser', actorPtid: 'alice' },
      { platform: 'native', actorPtid: 'old-actor' },
    ]) {
      privateState.platform = state.platform;
      privateState.scope.actorPtid = state.actorPtid;
      await expect(feedSearchIdentities({ postIds: ['post'] })).rejects.toThrow('nativeScopeMissing');
      await expect(reconcileFeedProjection()).rejects.toThrow('nativeScopeMissing');
    }
    expect(reconcile).not.toHaveBeenCalled();
  });
});
