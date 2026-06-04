import { timestampDate } from '@bufbuild/protobuf/wkt';

import { FriendMessageStatus, type FriendChatMessage } from '../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMessage } from '../gen/proto/domain/chat/group_chat_pb';

export interface MessagePreview {
  content: string;
  type: number;
  senderDid: string;
}

export interface ConversationLocalState {
  hidden?: boolean;
  clearedAt?: number;
  muted?: boolean;
  sticky?: boolean;
  alertEnabled?: boolean;
  background?: ChatBackgroundId;
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

export type TypingPeers = Record<string, Record<string, { typing: boolean; lastUpdate: number }>>;

export type MessageMutationKind = 'RECALL' | 'EDIT' | 'DELETE';

export interface MessageMutationProjection {
  kind: MessageMutationKind;
  newContent: string;
  newCiphertext: Uint8Array;
  mutatedTsUnixMs: number;
}

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
  const clearedAt = localState[conversationKey(kind, ulid)]?.clearedAt ?? 0;
  if (!clearedAt) return messages;
  return messages.filter((message) => {
    const sentMs = messageSentMs(message);
    return sentMs === 0 || sentMs >= clearedAt;
  });
}

export function mergeConversationMessages(existing: SocialMessage[], incoming: SocialMessage): SocialMessage[] {
  const byUlid = new Map<string, SocialMessage>();
  for (const message of existing) {
    if (message.ulid) byUlid.set(message.ulid, message);
  }
  if (incoming.ulid) {
    byUlid.set(incoming.ulid, incoming);
  }
  return Array.from(byUlid.values()).sort((a, b) => {
    const sentA = messageSentMs(a);
    const sentB = messageSentMs(b);
    if (sentA !== sentB) return sentA - sentB;
    return (a.ulid ?? '').localeCompare(b.ulid ?? '');
  });
}

export function previewFromMessage(message: SocialMessage): MessagePreview {
  const attachmentName = message.attachments?.[0]?.filename ?? '';
  return {
    content: message.content || attachmentName,
    type: Number(message.type ?? 1),
    senderDid: message.senderDid ?? '',
  };
}

export function receiptStatus(kind: 'DELIVERED' | 'READ'): FriendMessageStatus | null {
  if (kind === 'READ') return FriendMessageStatus.READ;
  if (kind === 'DELIVERED') return FriendMessageStatus.DELIVERED;
  return null;
}

export function applyMessageReceiptToList(
  messages: SocialMessage[] | undefined,
  messageUlid: string,
  kind: 'DELIVERED' | 'READ',
): SocialMessage[] | null {
  if (!messages?.length) return null;
  const target = receiptStatus(kind);
  if (target == null) return null;

  let mutated = false;
  const next = messages.map((message) => {
    const friendMessage = message as FriendChatMessage;
    if (friendMessage.ulid !== messageUlid) return message;
    if ((friendMessage.status ?? 0) >= target) return message;
    mutated = true;
    return { ...friendMessage, status: target } as FriendChatMessage;
  });

  return mutated ? next : null;
}

export function applyMessageMutationToList(
  messages: SocialMessage[] | undefined,
  messageUlid: string,
  mutation: MessageMutationProjection,
): SocialMessage[] | null {
  if (!messages?.length) return null;
  let mutated = false;

  if (mutation.kind === 'DELETE') {
    const next = messages.filter((message) => {
      if (message.ulid === messageUlid) {
        mutated = true;
        return false;
      }
      return true;
    });
    return mutated ? next : null;
  }

  const next = messages.map((message) => {
    if (message.ulid !== messageUlid) return message;
    if (!('recalled' in message)) return message;

    if (mutation.kind === 'RECALL') {
      if ((message as { recalled?: boolean }).recalled === true) return message;
      mutated = true;
      return {
        ...message,
        recalled: true,
        content: '',
        encryptedPayload: new Uint8Array(),
      } as FriendChatMessage | GroupMessage;
    }

    mutated = true;
    const existingEncryptedPayload = (message as { encryptedPayload?: Uint8Array }).encryptedPayload;
    return {
      ...message,
      content: mutation.newContent || message.content,
      encryptedPayload: mutation.newCiphertext.byteLength > 0
        ? mutation.newCiphertext
        : existingEncryptedPayload ?? new Uint8Array(),
      editedAt: timestampFromUnixMs(mutation.mutatedTsUnixMs) as unknown as FriendChatMessage['editedAt'],
    } as FriendChatMessage | GroupMessage;
  });

  return mutated ? next : null;
}

export function applyTypingStateToMap(
  typingPeers: TypingPeers,
  sessionUlid: string,
  fromActorId: string,
  typing: boolean,
): TypingPeers | null {
  const sessionMap = typingPeers[sessionUlid] ?? {};
  const previous = sessionMap[fromActorId];
  if (!typing && !previous) return null;

  const nextEntry = { typing, lastUpdate: Date.now() };
  return {
    ...typingPeers,
    [sessionUlid]: { ...sessionMap, [fromActorId]: nextEntry },
  };
}

export function pruneTypingPeers(typingPeers: TypingPeers, staleBefore: number): TypingPeers | null {
  let mutated = false;
  const nextSessions: TypingPeers = {};

  for (const [sessionUlid, byActor] of Object.entries(typingPeers)) {
    let sessionMutated = false;
    const nextActors: TypingPeers[string] = {};
    for (const [actorId, entry] of Object.entries(byActor)) {
      if (entry.typing && entry.lastUpdate < staleBefore) {
        sessionMutated = true;
        continue;
      }
      if (!entry.typing) {
        sessionMutated = true;
        continue;
      }
      nextActors[actorId] = entry;
    }
    if (sessionMutated) mutated = true;
    if (Object.keys(nextActors).length > 0) {
      nextSessions[sessionUlid] = nextActors;
    } else if (Object.keys(byActor).length > 0) {
      mutated = true;
    }
  }

  return mutated ? nextSessions : null;
}

function timestampFromUnixMs(value: number) {
  return {
    seconds: BigInt(Math.floor(value / 1000)),
    nanos: (value % 1000) * 1_000_000,
  };
}
