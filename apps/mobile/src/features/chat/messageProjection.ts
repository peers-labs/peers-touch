import type {
  SocialMessage,
  SocialMessageAttachment,
  SocialTimestamp,
} from '../social/socialTypes';
import type {
  MessagingAttachmentProjection,
  MessagingMessageProjection,
  MessagingReactionProjection,
} from '../../services/mobileCommands';

const MESSAGE_TYPE_TEXT = 1;
const MESSAGE_TYPE_IMAGE = 2;
const MESSAGE_TYPE_FILE = 3;
const MESSAGE_TYPE_AUDIO = 4;
const MESSAGE_TYPE_VIDEO = 5;

const MESSAGE_STATUS_SENDING = 1;
const MESSAGE_STATUS_SENT = 2;
const MESSAGE_STATUS_DELIVERED = 3;
const MESSAGE_STATUS_READ = 4;
const MESSAGE_STATUS_FAILED = 5;

export type MessageDeliveryDisplayState =
  | 'sending'
  | 'retrying'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export function messageDeliveryDisplayState(
  message: SocialMessage,
): MessageDeliveryDisplayState {
  const { messagingState } = messageProjectionMetadata(message);
  switch (messagingState) {
    case 'failed':
    case 'terminal':
      return 'failed';
    case 'retry_wait':
      return 'retrying';
    case 'draft':
    case 'pending':
    case 'prepared':
    case 'submitted':
      return 'sending';
    case 'read':
      return 'read';
    case 'delivered':
      return 'delivered';
    case 'accepted':
      return 'sent';
    default:
      return 'sending';
  }
}

export function messageProjectionMetadata(
  message: SocialMessage,
): MessagingProjectionMetadata {
  const metadata = message as Partial<MessagingProjectionMetadata>;
  return {
    eventSequence: metadata.eventSequence,
    messagingState: metadata.messagingState,
    moderated: metadata.moderated ?? false,
    moderationReasonCode: metadata.moderationReasonCode,
    reactions: metadata.reactions ?? [],
    pinnedByPtid: metadata.pinnedByPtid,
    pinnedAtUnixMs: metadata.pinnedAtUnixMs,
  };
}

export function projectMessagingMessage(
  conversationId: string,
  message: MessagingMessageProjection,
): SocialMessage {
  const timestamp = timestampFromUnixMs(message.timestampUnixMs);
  return {
    ulid: message.messageId,
    eventSequence: message.eventSequence,
    sessionUlid: conversationId,
    senderPtid: message.senderPtid,
    receiverPtid: '',
    type: messageType(message),
    content: message.editedText ?? message.plaintext,
    status: deliveryStatus(message),
    sentAt: timestamp,
    createdAt: timestamp,
    updatedAt: message.editedAtUnixMs
      ? timestampFromUnixMs(message.editedAtUnixMs)
      : timestamp,
    replyToUlid: message.replyToMessageId,
    threadRootUlid: message.threadRootMessageId,
    recalled: message.retracted,
    messagingState: message.state,
    moderated: message.moderated,
    moderationReasonCode: message.moderationReasonCode,
    reactions: message.reactions.map((reaction) => ({ ...reaction })),
    pinnedByPtid: message.pinnedByPtid,
    pinnedAtUnixMs: message.pinnedAtUnixMs,
    editedAt: message.editedAtUnixMs
      ? timestampFromUnixMs(message.editedAtUnixMs)
      : undefined,
    encryptedPayload: new Uint8Array(),
    attachments: message.attachments.map(projectAttachment),
  };
}

export interface MessagingProjectionMetadata {
  eventSequence?: number;
  messagingState?: MessagingMessageProjection['state'];
  moderated: boolean;
  moderationReasonCode?: string;
  reactions: MessagingReactionProjection[];
  pinnedByPtid?: string;
  pinnedAtUnixMs?: number;
}

function projectAttachment(
  attachment: MessagingAttachmentProjection,
): SocialMessageAttachment {
  return {
    cid: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.plaintextSize,
    plaintextSize: attachment.plaintextSize,
    ciphertextSize: attachment.ciphertextSize,
    availabilityState: attachment.availabilityState,
    voiceNote: attachment.voiceNote,
  };
}

function messageType(message: MessagingMessageProjection): number {
  const attachment = message.attachments[0];
  if (!attachment) return MESSAGE_TYPE_TEXT;
  if (attachment.mimeType.startsWith('image/')) return MESSAGE_TYPE_IMAGE;
  if (attachment.mimeType.startsWith('audio/')) return MESSAGE_TYPE_AUDIO;
  if (attachment.mimeType.startsWith('video/')) return MESSAGE_TYPE_VIDEO;
  return MESSAGE_TYPE_FILE;
}

function deliveryStatus(message: MessagingMessageProjection): number {
  switch (message.state) {
    case 'failed':
    case 'terminal':
      return MESSAGE_STATUS_FAILED;
    case 'draft':
    case 'pending':
    case 'prepared':
    case 'retry_wait':
    case 'submitted':
      return MESSAGE_STATUS_SENDING;
    case 'read':
      return MESSAGE_STATUS_READ;
    case 'delivered':
      return message.readByPtids.length > 0
        ? MESSAGE_STATUS_READ
        : MESSAGE_STATUS_DELIVERED;
    case 'accepted':
    default:
      return message.readByPtids.length > 0
        ? MESSAGE_STATUS_READ
        : MESSAGE_STATUS_SENT;
  }
}

function timestampFromUnixMs(unixMs: number): SocialTimestamp {
  return {
    seconds: Math.floor(unixMs / 1000),
    nanos: (unixMs % 1000) * 1_000_000,
  };
}
