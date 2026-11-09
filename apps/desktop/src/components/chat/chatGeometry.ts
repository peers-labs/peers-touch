export const CHAT_SESSION_ROW_HEIGHT = 64;
export const CHAT_MESSAGE_METADATA_RAIL_HEIGHT = 24;
export const CHAT_MESSAGE_REACTION_CHIP_HEIGHT = 20;
// Main-surface item spacing mirrors the prototype .sk-msg-stream gap (14px);
// the thread sheet keeps its own compact rhythm. Meta spacing is owned by
// .sc-msg-meta in chat.css (prototype .sk-msg-under grammar).
export const CHAT_MESSAGE_SPACING = { item: 14, compactItem: 6 } as const;

export function cappedChatUnreadCount(unread: number): number {
  return Math.min(Math.max(Math.trunc(unread), 0), 99);
}
