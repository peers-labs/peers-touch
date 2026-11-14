import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../auth/authSession';
import type { MomentsGateway, SocialGateway } from '../../services/gateways';
import { useSocialStore } from './socialStore';

const session: MobileAuthSession = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

afterEach(() => {
  useSocialStore.setState({
    authSession: null,
    socialGateway: null,
    momentsGateway: null,
    friendshipStatus: {},
    authoredFeeds: {},
    error: null,
  });
});

describe('Social relationship authoritative readback', () => {
  it('does not publish delayed conversation settings into a replacement session', async () => {
    let finish!: (value: unknown) => void;
    const response = new Promise(resolve => { finish = resolve; });
    const gateway = {
      getConversationSettings: vi.fn(() => response),
      updateConversationSettings: vi.fn(() => response),
    } as unknown as SocialGateway;
    useSocialStore.setState({ authSession: session, socialGateway: gateway, conversationSettings: {} });
    const read = useSocialStore.getState().loadConversationSettings('conversation-a');
    const write = useSocialStore.getState().updateConversationSettings('conversation-a', { isMuted: true });
    useSocialStore.setState({ authSession: { ...session, sessionId: 'replacement' }, socialGateway: {} as SocialGateway });
    finish({ ok: true, data: { sessionUlid: 'conversation-a', isMuted: true,
      isPinned: false, alertEnabled: true, background: 'default' } });
    await Promise.all([read, write]);
    expect(useSocialStore.getState().conversationSettings).toEqual({});
  });

  it('publishes follow state only after the status endpoint confirms it', async () => {
    const gateway = relationshipGateway({
      targetPtid: 'ptid:bob',
      blocked: false,
      following: true,
    });
    useSocialStore.setState({ authSession: session, socialGateway: gateway });

    await useSocialStore.getState().followUser('ptid:bob');

    expect(gateway.followUser).toHaveBeenCalledWith('ptid:bob');
    expect(gateway.getFriendshipStatus).toHaveBeenCalledWith('ptid:bob');
    expect(useSocialStore.getState().friendshipStatus['ptid:bob']?.following)
      .toBe(true);
  });

  it('rejects a successful command whose authoritative status is unchanged', async () => {
    const gateway = relationshipGateway({
      targetPtid: 'ptid:bob',
      blocked: false,
      following: false,
    });
    useSocialStore.setState({ authSession: session, socialGateway: gateway });

    await expect(useSocialStore.getState().followUser('ptid:bob'))
      .rejects.toThrow('mobile.social.followUnconfirmed');
  });

  it('keeps authored posts in the session-scoped Social projection owner', async () => {
    const momentsGateway = {
      fetchUserFeed: vi.fn(async () => ({
        ok: true,
        data: {
          posts: [{ id: 'post-1' }],
          nextCursor: 'cursor-2',
          hasMore: true,
        },
      })),
    } as unknown as MomentsGateway;
    useSocialStore.setState({ momentsGateway });

    await useSocialStore.getState().loadAuthoredPosts('ptid:bob');

    expect(momentsGateway.fetchUserFeed)
      .toHaveBeenCalledWith('ptid:bob', '', 30);
    expect(useSocialStore.getState().authoredFeeds['ptid:bob']).toMatchObject({
      posts: [{ id: 'post-1' }],
      nextCursor: 'cursor-2',
      hasMore: true,
      loading: false,
      error: null,
    });
  });
});

function relationshipGateway(status: {
  targetPtid: string;
  blocked: boolean;
  following: boolean;
}): SocialGateway {
  return {
    followUser: vi.fn(async () => ({ ok: true, data: true })),
    unfollowUser: vi.fn(async () => ({ ok: true, data: true })),
    getFriendshipStatus: vi.fn(async () => ({ ok: true, data: status })),
  } as unknown as SocialGateway;
}
