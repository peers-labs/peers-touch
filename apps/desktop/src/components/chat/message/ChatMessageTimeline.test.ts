import { describe, expect, it } from 'vitest';

import {
  CHAT_MESSAGE_VIRTUALIZATION_THRESHOLD,
  shouldVirtualizeChatMessageTimeline,
} from './chatMessageTimelinePolicy';
import {
  loadedThreadReplyCount,
  loadedThreadReplyIds,
} from './chatMessageThreadStats';
import type { ChatMessage } from './chatMessageModel';

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

describe('loaded thread reply ids', () => {
  it('preserves the authority order from the complete message projection', () => {
    const messages = [
      { ulid: 'root', threadRootUlid: '' },
      { ulid: 'reply-2', threadRootUlid: 'root' },
      { ulid: 'other-root', threadRootUlid: '' },
      { ulid: 'reply-3', threadRootUlid: 'root' },
    ] as ChatMessage[];

    expect(loadedThreadReplyIds(messages, 'root')).toEqual(['reply-2', 'reply-3']);
    expect(loadedThreadReplyCount(messages, 'root')).toBe(2);
  });
});
