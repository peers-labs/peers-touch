import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import {
  FollowerSchema,
  FollowingSchema,
} from '../gen/proto/domain/social/relationship_pb';
import type { DesktopIMConversationProjection } from './socialProjection';
import type { FriendRequestData } from './socialNormalizers';
import {
  projectChatFriendContacts,
  projectMutualFriends,
} from './friendshipProjection';

function conversation(
  id: string,
  peerPtid: string,
  federationId: string,
): DesktopIMConversationProjection {
  return {
    id,
    kind: 'friend',
    peerPtid,
    federationId,
    title: 'Conversation title',
    avatar: 'conversation-avatar',
    lastActivityMs: 0,
    unread: 0,
    visibleUnread: 0,
    muted: false,
    alertEnabled: true,
    hidden: false,
    syncStatus: 'live',
  };
}

function acceptedRequest(
  senderPtid: string,
  receiverPtid: string,
  federationId: string,
): FriendRequestData {
  return {
    id: `${senderPtid}:${receiverPtid}`,
    senderPtid,
    receiverPtid,
    federationId,
    senderHomeStationPeerId: '',
    receiverHomeStationPeerId: '',
    status: 2,
    message: '',
    createdAt: '',
    respondedAt: '',
    senderDisplayName: '',
    senderAvatar: '',
    receiverDisplayName: '',
    receiverAvatar: '',
  };
}

describe('projectMutualFriends', () => {
  it('uses only the intersection of followers and following', () => {
    const followers = [
      create(FollowerSchema, {
        actorPtid: 'ptid:alice',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: 'alice-avatar',
      }),
      create(FollowerSchema, {
        actorPtid: 'ptid:follower-only',
        username: 'follower-only',
      }),
    ];
    const following = [
      create(FollowingSchema, {
        actorPtid: 'ptid:alice',
        username: 'alice',
        displayName: 'Alice',
      }),
      create(FollowingSchema, {
        actorPtid: 'ptid:following-only',
        username: 'following-only',
      }),
    ];

    expect(projectMutualFriends(followers, following)).toEqual([
      expect.objectContaining({
        actorPtid: 'ptid:alice',
        displayName: 'Alice',
        avatarUrl: 'alice-avatar',
      }),
    ]);
  });
});

describe('projectChatFriendContacts', () => {
  it('keeps mutual friendship as truth and uses other sources only as metadata', () => {
    const mutualFriends = [{
      actorPtid: 'ptid:alice',
      username: 'alice',
      displayName: 'Alice',
      avatarUrl: 'alice-avatar',
      federatedHandle: '@alice@station.test',
      homeStationDomain: 'station.test',
    }];

    const contacts = projectChatFriendContacts(
      mutualFriends,
      [
        conversation('direct-alice', 'ptid:alice', 'federation-from-conversation'),
        conversation('direct-not-friend', 'ptid:not-friend', 'federation-ignored'),
      ],
      [
        acceptedRequest('ptid:self', 'ptid:request-only', 'federation-ignored'),
      ],
      'ptid:self',
      'federation-default',
    );

    expect(contacts).toEqual([
      expect.objectContaining({
        actorPtid: 'ptid:alice',
        conversationId: 'direct-alice',
        federationId: 'federation-from-conversation',
      }),
    ]);
  });

  it('assigns the current joined federation before a Direct conversation exists', () => {
    const contacts = projectChatFriendContacts(
      [{
        actorPtid: 'ptid:carol',
        username: 'carol',
        displayName: 'Carol',
        avatarUrl: '',
        federatedHandle: '',
        homeStationDomain: '',
      }],
      [],
      [],
      'ptid:self',
      'federation-current',
    );

    expect(contacts[0]).toMatchObject({
      actorPtid: 'ptid:carol',
      federationId: 'federation-current',
    });
    expect(contacts[0]?.conversationId).toBeUndefined();
  });
});
