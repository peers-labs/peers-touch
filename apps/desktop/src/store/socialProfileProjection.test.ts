import { describe, expect, it } from 'vitest';

import type { FriendChatSession, GroupMember } from './socialProjection';
import type { AccountProfile } from '../services/desktop_api';
import {
  accountProfileFromFederationResolve,
  canonicalProfileAvatar,
  projectGroupAvatarSlots,
  remoteProfileHandle,
  resolveActorIdentity,
} from './socialProfileProjection';
import type { FederationResolveView } from '../gen/proto/domain/federation/federation_resolve_pb';

const alice = 'ptid:alice';
const bob = 'ptid:bob';

const session = {
  participantAPtid: alice,
  participantADisplayName: 'Alice session',
  participantAAvatar: 'https://session/alice.png',
  participantBPtid: bob,
  participantBDisplayName: 'Bob session',
  participantBAvatar: 'https://session/bob.png',
} as unknown as FriendChatSession;

const bobStationProfile = {
  id: '2',
  username: 'bob',
  display_name: 'Bob Station',
  avatar: 'https://station/bob.png',
} as AccountProfile;

describe('social profile projection', () => {
  it('recognizes only canonical remote profile handles', () => {
    expect(remoteProfileHandle({
      acct: '@bob@station.example',
      username: '@bob@station.example',
    })).toBe('@bob@station.example');
    expect(remoteProfileHandle({
      acct: 'bob',
      username: 'bob',
    })).toBe('');
  });

  it('binds a resolved remote profile to the expected PTID', () => {
    const resolved = {
      profile: {
        id: 'https://station.example/users/bob',
        username: 'bob',
        acct: '@bob@station.example',
        displayName: 'Bob',
        note: '',
        url: 'https://station.example/users/bob',
        avatar: 'data:image/svg+xml;base64,PHN2Zz4=',
        header: '',
        locked: false,
        createdAt: '',
        statusesCount: 0n,
        followingCount: 0n,
        followersCount: 0n,
        region: '',
        timezone: '',
        tags: [],
        links: [],
        defaultVisibility: '',
        manuallyApprovesFollowers: false,
        messagePermission: '',
        autoExpireDays: 0,
        peersTouch: { networkId: bob },
      },
    } as unknown as FederationResolveView;

    expect(accountProfileFromFederationResolve(resolved, bob)).toMatchObject({
      acct: '@bob@station.example',
      avatar: 'data:image/svg+xml;base64,PHN2Zz4=',
      peers_touch: { network_id: bob },
    });
    expect(accountProfileFromFederationResolve(resolved, alice)).toBeNull();
  });

  it('uses exact self identity without username substring inference', () => {
    expect(resolveActorIdentity({
      ptid: alice,
      currentUserPtid: alice,
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
      currentUserPtid: alice,
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
      currentUserPtid: alice,
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

  it('keys peer avatars on canonical identity, never the rotating projection token', () => {
    // The Station profile edge carries both the per-process projected render
    // URL (`avatar`) and the transport-independent `avatar_identity`.
    const profile = {
      ...bobStationProfile,
      avatar: 'station-resource://local/01NEWEPHEMERALTOKEN',
      avatar_identity: '/sub-oss/file?key=avatars%2Fbob.png',
    } as AccountProfile;

    expect(canonicalProfileAvatar(profile)).toBe('/sub-oss/file?key=avatars%2Fbob.png');
    expect(resolveActorIdentity({
      ptid: bob,
      currentUserPtid: alice,
      currentUserProfile: null,
      peerProfiles: { [bob]: profile },
      sessions: [],
    })).toMatchObject({
      resolution: 'station',
      avatarUrl: '/sub-oss/file?key=avatars%2Fbob.png',
    });

    // Re-fetching the same profile rotates the token but the resolved
    // identity — and therefore the avatar cache key — stays stable.
    const refetched = {
      ...profile,
      avatar: 'station-resource://local/01ROTATEDDIFFERENTTOKEN',
    } as AccountProfile;
    expect(resolveActorIdentity({
      ptid: bob,
      currentUserPtid: alice,
      currentUserProfile: null,
      peerProfiles: { [bob]: refetched },
      sessions: [],
    }).avatarUrl).toBe('/sub-oss/file?key=avatars%2Fbob.png');
  });

  it('falls back to the projected avatar field when identity is absent', () => {
    // Older runtimes / federation-resolve mappings omit avatar_identity.
    expect(canonicalProfileAvatar(bobStationProfile)).toBe('https://station/bob.png');
    expect(resolveActorIdentity({
      ptid: bob,
      currentUserPtid: alice,
      currentUserProfile: null,
      peerProfiles: { [bob]: bobStationProfile },
      sessions: [],
    }).avatarUrl).toBe('https://station/bob.png');
  });

  it('prefers Station profile over stale session metadata', () => {
    expect(resolveActorIdentity({
      ptid: bob,
      currentUserPtid: alice,
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
      currentUserPtid: alice,
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
      currentUserPtid: alice,
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
        currentUserPtid: alice,
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
        currentUserPtid: alice,
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
