import {
  applyChatMessageMutationToList,
  applyChatMessageReceiptToList,
  applyChatPresenceToMap,
  applyChatTypingStateToMap,
  filterUnreadChatNotifications,
  mergeChatMessages,
  mergeChatNotifications,
  projectChatNotificationUnreadCount,
  pruneChatTypingPeers,
  resolveChatMessageReceiptStatus,
  seedChatPresenceFromParticipants,
  type ChatAttachmentLike,
  type ChatMessageMutationInput,
  type ChatMessageMutationKind,
} from '@peers-touch/client-chat-core';

import { timestampMillis } from './socialNormalizers';
import { FriendMessageType } from '../../gen/proto/domain/chat/friend_chat_pb';
import type { ChatEncryptedMessagePayload } from '../../gen/proto/domain/chat/group_chat_pb';
import type {
  FriendChatMessage,
  FriendChatSession,
  FriendMessageAttachment,
  FriendRequest,
  SocialConversation,
  SocialNotification,
  TypingEntry,
} from './socialTypes';

const FRIEND_REQUEST_STATUS_PENDING = 1;
const FRIEND_MESSAGE_STATUS_DELIVERED = 3;
const FRIEND_MESSAGE_STATUS_READ = 4;
const NOTIFICATION_STATUS_UNREAD = 1;

export type MessageMutationKind = ChatMessageMutationKind;

export interface MessageMutationProjection extends ChatMessageMutationInput {}

export function projectConversations(input: {
  sessions: FriendChatSession[];
  messages: Record<string, FriendChatMessage[]>;
  currentUserDid: string | null;
  peerOnline: Record<string, boolean>;
}): SocialConversation[] {
  return input.sessions
    .map((session) => {
      const peerDid = peerDidFromSession(session, input.currentUserDid);
      const lastMessage = input.messages[session.ulid]?.at(-1);
      return {
        session,
        peerDid,
        peerName: peerNameFromSession(session, input.currentUserDid),
        peerAvatar: peerAvatarFromSession(session, input.currentUserDid),
        peerOnline: input.peerOnline[peerDid] ?? peerOnlineFromSession(session, input.currentUserDid),
        unread: unreadFromSession(session, input.currentUserDid),
        lastMessage,
      };
    })
    .sort((a, b) => timestampMillis(b.session.lastMessageAt) - timestampMillis(a.session.lastMessageAt));
}

export function projectPendingInboundRequests(friendRequests: FriendRequest[], currentUserDid: string | null): FriendRequest[] {
  return friendRequests.filter(
    (request) =>
      request.status === FRIEND_REQUEST_STATUS_PENDING &&
      request.receiverDid === currentUserDid &&
      request.senderDid !== currentUserDid,
  );
}

export function projectOutgoingRequests(friendRequests: FriendRequest[], currentUserDid: string | null): FriendRequest[] {
  return friendRequests.filter(
    (request) =>
      request.status === FRIEND_REQUEST_STATUS_PENDING &&
      request.senderDid === currentUserDid &&
      request.receiverDid !== currentUserDid,
  );
}

export function projectUnreadNotifications(notifications: SocialNotification[]): SocialNotification[] {
  return filterUnreadChatNotifications(notifications, NOTIFICATION_STATUS_UNREAD);
}

export function projectUnreadNotificationCount(input: {
  notifications: SocialNotification[];
  unreadTotal: number;
}): number {
  return projectChatNotificationUnreadCount({
    notifications: input.notifications,
    unreadStatus: NOTIFICATION_STATUS_UNREAD,
    unreadTotal: input.unreadTotal,
  });
}

export function mergeMessages(messages: FriendChatMessage[], incoming: FriendChatMessage): FriendChatMessage[] {
  return mergeChatMessages(messages, incoming, {
    resolveTimestampMs: (message) => timestampMillis(message.sentAt ?? message.createdAt),
    shouldInclude: isVisibleFriendMessage,
    mergeExisting: (current, next) => ({ ...current, ...next }),
  });
}

export function visibleFriendMessages(messages: FriendChatMessage[]): FriendChatMessage[] {
  return messages.filter(isVisibleFriendMessage);
}

export function isSenderKeyDistributionMessage(message: FriendChatMessage): boolean {
  return message.type === FriendMessageType.SENDER_KEY_DISTRIBUTION;
}

export function isVisibleFriendMessage(message: FriendChatMessage): boolean {
  return !isSenderKeyDistributionMessage(message);
}

export function applyFriendEncryptedPayloadToMessage(
  message: FriendChatMessage,
  payload: ChatEncryptedMessagePayload,
): FriendChatMessage {
  return {
    ...message,
    content: payload.text,
    attachments: payload.attachments.map(friendAttachmentFromChatPayload),
    type: payload.messageType || message.type,
    encryptedPayload: new Uint8Array(),
  };
}

export function mergeNotifications(current: SocialNotification[], incoming: SocialNotification[]): SocialNotification[] {
  return mergeChatNotifications(current, incoming, {
    resolveCreatedAt: (notification) => timestampMillis(notification.createdAt),
  });
}

export function receiptStatus(kind: number | string): number | null {
  return resolveChatMessageReceiptStatus(kind, {
    delivered: FRIEND_MESSAGE_STATUS_DELIVERED,
    read: FRIEND_MESSAGE_STATUS_READ,
  });
}

export function applyMessageReceiptToList(
  messages: FriendChatMessage[] | undefined,
  messageUlid: string,
  kind: number | string,
): FriendChatMessage[] | null {
  const nextStatus = receiptStatus(kind);
  return applyChatMessageReceiptToList(messages, messageUlid, nextStatus);
}

export function applyMessageMutationToList(
  messages: FriendChatMessage[] | undefined,
  messageUlid: string,
  mutation: MessageMutationProjection,
): FriendChatMessage[] | null {
  return applyChatMessageMutationToList(messages, messageUlid, mutation, {
    createEditedAt: timestampFromUnixMs,
  });
}

export function seedPresenceFromSessions(sessions: FriendChatSession[], currentUserDid: string | null): Record<string, boolean> {
  return seedChatPresenceFromParticipants(sessions, (session) => [{
    actorId: peerDidFromSession(session, currentUserDid),
    online: peerOnlineFromSession(session, currentUserDid),
  }]);
}

export function applyPresenceToMap(
  presence: Record<string, boolean>,
  actorId: string,
  online: boolean,
): Record<string, boolean> | null {
  return applyChatPresenceToMap(presence, actorId, online);
}

export function peerDidFromSession(session: FriendChatSession, currentUserDid: string | null): string {
  if (session.participantADid === currentUserDid) return session.participantBDid;
  return session.participantADid;
}

export function applyTypingStateToMap(
  typingPeers: Record<string, Record<string, TypingEntry>>,
  sessionUlid: string,
  fromActorId: string,
  typing: boolean,
): Record<string, Record<string, TypingEntry>> | null {
  return applyChatTypingStateToMap(typingPeers, sessionUlid, fromActorId, typing);
}

export function pruneTypingPeers(
  typingPeers: Record<string, Record<string, TypingEntry>>,
  staleBefore: number,
): Record<string, Record<string, TypingEntry>> | null {
  return pruneChatTypingPeers(typingPeers, staleBefore);
}

function peerNameFromSession(session: FriendChatSession, currentUserDid: string | null): string {
  if (session.participantADid === currentUserDid) return session.participantBDisplayName || session.participantBDid;
  return session.participantADisplayName || session.participantADid;
}

function peerAvatarFromSession(session: FriendChatSession, currentUserDid: string | null): string {
  if (session.participantADid === currentUserDid) return session.participantBAvatar;
  return session.participantAAvatar;
}

function peerOnlineFromSession(session: FriendChatSession, currentUserDid: string | null): boolean {
  if (session.participantADid === currentUserDid) return session.participantBOnline;
  return session.participantAOnline;
}

function unreadFromSession(session: FriendChatSession, currentUserDid: string | null): number {
  if (session.participantADid === currentUserDid) return session.unreadCountA;
  return session.unreadCountB;
}

function timestampFromUnixMs(value: number) {
  return {
    seconds: Math.floor(value / 1000),
    nanos: (value % 1000) * 1_000_000,
  };
}

function friendAttachmentFromChatPayload(attachment: ChatAttachmentLike): FriendMessageAttachment {
  return {
    cid: attachment.cid ?? '',
    filename: attachment.filename ?? '',
    mimeType: attachment.mimeType ?? attachment.mime_type ?? '',
    size: Number(attachment.size ?? 0),
    thumbnailCid: attachment.thumbnailCid ?? attachment.thumbnail_cid ?? '',
    visibility: attachment.visibility ?? '',
    mediaEncryption: attachment.mediaEncryption ?? attachment.media_encryption,
    encryptionSuite: attachment.encryptionSuite ?? attachment.encryption_suite ?? '',
    encryptionKeyB64: attachment.encryptionKeyB64 ?? attachment.encryption_key_b64 ?? '',
    encryptionNonceB64: attachment.encryptionNonceB64 ?? attachment.encryption_nonce_b64 ?? '',
    plaintextSha256B64: attachment.plaintextSha256B64 ?? attachment.plaintext_sha256_b64 ?? '',
    ciphertextSha256B64: attachment.ciphertextSha256B64 ?? attachment.ciphertext_sha256_b64 ?? '',
    plaintextSize: Number(attachment.plaintextSize ?? attachment.plaintext_size ?? 0),
    ciphertextSize: Number(attachment.ciphertextSize ?? attachment.ciphertext_size ?? 0),
  };
}
