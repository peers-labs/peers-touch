import {
  projectIMConversation,
  projectIMMessage,
  type IMConversationProjection,
  type IMMessageProjection,
} from '@peers-touch/client-chat-core';

import type { Group, GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import { timestampMillis } from './groupNormalizers';

export type GroupListProjection = Group & { lastMessage?: GroupMessage };

export interface GroupConversation {
  group: Group;
  unread: number;
  lastMessage?: GroupMessage;
}

export type GroupMessageDisplay =
  | { kind: 'text'; content: string }
  | { kind: 'recalled' }
  | { kind: 'encrypted' }
  | { kind: 'empty' };

export function projectGroupConversations(input: {
  groups: GroupListProjection[];
  unreadCounts: Record<string, number>;
}): GroupConversation[] {
  return input.groups
    .map((group) => ({
      group,
      unread: input.unreadCounts[group.ulid] ?? 0,
      lastMessage: group.lastMessage,
    }))
    .sort((a, b) => timestampMillis(b.group.updatedAt ?? b.group.createdAt) - timestampMillis(a.group.updatedAt ?? a.group.createdAt));
}

export function projectMobileGroupIMConversation(conversation: GroupConversation): IMConversationProjection {
  return projectIMConversation({
    kind: 'group',
    id: conversation.group.ulid,
    title: conversation.group.name || 'Group',
    avatar: '',
    lastActivityMs: timestampMillis(conversation.group.updatedAt ?? conversation.group.createdAt),
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

export function projectMobileGroupIMMessage(
  conversationId: string,
  message: GroupMessage,
): IMMessageProjection {
  return projectIMMessage({
    id: message.ulid ?? '',
    conversationKind: 'group',
    conversationId,
    senderPtid: message.senderPtid ?? '',
    type: Number(message.type ?? 1),
    content: message.content,
    attachments: message.attachments ?? [],
    sentAtMs: timestampMillis(message.sentAt ?? message.createdAt),
    recalled: Boolean(message.recalled),
    editedAtMs: message.editedAt ? timestampMillis(message.editedAt) : undefined,
    replyToId: message.replyToUlid,
    threadRootId: message.threadRootUlid,
    encrypted: Boolean(message.encryptedPayload?.byteLength && !message.content),
  });
}

export function projectGroupMessageDisplay(message: GroupMessage): GroupMessageDisplay {
  if (message.recalled) return { kind: 'recalled' };
  if (message.content) return { kind: 'text', content: message.content };
  if (message.encryptedPayload?.byteLength) return { kind: 'encrypted' };
  return { kind: 'empty' };
}
