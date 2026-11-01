import { describe, expect, it } from 'vitest';
import {
  commitMention,
  findMentionTrigger,
  normalizeMentions,
  rebaseMentions,
} from './socialMentionModel';

describe('socialMentionModel', () => {
  it('detects an @ trigger immediately before the caret', () => {
    expect(findMentionTrigger('hi @ad', 6)).toEqual({
      start: 3,
      query: 'ad',
      caret: 6,
    });
  });

  it('triggers after a CJK ideograph (你好@x)', () => {
    const trigger = findMentionTrigger('你好@ad', 5);
    expect(trigger?.start).toBe(2);
    expect(trigger?.query).toBe('ad');
  });

  it('triggers after opening punctuation ((@x)', () => {
    expect(findMentionTrigger('(@ad)', 4)?.query).toBe('ad');
    expect(findMentionTrigger('（@ad）', 4)?.query).toBe('ad');
  });

  it('does not trigger when @ is mid-token', () => {
    expect(findMentionTrigger('user@host', 10)).toBeNull();
  });

  it('does not trigger after whitespace in the token', () => {
    expect(findMentionTrigger('@ada then', 10)).toBeNull();
  });

  it('triggers at index zero', () => {
    expect(findMentionTrigger('@ad', 3)?.query).toBe('ad');
  });

  it('counts astral characters as two UTF-16 units', () => {
    // "hi 𝕏 @ad" — 𝕏 is a surrogate pair.
    const trigger = findMentionTrigger('hi 𝕏 @ad', 9);
    expect(trigger?.start).toBe(6);
    expect(trigger?.query).toBe('ad');
  });

  it('commits a candidate replacing the query token', () => {
    const trigger = findMentionTrigger('hi @ad end', 6)!;
    const result = commitMention('hi @ad end', trigger, {
      actorPtid: 'ptid:ada',
      displayName: 'Ada',
    });
    expect(result.text).toBe('hi @Ada end');
    // The following space already existed, so the caret lands right
    // after the mention (before that space).
    expect(result.caret).toBe('hi @Ada'.length);
    expect(result.mention).toEqual({
      actorPtid: 'ptid:ada',
      offset: 3,
      length: 4,
      display: '@Ada',
    });
  });

  it('does not duplicate a leading @ in display', () => {
    const trigger = findMentionTrigger('@ad', 3)!;
    const result = commitMention('@ad', trigger, {
      actorPtid: 'ptid:ada',
      displayName: '@Ada',
    });
    expect(result.text).toBe('@Ada ');
    expect(result.mention.display).toBe('@Ada');
  });

  it('drops a mention when its display range is edited away', () => {
    const mentions = [{
      actorPtid: 'ptid:ada',
      offset: 0,
      length: 4,
      display: '@Ada',
    }];
    expect(rebaseMentions('@Boba', mentions)).toHaveLength(0);
    expect(rebaseMentions('@Ada hi', mentions)).toHaveLength(1);
  });

  it('normalizes: drops invalid, dedupes actor, sorts by offset', () => {
    const mentions = [
      { actorPtid: 'ptid:bob', offset: 9, length: 4, display: '@bob' },
      { actorPtid: 'ptid:ada', offset: 0, length: 4, display: '@Ada' },
      { actorPtid: 'ptid:ada', offset: 20, length: 4, display: '@ada' },
    ];
    const normalized = normalizeMentions('@Ada say @bob', mentions);
    expect(normalized.map((m) => m.actorPtid)).toEqual([
      'ptid:ada',
      'ptid:bob',
    ]);
    // The duplicate actor mention at an invalid range is gone.
    expect(normalized.filter((m) => m.actorPtid === 'ptid:ada')).toHaveLength(1);
  });

  it('rejects overlapping ranges during normalization', () => {
    const mentions = [
      { actorPtid: 'ptid:a', offset: 0, length: 2, display: '@a' },
      { actorPtid: 'ptid:b', offset: 1, length: 2, display: 'ad' },
    ];
    expect(normalizeMentions('@ada', mentions)).toEqual([]);
  });
});
