import { timestampMillis } from './socialNormalizers';
import { FriendMessageType } from '../../gen/proto/domain/chat/friend_chat_pb';
import type {
  FriendChatMessage,
  FriendChatSession,
  FriendRequest,
  SocialConversation,
  SocialNotification,
  TypingEntry,
} from './socialTypes';

const FRIEND_REQUEST_STATUS_PENDING = 1;
const FRIEND_MESSAGE_STATUS_DELIVERED = 3;
const FRIEND_MESSAGE_STATUS_READ = 4;
const NOTIFICATION_STATUS_UNREAD = 1;

export type MessageMutationKind = 'RECALL' | 'EDIT' | 'DELETE';

export interface MessageMutationProjection {
  kind: MessageMutationKind;
  newContent?: string;
  newCiphertext?: Uint8Array;
  mutatedTsUnixMs?: number;
}

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
  return notifications.filter((notification) => notification.status === NOTIFICATION_STATUS_UNREAD);
}

export function projectUnreadNotificationCount(input: {
  notifications: SocialNotification[];
  unreadTotal: number;
}): number {
  return input.unreadTotal || projectUnreadNotifications(input.notifications).length;
}

export function mergeMessages(messages: FriendChatMessage[], incoming: FriendChatMessage): FriendChatMessage[] {
  if (!isVisibleFriendMessage(incoming)) return messages;
  if (!incoming.ulid) return messages;
  const exists = messages.some((message) => message.ulid === incoming.ulid);
  const next = exists
    ? messages.map((message) => (message.ulid === incoming.ulid ? { ...message, ...incoming } : message))
    : [...messages, incoming];
  return next.sort((a, b) => timestampMillis(a.sentAt ?? a.createdAt) - timestampMillis(b.sentAt ?? b.createdAt));
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

export function mergeNotifications(current: SocialNotification[], incoming: SocialNotification[]): SocialNotification[] {
  const byId = new Map<string, SocialNotification>();
  [...current, ...incoming].forEach((notification) => {
    if (!notification.id) return;
    byId.set(notification.id, { ...byId.get(notification.id), ...notification });
  });
  return [...byId.values()].sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
}

export function receiptStatus(kind: number | string): number | null {
  if (kind === FRIEND_MESSAGE_STATUS_DELIVERED || kind === 'DELIVERED') return FRIEND_MESSAGE_STATUS_DELIVERED;
  if (kind === FRIEND_MESSAGE_STATUS_READ || kind === 'READ') return FRIEND_MESSAGE_STATUS_READ;
  return null;
}

export function applyMessageReceiptToList(
  messages: FriendChatMessage[] | undefined,
  messageUlid: string,
  kind: number | string,
): FriendChatMessage[] | null {
  if (!messages?.length) return null;
  const nextStatus = receiptStatus(kind);
  if (!nextStatus) return null;
  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.ulid !== messageUlid || message.status >= nextStatus) return message;
    changed = true;
    return { ...message, status: nextStatus };
  });
  return changed ? nextMessages : null;
}

export function applyMessageMutationToList(
  messages: FriendChatMessage[] | undefined,
  messageUlid: string,
  mutation: MessageMutationProjection,
): FriendChatMessage[] | null {
  if (!messages?.length) return null;
  let changed = false;

  if (mutation.kind === 'DELETE') {
    const nextMessages = messages.filter((message) => {
      if (message.ulid === messageUlid) {
        changed = true;
        return false;
      }
      return true;
    });
    return changed ? nextMessages : null;
  }

  const nextMessages = messages.map((message) => {
    if (message.ulid !== messageUlid) return message;
    if (mutation.kind === 'RECALL') {
      if (message.recalled) return message;
      changed = true;
      return { ...message, content: '', encryptedPayload: new Uint8Array(), recalled: true };
    }

    changed = true;
    return {
      ...message,
      content: mutation.newContent || message.content,
      encryptedPayload: mutation.newCiphertext?.byteLength ? mutation.newCiphertext : message.encryptedPayload,
      editedAt: timestampFromUnixMs(mutation.mutatedTsUnixMs ?? Date.now()),
    };
  });

  return changed ? nextMessages : null;
}

export function seedPresenceFromSessions(sessions: FriendChatSession[], currentUserDid: string | null): Record<string, boolean> {
  return sessions.reduce<Record<string, boolean>>((next, session) => {
    next[peerDidFromSession(session, currentUserDid)] = peerOnlineFromSession(session, currentUserDid);
    return next;
  }, {});
}

export function peerDidFromSession(session: FriendChatSession, currentUserDid: string | null): string {
  if (session.participantADid === currentUserDid) return session.participantBDid;
  return session.participantADid;
}

export function pruneTypingPeers(
  typingPeers: Record<string, Record<string, TypingEntry>>,
  staleBefore: number,
): Record<string, Record<string, TypingEntry>> | null {
  let changed = false;
  const next: Record<string, Record<string, TypingEntry>> = {};
  Object.entries(typingPeers).forEach(([sessionUlid, peers]) => {
    const activePeers: Record<string, TypingEntry> = {};
    Object.entries(peers).forEach(([actorId, entry]) => {
      if (!entry.typing || entry.lastUpdate < staleBefore) {
        changed = true;
        return;
      }
      activePeers[actorId] = entry;
    });
    if (Object.keys(activePeers).length > 0) {
      next[sessionUlid] = activePeers;
    } else if (Object.keys(peers).length > 0) {
      changed = true;
    }
  });
  return changed ? next : null;
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
