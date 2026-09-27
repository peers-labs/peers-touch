import { describe, expect, it } from 'vitest';

import {
  CHAT_MESSAGE_TAIL_PIN_THRESHOLD,
  CHAT_MESSAGE_VIRTUALIZATION_THRESHOLD,
  chatMessageTailScrollTop,
  chatMessageTimelineContainerStyle,
  chatMessageTailScrollOptions,
  isChatMessageTailPinned,
  shouldAdjustChatMessageScrollPosition,
  shouldVirtualizeChatMessageTimeline,
} from './chatMessageTimelinePolicy';
import {
  loadedThreadReplyCount,
  loadedThreadReplyIds,
  resolvedThreadReplyCount,
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
    expect(resolvedThreadReplyCount(messages, 'root', 3)).toBe(3);
    expect(resolvedThreadReplyCount(messages, 'root', 1)).toBe(2);
  });
});

describe('ChatMessageTimeline layout', () => {
  it('preserves the full virtual height inside the scroll flex column', () => {
    expect(chatMessageTimelineContainerStyle(1_272)).toEqual({
      height: 1_272,
      width: '100%',
      position: 'relative',
      flex: '0 0 auto',
    });
  });

  it('places a newly rendered tail above the composer without animation', () => {
    expect(chatMessageTailScrollOptions()).toEqual({
      behavior: 'auto',
      block: 'end',
    });
  });

  it('reconciles delayed virtual measurements while the tail remains pinned', () => {
    const measured = {
      clientHeight: 567,
      scrollHeight: 4_269,
      scrollTop: 3_662,
    };

    expect(chatMessageTailScrollTop(measured)).toBe(3_702);
    expect(isChatMessageTailPinned(measured)).toBe(true);
    expect(CHAT_MESSAGE_TAIL_PIN_THRESHOLD).toBe(48);
    expect(isChatMessageTailPinned({
      ...measured,
      scrollTop: 3_600,
    })).toBe(false);
  });

  it('preserves the visible anchor when a measured row above it changes size', () => {
    expect(shouldAdjustChatMessageScrollPosition(400, 600, 24)).toBe(true);
    expect(shouldAdjustChatMessageScrollPosition(700, 600, 24)).toBe(false);
    expect(shouldAdjustChatMessageScrollPosition(400, 600, 0)).toBe(false);
  });

  it('uses natural document flow for short conversations', () => {
    expect(chatMessageTimelineContainerStyle(0, false)).toEqual({
      height: 'auto',
      width: '100%',
      position: 'relative',
      flex: '0 0 auto',
    });
  });
});
