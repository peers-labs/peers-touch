import { describe, expect, it } from 'vitest';

import {
  CHAT_MESSAGE_VIRTUALIZATION_THRESHOLD,
  shouldVirtualizeChatMessageTimeline,
} from './chatMessageTimelinePolicy';

describe('chat message timeline virtualization policy', () => {
  it('keeps short conversations in normal document flow', () => {
    expect(shouldVirtualizeChatMessageTimeline(0)).toBe(false);
    expect(
      shouldVirtualizeChatMessageTimeline(CHAT_MESSAGE_VIRTUALIZATION_THRESHOLD),
    ).toBe(false);
  });

  it('virtualizes conversations above the short-timeline threshold', () => {
    expect(
      shouldVirtualizeChatMessageTimeline(CHAT_MESSAGE_VIRTUALIZATION_THRESHOLD + 1),
    ).toBe(true);
  });
});
