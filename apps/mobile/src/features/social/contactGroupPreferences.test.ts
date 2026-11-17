import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readCollapsedContactGroups,
  withGroupCollapsed,
  writeCollapsedContactGroups,
} from './contactGroupPreferences';

const STORAGE_KEY = 'peers-touch.mobile.contacts-collapsed-groups';

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

describe('contactGroupPreferences', () => {
  let fakeStorage: FakeStorage;
  let originalStorage: Storage | undefined;

  beforeEach(() => {
    fakeStorage = new FakeStorage();
    originalStorage = (globalThis as { localStorage?: Storage }).localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: fakeStorage, configurable: true, writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalStorage, configurable: true, writable: true,
    });
  });

  it('starts empty and round-trips a collapsed letter set', () => {
    expect(readCollapsedContactGroups().size).toBe(0);
    writeCollapsedContactGroups(new Set(['B', 'D']));
    expect([...readCollapsedContactGroups()].sort()).toEqual(['B', 'D']);
    expect(JSON.parse(fakeStorage.getItem(STORAGE_KEY)!)).toEqual(['B', 'D']);
  });

  it('toggles a single letter without mutating the input', () => {
    const initial = new Set(['A']);
    const expanded = withGroupCollapsed(initial, 'A', false);
    expect(expanded.has('A')).toBe(false);
    expect(initial.has('A')).toBe(true);
    const collapsed = withGroupCollapsed(initial, 'C', true);
    expect([...collapsed].sort()).toEqual(['A', 'C']);
  });

  it('ignores corrupt payloads', () => {
    fakeStorage.setItem(STORAGE_KEY, '{bad-json');
    expect(readCollapsedContactGroups().size).toBe(0);
    fakeStorage.setItem(STORAGE_KEY, JSON.stringify(['A', 4, null, 'B']));
    expect([...readCollapsedContactGroups()].sort()).toEqual(['A', 'B']);
  });
});
