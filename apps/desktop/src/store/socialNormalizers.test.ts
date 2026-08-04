import { describe, expect, it } from 'vitest';

import { friendRequestProfileDids, type FriendRequestData } from './socialNormalizers';

function request(senderId: string, receiverId: string): FriendRequestData {
  return {
    id: `${senderId}-${receiverId}`,
    senderId,
    receiverId,
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
