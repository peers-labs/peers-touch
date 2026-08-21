import { describe, expect, it } from 'vitest';

import { FriendMessageStatus } from '../gen/proto/domain/chat/friend_chat_pb';
import {
  preserveMessageReceiptStatuses,
  projectDesktopIMConversation,
  projectDesktopIMMessages,
  projectGroupSecurityState,
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

describe('conversation identity projection', () => {
  it('retains the authority Station identity for visible Chat surfaces', () => {
    expect(projectDesktopIMConversation({
      type: 'group',
      ulid: 'conversation-1',
      authorityStationId: 'station-authority',
      name: 'Group',
      lastActivity: new Date(1_800_000_000_000),
      unread: 0,
    })).toMatchObject({
      id: 'conversation-1',
      authorityStationId: 'station-authority',
    });
  });
});

describe('group security projection', () => {
  it('projects local MLS recipient status without inferring readiness from authority epoch', () => {
    expect(projectGroupSecurityState('idle')).toBe('idle');
    expect(projectGroupSecurityState('establishing')).toBe('establishing');
    expect(projectGroupSecurityState('active')).toBe('ready');
    expect(projectGroupSecurityState('crypto_desynced')).toBe('crypto-desynced');
  });
});

describe('conversation message authority ordering', () => {
  it('orders committed messages by authority sequence before pending messages', () => {
    const messages = [
      { ulid: 'pending', senderDid: 'alice', content: 'pending', type: 1, groupSeq: 0n },
      { ulid: 'second', senderDid: 'bob', content: 'second', type: 1, groupSeq: 2n },
      { ulid: 'first', senderDid: 'alice', content: 'first', type: 1, groupSeq: 1n },
    ] as unknown as SocialMessage[];

    expect(projectDesktopIMMessages('group', 'conversation-1', messages).map((message) => ({
      id: message.id,
      sequence: message.eventSequence,
    }))).toEqual([
      { id: 'first', sequence: 1 },
      { id: 'second', sequence: 2 },
      { id: 'pending', sequence: 0 },
    ]);
  });
});
