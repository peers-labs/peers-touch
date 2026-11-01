import {
  buildChatThreadSurface,
  collectChatThreadPreviewMessages,
} from '@peers-touch/client-chat-core';

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
  // The inline Feishu-style preview under the root bubble MUST reuse the
  // surface's authoritative replies: once the thread panel has loaded,
  // timeline copies are potentially stale (see buildChatThreadSurface). The
  // collector only adds ordering, dedupe, and the tail preview limit.
  const previewMessages = collectChatThreadPreviewMessages({
    rootUlid,
    currentMessages: [],
    loadedThreadMessages: replies,
    resolveTimestampMs: (message) => message.sentAtMs,
  });
  return {
    replyCount: Math.max(replies.length, projectedReplyCount ?? 0),
    replyIds: replies.map(message => message.ulid),
    previewMessages,
  };
}
