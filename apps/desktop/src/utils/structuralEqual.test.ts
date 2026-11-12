import { describe, expect, it } from 'vitest';
import { structuralEqual } from './structuralEqual';

describe('structuralEqual', () => {
  it('compares primitives including bigint with Object.is semantics', () => {
    expect(structuralEqual(1, 1)).toBe(true);
    expect(structuralEqual(1n, 1n)).toBe(true);
    expect(structuralEqual(1n, 2n)).toBe(false);
    expect(structuralEqual('a', 'a')).toBe(true);
    expect(structuralEqual(true, true)).toBe(true);
    expect(structuralEqual(null, null)).toBe(true);
    expect(structuralEqual(0, -0)).toBe(false);
    expect(structuralEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(structuralEqual('a', 1)).toBe(false);
    expect(structuralEqual(null, {})).toBe(false);
  });

  it('compares arrays by position and length', () => {
    expect(structuralEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(structuralEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(structuralEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(structuralEqual([{ a: 1n }], [{ a: 1n }])).toBe(true);
    expect(structuralEqual([], [])).toBe(true);
  });

  it('compares nested objects regardless of key order', () => {
    const left = { a: 1, b: { c: 2n, d: [1, 2] } };
    const right = { b: { d: [1, 2], c: 2n }, a: 1 };
    expect(structuralEqual(left, right)).toBe(true);
    expect(structuralEqual(left, { a: 1, b: { c: 3n, d: [1, 2] } })).toBe(false);
    expect(structuralEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('treats an explicit undefined member as equivalent to an absent key', () => {
    expect(structuralEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(structuralEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(structuralEqual({ a: undefined }, {})).toBe(true);
  });

  it('distinguishes an array from an object and handles null', () => {
    expect(structuralEqual([], {})).toBe(false);
    expect(structuralEqual({}, [])).toBe(false);
    expect(structuralEqual({ a: null }, { a: null })).toBe(true);
    expect(structuralEqual({ a: null }, { a: undefined })).toBe(false);
  });
});
