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

export function isOwnMessage(message: ChatMessage, currentUserPtid: string | null): boolean {
  return isOwnChatMessage(message, currentUserPtid);
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

// North-star parity (prototype MessageActions.isEmojiOnly): a short message
// made only of emoji glyphs renders as a bare enlarged glyph with no bubble.
const EMOJI_ONLY_REGEX = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\s]+$/u;

export function isEmojiOnlyText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 24 && EMOJI_ONLY_REGEX.test(trimmed);
}

export function isBareEmojiOnlyMessage(message: ChatMessage): boolean {
  return !isRecalledChatMessage(message)
    && !isEncryptedChatPlaceholder(message)
    && !message.serviceMessage
    && (message.attachments?.length ?? 0) === 0
    && Boolean(message.content)
    && isEmojiOnlyText(message.content);
}
