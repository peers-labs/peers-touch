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
  resolveChatMessageThreadStats,
} from './chatMessageThreadStats';
import { isOwnMessage, type ChatMessage } from './chatMessageModel';

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
      { ulid: 'root', threadRootUlid: '', sentAtMs: 10 },
      { ulid: 'reply-2', threadRootUlid: 'root', sentAtMs: 20 },
      { ulid: 'other-root', threadRootUlid: '', sentAtMs: 30 },
      { ulid: 'reply-3', threadRootUlid: 'root', sentAtMs: 40 },
    ] as ChatMessage[];

    const stats = (projectedReplyCount?: number) => resolveChatMessageThreadStats({
      rootUlid: 'root',
      currentMessages: messages,
      loadedThreadMessages: [],
      projectedReplyCount,
    });
    expect(stats()).toEqual({
      replyCount: 2,
      replyIds: ['reply-2', 'reply-3'],
      previewMessages: [messages[1], messages[3]],
    });
    expect(stats(3).replyCount).toBe(3);
    expect(stats(1).replyCount).toBe(2);
  });

  it('exposes reply identities loaded by the thread owner after a cold timeline', () => {
    const currentMessages = [{ ulid: 'root', threadRootUlid: '', sentAtMs: 10 }] as ChatMessage[];
    const options = { rootUlid: 'root', currentMessages, projectedReplyCount: 2 };
    expect(resolveChatMessageThreadStats({
      ...options,
      loadedThreadMessages: [],
    })).toEqual({ replyCount: 2, replyIds: [], previewMessages: [] });

    const firstReply = { ulid: 'first-reply', threadRootUlid: 'root', sentAtMs: 20 } as ChatMessage;
    const nestedReply = {
      ulid: 'nested-reply',
      threadRootUlid: 'root',
      replyToUlid: 'first-reply',
      sentAtMs: 30,
    } as ChatMessage;
    expect(resolveChatMessageThreadStats({
      ...options,
      loadedThreadMessages: [currentMessages[0], firstReply, nestedReply],
    })).toEqual({
      replyCount: 2,
      replyIds: ['first-reply', 'nested-reply'],
      previewMessages: [firstReply, nestedReply],
    });
  });

  it('uses the current thread projection when the timeline still has stale replies', () => {
    const currentReply = { ulid: 'current-reply', threadRootUlid: 'root', sentAtMs: 30 } as ChatMessage;
    expect(resolveChatMessageThreadStats({
      rootUlid: 'root',
      currentMessages: [
        { ulid: 'root', threadRootUlid: '', sentAtMs: 10 },
        { ulid: 'stale-reply', threadRootUlid: 'root', sentAtMs: 20 },
      ] as ChatMessage[],
      loadedThreadMessages: [
        { ulid: 'root', threadRootUlid: '', sentAtMs: 10 },
        currentReply,
      ] as ChatMessage[],
      projectedReplyCount: 1,
    })).toEqual({
      replyCount: 1,
      replyIds: ['current-reply'],
      previewMessages: [currentReply],
    });
  });

  it('orders the inline preview chronologically and keeps only the latest tail', () => {
    const root = { ulid: 'root', threadRootUlid: '', sentAtMs: 1 } as ChatMessage;
    const replies = Array.from({ length: 12 }, (_, index) => ({
      ulid: `reply-${index}`,
      threadRootUlid: 'root',
      sentAtMs: 100 - index,
    })) as ChatMessage[];

    const { previewMessages } = resolveChatMessageThreadStats({
      rootUlid: 'root',
      currentMessages: [],
      // Feed replies newest-first to prove the resolver sorts by timestamp.
      loadedThreadMessages: [root, ...replies],
    });

    expect(previewMessages).toHaveLength(10);
    expect(previewMessages.map(message => message.ulid)).toEqual([
      'reply-9',
      'reply-8',
      'reply-7',
      'reply-6',
      'reply-5',
      'reply-4',
      'reply-3',
      'reply-2',
      'reply-1',
      'reply-0',
    ]);
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

describe('thread reply sender attribution', () => {
  const bobTwoPtid = 'ptid:peer:bob-two';
  const alicePtid = 'ptid:peer:alice';
  const replyFromBobTwo = { ulid: 'reply', senderPtid: bobTwoPtid } as ChatMessage;

  it('labels a reply as own only for its actual sender viewer', () => {
    // bob_two's own client sees the reply as "You"; alice's client must keep it
    // attributed to bob_two. Attribution is purely senderPtid vs viewer PTID.
    expect(isOwnMessage(replyFromBobTwo, bobTwoPtid)).toBe(true);
    expect(isOwnMessage(replyFromBobTwo, alicePtid)).toBe(false);
  });

  it('never treats a reply as own when the viewer identity is unknown', () => {
    expect(isOwnMessage(replyFromBobTwo, null)).toBe(false);
  });
});
