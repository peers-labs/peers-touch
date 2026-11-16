import { describe, expect, it } from 'vitest';
import { catalogBounds, expandedCatalogWidth, settleCatalogBoundary } from '@peers-touch/ui';

import {
  CHAT_RAIL_DEFAULT_WIDTH,
  CHAT_RAIL_MAX_WIDTH,
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

describe('expandedCatalogWidth', () => {
  it('keeps every usable-band value and rounds it', () => {
    expect(expandedCatalogWidth(160)).toBe(160);
    expect(expandedCatalogWidth(172.4)).toBe(172);
    expect(expandedCatalogWidth(312.4)).toBe(312);
    expect(expandedCatalogWidth(CHAT_RAIL_DEFAULT_WIDTH)).toBe(300);
  });

  it('clamps to the usable min / max band', () => {
    expect(expandedCatalogWidth(20)).toBe(CHAT_RAIL_DEFAULT_WIDTH);
    expect(expandedCatalogWidth(159.9)).toBe(CHAT_RAIL_DEFAULT_WIDTH);
    expect(expandedCatalogWidth(900)).toBe(CHAT_RAIL_MAX_WIDTH);
  });

  it('recovers expanded paper when legacy persistence contains only a collapsed/intermediate pose', () => {
    for (const width of [64, 80, 144, 151, 152, 159]) expect(expandedCatalogWidth(width)).toBe(300);
  });

  it('falls back to the default for non-finite input', () => {
    expect(expandedCatalogWidth(Number.NaN)).toBe(CHAT_RAIL_DEFAULT_WIDTH);
    expect(expandedCatalogWidth(Number.POSITIVE_INFINITY)).toBe(
      CHAT_RAIL_DEFAULT_WIDTH,
    );
    expect(expandedCatalogWidth(Number.NEGATIVE_INFINITY)).toBe(
      CHAT_RAIL_DEFAULT_WIDTH,
    );
  });
});

describe('directional settlement after the gesture', () => {
  it('keeps the exact released width anywhere in the usable band', () => {
    const range = catalogBounds(905, 1);
    for (const width of [160, 172, 240, 300, 352, 360]) {
      for (const direction of [-1, 0, 1] as const) {
        expect(settleCatalogBoundary(width, range, direction))
          .toEqual({ rest: 'expanded', width });
      }
    }
  });

  it('snaps only the unsittable gap, according to final direction', () => {
    const range = catalogBounds(905, 1);
    for (const width of [65, 100, 112, 152]) {
      expect(settleCatalogBoundary(width, range, -1))
        .toEqual({ rest: 'compact', width: 64 });
      expect(settleCatalogBoundary(width, range, 1))
        .toEqual({ rest: 'expanded', width: 160 });
    }
  });

  it('picks the nearest side of the gap for nondirectional input', () => {
    const range = catalogBounds(905, 1);
    expect(settleCatalogBoundary(100, range, 0)).toEqual({ rest: 'compact', width: 64 });
    expect(settleCatalogBoundary(112, range, 0)).toEqual({ rest: 'expanded', width: 160 });
  });

  it('settles a compressed visible edge to its reachable stops instead of a hidden paper width', () => {
    const range = catalogBounds(299, 1);
    expect(range).toEqual({ min: 64, max: 99 });
    expect(settleCatalogBoundary(80, range, -1)).toEqual({ rest: 'compact', width: 64 });
    expect(settleCatalogBoundary(80, range, 1)).toEqual({ rest: 'expanded', width: 99 });
    expect(settleCatalogBoundary(80, range, 0)).toEqual({ rest: 'compact', width: 64 });
    expect(settleCatalogBoundary(85, range, 0)).toEqual({ rest: 'expanded', width: 99 });
  });

  it('never leaves a stable rest inside the gap on a roomy frame', () => {
    const range = catalogBounds(905, 1);
    for (let width = 64; width <= 360; width++) {
      const settled = settleCatalogBoundary(width, range, width % 2 ? -1 : 1);
      if (settled.rest === 'compact') expect(settled.width).toBe(64);
      else expect(settled.width).toBeGreaterThanOrEqual(160);
    }
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
    expect(committed).toBe(CHAT_RAIL_DEFAULT_WIDTH);
    expect(storage.getItem(CHAT_RAIL_WIDTH_STORAGE_KEY)).toBe(
      String(CHAT_RAIL_DEFAULT_WIDTH),
    );
  });

  it('round-trips through readStoredChatRailWidth', () => {
    const storage = memoryStorage();
    persistChatRailWidth(367.8, storage);
    expect(readStoredChatRailWidth(storage)).toBe(360);
  });

  it('persists every usable-band width independently from compact or gap poses', () => {
    const storage = memoryStorage();
    for (const [input, expected] of [[64, 300], [80, 300], [152, 300], [159, 300], [160, 160], [172, 172], [240, 240], [300, 300], [420, 360]]) {
      expect(persistChatRailWidth(input, storage)).toBe(expected);
      expect(readStoredChatRailWidth(storage)).toBe(expected);
      storage.setItem(CHAT_RAIL_WIDTH_STORAGE_KEY, String(input));
      expect(readStoredChatRailWidth(storage)).toBe(expected);
    }
  });
});
