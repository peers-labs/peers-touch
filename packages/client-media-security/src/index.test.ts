import { describe, expect, it, vi } from 'vitest';

import {
  CLIENT_MEDIA_CHUNKED_ENCRYPTION_SUITE,
  CLIENT_MEDIA_CHUNKED_ENCRYPTION_VERSION,
  decryptClientMediaBlob,
  encryptClientMediaBlobChunked,
} from './index';

describe('client media chunked AEAD', () => {
  it('matches the canonical fixed-material chunk vector', async () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const nonce = Uint8Array.from([
      0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0, 0, 0, 0,
    ]);
    let randomCall = 0;
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
      const target = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      target.set(randomCall === 0 ? key : nonce);
      randomCall += 1;
      return array;
    });
    const plaintext = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      const encrypted = await encryptClientMediaBlobChunked(
        new Blob([plaintext]),
        { chunkSize: 16 },
      );
      expect(await base64FromBlob(encrypted.encryptedBlob)).toBe(
        '/1vtrFQ0dS3eddGVgXg6uj17xV5Z6HbDhtG/3JbnXJ0ikUQwYUZ/ydqqqiV3kxGC1/KKGIryRnpvPTngbEB1OQ==',
      );
      expect(encrypted.descriptor.plaintextSha256B64).toBe(
        'riFsLvUkejeCwTXvonmj5M3GEJQnD10r5YxiBLemEsk=',
      );
      expect(encrypted.descriptor.ciphertextSha256B64).toBe(
        '7FB/S7H9iuHd/yXfZ6dtIshRBkClL1ro99d5x6eBoS8=',
      );
      expect(encrypted.descriptor.chunkCiphertextSha256B64).toEqual([
        'BKHAtIGDdq0kErwlk5kFUw9k7GysirnTLokd5IRV2pc=',
        'pfOgF7DA241aUKB+XCEH5WAmH54KKXO+oZrkewNyQuE=',
      ]);
    } finally {
      random.mockRestore();
    }
  });

  it('round-trips multiple independently authenticated chunks', async () => {
    const plaintext = new Uint8Array(1024 * 2 + 17);
    for (let i = 0; i < plaintext.byteLength; i += 1) plaintext[i] = i % 251;

    const encrypted = await encryptClientMediaBlobChunked(new Blob([plaintext]), { chunkSize: 1024 });
    expect(encrypted.descriptor.version).toBe(CLIENT_MEDIA_CHUNKED_ENCRYPTION_VERSION);
    expect(encrypted.descriptor.suite).toBe(CLIENT_MEDIA_CHUNKED_ENCRYPTION_SUITE);
    expect(encrypted.descriptor.chunkCount).toBe(3);

    const decrypted = await decryptClientMediaBlob({
      ciphertext: encrypted.encryptedBlob,
      descriptor: encrypted.descriptor,
    });
    expect(new Uint8Array(await decrypted.arrayBuffer())).toEqual(plaintext);
  });

  it('rejects a tampered chunk before returning plaintext', async () => {
    const plaintext = new Uint8Array(2048);
    plaintext.fill(7);
    const encrypted = await encryptClientMediaBlobChunked(new Blob([plaintext]), { chunkSize: 1024 });
    const tampered = new Uint8Array(await encrypted.encryptedBlob.arrayBuffer());
    tampered[10] ^= 0xff;

    await expect(decryptClientMediaBlob({
      ciphertext: tampered,
      descriptor: encrypted.descriptor,
    })).rejects.toThrow();
  });

  it('rejects a conflicting per-chunk commitment', async () => {
    const plaintext = new Uint8Array(2048);
    plaintext.fill(9);
    const encrypted = await encryptClientMediaBlobChunked(new Blob([plaintext]), { chunkSize: 1024 });

    await expect(decryptClientMediaBlob({
      ciphertext: encrypted.encryptedBlob,
      descriptor: {
        ...encrypted.descriptor,
        chunkCiphertextSha256B64: [
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          encrypted.descriptor.chunkCiphertextSha256B64?.[1] ?? '',
        ],
      },
    })).rejects.toThrow('client-media:chunk-hash-mismatch');
  });
});

async function base64FromBlob(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}
