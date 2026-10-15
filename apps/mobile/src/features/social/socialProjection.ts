import {
  applyChatPresenceToMap,
  applyChatTypingStateToMap,
  filterUnreadChatNotifications,
  mergeChatNotifications,
  projectIMConversation,
  projectIMMessage,
  projectChatNotificationUnreadCount,
  pruneChatTypingPeers,
  type ChatMessageMutationKind,
  type IMConversationProjection,
  type IMMessageProjection,
} from '@peers-touch/client-chat-core';

import { timestampMillis } from './socialNormalizers';
import { FriendRequestState } from '../../gen/proto/domain/social/relationship_pb';
import type {
  SocialMessage,
  FriendChatSession,
  FriendRequest,
  SocialConversation,
  SocialNotification,
  TypingEntry,
} from './socialTypes';

const FRIEND_REQUEST_STATUS_PENDING = 1;
const NOTIFICATION_STATUS_UNREAD = 1;

export type MessageMutationKind = ChatMessageMutationKind;

export interface SocialContact {
  readonly peerPtid: string;
  readonly peerName: string;
  readonly peerAvatar: string;
  readonly peerOnline: boolean;
  readonly federationIds: readonly string[];
}

export function actorDisplayName(
  displayName: string | undefined,
  actorPtid: string,
): string {
  const candidate = displayName?.trim() ?? '';
  if (candidate && !candidate.startsWith('ptid:')) return candidate;

  const parts = actorPtid.split(':').filter(Boolean);
  const handle = parts[0] === 'ptid' && parts[2] === 'actor'
    ? parts.at(-2) ?? ''
    : parts.length === 2 && parts[0] === 'ptid'
      ? parts[1]
      : '';
  if (handle && !/^[a-f0-9]{32,}$/i.test(handle)) {
    return `${handle.slice(0, 1).toUpperCase()}${handle.slice(1)}`;
  }

  const fallback = candidate || actorPtid.trim();
  if (!fallback) return '';
  return fallback.length > 22
    ? `${fallback.slice(0, 10)}...${fallback.slice(-6)}`
    : fallback;
}

export function projectAcceptedContacts(
  requests: readonly FriendRequest[],
  currentUserPtid: string | null,
  peerOnline: Readonly<Record<string, boolean>>,
): SocialContact[] {
  if (!currentUserPtid) return [];
  const contacts = new Map<string, SocialContact>();
  for (const request of requests) {
    if (request.status !== FriendRequestState.ACCEPTED) continue;
    const outgoing: boolean = request.senderPtid === currentUserPtid;
    if (!outgoing && request.receiverPtid !== currentUserPtid) continue;
    const peerPtid: string = outgoing ? request.receiverPtid : request.senderPtid;
    if (!peerPtid || peerPtid === currentUserPtid) continue;
    const existing = contacts.get(peerPtid);
    const federationIds = new Set(existing?.federationIds);
    if (request.federationId.trim()) federationIds.add(request.federationId);
    contacts.set(peerPtid, {
      peerPtid,
      peerName: actorDisplayName(
        (outgoing ? request.receiverDisplayName : request.senderDisplayName)
          || existing?.peerName,
        peerPtid,
      ),
      peerAvatar: (outgoing ? request.receiverAvatar : request.senderAvatar)
        || existing?.peerAvatar || '',
      peerOnline: peerOnline[peerPtid] ?? false,
      federationIds: [...federationIds],
    });
  }
  return [...contacts.values()].sort((a, b) => a.peerName.localeCompare(b.peerName));
}

export function projectConversations(input: {
  sessions: FriendChatSession[];
  currentUserPtid: string | null;
  peerOnline: Record<string, boolean>;
}): SocialConversation[] {
  return input.sessions
    .map((session) => {
      const peerPtid = peerPtidFromSession(session, input.currentUserPtid);
      return {
        session,
        peerPtid,
        peerName: peerNameFromSession(session, input.currentUserPtid),
        peerAvatar: peerAvatarFromSession(session, input.currentUserPtid),
        peerOnline: input.peerOnline[peerPtid] ?? false,
        unread: unreadFromSession(session, input.currentUserPtid),
        lastMessage: session.lastMessage,
      };
    })
    .sort((a, b) => timestampMillis(b.session.lastMessageAt) - timestampMillis(a.session.lastMessageAt));
}

export function projectPendingInboundRequests(friendRequests: FriendRequest[], currentUserPtid: string | null): FriendRequest[] {
  return friendRequests.filter(
    (request) =>
      request.status === FRIEND_REQUEST_STATUS_PENDING &&
      request.receiverPtid === currentUserPtid &&
      request.senderPtid !== currentUserPtid,
  );
}

export function projectOutgoingRequests(friendRequests: FriendRequest[], currentUserPtid: string | null): FriendRequest[] {
  return friendRequests.filter(
    (request) =>
      request.status === FRIEND_REQUEST_STATUS_PENDING &&
      request.senderPtid === currentUserPtid &&
      request.receiverPtid !== currentUserPtid,
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

export function projectMobileSocialIMConversation(conversation: SocialConversation): IMConversationProjection {
  return projectIMConversation({
    kind: 'friend',
    id: conversation.session.ulid,
    title: conversation.peerName || conversation.peerPtid || 'Friend',
    avatar: conversation.peerAvatar,
    lastActivityMs: timestampMillis(conversation.session.lastMessageAt),
    unread: conversation.unread,
    preview: conversation.lastMessage
      ? {
        content: conversation.lastMessage.content || conversation.lastMessage.attachments?.[0]?.filename || '',
        type: Number(conversation.lastMessage.type ?? 1),
        senderPtid: conversation.lastMessage.senderPtid ?? '',
      }
      : undefined,
  });
}

export function projectMobileSocialIMMessage(
  conversationId: string,
  message: SocialMessage,
): IMMessageProjection {
  return projectIMMessage({
    id: message.ulid ?? '',
    conversationKind: 'friend',
    conversationId,
    senderPtid: message.senderPtid ?? '',
    type: Number(message.type ?? 1),
    content: message.content,
    attachments: message.attachments ?? [],
    status: message.status,
    sentAtMs: timestampMillis(message.sentAt ?? message.createdAt),
    recalled: Boolean(message.recalled),
    editedAtMs: message.editedAt ? timestampMillis(message.editedAt) : undefined,
    replyToId: message.replyToUlid,
    threadRootId: message.threadRootUlid,
    encrypted: Boolean(message.encryptedPayload?.byteLength && !message.content),
  });
}

export function mergeNotifications(current: SocialNotification[], incoming: SocialNotification[]): SocialNotification[] {
  return mergeChatNotifications(current, incoming, {
    resolveCreatedAt: (notification) => timestampMillis(notification.createdAt),
  });
}

export function applyPresenceToMap(
  presence: Record<string, boolean>,
  ptid: string,
  online: boolean,
): Record<string, boolean> | null {
  return applyChatPresenceToMap(presence, ptid, online);
}

export function peerPtidFromSession(session: FriendChatSession, currentUserPtid: string | null): string {
  if (session.participantAPtid === currentUserPtid) return session.participantBPtid;
  return session.participantAPtid;
}

export function applyTypingStateToMap(
  typingPeers: Record<string, Record<string, TypingEntry>>,
  sessionUlid: string,
  fromActorPtid: string,
  typing: boolean,
): Record<string, Record<string, TypingEntry>> | null {
  return applyChatTypingStateToMap(typingPeers, sessionUlid, fromActorPtid, typing);
}

export function pruneTypingPeers(
  typingPeers: Record<string, Record<string, TypingEntry>>,
  staleBefore: number,
): Record<string, Record<string, TypingEntry>> | null {
  return pruneChatTypingPeers(typingPeers, staleBefore);
}

function peerNameFromSession(session: FriendChatSession, currentUserPtid: string | null): string {
  if (session.participantAPtid === currentUserPtid) {
    return actorDisplayName(
      session.participantBDisplayName,
      session.participantBPtid,
    );
  }
  return actorDisplayName(
    session.participantADisplayName,
    session.participantAPtid,
  );
}

function peerAvatarFromSession(session: FriendChatSession, currentUserPtid: string | null): string {
  if (session.participantAPtid === currentUserPtid) return session.participantBAvatar;
  return session.participantAAvatar;
}

function unreadFromSession(session: FriendChatSession, currentUserPtid: string | null): number {
  if (session.participantAPtid === currentUserPtid) return session.unreadCountA;
  return session.unreadCountB;
}
