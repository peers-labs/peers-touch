import { describe, expect, it } from 'vitest';

import {
  conversationMentionDraft,
  detectConversationMentionTrigger,
  insertConversationMention,
  reconcileConversationMentions,
} from './conversationMentions';

describe('conversation mentions', () => {
  it('detects a whitespace-delimited trigger and inserts the selected member', () => {
    const text = 'Hello @bo';
    const trigger = detectConversationMentionTrigger(text, text.length);
    expect(trigger).toEqual({ start: 6, end: 9, query: 'bo' });

    const inserted = insertConversationMention(text, trigger!, {
      actorPtid: 'ptid:bob',
      displayName: 'Bob',
    });
    expect(inserted.text).toBe('Hello @Bob ');
    expect(inserted.cursor).toBe(11);
  });

  it('reconciles positions after edits and emits UTF-8 byte offsets', () => {
    const selections = reconcileConversationMentions('你好 @Bob', [{
      actorPtid: 'ptid:bob',
      display: 'Bob',
      start: 0,
    }]);
    const draft = conversationMentionDraft('你好 @Bob', selections);
    expect(draft.mentions).toEqual([{
      actorPtid: 'ptid:bob',
      offset: 7,
      length: 4,
      display: 'Bob',
    }]);
  });

  it('replaces the captured trigger range even after the live caret moves', () => {
    const text = '@bo after';
    const trigger = detectConversationMentionTrigger(text, 3);
    const inserted = insertConversationMention(text, trigger!, {
      actorPtid: 'ptid:bob',
      displayName: 'Bob',
    });
    expect(inserted.text).toBe('@Bob after');
  });

  it('drops deleted tokens and keeps mention-all mutually exclusive', () => {
    expect(reconcileConversationMentions('plain text', [{
      actorPtid: 'ptid:bob',
      display: 'Bob',
      start: 0,
    }])).toEqual([]);

    expect(conversationMentionDraft('@all', [{
      actorPtid: null,
      display: 'all',
      start: 0,
    }, {
      actorPtid: 'ptid:bob',
      display: 'Bob',
      start: 5,
    }])).toMatchObject({ mentions: [], mentionAll: true });
  });

  it('drops a selected token after it becomes only a prefix of another token', () => {
    expect(reconcileConversationMentions('@Bobby', [{
      actorPtid: 'ptid:bob',
      display: 'Bob',
      start: 0,
    }])).toEqual([]);
  });
});
