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
import type { CommittedConversationEvent } from '../gen/proto/domain/chat/conversation_pb';

export interface MessagePreview {
  content: string;
  type: number;
  senderPtid: string;
}

export interface DesktopUnifiedConversationLike {
  type: 'friend' | 'group';
  ulid: string;
  name: string;
  avatar?: string;
  lastActivity: Date;
  unread: number;
  peerPtid?: string;
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

type SequencedSocialMessage = SocialMessage & { groupSeq?: bigint };

export function projectConversationMessageEvents(
  kind: 'friend' | 'group',
  events: readonly CommittedConversationEvent[],
): SocialMessage[] {
  const messages = new Map<string, SequencedSocialMessage>();

  for (const event of [...events].sort((a, b) => Number(a.groupSeq - b.groupSeq))) {
    switch (event.payload.case) {
      case 'messageCommitted': {
        const payload = event.payload.value;
        const common = {
          ulid: payload.messageId,
          senderPtid: payload.senderPtid,
          type: payload.contentType as number,
          content: '',
          attachments: [],
          replyToUlid: payload.replyToMessageId,
          threadRootUlid: payload.threadRootMessageId,
          sentAt: payload.clientTs ?? event.committedAt,
          createdAt: event.committedAt,
          updatedAt: event.committedAt,
          encryptedPayload: kind === 'group'
            ? payload.groupEncryptedPayload
            : new Uint8Array(),
          recalled: false,
          editedAt: undefined,
          groupSeq: event.groupSeq,
        };
        const message = kind === 'friend'
          ? {
              ...common,
              $typeName: 'peers_touch.model.chat.v1.FriendChatMessage' as const,
              sessionUlid: event.conversationId,
              receiverPtid: '',
              status: FriendMessageStatus.SENT,
              deliveredAt: undefined,
              readAt: undefined,
            }
          : {
              ...common,
              $typeName: 'peers_touch.model.chat.v1.GroupMessage' as const,
              groupUlid: event.conversationId,
              mentionedPtids: [],
              mentionAll: false,
            };
        messages.set(payload.messageId, message as unknown as SequencedSocialMessage);
        break;
      }
      case 'messageEdited': {
        const payload = event.payload.value;
        const current = messages.get(payload.messageId);
        if (current) {
          messages.set(payload.messageId, {
            ...current,
            content: '',
            encryptedPayload: kind === 'group'
              ? payload.groupEncryptedPayload
              : new Uint8Array(),
            editedAt: payload.editedAt ?? event.committedAt,
            updatedAt: payload.editedAt ?? event.committedAt,
          } as SequencedSocialMessage);
        }
        break;
      }
      case 'messageRetracted': {
        const payload = event.payload.value;
        const current = messages.get(payload.messageId);
        if (current) {
          messages.set(payload.messageId, {
            ...current,
            content: '',
            encryptedPayload: new Uint8Array(),
            recalled: true,
            updatedAt: payload.retractedAt ?? event.committedAt,
          } as SequencedSocialMessage);
        }
        break;
      }
      default:
        break;
    }
  }

  return [...messages.values()].sort((a, b) => {
    const seqDelta = Number((a.groupSeq ?? 0n) - (b.groupSeq ?? 0n));
    return seqDelta || a.ulid.localeCompare(b.ulid);
  });
}

export function messageGroupSeq(message: SocialMessage): number {
  return Number((message as SequencedSocialMessage).groupSeq ?? 0n);
}

export type DesktopIMConversationProjection = IMConversationProjection & {
  peerPtid?: string;
  memberCount?: number;
};

export type DesktopIMMessageProjection = IMMessageProjection<ChatAttachmentLike> & {
  // Compatibility aliases for shared chat helpers that still use the legacy
  // `ulid` naming while Desktop renderers consume the IM projection contract.
  ulid: string;
  senderPtid: string;
  replyToUlid?: string;
  threadRootUlid?: string;
  readByPtids: string[];
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

export function preserveMessageReceiptStatuses(
  existing: SocialMessage[],
  reconciled: SocialMessage[],
): SocialMessage[] {
  const existingByUlid = new Map(existing.map((message) => [message.ulid, message]));
  return reconciled.map((message) => {
    if (!('status' in message)) return message;
    const current = existingByUlid.get(message.ulid);
    if (!current || !('status' in current) || current.status <= message.status) return message;
    return {
      ...message,
      status: current.status,
      deliveredAt: current.deliveredAt,
      readAt: current.readAt,
    };
  });
}

export function previewFromMessage(message: SocialMessage): MessagePreview {
  const attachmentName = message.attachments?.[0]?.filename ?? '';
  return {
    content: message.content || attachmentName,
    type: Number(message.type ?? 1),
    senderPtid: message.senderPtid ?? '',
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
        senderPtid: conversation.preview.senderPtid,
      }
      : undefined,
  });
  return {
    ...projection,
    peerPtid: conversation.peerPtid,
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
    senderPtid: message.senderPtid ?? '',
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
    senderPtid: projection.senderPtid,
    replyToUlid: projection.replyToId,
    threadRootUlid: projection.threadRootId,
    readByPtids: (message as { readByPtids?: string[] }).readByPtids ?? [],
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
  actorPtid: string,
  online: boolean,
): Record<string, boolean> | null {
  return applyChatPresenceToMap(presence, actorPtid, online);
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
  fromActorPtid: string,
  typing: boolean,
): TypingPeers | null {
  return applyChatTypingStateToMap(typingPeers, sessionUlid, fromActorPtid, typing);
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
