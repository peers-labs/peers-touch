import { create, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import {
  MessageReceiptSchema,
  ReceiptType,
} from '../gen/proto/domain/chat/conversation_pb';
import { FriendMessageStatus } from '../gen/proto/domain/chat/friend_chat_pb';
import {
  decodeChatReceipt,
  receiptKindFromType,
  receiptTypeForMessageStatus,
} from './chatReceipt';

describe('unified conversation receipt mapping', () => {
  it('maps friend message acknowledgement states to receipt types', () => {
    expect(receiptTypeForMessageStatus(FriendMessageStatus.DELIVERED)).toBe(ReceiptType.DELIVERED);
    expect(receiptTypeForMessageStatus(FriendMessageStatus.READ)).toBe(ReceiptType.READ);
    expect(receiptTypeForMessageStatus(FriendMessageStatus.SENT)).toBeNull();
  });

  it('maps receipt envelopes back to monotonic message status kinds', () => {
    expect(receiptKindFromType(ReceiptType.DELIVERED)).toBe('DELIVERED');
    expect(receiptKindFromType(ReceiptType.READ)).toBe('READ');
    expect(receiptKindFromType(ReceiptType.UNSPECIFIED)).toBeNull();
  });

  it('decodes a durable Conversation receipt envelope', () => {
    const payload = toBinary(MessageReceiptSchema, create(MessageReceiptSchema, {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      receiptType: ReceiptType.READ,
    }));

    expect(decodeChatReceipt(payload)).toEqual({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      kind: 'READ',
    });
  });
});
