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
});
