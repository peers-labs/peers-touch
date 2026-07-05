import {
  isEncryptedChatPlaceholder,
  isOwnChatMessage,
  isRecalledChatMessage,
  isVisualChatAttachment,
  normalizeChatAttachmentVisibility,
  messageReplyToUlid as sharedMessageReplyToUlid,
  messageThreadRootUlid as sharedMessageThreadRootUlid,
  replyPreviewForChatMessage,
  type ChatAttachmentPreviewLabels,
} from '@peers-touch/client-chat-core';

import type { DesktopIMMessageProjection } from '../../../store/socialProjection';
import type { ChatAttachmentVisibilityHint } from '../AttachmentItem';

export type ChatSurfaceKind = 'friend' | 'group';
export type ChatMessage = DesktopIMMessageProjection;

export type ReplyPreviewLabels = ChatAttachmentPreviewLabels;

export function isFriendMessage(message: ChatMessage): boolean {
  return message.conversationKind === 'friend';
}

export function isOwnMessage(message: ChatMessage, currentUserDid: string | null): boolean {
  return isOwnChatMessage(message, currentUserDid);
}

export function messageReplyToUlid(message: ChatMessage): string {
  return sharedMessageReplyToUlid(message);
}

export function messageThreadRootUlid(message: ChatMessage): string {
  return sharedMessageThreadRootUlid(message);
}

export function normalizeAttachmentVisibility(
  value: string | undefined,
): ChatAttachmentVisibilityHint | undefined {
  return normalizeChatAttachmentVisibility(value);
}

export function isVisualMessageAttachment(attachment: { mimeType?: string; filename?: string }): boolean {
  return isVisualChatAttachment(attachment);
}

export function isRecalledMessage(message: ChatMessage): boolean {
  return isRecalledChatMessage(message);
}

export function messageEditedAtMs(message: ChatMessage): number | undefined {
  return message.editedAtMs;
}

export function isEncryptedPlaceholder(message: ChatMessage): boolean {
  return isEncryptedChatPlaceholder(message);
}

export function messageTimestampDate(message: ChatMessage): Date | null {
  return message.sentAtMs > 0 ? new Date(message.sentAtMs) : null;
}

export function messageTimestampMs(message: ChatMessage): number {
  return message.sentAtMs;
}

export function replyPreviewForMessage(
  message: ChatMessage | null | undefined,
  labels: ReplyPreviewLabels,
): string | undefined {
  return replyPreviewForChatMessage(message, labels);
}
