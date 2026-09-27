import { fromBinary } from '@bufbuild/protobuf';

import {
  MessageReceiptSchema,
  ReceiptType,
} from '../gen/proto/domain/chat/conversation_pb';
import { MessageStatus } from '../gen/proto/domain/chat/chat_pb';

export type ChatReceiptKind = 'DELIVERED' | 'READ';
export interface ChatReceiptProjection {
  conversationId: string;
  messageId: string;
  kind: ChatReceiptKind;
}

export function receiptTypeForMessageStatus(status: MessageStatus): ReceiptType | null {
  switch (status) {
    case MessageStatus.DELIVERED:
      return ReceiptType.DELIVERED;
    case MessageStatus.READ:
      return ReceiptType.READ;
    default:
      return null;
  }
}

export function receiptKindFromType(receiptType: ReceiptType): ChatReceiptKind | null {
  switch (receiptType) {
    case ReceiptType.DELIVERED:
      return 'DELIVERED';
    case ReceiptType.READ:
      return 'READ';
    default:
      return null;
  }
}

export function decodeChatReceipt(payloadBytes: Uint8Array): ChatReceiptProjection | null {
  if (payloadBytes.length === 0) return null;
  const receipt = fromBinary(MessageReceiptSchema, payloadBytes);
  const kind = receiptKindFromType(receipt.receiptType);
  if (!receipt.conversationId || !receipt.messageId || !kind) return null;
  return {
    conversationId: receipt.conversationId,
    messageId: receipt.messageId,
    kind,
  };
}
