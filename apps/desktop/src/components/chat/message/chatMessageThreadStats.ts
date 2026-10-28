import { buildChatThreadSurface } from '@peers-touch/client-chat-core';

import type { ChatMessage } from './chatMessageModel';

export function resolveChatMessageThreadStats({
  rootUlid,
  currentMessages,
  loadedThreadMessages,
  projectedReplyCount,
}: {
  rootUlid: string;
  currentMessages: ChatMessage[];
  loadedThreadMessages: ChatMessage[];
  projectedReplyCount?: number;
}) {
  const { replies } = buildChatThreadSurface({
    rootUlid,
    currentMessages,
    loadedThreadMessages,
  });
  return {
    replyCount: Math.max(replies.length, projectedReplyCount ?? 0),
    replyIds: replies.map(message => message.ulid),
  };
}
