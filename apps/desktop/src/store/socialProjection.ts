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

import { MessageStatus } from '../gen/proto/domain/chat/chat_pb';
import type { ConversationEvent } from '../gen/proto/domain/chat/event_pb';
import type { MessagingConversationProjection } from '../services/im-service-contract';

export interface MessagePreview {
  content: string;
  type: number;
  senderPtid: string;
}

export interface DesktopUnifiedConversationLike {
  type: 'friend' | 'group';
  ulid: string;
  authorityStationId?: string;
  federationId?: string;
  name: string;
  avatar?: string;
  lastActivity: Date;
  unread: number;
  peerPtid?: string;
  username?: string;
  federatedHandle?: string;
  homeStationDomain?: string;
  homeStationPeerId?: string;
  homeStationName?: string;
  federationName?: string;
  memberCount?: number;
  muted?: boolean;
  alertEnabled?: boolean;
  hidden?: boolean;
  preview?: MessagePreview;
}

export interface ConversationLocalState {
  hidden?: boolean;
  muted?: boolean;
  sticky?: boolean;
  alertEnabled?: boolean;
  background?: ChatBackgroundId;
  backgroundImage?: string;
}

export type GroupSecurityState =
  | 'idle'
  | 'establishing'
  | 'ready'
  | 'crypto-desynced'
  | 'error';

export function projectGroupSecurityState(
  status: NonNullable<MessagingConversationProjection['mlsStatus']>,
): Exclude<GroupSecurityState, 'error'> {
  switch (status) {
    case 'active':
      return 'ready';
    case 'crypto_desynced':
      return 'crypto-desynced';
    default:
      return status;
  }
}

export const CHAT_BACKGROUND_OPTIONS = ['default', 'paper', 'mint', 'dusk', 'calm', 'graphite'] as const;
export type ChatBackgroundId = (typeof CHAT_BACKGROUND_OPTIONS)[number];

export function normalizeChatBackgroundId(value: unknown): ChatBackgroundId {
  if (typeof value === 'string' && (CHAT_BACKGROUND_OPTIONS as readonly string[]).includes(value)) {
    return value as ChatBackgroundId;
  }
  return 'default';
}

export interface SocialMessage {
  $typeName?: string;
  ulid: string;
  senderPtid: string;
  content: string;
  type: number;
  attachments: Array<{ filename?: string; [key: string]: unknown }>;
  sentAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  encryptedPayload?: Uint8Array;
  recalled?: boolean;
  editedAt?: unknown;
  replyToUlid?: string;
  threadRootUlid?: string;
  sessionUlid?: string;
  receiverPtid?: string;
  groupUlid?: string;
  mentionedPtids?: string[];
  mentionAll?: boolean;
  status?: number;
  deliveredAt?: unknown;
  readAt?: unknown;
  readByPtids?: string[];
  deliveryState?: string;
  senderDeviceId?: string;
}

export interface FriendChatSession {
  $typeName?: string;
  ulid: string;
  participantAPtid: string;
  participantBPtid: string;
  participantADisplayName: string;
  participantAAvatar: string;
  participantBDisplayName: string;
  participantBAvatar: string;
  unreadCountA: number;
  unreadCountB: number;
  lastMessageUlid?: string;
  lastMessageAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Group {
  $typeName?: string;
  ulid: string;
  name: string;
  description?: string;
  avatarCid?: string;
  ownerPtid?: string;
  type?: number;
  visibility?: number;
  memberCount?: number;
  maxMembers?: number;
  muted?: boolean;
  settings?: Record<string, string>;
  createdAt?: unknown;
  updatedAt?: unknown;
  status?: number;
  dissolvedAt?: unknown;
  membershipEpoch?: bigint;
  federationId?: string;
  authorityStationPeerId?: string;
}

export interface GroupMember {
  $typeName?: string;
  groupUlid: string;
  ptid: string;
  role: number;
  nickname: string;
  muted: boolean;
  mutedUntil?: unknown;
  joinedAt?: unknown;
  invitedBy: string;
  actorHomeStationPeerId: string;
  actorHomeStationDomain: string;
}

type SequencedSocialMessage = SocialMessage & { groupSeq?: bigint };

export function projectConversationMessageEvents(
  kind: 'friend' | 'group',
  events: readonly ConversationEvent[],
): SocialMessage[] {
  const messages = new Map<string, SequencedSocialMessage>();

  for (const event of [...events].sort((a, b) => Number(a.sequence - b.sequence))) {
    switch (event.payload.case) {
      case 'messageCommitted': {
        const payload = event.payload.value;
        const common = {
          ulid: payload.messageId,
          senderPtid: payload.sender?.ptid ?? '',
          type: payload.contentKind as number,
          content: '',
          attachments: [],
          replyToUlid: payload.replyToMessageId,
          threadRootUlid: payload.threadRootMessageId,
          sentAt: payload.clientTimestamp ?? event.committedAt,
          createdAt: event.committedAt,
          updatedAt: event.committedAt,
          encryptedPayload: new Uint8Array(),
          recalled: false,
          editedAt: undefined,
          groupSeq: event.sequence,
        };
        const message = kind === 'friend'
          ? {
              ...common,
              $typeName: 'peers_touch.model.chat.v1.ChatMessage' as const,
              sessionUlid: event.conversationId,
              receiverPtid: '',
              status: MessageStatus.SENT,
              deliveredAt: undefined,
              readAt: undefined,
            }
          : {
              ...common,
              $typeName: 'peers_touch.model.chat.v1.ChatMessage' as const,
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
  authorityStationId?: string;
  federationId?: string;
  peerPtid?: string;
  username?: string;
  federatedHandle?: string;
  homeStationDomain?: string;
  homeStationPeerId?: string;
  homeStationName?: string;
  federationName?: string;
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
  eventSequence: number;
  deliveryState: string;
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
  const sentAt = message.sentAt;
  const createdAt = message.createdAt;
  const ts = sentAt || createdAt;
  // Generated protobuf timestamps and local projections share this shape.
  return ts ? timestampDate(ts as Parameters<typeof timestampDate>[0]).getTime() : 0;
}

export function mergeConversationMessages(existing: SocialMessage[], incoming: SocialMessage): SocialMessage[] {
  const merged = mergeChatMessages(existing, incoming, {
    resolveTimestampMs: messageSentMs,
  });
  return merged.sort((left, right) => {
    const leftSequence = messageGroupSeq(left);
    const rightSequence = messageGroupSeq(right);
    const leftConfirmed = leftSequence > 0;
    const rightConfirmed = rightSequence > 0;
    if (leftConfirmed && rightConfirmed) {
      return leftSequence - rightSequence;
    }
    if (leftConfirmed !== rightConfirmed) {
      return leftConfirmed ? -1 : 1;
    }
    const timestampDelta = messageSentMs(left) - messageSentMs(right);
    return timestampDelta || left.ulid.localeCompare(right.ulid);
  });
}

export function preserveMessageReceiptStatuses(
  existing: SocialMessage[],
  reconciled: SocialMessage[],
): SocialMessage[] {
  const existingByUlid = new Map(existing.map((message) => [message.ulid, message]));
  return reconciled.map((message) => {
    if (message.status === undefined) return message;
    const current = existingByUlid.get(message.ulid);
    if (
      !current
      || current.status === undefined
      || current.status <= message.status
    ) return message;
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
    authorityStationId: conversation.authorityStationId ?? '',
    federationId: conversation.federationId ?? '',
    peerPtid: conversation.peerPtid,
    username: conversation.username,
    federatedHandle: conversation.federatedHandle,
    homeStationDomain: conversation.homeStationDomain,
    homeStationPeerId: conversation.homeStationPeerId,
    homeStationName: conversation.homeStationName,
    federationName: conversation.federationName,
    memberCount: conversation.memberCount,
  };
}

export function projectDesktopIMMessage(
  kind: 'friend' | 'group',
  conversationId: string,
  message: SocialMessage,
): DesktopIMMessageProjection {
  const encryptedPayload = (message as { encryptedPayload?: Uint8Array }).encryptedPayload;
  const editedAt = message.editedAt;
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
    editedAtMs: editedAt
      ? timestampDate(editedAt as Parameters<typeof timestampDate>[0]).getTime()
      : undefined,
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
    eventSequence: messageGroupSeq(message),
    deliveryState: (message as { deliveryState?: string }).deliveryState ?? '',
  };
}

export function projectDesktopIMMessages(
  kind: 'friend' | 'group',
  conversationId: string,
  messages: SocialMessage[],
): DesktopIMMessageProjection[] {
  return messages.map((message) => (
    projectDesktopIMMessage(kind, conversationId, message)
  ));
}

export function applyPresenceToMap(
  presence: Record<string, boolean>,
  actorPtid: string,
  online: boolean,
): Record<string, boolean> | null {
  return applyChatPresenceToMap(presence, actorPtid, online);
}

export function receiptStatus(kind: 'DELIVERED' | 'READ'): MessageStatus | null {
  return resolveChatMessageReceiptStatus(kind, {
    delivered: MessageStatus.DELIVERED,
    read: MessageStatus.READ,
  }) as MessageStatus | null;
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
    createEditedAt: (unixMs) => timestampFromUnixMs(unixMs),
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
