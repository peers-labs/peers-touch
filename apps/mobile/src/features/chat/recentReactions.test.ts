import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildQuickReactions,
  readRecentReactions,
  recordRecentReaction,
} from './recentReactions';

const ALLOWED = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const STORAGE_KEY = 'peers-touch.mobile.recent-reactions';

class FakeStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }
}

describe('recentReactions', () => {
  let fakeStorage: FakeStorage;
  let originalStorage: Storage | undefined;

  beforeEach(() => {
    fakeStorage = new FakeStorage();
    originalStorage = (globalThis as { localStorage?: Storage }).localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: fakeStorage,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalStorage,
      configurable: true,
      writable: true,
    });
  });

  it('returns an empty list before any reaction is recorded', () => {
    expect(readRecentReactions(ALLOWED)).toEqual([]);
  });

  it('records reactions most-recent-first, deduped and capped at eight', () => {
    recordRecentReaction('a', ALLOWED);
    recordRecentReaction('b', ALLOWED);
    recordRecentReaction('a', ALLOWED);
    expect(readRecentReactions(ALLOWED)).toEqual(['a', 'b']);

    const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    for (const emoji of nine) {
      recordRecentReaction(emoji, nine);
    }
    const stored = readRecentReactions(nine);
    expect(stored).toHaveLength(8);
    expect(stored[0]).toBe('i');
    expect(new Set(stored).size).toBe(stored.length);
  });

  it('persists the MRU list so a fresh read returns the same order', () => {
    recordRecentReaction('c', ALLOWED);
    recordRecentReaction('a', ALLOWED);
    expect(JSON.parse(fakeStorage.getItem(STORAGE_KEY)!)).toEqual(['a', 'c']);
    expect(readRecentReactions(ALLOWED)).toEqual(['a', 'c']);
  });

  it('ignores reactions outside the allowed set and corrupt payloads', () => {
    expect(recordRecentReaction('z', ALLOWED)).toEqual([]);
    fakeStorage.setItem(STORAGE_KEY, '{not-json');
    expect(readRecentReactions(ALLOWED)).toEqual([]);
    fakeStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'z', 42, 'b']));
    expect(readRecentReactions(ALLOWED)).toEqual(['a', 'b']);
  });

  it('degrades without throwing when localStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    // Reads stay empty and recording still returns the computed list for the
    // current session, but nothing is persisted for a subsequent read.
    expect(readRecentReactions(ALLOWED)).toEqual([]);
    expect(recordRecentReaction('a', ALLOWED)).toEqual(['a']);
    expect(readRecentReactions(ALLOWED)).toEqual([]);
  });
});

describe('buildQuickReactions', () => {
  const defaults = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

  it('fills slots with defaults when there are no recents', () => {
    expect(buildQuickReactions([], defaults, 6)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('puts recents first and fills the rest with defaults without duplicates', () => {
    expect(buildQuickReactions(['g', 'a'], defaults, 6)).toEqual(['g', 'a', 'b', 'c', 'd', 'e']);
  });

  it('never returns more than the requested slot count', () => {
    expect(buildQuickReactions(['g', 'f', 'e'], defaults, 2)).toEqual(['g', 'f']);
  });
});
