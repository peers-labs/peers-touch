import { describe, expect, it } from 'vitest';

import {
  CHAT_RAIL_DEFAULT_WIDTH,
  CHAT_RAIL_MAX_WIDTH,
  CHAT_RAIL_MIN_WIDTH,
  CHAT_RAIL_WIDTH_STORAGE_KEY,
  clampChatRailWidth,
  persistChatRailWidth,
  readStoredChatRailWidth,
} from './chatRailWidth';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => map.set(key, value),
  } as Storage;
}

describe('clampChatRailWidth', () => {
  it('keeps in-band values and rounds them', () => {
    expect(clampChatRailWidth(312.4)).toBe(312);
    expect(clampChatRailWidth(CHAT_RAIL_DEFAULT_WIDTH)).toBe(300);
  });

  it('clamps to the min / max band', () => {
    expect(clampChatRailWidth(120)).toBe(CHAT_RAIL_MIN_WIDTH);
    expect(clampChatRailWidth(900)).toBe(CHAT_RAIL_MAX_WIDTH);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampChatRailWidth(Number.NaN)).toBe(CHAT_RAIL_DEFAULT_WIDTH);
    expect(clampChatRailWidth(Number.POSITIVE_INFINITY)).toBe(
      CHAT_RAIL_DEFAULT_WIDTH,
    );
    expect(clampChatRailWidth(Number.NEGATIVE_INFINITY)).toBe(
      CHAT_RAIL_DEFAULT_WIDTH,
    );
  });
});

describe('readStoredChatRailWidth', () => {
  it('returns the default when nothing is stored', () => {
    expect(readStoredChatRailWidth(memoryStorage())).toBe(
      CHAT_RAIL_DEFAULT_WIDTH,
    );
  });

  it('recovers a stored in-band width', () => {
    const storage = memoryStorage();
    storage.setItem(CHAT_RAIL_WIDTH_STORAGE_KEY, '348');
    expect(readStoredChatRailWidth(storage)).toBe(348);
  });

  it('rejects corrupt or non-positive values and clamps out-of-band ones', () => {
    const corrupt = memoryStorage();
    corrupt.setItem(CHAT_RAIL_WIDTH_STORAGE_KEY, 'not-a-number');
    expect(readStoredChatRailWidth(corrupt)).toBe(CHAT_RAIL_DEFAULT_WIDTH);

    const negative = memoryStorage();
    negative.setItem(CHAT_RAIL_WIDTH_STORAGE_KEY, '-8');
    expect(readStoredChatRailWidth(negative)).toBe(CHAT_RAIL_DEFAULT_WIDTH);

    const oversized = memoryStorage();
    oversized.setItem(CHAT_RAIL_WIDTH_STORAGE_KEY, '800');
    expect(readStoredChatRailWidth(oversized)).toBe(CHAT_RAIL_MAX_WIDTH);
  });

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
    } as unknown as Storage;
    expect(readStoredChatRailWidth(broken)).toBe(CHAT_RAIL_DEFAULT_WIDTH);
  });
});

describe('persistChatRailWidth', () => {
  it('stores the clamped width and returns it', () => {
    const storage = memoryStorage();
    const committed = persistChatRailWidth(100, storage);
    expect(committed).toBe(CHAT_RAIL_MIN_WIDTH);
    expect(storage.getItem(CHAT_RAIL_WIDTH_STORAGE_KEY)).toBe(
      String(CHAT_RAIL_MIN_WIDTH),
    );
  });

  it('round-trips through readStoredChatRailWidth', () => {
    const storage = memoryStorage();
    persistChatRailWidth(367.8, storage);
    expect(readStoredChatRailWidth(storage)).toBe(368);
  });
});
