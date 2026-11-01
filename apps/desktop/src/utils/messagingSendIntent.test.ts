import { describe, expect, it } from 'vitest';

import { newSendIntentId } from './messagingSendIntent';

describe('send-intent ULID', () => {
  it('mints canonical 26-char Crockford Base32 ids', () => {
    for (let index = 0; index < 100; index += 1) {
      const id = newSendIntentId();
      expect(id).toHaveLength(26);
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it('produces distinct ids for distinct send actions', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSendIntentId()));
    expect(ids.size).toBe(50);
  });

  it('encodes the current millisecond timestamp in the leading chars', () => {
    const now = Date.now();
    const id = newSendIntentId();
    // Decode the 10-char Crockford prefix back to milliseconds.
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let decoded = 0;
    for (const char of id.slice(0, 10)) {
      decoded = decoded * 32 + alphabet.indexOf(char);
    }
    expect(Math.abs(decoded - now)).toBeLessThan(1000);
  });
});
