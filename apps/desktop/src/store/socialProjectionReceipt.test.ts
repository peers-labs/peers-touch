import { describe, expect, it } from 'vitest';

import { FriendMessageStatus } from '../gen/proto/domain/chat/friend_chat_pb';
import {
  preserveMessageReceiptStatuses,
  type SocialMessage,
} from './socialProjection';

function friendMessage(ulid: string, status: FriendMessageStatus): SocialMessage {
  return {
    ulid,
    status,
  } as SocialMessage;
}

describe('message receipt reconciliation', () => {
  it('preserves the highest Station receipt status across message reloads', () => {
    const existing = [
      friendMessage('delivered', FriendMessageStatus.DELIVERED),
      friendMessage('read', FriendMessageStatus.READ),
    ];
    const reconciled = [
      friendMessage('delivered', FriendMessageStatus.SENT),
      friendMessage('read', FriendMessageStatus.SENT),
    ];

    expect(preserveMessageReceiptStatuses(existing, reconciled).map((message) => (
      'status' in message ? message.status : null
    ))).toEqual([
      FriendMessageStatus.DELIVERED,
      FriendMessageStatus.READ,
    ]);
  });

  it('allows reconciliation to advance but never downgrade receipt status', () => {
    const existing = [friendMessage('message', FriendMessageStatus.DELIVERED)];
    const reconciled = [friendMessage('message', FriendMessageStatus.READ)];

    const [message] = preserveMessageReceiptStatuses(existing, reconciled);
    expect('status' in message ? message.status : null).toBe(FriendMessageStatus.READ);
  });
});
