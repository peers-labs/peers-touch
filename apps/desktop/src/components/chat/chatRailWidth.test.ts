import { describe, expect, it } from 'vitest';
import { geometry, settleCatalog } from '@peers-touch/ui';

import {
  CHAT_RAIL_DEFAULT_WIDTH,
  CHAT_RAIL_MAX_WIDTH,
  CHAT_RAIL_MIN_WIDTH,
  CHAT_RAIL_WIDTH_STORAGE_KEY,
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

describe('settleCatalog', () => {
  it('keeps in-band values and rounds them', () => {
    expect(settleCatalog(312.4)).toBe(312);
    expect(settleCatalog(CHAT_RAIL_DEFAULT_WIDTH)).toBe(300);
  });

  it('clamps to the min / max band', () => {
    expect(settleCatalog(20)).toBe(CHAT_RAIL_MIN_WIDTH);
    expect(settleCatalog(900)).toBe(CHAT_RAIL_MAX_WIDTH);
  });

  it('maps old intermediate widths to the nearest stable endpoint', () => {
    expect(settleCatalog(80)).toBe(64);
    expect(settleCatalog(151)).toBe(64);
    expect(settleCatalog(152)).toBe(240);
    expect(settleCatalog(239)).toBe(240);
  });

  it('falls back to the default for non-finite input', () => {
    expect(settleCatalog(Number.NaN)).toBe(CHAT_RAIL_DEFAULT_WIDTH);
    expect(settleCatalog(Number.POSITIVE_INFINITY)).toBe(
      CHAT_RAIL_DEFAULT_WIDTH,
    );
    expect(settleCatalog(Number.NEGATIVE_INFINITY)).toBe(
      CHAT_RAIL_DEFAULT_WIDTH,
    );
  });
});

describe('directional settlement after the gesture', () => {
  it('snaps the same intermediate pointer position according to actual direction', () => {
    for (const width of [65, 100, 152, 185, 239]) {
      expect(settleCatalog(width, -1)).toBe(64);
      expect(settleCatalog(width, 1)).toBe(240);
    }
  });

  it('keeps every expanded pixel available and clamps outside the endpoints', () => {
    for (let width = 240; width <= 360; width += 1) {
      expect(settleCatalog(width, -1)).toBe(width);
      expect(settleCatalog(width, 1)).toBe(width);
    }
    expect(settleCatalog(30, 1)).toBe(64);
    expect(settleCatalog(500, -1)).toBe(360);
    expect(settleCatalog(Number.NaN, 1)).toBe(300);
  });

  it('skips the gap with arrow keys at either endpoint', () => {
    const { keyboardStep } = geometry.chatRail;
    expect(settleCatalog(64 + keyboardStep, 1)).toBe(240);
    expect(settleCatalog(240 - keyboardStep, -1)).toBe(64);
    expect(settleCatalog(300 - keyboardStep, -1)).toBe(284);
    expect(settleCatalog(300 + keyboardStep, 1)).toBe(316);
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
    const committed = persistChatRailWidth(20, storage);
    expect(committed).toBe(CHAT_RAIL_MIN_WIDTH);
    expect(storage.getItem(CHAT_RAIL_WIDTH_STORAGE_KEY)).toBe(
      String(CHAT_RAIL_MIN_WIDTH),
    );
  });

  it('round-trips through readStoredChatRailWidth', () => {
    const storage = memoryStorage();
    persistChatRailWidth(367.8, storage);
    expect(readStoredChatRailWidth(storage)).toBe(360);
  });

  it('persists only the fixed compact state or the expanded interval', () => {
    const storage = memoryStorage();
    for (const [input, expected] of [[64, 64], [80, 64], [185, 240], [239, 240], [240, 240], [300, 300], [420, 360]]) {
      expect(persistChatRailWidth(input, storage)).toBe(expected);
      expect(readStoredChatRailWidth(storage)).toBe(expected);
      storage.setItem(CHAT_RAIL_WIDTH_STORAGE_KEY, String(input));
      expect(readStoredChatRailWidth(storage)).toBe(expected);
    }
  });
});
