import { describe, expect, it } from 'vitest';
import { normalizeChatSearchQuery, prependRecentChatSearch } from './recentChatSearch';

describe('recent Chat search', () => {
  it('replays a normalized query once and moves it ahead of older searches', () => {
    expect(prependRecentChatSearch(['old', 'Release Notes', 'new'], '  release \n notes  '))
      .toEqual(['release notes', 'old', 'new']);
  });

  it('retains only the newest ten entries and ignores empty searches', () => {
    const entries = Array.from({ length: 12 }, (_, index) => `query ${index}`);
    expect(prependRecentChatSearch(entries, 'latest')).toEqual(['latest', ...entries.slice(0, 9)]);
    expect(prependRecentChatSearch(['alpha', ''], ' \n ')).toEqual(['alpha']);
  });

  it('normalizes whitespace without changing the text sent to message search', () => {
    expect(normalizeChatSearchQuery('  项目 \t 发布  ')).toBe('项目 发布');
    expect(normalizeChatSearchQuery('API_v2')).toBe('API_v2');
  });
});
