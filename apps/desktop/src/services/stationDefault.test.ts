import { describe, expect, it } from "vitest";
import {
  type KVStorage,
  hasUserChosenStation,
  loadStationAutoDefault,
  markStationUserChoice,
  shouldAutoApplyDefault,
  storeStationAutoDefault,
} from "./stationDefault";

class MemoryStorage implements KVStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("station default auto-apply policy", () => {
  it("allows a fresh profile to auto-apply once", () => {
    const storage = new MemoryStorage();
    expect(shouldAutoApplyDefault("relay-cn-1", storage)).toBe(true);
    storeStationAutoDefault("relay-cn-1", storage);
    expect(shouldAutoApplyDefault("relay-cn-1", storage)).toBe(false);
    expect(loadStationAutoDefault(storage)?.seedId).toBe("relay-cn-1");
  });

  it("allows a changed cloud seed exactly once more", () => {
    const storage = new MemoryStorage();
    storeStationAutoDefault("relay-old", storage);
    expect(shouldAutoApplyDefault("relay-new", storage)).toBe(true);
  });

  it("never auto-applies after an explicit user choice", () => {
    const storage = new MemoryStorage();
    markStationUserChoice(storage);
    expect(hasUserChosenStation(storage)).toBe(true);
    expect(shouldAutoApplyDefault("relay-cn-1", storage)).toBe(false);
  });

  it("rejects empty seed ids and missing storage", () => {
    const storage = new MemoryStorage();
    expect(shouldAutoApplyDefault(null, storage)).toBe(false);
    expect(shouldAutoApplyDefault(undefined, storage)).toBe(false);
    expect(shouldAutoApplyDefault("", storage)).toBe(false);
    expect(hasUserChosenStation(null)).toBe(false);
    expect(loadStationAutoDefault(null)).toBeNull();
  });
});
