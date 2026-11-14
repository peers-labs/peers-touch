import type { CSSProperties } from 'react';

export const CHAT_MESSAGE_VIRTUALIZATION_THRESHOLD = 50;
export const CHAT_MESSAGE_TAIL_PIN_THRESHOLD = 48;

export function shouldVirtualizeChatMessageTimeline(messageCount: number): boolean {
  return messageCount > CHAT_MESSAGE_VIRTUALIZATION_THRESHOLD;
}

export function chatMessageTimelineContainerStyle(
  totalSize: number,
  virtualized = true,
): CSSProperties {
  return {
    height: virtualized ? totalSize : 'auto',
    width: '100%',
    position: 'relative',
    flex: '0 0 auto',
  };
}

export function shouldAdjustChatMessageScrollPosition(
  itemStart: number,
  scrollOffset: number,
  sizeDelta: number,
): boolean {
  return sizeDelta !== 0 && itemStart < scrollOffset;
}

export function chatMessageTailScrollOptions(): ScrollIntoViewOptions {
  return {
    behavior: 'auto',
    block: 'end',
  };
}

interface ChatMessageScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

export function chatMessageTailScrollTop(
  metrics: Pick<ChatMessageScrollMetrics, 'clientHeight' | 'scrollHeight'>,
): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

/**
 * Decide a tail-pin reconciliation after a scroll port or content resize.
 * Async growth (preview image load, late delivery/reaction rows) increases
 * scrollHeight without changing scrollTop; while the conversation is
 * tail-pinned the tail must be re-pinned, otherwise the last message ends
 * under the composer. Returns the next scrollTop, or null to leave the
 * scroll position untouched (user scrolled up, or sub-pixel jitter only).
 */
export function reconcileTailScrollOnResize(
  metrics: ChatMessageScrollMetrics,
  tailPinned: boolean,
): number | null {
  if (!tailPinned) return null;
  const target = chatMessageTailScrollTop(metrics);
  if (Math.abs(target - metrics.scrollTop) <= 1) return null;
  return target;
}

export function isChatMessageTailPinned(
  metrics: ChatMessageScrollMetrics,
): boolean {
  return chatMessageTailScrollTop(metrics) - metrics.scrollTop
    <= CHAT_MESSAGE_TAIL_PIN_THRESHOLD;
}
