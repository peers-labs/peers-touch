import type { CSSProperties } from 'react';

export const CHAT_MESSAGE_VIRTUALIZATION_THRESHOLD = 50;

export function shouldVirtualizeChatMessageTimeline(messageCount: number): boolean {
  return messageCount > CHAT_MESSAGE_VIRTUALIZATION_THRESHOLD;
}

export function chatMessageTimelineContainerStyle(totalSize: number): CSSProperties {
  return {
    height: totalSize,
    width: '100%',
    position: 'relative',
    flex: '0 0 auto',
  };
}

export function chatMessageTailScrollOptions(): ScrollIntoViewOptions {
  return {
    behavior: 'auto',
    block: 'end',
  };
}
