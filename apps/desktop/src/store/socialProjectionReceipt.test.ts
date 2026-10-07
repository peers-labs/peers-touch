import { describe, expect, it } from 'vitest';

import { MessageStatus } from '../gen/proto/domain/chat/chat_pb';
import {
  preserveMessageReceiptStatuses,
  projectDesktopIMConversation,
  projectDesktopIMMessages,
  projectGroupSecurityState,
  type SocialMessage,
} from './socialProjection';

function friendMessage(ulid: string, status: MessageStatus): SocialMessage {
  return {
    ulid,
    status,
  } as SocialMessage;
}

describe('message receipt reconciliation', () => {
  it('preserves the highest Station receipt status across message reloads', () => {
    const existing = [
      friendMessage('delivered', MessageStatus.DELIVERED),
      friendMessage('read', MessageStatus.READ),
    ];
    const reconciled = [
      friendMessage('delivered', MessageStatus.SENT),
      friendMessage('read', MessageStatus.SENT),
    ];

    expect(preserveMessageReceiptStatuses(existing, reconciled).map((message) => (
      'status' in message ? message.status : null
    ))).toEqual([
      MessageStatus.DELIVERED,
      MessageStatus.READ,
    ]);
  });

  it('allows reconciliation to advance but never downgrade receipt status', () => {
    const existing = [friendMessage('message', MessageStatus.DELIVERED)];
    const reconciled = [friendMessage('message', MessageStatus.READ)];

    const [message] = preserveMessageReceiptStatuses(existing, reconciled);
    expect('status' in message ? message.status : null).toBe(MessageStatus.READ);
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
  it('preserves the canonical projection order around pending messages', () => {
    const messages = [
      { ulid: 'first', senderPtid: 'alice', content: 'first', type: 1, groupSeq: 1n },
      { ulid: 'pending', senderPtid: 'alice', content: 'pending', type: 1, groupSeq: 0n },
      { ulid: 'second', senderPtid: 'bob', content: 'second', type: 1, groupSeq: 2n },
    ] as unknown as SocialMessage[];

    expect(projectDesktopIMMessages('group', 'conversation-1', messages).map((message) => ({
      id: message.id,
      sequence: message.eventSequence,
    }))).toEqual([
      { id: 'first', sequence: 1 },
      { id: 'pending', sequence: 0 },
      { id: 'second', sequence: 2 },
    ]);
  });
});
