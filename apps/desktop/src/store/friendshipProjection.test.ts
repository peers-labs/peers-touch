import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import {
  FollowerSchema,
  FollowingSchema,
} from '../gen/proto/domain/social/relationship_pb';
import type { AccountProfile } from '../services/desktop_api';
import type { DesktopIMConversationProjection } from './socialProjection';
import type { FriendRequestData } from './socialNormalizers';
import {
  chatActorIdentityMetadata,
  chatActorIdentityMetadataParts,
  projectChatFriendContacts,
  projectMutualFriends,
  singleFederationId,
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
        homeStationPeerId: '',
      }),
    ]);
  });

  it('keeps same-name actors separate by PTID and projects their Home Stations', () => {
    const followers = [
      create(FollowerSchema, {
        actorPtid: 'ptid:bob:station-a',
        username: 'bob',
        displayName: 'Bob',
        federatedHandle: '@bob@station-a.example',
        homeStationDomain: 'station-a.example',
        homeStationPeerId: 'station-a-peer',
      }),
      create(FollowerSchema, {
        actorPtid: 'ptid:bob:station-b',
        username: 'bob',
        displayName: 'Bob',
        federatedHandle: '@bob@station-b.example',
        homeStationDomain: 'station-b.example',
        homeStationPeerId: 'station-b-peer',
      }),
    ];
    const following = [
      create(FollowingSchema, {
        actorPtid: 'ptid:bob:station-a',
        username: 'bob',
        displayName: 'Bob',
        federatedHandle: '@bob@station-a.example',
        homeStationDomain: 'station-a.example',
        homeStationPeerId: 'station-a-peer',
      }),
      create(FollowingSchema, {
        actorPtid: 'ptid:bob:station-b',
        username: 'bob',
        displayName: 'Bob',
        federatedHandle: '@bob@station-b.example',
        homeStationDomain: 'station-b.example',
        homeStationPeerId: 'station-b-peer',
      }),
    ];

    expect(projectMutualFriends(followers, following)).toEqual([
      expect.objectContaining({
        actorPtid: 'ptid:bob:station-a',
        federatedHandle: '@bob@station-a.example',
        homeStationPeerId: 'station-a-peer',
      }),
      expect.objectContaining({
        actorPtid: 'ptid:bob:station-b',
        federatedHandle: '@bob@station-b.example',
        homeStationPeerId: 'station-b-peer',
      }),
    ]);
  });
});

describe('projectChatFriendContacts', () => {
  it('uses accepted friend-request authority and ignores conversation-only peers', () => {
    const contacts = projectChatFriendContacts({
      conversations: [
        conversation('direct-alice', 'ptid:alice', 'federation-from-conversation'),
        conversation('direct-not-friend', 'ptid:not-friend', 'federation-ignored'),
      ],
      friendRequests: [
        {
          ...acceptedRequest('ptid:self', 'ptid:alice', 'federation-request'),
          receiverDisplayName: 'Alice',
          receiverAvatar: 'alice-avatar',
          receiverHomeStationPeerId: 'station-peer',
        },
      ],
      peerProfiles: {},
      currentUserPtid: 'ptid:self',
      federations: [{
        federationId: 'federation-default',
        name: 'Default Federation',
      }],
    });

    expect(contacts).toEqual([
      expect.objectContaining({
        actorPtid: 'ptid:alice',
        conversationId: 'direct-alice',
        federationId: 'federation-from-conversation',
        homeStationPeerId: 'station-peer',
      }),
    ]);
  });

  it('assigns the sole available federation before a Direct conversation exists', () => {
    const contacts = projectChatFriendContacts({
      conversations: [],
      friendRequests: [{
        ...acceptedRequest('ptid:self', 'ptid:carol', ''),
        receiverDisplayName: 'Carol',
      }],
      peerProfiles: {},
      currentUserPtid: 'ptid:self',
      federations: [{
        federationId: 'federation-current',
        name: 'Current Federation',
      }],
    });

    expect(contacts[0]).toMatchObject({
      actorPtid: 'ptid:carol',
      federationId: 'federation-current',
      federationName: 'Current Federation',
    });
    expect(contacts[0]?.conversationId).toBeUndefined();
  });

  it('uses one authoritative profile priority on every contact surface', () => {
    const contacts = projectChatFriendContacts({
      conversations: [
        conversation('direct-bob', 'ptid:bob', 'federation-current'),
      ],
      friendRequests: [
        {
          ...acceptedRequest('ptid:self', 'ptid:bob', 'federation-current'),
          receiverDisplayName: 'Bob request',
          receiverAvatar: 'request-avatar',
          receiverHomeStationPeerId: 'station-peer',
        },
      ],
      peerProfiles: {
        'ptid:bob': {
          id: 'ptid:bob',
          username: 'bob',
          acct: '@bob@station.example',
          display_name: 'Bob Home',
          avatar: 'home-avatar',
        } as AccountProfile,
      },
      currentUserPtid: 'ptid:self',
      federations: [{
        federationId: 'federation-current',
        name: 'Friends Federation',
      }],
    });

    expect(contacts[0]).toMatchObject({
      actorPtid: 'ptid:bob',
      displayName: 'Bob Home',
      avatarUrl: 'home-avatar',
      federatedHandle: '@bob@station.example',
      homeStationDomain: 'station.example',
      homeStationPeerId: 'station-peer',
      federationId: 'federation-current',
      federationName: 'Friends Federation',
    });
    expect(chatActorIdentityMetadata(contacts[0]!))
      .toBe('Friends Federation · station.example');
    expect(chatActorIdentityMetadataParts(contacts[0]!)).toEqual({
      federation: 'Friends Federation',
      station: 'station.example',
    });
  });

  it('does not fabricate contacts from pending, rejected, or conversation state', () => {
    const pending = {
      ...acceptedRequest('ptid:self', 'ptid:pending', 'federation-current'),
      status: 1,
    };
    const rejected = {
      ...acceptedRequest('ptid:self', 'ptid:rejected', 'federation-current'),
      status: 3,
    };

    expect(projectChatFriendContacts({
      conversations: [
        conversation('direct-stranger', 'ptid:stranger', 'federation-current'),
      ],
      friendRequests: [pending, rejected],
      peerProfiles: {},
      currentUserPtid: 'ptid:self',
      federations: [{
        federationId: 'federation-current',
        name: 'Current Federation',
      }],
    })).toEqual([]);
  });

  it('derives the Station domain from the canonical handle when needed', () => {
    expect(chatActorIdentityMetadataParts({
      federatedHandle: '@bob@remote.station.example',
      homeStationDomain: '',
      homeStationPeerId: '12D3KooW-remote',
      federationId: 'federation-current',
      federationName: 'Friends Federation',
    })).toEqual({
      federation: 'Friends Federation',
      station: 'remote.station.example',
    });
  });
});

describe('singleFederationId', () => {
  it('returns the only explicit federation scope', () => {
    expect(singleFederationId([
      { federationId: 'federation-current' },
    ])).toBe('federation-current');
  });

  it('does not guess when multiple federation scopes are available', () => {
    expect(singleFederationId([
      { federationId: 'federation-a' },
      { federationId: 'federation-b' },
    ])).toBe('');
  });
});
