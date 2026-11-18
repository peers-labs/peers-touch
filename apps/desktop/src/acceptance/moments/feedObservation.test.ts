import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFederationStore } from '../../store/federation';

const { session, privateState, posts, chat, reconcile } = vi.hoisted(() => ({
  session: { currentUser: { actorPtid: 'alice' }, sessionEpoch: 1, stationPeerId: 'station-a' },
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

import {
  beginCommentReadReconcile, clearCommentReadReconcile, commentReadReconcileStatus,
  feedSearchIdentities, reconcileFeedProjection, releaseCommentReadReconcile,
} from './feedObservation';
import { holdVerifiedCommentRead } from './commentReadFault';

describe('original Social feed observation authority', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ACCEPTANCE_HARNESS', '1');
    session.currentUser = { actorPtid: 'alice' };
    session.sessionEpoch = 1;
    session.stationPeerId = 'station-a';
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

  afterEach(async () => {
    await clearCommentReadReconcile();
    vi.unstubAllEnvs();
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

  it('keeps the original Runtime pending until one real read is released and then rearms', async () => {
    reconcile.mockImplementation(() => holdVerifiedCommentRead('post'));
    for (let index = 0; index < 2; index += 1) {
      await beginCommentReadReconcile({ postId: 'post' });
      await expect(commentReadReconcileStatus()).resolves.toEqual({
        state: 'held', effectCount: 1, reconciled: false,
      });
      await expect(beginCommentReadReconcile({ postId: 'post' })).rejects.toThrow('AlreadyActive');
      await expect(releaseCommentReadReconcile()).resolves.toEqual({
        state: 'released', effectCount: 1, reconciled: true,
      });
      await clearCommentReadReconcile();
    }
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('cancels pending work and propagates Runtime failure before another read can start', async () => {
    reconcile.mockImplementation(() => holdVerifiedCommentRead('post'));
    await beginCommentReadReconcile({ postId: 'post' });
    await expect(clearCommentReadReconcile()).resolves.toEqual({ cleared: true });
    await expect(commentReadReconcileStatus()).resolves.toEqual({
      state: 'idle', effectCount: 0, reconciled: false,
    });
    reconcile.mockRejectedValueOnce(new Error('original read failed'));
    await beginCommentReadReconcile({ postId: 'post' });
    await expect(commentReadReconcileStatus()).rejects.toThrow('original read failed');
  });

  it('refuses release after same-Actor Session epoch or Station changes', async () => {
    for (const edge of ['sessionEpoch', 'stationPeerId'] as const) {
      reconcile.mockImplementation(() => holdVerifiedCommentRead('post'));
      await beginCommentReadReconcile({ postId: 'post' });
      if (edge === 'sessionEpoch') session.sessionEpoch += 1;
      else session.stationPeerId = 'station-b';
      await expect(releaseCommentReadReconcile()).rejects.toThrow('commentReadScopeChanged');
      await clearCommentReadReconcile();
      session.sessionEpoch = 1;
      session.stationPeerId = 'station-a';
    }
  });
});
