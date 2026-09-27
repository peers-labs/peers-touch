import { describe, expect, it } from 'vitest';

import {
  CHAT_MESSAGE_METADATA_RAIL_HEIGHT,
  CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
  CHAT_SESSION_ROW_HEIGHT,
  CHAT_SESSION_UNREAD_LANE_WIDTH,
  cappedChatUnreadCount,
} from './chatGeometry';

describe('chat layout geometry', () => {
  it('reserves stable conversation and message metadata lanes', () => {
    expect(CHAT_SESSION_ROW_HEIGHT).toBe(64);
    expect(CHAT_SESSION_UNREAD_LANE_WIDTH).toBeGreaterThanOrEqual(28);
    expect(CHAT_MESSAGE_METADATA_RAIL_HEIGHT).toBeGreaterThanOrEqual(
      CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
    );
  });

  it('caps unread values without changing the lane contract', () => {
    expect(cappedChatUnreadCount(-1)).toBe(0);
    expect(cappedChatUnreadCount(8)).toBe(8);
    expect(cappedChatUnreadCount(120)).toBe(99);
  });
});
