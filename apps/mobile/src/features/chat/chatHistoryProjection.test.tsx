import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useChatHistoryProjection } from './chatSelectors';
import { normalizeMessage } from '../social/socialNormalizers';

const messages = Array.from({ length: 240 }, (_, index) => normalizeMessage({
  ulid: `message-${index}`, content: index === 17 ? 'earliest-match' : 'reply',
  threadRootUlid: index === 0 ? '' : 'message-0',
  sentAt: { seconds: index + 1 },
}));

describe('Logical message history projection', () => {
  it('searches outside the newest render window and counts the complete thread', () => {
    let result: ReturnType<typeof useChatHistoryProjection> | undefined;
    function Fixture() {
      result = useChatHistoryProjection(messages, [], 'message-0', 'earliest-match');
      return null;
    }
    renderToStaticMarkup(<Fixture />);
    expect(result?.visible).toHaveLength(240);
    expect(result?.replyCount).toBe(239);
    expect(result?.searchResults.map((message) => message.ulid)).toEqual(['message-17']);
  });

  it('deduplicates owner projections, keeps current edits, and sorts the root first', () => {
    let result: ReturnType<typeof useChatHistoryProjection> | undefined;
    function Fixture() {
      result = useChatHistoryProjection(
        [{ ...messages[17], content: 'edited' }],
        [...messages].reverse(),
        'message-0', 'edited',
      );
      return null;
    }
    renderToStaticMarkup(<Fixture />);
    expect(result?.visible[0].ulid).toBe('message-0');
    expect(result?.visible).toHaveLength(240);
    expect(result?.byId.get('message-17')?.content).toBe('edited');
    expect(result?.searchResults).toHaveLength(1);
  });
});
