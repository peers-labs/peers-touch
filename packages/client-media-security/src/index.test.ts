import { describe, expect, it } from 'vitest';

import {
  CLIENT_MEDIA_CHUNKED_ENCRYPTION_SUITE,
  CLIENT_MEDIA_CHUNKED_ENCRYPTION_VERSION,
  decryptClientMediaBlob,
  encryptClientMediaBlobChunked,
} from './index';

describe('client media chunked AEAD', () => {
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
});
