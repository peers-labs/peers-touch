import { geometry } from '@peers-touch/ui-tokens';

/** Pointer or keyboard movement: narrower, stationary, wider. */
export type ChatRailResizeDirection = -1 | 0 | 1;

/** The catalog has one compact width and a continuous expanded interval. */
export function normalizeChatRailWidth(width: number): number {
  const { minWidth, expandedMinWidth, maxWidth, defaultWidth } = geometry.chatRail;
  if (!Number.isFinite(width)) return defaultWidth;
  const bounded = Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
  if (bounded > minWidth && bounded < expandedMinWidth) {
    return bounded - minWidth < expandedMinWidth - bounded ? minWidth : expandedMinWidth;
  }
  return bounded;
}

/** Never preview the gap: snap toward the endpoint the user is moving to. */
export function resizeChatRailWidth(width: number, direction: ChatRailResizeDirection): number {
  const { minWidth, expandedMinWidth } = geometry.chatRail;
  if (Number.isFinite(width) && width > minWidth && width < expandedMinWidth) {
    if (direction < 0) return minWidth;
    if (direction > 0) return expandedMinWidth;
  }
  return normalizeChatRailWidth(width);
}
