import { describe, expect, it } from 'vitest';

import {
  CHAT_MESSAGE_METADATA_RAIL_HEIGHT,
  CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
  CHAT_SESSION_ROW_HEIGHT,
  cappedChatUnreadCount,
} from './chatGeometry';

describe('chat layout geometry', () => {
  it('reserves stable conversation rows and message metadata lanes', () => {
    expect(CHAT_SESSION_ROW_HEIGHT).toBe(64);
    expect(CHAT_MESSAGE_METADATA_RAIL_HEIGHT).toBeGreaterThanOrEqual(
      CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
    );
  });

  it('caps unread values for the avatar-corner badge contract', () => {
    expect(cappedChatUnreadCount(-1)).toBe(0);
    expect(cappedChatUnreadCount(8)).toBe(8);
    expect(cappedChatUnreadCount(120)).toBe(99);
  });
});
