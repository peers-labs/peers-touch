import { describe, expect, it } from 'vitest';

import type { FriendChatSession } from '../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMember } from '../gen/proto/domain/chat/group_chat_pb';
import type { AccountProfile } from '../services/desktop_api';
import {
  projectGroupAvatarSlots,
  resolveActorIdentity,
} from './socialProfileProjection';

const alice = 'ptid:alice';
const bob = 'ptid:bob';

const session = {
  participantADid: alice,
  participantADisplayName: 'Alice session',
  participantAAvatar: 'https://session/alice.png',
  participantBDid: bob,
  participantBDisplayName: 'Bob session',
  participantBAvatar: 'https://session/bob.png',
} as FriendChatSession;

const bobStationProfile = {
  id: '2',
  username: 'bob',
  display_name: 'Bob Station',
  avatar: 'https://station/bob.png',
} as AccountProfile;

describe('social profile projection', () => {
  it('uses exact self identity without username substring inference', () => {
    expect(resolveActorIdentity({
      ptid: alice,
      currentUserDid: alice,
      currentUserProfile: {
        displayName: 'Alice',
        username: 'alice',
        avatar: 'https://station/alice.png',
      },
      peerProfiles: {},
      sessions: [session],
    })).toEqual({
      ptid: alice,
      displayName: 'Alice',
      avatarUrl: 'https://station/alice.png',
      isSelf: true,
      resolution: 'self',
    });

    expect(resolveActorIdentity({
      ptid: 'ptid:alice-other',
      currentUserDid: alice,
      currentUserProfile: {
        displayName: 'Alice',
        username: 'alice',
        avatar: 'https://station/alice.png',
      },
      peerProfiles: {},
      sessions: [session],
    }).isSelf).toBe(false);
  });

  it('preserves the Station origin in avatar resource identity', () => {
    const identity = resolveActorIdentity({
      ptid: bob,
      currentUserDid: alice,
      currentUserProfile: null,
      peerProfiles: {
        [bob]: {
          ...bobStationProfile,
          avatar: 'https://station-b.example/sub-oss/file?key=avatars%2Fbob.png',
        },
      },
      sessions: [],
    });

    expect(identity.avatarUrl)
      .toBe('https://station-b.example/sub-oss/file?key=avatars%2Fbob.png');
  });

  it('prefers Station profile over stale session metadata', () => {
    expect(resolveActorIdentity({
      ptid: bob,
      currentUserDid: alice,
      currentUserProfile: null,
      peerProfiles: { [bob]: bobStationProfile },
      sessions: [session],
    })).toMatchObject({
      displayName: 'Bob Station',
      avatarUrl: 'https://station/bob.png',
      resolution: 'station',
    });
  });

  it('never assigns a session participant to an unrelated PTID', () => {
    expect(resolveActorIdentity({
      ptid: 'ptid:carol',
      currentUserDid: alice,
      currentUserProfile: null,
      peerProfiles: {},
      sessions: [session],
    })).toEqual({
      ptid: 'ptid:carol',
      displayName: 'ptid:carol',
      avatarUrl: '',
      isSelf: false,
      resolution: 'fallback',
    });
  });

  it('uses group nickname only for the label, not the canonical avatar', () => {
    expect(resolveActorIdentity({
      ptid: bob,
      currentUserDid: alice,
      currentUserProfile: null,
      peerProfiles: { [bob]: bobStationProfile },
      sessions: [session],
      nickname: 'Builder',
    })).toMatchObject({
      displayName: 'Builder',
      avatarUrl: 'https://station/bob.png',
    });
  });

  it('sorts group avatar slots by PTID for viewer-independent composition', () => {
    const members = [
      { ptid: bob, nickname: '' },
      { ptid: alice, nickname: '' },
    ] as GroupMember[];
    const profiles = {
      [alice]: resolveActorIdentity({
        ptid: alice,
        currentUserDid: alice,
        currentUserProfile: {
          displayName: 'Alice',
          username: 'alice',
          avatar: 'https://station/alice.png',
        },
        peerProfiles: {},
        sessions: [session],
      }),
      [bob]: resolveActorIdentity({
        ptid: bob,
        currentUserDid: alice,
        currentUserProfile: null,
        peerProfiles: { [bob]: bobStationProfile },
        sessions: [session],
      }),
    };

    expect(projectGroupAvatarSlots(
      members,
      (ptid) => profiles[ptid as keyof typeof profiles],
    )).toEqual([
      {
        ptid: alice,
        name: 'Alice',
        avatar: 'https://station/alice.png',
      },
      {
        ptid: bob,
        name: 'Bob Station',
        avatar: 'https://station/bob.png',
      },
    ]);
  });
});
