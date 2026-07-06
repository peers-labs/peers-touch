import { timestampDate } from '@bufbuild/protobuf/wkt';
import {
  applyChatMessageMutationToList,
  applyChatMessageReceiptToList,
  applyChatPresenceToMap,
  applyChatTypingStateToMap,
  mergeChatMessages,
  projectIMConversation,
  projectIMMessage,
  pruneChatTypingPeers,
  resolveChatMessageReceiptStatus,
  type ChatAttachmentLike,
  type ChatMessageMutationInput,
  type ChatMessageMutationKind,
  type IMConversationProjection,
  type IMMessageProjection,
} from '@peers-touch/client-chat-core';

import { FriendMessageStatus, type FriendChatMessage } from '../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMessage } from '../gen/proto/domain/chat/group_chat_pb';

export interface MessagePreview {
  content: string;
  type: number;
	senderId: string;
}

export interface DesktopUnifiedConversationLike {
  type: 'friend' | 'group';
  ulid: string;
  name: string;
  avatar?: string;
  lastActivity: Date;
  unread: number;
  peerDid?: string;
  memberCount?: number;
  muted?: boolean;
  alertEnabled?: boolean;
  hidden?: boolean;
  preview?: MessagePreview;
}

export interface ConversationLocalState {
  hidden?: boolean;
  clearedAt?: number;
  deletedMessageUlids?: Record<string, true>;
  muted?: boolean;
  sticky?: boolean;
  alertEnabled?: boolean;
  background?: ChatBackgroundId;
  backgroundImage?: string;
}

export const CHAT_BACKGROUND_OPTIONS = ['default', 'paper', 'mint', 'dusk', 'calm', 'graphite'] as const;
export type ChatBackgroundId = (typeof CHAT_BACKGROUND_OPTIONS)[number];

export function normalizeChatBackgroundId(value: unknown): ChatBackgroundId {
  if (typeof value === 'string' && (CHAT_BACKGROUND_OPTIONS as readonly string[]).includes(value)) {
    return value as ChatBackgroundId;
  }
  return 'default';
}

export type SocialMessage = FriendChatMessage | GroupMessage;

export type DesktopIMConversationProjection = IMConversationProjection & {
  peerDid?: string;
  memberCount?: number;
};

export type DesktopIMMessageProjection = IMMessageProjection<ChatAttachmentLike> & {
  // Compatibility aliases for shared chat helpers that still use the legacy
  // `ulid` naming while Desktop renderers consume the IM projection contract.
  ulid: string;
  senderDid: string;
  replyToUlid?: string;
  threadRootUlid?: string;
};

export interface DesktopIMSenderProfileProjection {
  id: string;
  name: string;
  avatar: string;
  isSelf: boolean;
}

export type TypingPeers = Record<string, Record<string, { typing: boolean; lastUpdate: number }>>;

export type MessageMutationKind = ChatMessageMutationKind;

export interface MessageMutationProjection extends ChatMessageMutationInput {}

export function conversationKey(kind: 'friend' | 'group', ulid: string): string {
  return `${kind}:${ulid}`;
}

export function conversationSuppressesAlerts(state: ConversationLocalState | undefined): boolean {
  return Boolean(state?.muted || state?.alertEnabled === false);
}

export function visibleConversationUnread(unread: number, state: ConversationLocalState | undefined): number {
  return conversationSuppressesAlerts(state) ? 0 : unread;
}

export function messageSentMs(message: SocialMessage): number {
  const sentAt = (message as { sentAt?: unknown }).sentAt as FriendChatMessage['sentAt'] | undefined;
  const createdAt = (message as { createdAt?: unknown }).createdAt as FriendChatMessage['createdAt'] | undefined;
  const ts = sentAt || createdAt;
  return ts ? timestampDate(ts).getTime() : 0;
}

export function filterClearedMessages(
  messages: SocialMessage[],
  localState: Record<string, ConversationLocalState>,
  kind: 'friend' | 'group',
  ulid: string,
): SocialMessage[] {
  const state = localState[conversationKey(kind, ulid)];
  const clearedAt = state?.clearedAt ?? 0;
  const deletedMessageUlids = state?.deletedMessageUlids ?? {};
  const hasDeletedMessages = Object.keys(deletedMessageUlids).length > 0;
  if (!clearedAt && !hasDeletedMessages) return messages;
  return messages.filter((message) => {
    if (message.ulid && deletedMessageUlids[message.ulid]) return false;
    const sentMs = messageSentMs(message);
    return sentMs === 0 || sentMs >= clearedAt;
  });
}

export function mergeConversationMessages(existing: SocialMessage[], incoming: SocialMessage): SocialMessage[] {
  return mergeChatMessages(existing, incoming, {
    resolveTimestampMs: messageSentMs,
  });
}

export function previewFromMessage(message: SocialMessage): MessagePreview {
  const attachmentName = message.attachments?.[0]?.filename ?? '';
  return {
    content: message.content || attachmentName,
    type: Number(message.type ?? 1),
		senderId: message.senderDid ?? '',
  };
}

export function projectDesktopIMConversation(conversation: DesktopUnifiedConversationLike): DesktopIMConversationProjection {
  const projection = projectIMConversation({
    kind: conversation.type,
    id: conversation.ulid,
    title: conversation.name,
    avatar: conversation.avatar,
    lastActivityMs: conversation.lastActivity.getTime(),
    unread: conversation.unread,
    muted: conversation.muted,
    alertEnabled: conversation.alertEnabled,
    hidden: conversation.hidden,
    preview: conversation.preview
      ? {
        content: conversation.preview.content,
        type: conversation.preview.type,
			senderId: conversation.preview.senderId,
      }
      : undefined,
  });
  return {
    ...projection,
    peerDid: conversation.peerDid,
    memberCount: conversation.memberCount,
  };
}

export function projectDesktopIMMessage(
  kind: 'friend' | 'group',
  conversationId: string,
  message: SocialMessage,
): DesktopIMMessageProjection {
  const encryptedPayload = (message as { encryptedPayload?: Uint8Array }).encryptedPayload;
  const editedAt = (message as { editedAt?: unknown }).editedAt as FriendChatMessage['editedAt'] | undefined;
  const projection = projectIMMessage<ChatAttachmentLike>({
    id: message.ulid ?? '',
    conversationKind: kind,
    conversationId,
    senderId: message.senderDid ?? '',
    type: Number(message.type ?? 1),
    content: message.content,
    attachments: message.attachments ?? [],
    status: (message as { status?: number }).status,
    sentAtMs: messageSentMs(message),
    recalled: Boolean((message as { recalled?: boolean }).recalled),
    editedAtMs: editedAt ? timestampDate(editedAt).getTime() : undefined,
    replyToId: (message as { replyToUlid?: string }).replyToUlid,
    threadRootId: (message as { threadRootUlid?: string }).threadRootUlid,
    encrypted: Boolean(encryptedPayload?.byteLength && !message.content),
  });
  return {
    ...projection,
    ulid: projection.id,
    senderDid: projection.senderId,
    replyToUlid: projection.replyToId,
    threadRootUlid: projection.threadRootId,
  };
}

export function projectDesktopIMMessages(
  kind: 'friend' | 'group',
  conversationId: string,
  messages: SocialMessage[],
): DesktopIMMessageProjection[] {
  return messages
    .map((message) => projectDesktopIMMessage(kind, conversationId, message))
    .sort((a, b) => {
      const timestampDelta = a.sentAtMs - b.sentAtMs;
      if (timestampDelta !== 0) return timestampDelta;
      return a.id.localeCompare(b.id);
    });
}

export function applyPresenceToMap(
  presence: Record<string, boolean>,
  actorId: string,
  online: boolean,
): Record<string, boolean> | null {
  return applyChatPresenceToMap(presence, actorId, online);
}

export function receiptStatus(kind: 'DELIVERED' | 'READ'): FriendMessageStatus | null {
  return resolveChatMessageReceiptStatus(kind, {
    delivered: FriendMessageStatus.DELIVERED,
    read: FriendMessageStatus.READ,
  }) as FriendMessageStatus | null;
}

export function applyMessageReceiptToList(
  messages: SocialMessage[] | undefined,
  messageUlid: string,
  kind: 'DELIVERED' | 'READ',
): SocialMessage[] | null {
  const target = receiptStatus(kind);
  return applyChatMessageReceiptToList(messages, messageUlid, target);
}

export function applyMessageMutationToList(
  messages: SocialMessage[] | undefined,
  messageUlid: string,
  mutation: MessageMutationProjection,
): SocialMessage[] | null {
  return applyChatMessageMutationToList(messages, messageUlid, mutation, {
    createEditedAt: (unixMs) => timestampFromUnixMs(unixMs) as unknown as FriendChatMessage['editedAt'],
    canMutateMessage: (message) => 'recalled' in message,
  });
}

export function applyTypingStateToMap(
  typingPeers: TypingPeers,
  sessionUlid: string,
  fromActorId: string,
  typing: boolean,
): TypingPeers | null {
  return applyChatTypingStateToMap(typingPeers, sessionUlid, fromActorId, typing);
}

export function pruneTypingPeers(typingPeers: TypingPeers, staleBefore: number): TypingPeers | null {
  return pruneChatTypingPeers(typingPeers, staleBefore);
}

function timestampFromUnixMs(value: number) {
  return {
    seconds: BigInt(Math.floor(value / 1000)),
    nanos: (value % 1000) * 1_000_000,
  };
}
