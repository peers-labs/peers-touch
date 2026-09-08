// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { describe, expect, it } from 'vitest';

import {
  friendSessionFromMessaging,
  groupFromMessaging,
} from './messagingProjectionAdapters';

const directConversation = {
  conversationId: 'direct-1',
  authorityStationId: 'station-one',
  federationId: 'federation-1',
  kind: 1,
  name: '',
  ownerPtid: 'ptid:alice',
  memberPtids: ['ptid:alice', 'ptid:bob'],
  membershipEpoch: 1,
  mlsEpoch: 0,
  active: true,
  updatedAtUnixMs: 1_750_000_000_123,
};

describe('Messaging conversation projection adapters', () => {
  it('projects a Direct conversation around the active actor', () => {
    const session = friendSessionFromMessaging(
      directConversation,
      'ptid:alice',
    );

    expect(session).toMatchObject({
      ulid: 'direct-1',
      participantAPtid: 'ptid:alice',
      participantBPtid: 'ptid:bob',
      participantBDisplayName: 'ptid:bob',
    });
    expect(session.updatedAt).toEqual({
      seconds: 1_750_000_000,
      nanos: 123_000_000,
    });
  });

  it('preserves known Direct participant metadata', () => {
    const session = friendSessionFromMessaging(
      directConversation,
      'ptid:alice',
      {
        ulid: 'legacy-direct',
        participantAPtid: 'ptid:bob',
        participantBPtid: 'ptid:alice',
        lastMessageUlid: '',
        unreadCountA: 0,
        unreadCountB: 0,
        participantADisplayName: 'Bob',
        participantAAvatar: 'bob-avatar',
        participantBDisplayName: 'Alice',
        participantBAvatar: 'alice-avatar',
        participantAOnline: true,
        participantBOnline: false,
      },
    );

    expect(session.participantADisplayName).toBe('Alice');
    expect(session.participantAAvatar).toBe('alice-avatar');
    expect(session.participantBDisplayName).toBe('Bob');
    expect(session.participantBAvatar).toBe('bob-avatar');
    expect(session.participantBOnline).toBe(true);
  });

  it('projects canonical Group metadata and epochs', () => {
    const group = groupFromMessaging({
      ...directConversation,
      conversationId: 'group-1',
      kind: 2,
      name: 'Release',
      memberPtids: ['ptid:alice', 'ptid:bob', 'ptid:carol'],
      membershipEpoch: 4,
      mlsEpoch: 6,
    });

    expect(group).toMatchObject({
      ulid: 'group-1',
      name: 'Release',
      ownerPtid: 'ptid:alice',
      memberCount: 3,
      membershipEpoch: 4n,
    });
  });
});
