import { describe, expect, it } from 'vitest';

import {
  friendRequestProfileDids,
  normalizeFriendRequestData,
  type FriendRequestData,
} from './socialNormalizers';

function request(senderPtid: string, receiverPtid: string): FriendRequestData {
  return {
    id: `${senderPtid}-${receiverPtid}`,
    senderPtid,
    receiverPtid,
    federationId: 'federation-1',
    senderHomeStationPeerId: 'station-a',
    receiverHomeStationPeerId: 'station-b',
    status: 1,
    message: '',
    createdAt: '',
    respondedAt: '',
    senderDisplayName: '',
    senderAvatar: '',
    receiverDisplayName: '',
    receiverAvatar: '',
  };
}

describe('friendRequestProfileDids', () => {
  it('returns each non-self participant once', () => {
    expect(friendRequestProfileDids([
      request('alice', 'bob'),
      request('carol', 'alice'),
      request('alice', 'bob'),
    ], 'alice')).toEqual(['bob', 'carol']);
  });

  it('ignores blank participant identifiers', () => {
    expect(friendRequestProfileDids([
      request('', 'bob'),
      request('alice', ' '),
    ], 'alice')).toEqual(['bob']);
  });
});

describe('normalizeFriendRequestData', () => {
  it('keeps the canonical federation and nested actor identities', () => {
    expect(normalizeFriendRequestData({
      requestId: 'request-1',
      sender: { ptid: 'ptid:alice' },
      receiver: { ptid: 'ptid:bob' },
      federationId: 'federation-1',
      senderHomeStationPeerId: 'station-a',
      receiverHomeStationPeerId: 'station-b',
      state: 2,
    })).toMatchObject({
      id: 'request-1',
      senderPtid: 'ptid:alice',
      receiverPtid: 'ptid:bob',
      federationId: 'federation-1',
      senderHomeStationPeerId: 'station-a',
      receiverHomeStationPeerId: 'station-b',
      status: 2,
    });
  });

  it('normalizes protobuf timestamps into sortable ISO strings', () => {
    expect(normalizeFriendRequestData({
      requestId: 'request-2',
      sender: { ptid: 'ptid:alice' },
      receiver: { ptid: 'ptid:bob' },
      createdAt: {
        seconds: 1_789_624_365n,
        nanos: 123_000_000,
      },
      respondedAt: {
        seconds: '1789624393',
        nanos: 392_000_000,
      },
    })).toMatchObject({
      createdAt: '2026-09-17T05:52:45.123Z',
      respondedAt: '2026-09-17T05:53:13.392Z',
    });
  });
});
