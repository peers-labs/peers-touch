import { describe, expect, it, vi } from 'vitest';

import {
  ChatImageObjectUrlCache,
  chatImageRequiresDataUrl,
} from '@peers-touch/client-chat-core';

function makeFactory() {
  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;
  return {
    created,
    revoked,
    factory: {
      createObjectUrl: vi.fn((blob: Blob) => {
        const url = `blob:mock-${seq++}-${blob.size}`;
        created.push(url);
        return url;
      }),
      revokeObjectUrl: vi.fn((url: string) => {
        revoked.push(url);
      }),
    },
  };
}

function blob(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}

function fetcher(blobs: Map<string, Blob>) {
  return vi.fn(async (url: string) => {
    const value = blobs.get(url);
    if (!value) throw new Error('missing blob');
    return value;
  });
}

describe('chatImageRequiresDataUrl', () => {
  it('selects data URLs only on Android', () => {
    expect(chatImageRequiresDataUrl('Mozilla ... Android 14 ... Chrome')).toBe(true);
    expect(chatImageRequiresDataUrl('Mozilla ... iPhone OS ...')).toBe(false);
    expect(chatImageRequiresDataUrl('')).toBe(false);
  });
});

describe('ChatImageObjectUrlCache', () => {
  it('primes once and serves the same stable URL on later gets', async () => {
    const harness = makeFactory();
    const cache = new ChatImageObjectUrlCache(harness.factory);
    const sources = new Map([['asset-1', blob(100)]]);
    const fetchSpy = fetcher(sources);

    const first = await cache.prime('att-1', 'asset-1', fetchSpy, 'iPhone');
    const second = await cache.prime('att-1', 'asset-1', fetchSpy, 'iPhone');

    expect(first).toBe(second);
    expect(cache.get('att-1')).toBe(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(harness.factory.createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent primes for the same attachment', async () => {
    const harness = makeFactory();
    const cache = new ChatImageObjectUrlCache(harness.factory);
    const sources = new Map([['asset-1', blob(50)]]);
    const fetchSpy = fetcher(sources);

    const [a, b] = await Promise.all([
      cache.prime('att-1', 'asset-1', fetchSpy, 'iPhone'),
      cache.prime('att-1', 'asset-1', fetchSpy, 'iPhone'),
    ]);

    expect(a).toBe(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null and stays empty when the asset fetch fails', async () => {
    const harness = makeFactory();
    const cache = new ChatImageObjectUrlCache(harness.factory);
    const failing = vi.fn(async () => {
      throw new Error('network');
    });

    const result = await cache.prime('att-x', 'asset-x', failing, 'iPhone');

    expect(result).toBeNull();
    expect(cache.has('att-x')).toBe(false);
    expect(cache.get('att-x')).toBeNull();
  });

  it('evicts the oldest entry past the entry limit and revokes its URL', async () => {
    const harness = makeFactory();
    const cache = new ChatImageObjectUrlCache(harness.factory, 2, 10_000);
    const sources = new Map([
      ['a', blob(10)],
      ['b', blob(10)],
      ['c', blob(10)],
    ]);
    const fetchSpy = fetcher(sources);

    await cache.prime('a', 'a', fetchSpy, 'iPhone');
    await cache.prime('b', 'b', fetchSpy, 'iPhone');
    await cache.prime('c', 'c', fetchSpy, 'iPhone');

    expect(cache.size).toBe(2);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(harness.revoked).toHaveLength(1);
  });

  it('enforces the byte budget and releases revoked blob URLs', async () => {
    const harness = makeFactory();
    const cache = new ChatImageObjectUrlCache(harness.factory, 10, 100);
    const sources = new Map([
      ['big-1', blob(60)],
      ['big-2', blob(60)],
    ]);
    const fetchSpy = fetcher(sources);

    await cache.prime('big-1', 'big-1', fetchSpy, 'iPhone');
    await cache.prime('big-2', 'big-2', fetchSpy, 'iPhone');

    expect(cache.size).toBe(1);
    expect(cache.has('big-1')).toBe(false);
    expect(harness.revoked).toHaveLength(1);
  });

  it('uses data URLs on Android and does not revoke them', async () => {
    const harness = makeFactory();
    const readDataUrl = vi.fn(async () => 'data:image/jpeg;base64,AAAA');
    const cache = new ChatImageObjectUrlCache(harness.factory, 1, 10, readDataUrl);
    const sources = new Map([['droid', blob(10)]]);
    const fetchSpy = fetcher(sources);

    const url = await cache.prime(
      'droid',
      'droid',
      fetchSpy,
      'Mozilla Android 14',
    );

    expect(url?.startsWith('data:')).toBe(true);
    expect(readDataUrl).toHaveBeenCalledOnce();
    expect(harness.factory.createObjectUrl).not.toHaveBeenCalled();
    await cache.prime('other', 'droid', fetchSpy, 'Mozilla Android 14');
    expect(harness.revoked).toHaveLength(0);
  });
});
