import { create } from '@bufbuild/protobuf';
import {
  applyChatDecryptedContentToList,
  applyChatMessageMutationToList,
  mergeChatMessages,
  projectIMConversation,
  projectIMMessage,
  type ChatAttachmentLike,
  type ChatMessageMutationInput,
  type IMConversationProjection,
  type IMMessageProjection,
} from '@peers-touch/client-chat-core';

import { GroupMessageAttachmentSchema, type ChatEncryptedMessagePayload, type Group, type GroupMessage, type GroupMessageAttachment } from '../../gen/proto/domain/chat/group_chat_pb';
import { EncryptedMediaDescriptorSchema } from '../../gen/proto/domain/common/common_pb';
import { timestampMillis } from './groupNormalizers';

export interface GroupConversation {
  group: Group;
  unread: number;
  lastMessage?: GroupMessage;
}

export type GroupMessageDisplay =
  | { kind: 'text'; content: string }
  | { kind: 'recalled' }
  | { kind: 'encrypted' }
  | { kind: 'empty' };

export function projectGroupConversations(input: {
  groups: Group[];
  messages: Record<string, GroupMessage[]>;
  unreadCounts: Record<string, number>;
}): GroupConversation[] {
  return input.groups
    .map((group) => ({
      group,
      unread: input.unreadCounts[group.ulid] ?? 0,
      lastMessage: input.messages[group.ulid]?.at(-1),
    }))
    .sort((a, b) => timestampMillis(b.group.updatedAt ?? b.group.createdAt) - timestampMillis(a.group.updatedAt ?? a.group.createdAt));
}

export function projectMobileGroupIMConversation(conversation: GroupConversation): IMConversationProjection {
  return projectIMConversation({
    kind: 'group',
    id: conversation.group.ulid,
    title: conversation.group.name || 'Group',
    avatar: '',
    lastActivityMs: timestampMillis(conversation.group.updatedAt ?? conversation.group.createdAt),
    unread: conversation.unread,
    preview: conversation.lastMessage
      ? {
        content: conversation.lastMessage.content || conversation.lastMessage.attachments?.[0]?.filename || '',
        type: Number(conversation.lastMessage.type ?? 1),
        senderId: conversation.lastMessage.senderDid ?? '',
      }
      : undefined,
  });
}

export function projectMobileGroupIMMessage(
  conversationId: string,
  message: GroupMessage,
): IMMessageProjection {
  return projectIMMessage({
    id: message.ulid ?? '',
    conversationKind: 'group',
    conversationId,
    senderId: message.senderDid ?? '',
    type: Number(message.type ?? 1),
    content: message.content,
    attachments: message.attachments ?? [],
    sentAtMs: timestampMillis(message.sentAt ?? message.createdAt),
    recalled: Boolean(message.recalled),
    editedAtMs: message.editedAt ? timestampMillis(message.editedAt) : undefined,
    replyToId: message.replyToUlid,
    threadRootId: message.threadRootUlid,
    encrypted: Boolean(message.encryptedPayload?.byteLength && !message.content),
  });
}

export function mergeGroupMessages(messages: GroupMessage[], incoming: GroupMessage): GroupMessage[] {
  return mergeChatMessages(messages, incoming, {
    resolveTimestampMs: (message) => timestampMillis(message.sentAt ?? message.createdAt),
  });
}

export function projectGroupMessageDisplay(message: GroupMessage): GroupMessageDisplay {
  if (message.recalled) return { kind: 'recalled' };
  if (message.content) return { kind: 'text', content: message.content };
  if (message.encryptedPayload?.byteLength) return { kind: 'encrypted' };
  return { kind: 'empty' };
}

export function applyGroupDecryptedContentToList(
  messages: GroupMessage[] | undefined,
  messageUlid: string,
  plaintext: string | ChatEncryptedMessagePayload,
): GroupMessage[] | null {
  if (typeof plaintext === 'string') return applyChatDecryptedContentToList(messages, messageUlid, plaintext);
  if (!messages?.length) return null;

  const nextAttachments = plaintext.attachments.map(groupAttachmentFromChatPayload);
  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.ulid !== messageUlid) return message;
    changed = true;
    return {
      ...message,
      content: plaintext.text,
      attachments: nextAttachments,
      type: plaintext.messageType || message.type,
      encryptedPayload: new Uint8Array(),
    } as GroupMessage;
  });

  return changed ? nextMessages : null;
}

export function applyGroupMutationToList(
  messages: GroupMessage[] | undefined,
  messageUlid: string,
  mutation: ChatMessageMutationInput,
): GroupMessage[] | null {
  return applyChatMessageMutationToList(messages, messageUlid, mutation, {
    createEditedAt: timestampFromUnixMs,
  });
}

function timestampFromUnixMs(value: number) {
  return {
    seconds: BigInt(Math.floor(value / 1000)),
    nanos: (value % 1000) * 1_000_000,
  };
}

function groupAttachmentFromChatPayload(attachment: ChatAttachmentLike): GroupMessageAttachment {
  const size = Number(attachment.size ?? 0);
  const plaintextSize = Number(attachment.plaintextSize ?? attachment.plaintext_size ?? size);
  const ciphertextSize = Number(attachment.ciphertextSize ?? attachment.ciphertext_size ?? size);
  const suite = attachment.encryptionSuite ?? attachment.encryption_suite ?? '';
  const mediaEncryption = attachment.mediaEncryption ?? attachment.media_encryption ?? (suite
    ? create(EncryptedMediaDescriptorSchema, {
      encrypted: true,
      version: 1,
      suite,
      keyB64: attachment.encryptionKeyB64 ?? attachment.encryption_key_b64 ?? '',
      nonceB64: attachment.encryptionNonceB64 ?? attachment.encryption_nonce_b64 ?? '',
      plaintextSha256B64: attachment.plaintextSha256B64 ?? attachment.plaintext_sha256_b64 ?? '',
      ciphertextSha256B64: attachment.ciphertextSha256B64 ?? attachment.ciphertext_sha256_b64 ?? '',
      plaintextSize: BigInt(Number.isFinite(plaintextSize) && plaintextSize > 0 ? Math.floor(plaintextSize) : 0),
      ciphertextSize: BigInt(Number.isFinite(ciphertextSize) && ciphertextSize > 0 ? Math.floor(ciphertextSize) : 0),
    })
    : undefined);
  return create(GroupMessageAttachmentSchema, {
    cid: attachment.cid ?? '',
    filename: attachment.filename ?? '',
    mimeType: attachment.mimeType ?? attachment.mime_type ?? '',
    size: BigInt(Number.isFinite(size) && size > 0 ? Math.floor(size) : 0),
    thumbnailCid: attachment.thumbnailCid ?? attachment.thumbnail_cid ?? '',
    visibility: attachment.visibility ?? '',
    mediaEncryption,
    encryptionSuite: suite,
    encryptionKeyB64: attachment.encryptionKeyB64 ?? attachment.encryption_key_b64 ?? '',
    encryptionNonceB64: attachment.encryptionNonceB64 ?? attachment.encryption_nonce_b64 ?? '',
    plaintextSha256B64: attachment.plaintextSha256B64 ?? attachment.plaintext_sha256_b64 ?? '',
    ciphertextSha256B64: attachment.ciphertextSha256B64 ?? attachment.ciphertext_sha256_b64 ?? '',
    plaintextSize: BigInt(Number.isFinite(plaintextSize) && plaintextSize > 0 ? Math.floor(plaintextSize) : 0),
    ciphertextSize: BigInt(Number.isFinite(ciphertextSize) && ciphertextSize > 0 ? Math.floor(ciphertextSize) : 0),
  });
}
