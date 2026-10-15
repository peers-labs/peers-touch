import { afterEach, describe, expect, it, vi } from 'vitest';

import { secureRandomUuid } from './randomIdentity';

describe('secureRandomUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the platform UUID implementation when available', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    vi.stubGlobal('crypto', { randomUUID });

    expect(secureRandomUuid('identity-unavailable'))
      .toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('creates an RFC 4122 v4 UUID from getRandomValues on older WebKit', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set([
          0x00, 0x11, 0x22, 0x33,
          0x44, 0x55,
          0x66, 0x77,
          0x88, 0x99,
          0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
        ]);
        return bytes;
      },
    });

    expect(secureRandomUuid('identity-unavailable'))
      .toBe('00112233-4455-4677-8899-aabbccddeeff');
  });

  it('fails when the device has no secure random source', () => {
    vi.stubGlobal('crypto', undefined);

    expect(() => secureRandomUuid('identity-unavailable'))
      .toThrow('identity-unavailable');
  });
});
