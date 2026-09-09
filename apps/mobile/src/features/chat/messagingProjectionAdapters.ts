import { create } from '@bufbuild/protobuf';

import {
  GroupSchema,
  GroupStatus,
  GroupType,
  GroupVisibility,
  GroupMessageAttachmentSchema,
  GroupMessageSchema,
  type Group,
  type GroupMessage,
  type GroupMessageAttachment,
  type GroupMessageType,
} from '../../gen/proto/domain/chat/group_chat_pb';
import type {
  FriendChatMessage,
  FriendChatSession,
  FriendMessageAttachment,
  SocialTimestamp,
} from '../social/socialTypes';
import type {
  MessagingAttachmentProjection,
  MessagingConversationProjection,
  MessagingMessageProjection,
} from '../../services/mobileCommands';

const MESSAGE_TYPE_TEXT = 1;
const MESSAGE_TYPE_IMAGE = 2;
const MESSAGE_TYPE_FILE = 3;
const MESSAGE_TYPE_AUDIO = 4;
const MESSAGE_TYPE_VIDEO = 5;

const FRIEND_STATUS_SENDING = 1;
const FRIEND_STATUS_SENT = 2;
const FRIEND_STATUS_DELIVERED = 3;
const FRIEND_STATUS_READ = 4;
const FRIEND_STATUS_FAILED = 5;

export function friendSessionFromMessaging(
  conversation: MessagingConversationProjection,
  currentActorPtid: string,
  previous?: FriendChatSession,
): FriendChatSession {
  const peerPtid = conversation.memberPtids.find((ptid) => ptid !== currentActorPtid) ?? '';
  const timestamp = timestampFromUnixMs(conversation.updatedAtUnixMs);
  return {
    ulid: conversation.conversationId,
    participantAPtid: currentActorPtid,
    participantBPtid: peerPtid,
    lastMessageUlid: previous?.lastMessageUlid ?? '',
    lastMessageAt: previous?.lastMessageAt ?? timestamp,
    unreadCountA: previous?.unreadCountA ?? 0,
    unreadCountB: 0,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    participantADisplayName: participantDisplayName(previous, currentActorPtid),
    participantAAvatar: participantAvatar(previous, currentActorPtid),
    participantBDisplayName:
      participantDisplayName(previous, peerPtid) || peerPtid,
    participantBAvatar: participantAvatar(previous, peerPtid),
    participantAOnline: participantOnline(previous, currentActorPtid),
    participantBOnline: participantOnline(previous, peerPtid),
    lastMessage: previous?.lastMessage,
  };
}

export function groupFromMessaging(
  conversation: MessagingConversationProjection,
  previous?: Group,
): Group {
  const timestamp = protobufTimestampFromUnixMs(conversation.updatedAtUnixMs);
  return create(GroupSchema, {
    ulid: conversation.conversationId,
    name: conversation.name,
    description: previous?.description ?? '',
    avatarCid: previous?.avatarCid ?? '',
    ownerPtid: conversation.ownerPtid,
    type: previous?.type ?? GroupType.NORMAL,
    visibility: previous?.visibility ?? GroupVisibility.PRIVATE,
    memberCount: conversation.memberPtids.length,
    maxMembers: previous?.maxMembers ?? 500,
    muted: previous?.muted ?? false,
    settings: previous?.settings ?? {},
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    status: conversation.active ? GroupStatus.ACTIVE : GroupStatus.DISSOLVED,
    dissolvedAt: conversation.active ? undefined : timestamp,
    membershipEpoch: BigInt(conversation.membershipEpoch),
  });
}

export function friendMessageFromMessaging(
  conversationId: string,
  message: MessagingMessageProjection,
): FriendChatMessage {
  const timestamp = timestampFromUnixMs(message.timestampUnixMs);
  return {
    ulid: message.messageId,
    eventSequence: message.eventSequence,
    sessionUlid: conversationId,
    senderPtid: message.senderPtid,
    receiverPtid: '',
    type: messageType(message),
    content: message.editedText ?? message.plaintext,
    status: friendMessageStatus(message),
    sentAt: timestamp,
    createdAt: timestamp,
    updatedAt: message.editedAtUnixMs
      ? timestampFromUnixMs(message.editedAtUnixMs)
      : timestamp,
    replyToUlid: message.replyToMessageId,
    threadRootUlid: message.threadRootMessageId,
    recalled: message.retracted,
    messagingState: message.state,
    editedAt: message.editedAtUnixMs
      ? timestampFromUnixMs(message.editedAtUnixMs)
      : undefined,
    encryptedPayload: new Uint8Array(),
    attachments: message.attachments.map(friendAttachmentFromMessaging),
  };
}

export function groupMessageFromMessaging(
  conversationId: string,
  message: MessagingMessageProjection,
): GroupMessage & MessagingProjectionMetadata {
  const timestamp = protobufTimestampFromUnixMs(message.timestampUnixMs);
  return Object.assign(create(GroupMessageSchema, {
    ulid: message.messageId,
    groupUlid: conversationId,
    senderPtid: message.senderPtid,
    type: messageType(message) as GroupMessageType,
    content: message.editedText ?? message.plaintext,
    attachments: message.attachments.map(groupAttachmentFromMessaging),
    replyToUlid: message.replyToMessageId ?? '',
    threadRootUlid: message.threadRootMessageId ?? '',
    mentionedPtids: [],
    mentionAll: false,
    sentAt: timestamp,
    createdAt: timestamp,
    updatedAt: message.editedAtUnixMs
      ? protobufTimestampFromUnixMs(message.editedAtUnixMs)
      : timestamp,
    recalled: message.retracted,
    encryptedPayload: new Uint8Array(),
    editedAt: message.editedAtUnixMs
      ? protobufTimestampFromUnixMs(message.editedAtUnixMs)
      : undefined,
  }), {
    eventSequence: message.eventSequence,
    messagingState: message.state,
  });
}

function friendAttachmentFromMessaging(
  attachment: MessagingAttachmentProjection,
): FriendMessageAttachment {
  return {
    cid: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.plaintextSize,
    plaintextSize: attachment.plaintextSize,
    ciphertextSize: attachment.ciphertextSize,
    availabilityState: attachment.availabilityState,
  };
}

function groupAttachmentFromMessaging(
  attachment: MessagingAttachmentProjection,
): GroupMessageAttachment & MessagingAttachmentMetadata {
  return Object.assign(create(GroupMessageAttachmentSchema, {
    cid: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: BigInt(attachment.plaintextSize),
    thumbnailCid: '',
    visibility: '',
    encryptionSuite: '',
    encryptionKeyB64: '',
    encryptionNonceB64: '',
    plaintextSha256B64: '',
    ciphertextSha256B64: '',
    plaintextSize: BigInt(attachment.plaintextSize),
    ciphertextSize: BigInt(attachment.ciphertextSize ?? 0),
  }), {
    availabilityState: attachment.availabilityState,
  });
}

function messageType(message: MessagingMessageProjection): number {
  const attachment = message.attachments[0];
  if (!attachment) return MESSAGE_TYPE_TEXT;
  if (attachment.mimeType.startsWith('image/')) return MESSAGE_TYPE_IMAGE;
  if (attachment.mimeType.startsWith('audio/')) return MESSAGE_TYPE_AUDIO;
  if (attachment.mimeType.startsWith('video/')) return MESSAGE_TYPE_VIDEO;
  return MESSAGE_TYPE_FILE;
}

function friendMessageStatus(message: MessagingMessageProjection): number {
  if (message.readByPtids.length > 0) return FRIEND_STATUS_READ;
  switch (message.state) {
    case 'draft':
    case 'pending':
    case 'prepared':
    case 'retry_wait':
      return FRIEND_STATUS_SENDING;
    case 'delivered':
      return FRIEND_STATUS_DELIVERED;
    case 'failed':
    case 'terminal':
      return FRIEND_STATUS_FAILED;
    default:
      return FRIEND_STATUS_SENT;
  }
}

function timestampFromUnixMs(unixMs: number): SocialTimestamp {
  return {
    seconds: Math.floor(unixMs / 1000),
    nanos: (unixMs % 1000) * 1_000_000,
  };
}

function protobufTimestampFromUnixMs(unixMs: number) {
  return {
    seconds: BigInt(Math.floor(unixMs / 1000)),
    nanos: (unixMs % 1000) * 1_000_000,
  };
}

function participantDisplayName(
  session: FriendChatSession | undefined,
  ptid: string,
): string {
  if (!session || !ptid) return '';
  if (session.participantAPtid === ptid) return session.participantADisplayName;
  if (session.participantBPtid === ptid) return session.participantBDisplayName;
  return '';
}

function participantAvatar(
  session: FriendChatSession | undefined,
  ptid: string,
): string {
  if (!session || !ptid) return '';
  if (session.participantAPtid === ptid) return session.participantAAvatar;
  if (session.participantBPtid === ptid) return session.participantBAvatar;
  return '';
}

function participantOnline(
  session: FriendChatSession | undefined,
  ptid: string,
): boolean {
  if (!session || !ptid) return false;
  if (session.participantAPtid === ptid) return session.participantAOnline;
  if (session.participantBPtid === ptid) return session.participantBOnline;
  return false;
}

interface MessagingProjectionMetadata {
  eventSequence?: number;
  messagingState: string;
}

interface MessagingAttachmentMetadata {
  availabilityState?: 'remote' | 'local';
}
