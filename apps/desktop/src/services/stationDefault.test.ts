import { describe, expect, it } from "vitest";
import {
  type KVStorage,
  hasUserChosenStation,
  markStationUserChoice,
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

describe("station explicit choice marker", () => {
  it("is unset until an explicit user action", () => {
    const storage = new MemoryStorage();
    expect(hasUserChosenStation(storage)).toBe(false);
  });

  it("records an explicit choice permanently", () => {
    const storage = new MemoryStorage();
    markStationUserChoice(storage);
    expect(hasUserChosenStation(storage)).toBe(true);
  });

  it("treats missing storage as no choice", () => {
    expect(hasUserChosenStation(null)).toBe(false);
  });
});
