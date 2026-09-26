import { countChatThreadReplies } from '@peers-touch/client-chat-core';

import { messageThreadRootUlid, type ChatMessage } from './chatMessageModel';

export function loadedThreadReplyCount(messages: ChatMessage[], rootUlid: string): number {
  return countChatThreadReplies(messages, rootUlid);
}

export function resolvedThreadReplyCount(
  messages: ChatMessage[],
  rootUlid: string,
  projectedReplyCount?: number,
): number {
  return Math.max(
    loadedThreadReplyCount(messages, rootUlid),
    projectedReplyCount ?? 0,
  );
}

export function loadedThreadReplyIds(messages: ChatMessage[], rootUlid: string): string[] {
  return messages
    .filter(message => messageThreadRootUlid(message) === rootUlid)
    .map(message => message.ulid);
}
