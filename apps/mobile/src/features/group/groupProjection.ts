import type { Group, GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import { timestampMillis } from './groupNormalizers';

export interface GroupConversation {
  group: Group;
  unread: number;
  lastMessage?: GroupMessage;
}

export function projectGroupConversations(input: {
  groups: Group[];
  messages: Record<string, GroupMessage[]>;
  unreadCounts: Record<string, number>;
}): GroupConversation[] {
  return input.groups
    .map((group) => ({
      group,
      unread: input.unreadCounts[group.ulid] ?? 0,
      lastMessage: input.messages[group.ulid]?.at(-1),
    }))
    .sort((a, b) => timestampMillis(b.group.updatedAt ?? b.group.createdAt) - timestampMillis(a.group.updatedAt ?? a.group.createdAt));
}

export function mergeGroupMessages(messages: GroupMessage[], incoming: GroupMessage): GroupMessage[] {
  if (!incoming.ulid) return messages;
  const byUlid = new Map<string, GroupMessage>();
  messages.forEach((message) => {
    if (message.ulid) byUlid.set(message.ulid, message);
  });
  byUlid.set(incoming.ulid, incoming);
  return [...byUlid.values()].sort((a, b) => timestampMillis(a.sentAt ?? a.createdAt) - timestampMillis(b.sentAt ?? b.createdAt));
}

export function applyGroupMutationToList(
  messages: GroupMessage[] | undefined,
  messageUlid: string,
  mutation: {
    kind: 'RECALL' | 'EDIT' | 'DELETE';
    newContent?: string;
    newCiphertext?: Uint8Array;
    mutatedTsUnixMs?: number;
  },
): GroupMessage[] | null {
  if (!messages?.length) return null;
  let changed = false;

  if (mutation.kind === 'DELETE') {
    const next = messages.filter((message) => {
      if (message.ulid === messageUlid) {
        changed = true;
        return false;
      }
      return true;
    });
    return changed ? next : null;
  }

  const next = messages.map((message) => {
    if (message.ulid !== messageUlid) return message;
    if (mutation.kind === 'RECALL') {
      if (message.recalled) return message;
      changed = true;
      return { ...message, content: '', encryptedPayload: new Uint8Array(), recalled: true } as GroupMessage;
    }

    changed = true;
    return {
      ...message,
      content: mutation.newContent || message.content,
      encryptedPayload: mutation.newCiphertext?.byteLength ? mutation.newCiphertext : message.encryptedPayload,
      editedAt: timestampFromUnixMs(mutation.mutatedTsUnixMs ?? Date.now()),
    } as GroupMessage;
  });

  return changed ? next : null;
}

function timestampFromUnixMs(value: number) {
  return {
    seconds: BigInt(Math.floor(value / 1000)),
    nanos: (value % 1000) * 1_000_000,
  };
}
