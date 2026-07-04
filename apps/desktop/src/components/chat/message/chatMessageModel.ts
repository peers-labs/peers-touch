import { timestampDate, type Timestamp } from '@bufbuild/protobuf/wkt';
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

import {
  actorProfileFromSessions,
  peerOfSession,
  type CurrentUserProfile,
} from '../../../store/socialChat';
import type { FriendChatSession } from '../../../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMember } from '../../../gen/proto/domain/chat/group_chat_pb';
import type { DesktopIMMessageProjection } from '../../../store/socialProjection';
import type { ChatAttachmentVisibilityHint } from '../AttachmentItem';

export type ChatSurfaceKind = 'friend' | 'group';
export type ChatMessage = DesktopIMMessageProjection;

export interface ChatSenderProfile {
  name: string;
  avatar: string;
}

export interface ResolveChatSenderOptions {
  activeKind: ChatSurfaceKind;
  activeConversationId: string | null;
  currentUserDid: string | null;
  currentUserProfile: CurrentUserProfile | null;
  groupMembers: Record<string, GroupMember[]>;
  sessions: FriendChatSession[];
  message: ChatMessage;
}

export type ReplyPreviewLabels = ChatAttachmentPreviewLabels;

export function isFriendMessage(message: ChatMessage): boolean {
  return message.kind === 'friend';
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

export function messageEditedAt(message: ChatMessage): Timestamp | undefined {
  return (message as { editedAt?: Timestamp }).editedAt;
}

export function isEncryptedPlaceholder(message: ChatMessage): boolean {
  return isEncryptedChatPlaceholder(message);
}

export function messageTimestampDate(message: ChatMessage): Date | null {
  const ts = message.createdAt ?? message.sentAt;
  return ts ? timestampDate(ts) : null;
}

export function messageTimestampMs(message: ChatMessage): number {
  const ts = message.sentAt ?? message.createdAt;
  return ts ? timestampDate(ts).getTime() : 0;
}

export function resolveChatSenderProfile({
  activeKind,
  activeConversationId,
  currentUserDid,
  currentUserProfile,
  groupMembers,
  sessions,
  message,
}: ResolveChatSenderOptions): ChatSenderProfile {
  if (isOwnMessage(message, currentUserDid)) {
    return {
      name: currentUserProfile?.displayName
        || currentUserProfile?.username
        || currentUserDid
        || message.senderDid,
      avatar: currentUserProfile?.avatar || '',
    };
  }

  if (activeKind === 'friend') {
    const session = sessions.find((item) => item.ulid === activeConversationId);
    const peer = session ? peerOfSession(session, currentUserDid) : null;
    return {
      name: peer?.name || message.senderDid,
      avatar: peer?.avatar || '',
    };
  }

  const member = activeConversationId
    ? groupMembers[activeConversationId]?.find((item) => item.actorDid === message.senderDid)
    : undefined;
  const profile = actorProfileFromSessions(
    sessions,
    currentUserDid,
    message.senderDid,
    currentUserProfile,
  );
  return {
    name: member?.nickname || profile.name || message.senderDid,
    avatar: profile.avatar || '',
  };
}

export function replyPreviewForMessage(
  message: ChatMessage | null | undefined,
  labels: ReplyPreviewLabels,
): string | undefined {
  return replyPreviewForChatMessage(message, labels);
}
