import { describe, expect, it } from 'vitest';
import { boundedListRange } from './boundedListRange';

describe('bounded list identity window', () => {
  const keys = Array.from({ length: 1250 }, (_, index) => `row-${index}`);
  it('starts histories at the newest rows without discarding prior identities', () => {
    expect(boundedListRange(keys, undefined, 200, 'end')).toEqual({ start: 1050, end: 1250 });
    expect(boundedListRange(keys, 'row-12', 200, 'end')).toEqual({ start: 12, end: 212 });
  });
  it('reaches the complete dataset through overlapping bounded windows', () => {
    const visited = new Set<string>();
    let anchor: string | undefined;
    for (;;) {
      const { start, end } = boundedListRange(keys, anchor, 100, 'start');
      expect(end - start).toBeLessThanOrEqual(100);
      keys.slice(start, end).forEach((key) => visited.add(key));
      if (end === keys.length) break;
      anchor = keys[end - 1];
    }
    expect(visited.size).toBe(keys.length);
  });
  it('keeps the first visible identity when a new row is inserted above it', () => {
    expect(boundedListRange(['inserted', ...keys], 'row-125', 100, 'start'))
      .toEqual({ start: 126, end: 226 });
  });
  it('handles removed anchors, shorter lists, and empty projections', () => {
    expect(boundedListRange([], 'removed', 100, 'end')).toEqual({ start: 0, end: 0 });
    expect(boundedListRange(keys.slice(0, 2), 'row-1', 100, 'start')).toEqual({ start: 0, end: 2 });
    expect(boundedListRange(keys, 'removed', 100, 'start')).toEqual({ start: 0, end: 100 });
  });
});
