export const CHAT_SESSION_ROW_HEIGHT = 64;
export const CHAT_SESSION_UNREAD_LANE_WIDTH = 28;
export const CHAT_MESSAGE_METADATA_RAIL_HEIGHT = 24;
export const CHAT_MESSAGE_REACTION_CHIP_HEIGHT = 20;

export function cappedChatUnreadCount(unread: number): number {
  return Math.min(Math.max(Math.trunc(unread), 0), 99);
}
