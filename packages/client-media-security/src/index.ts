export const CLIENT_MEDIA_ENCRYPTION_VERSION = 1;
export const CLIENT_MEDIA_ENCRYPTION_SUITE = 'AES-256-GCM' as const;
export const CLIENT_MEDIA_CHUNKED_ENCRYPTION_VERSION = 2;
export const CLIENT_MEDIA_CHUNKED_ENCRYPTION_SUITE = 'AES-256-GCM-CHUNKED' as const;
export const CLIENT_MEDIA_CHUNKING_FIXED_V1 = 'fixed-v1' as const;
export const CLIENT_MEDIA_NONCE_STRATEGY_COUNTER32_BE = 'prefix-counter32-be' as const;

export interface ClientMediaEncryptionDescriptor {
  readonly encrypted: true;
  readonly version: typeof CLIENT_MEDIA_ENCRYPTION_VERSION | typeof CLIENT_MEDIA_CHUNKED_ENCRYPTION_VERSION;
  readonly suite: typeof CLIENT_MEDIA_ENCRYPTION_SUITE | typeof CLIENT_MEDIA_CHUNKED_ENCRYPTION_SUITE;
  readonly keyB64: string;
  readonly nonceB64: string;
  readonly plaintextSha256B64: string;
  readonly ciphertextSha256B64: string;
  readonly plaintextSize: number;
  readonly ciphertextSize: number;
  readonly chunking?: string;
  readonly chunkSize?: number;
  readonly chunkCount?: number;
  readonly tagSize?: number;
  readonly nonceStrategy?: string;
}

export interface ClientEncryptedMediaAsset {
  readonly encryptedBlob: Blob;
  readonly descriptor: ClientMediaEncryptionDescriptor;
}

export interface ClientMediaEncryptionProgress {
  readonly phase: 'read' | 'encrypt' | 'hash' | 'done';
  readonly loaded: number;
  readonly total: number;
}

export interface ClientMediaEncryptionOptions {
  readonly chunkSize?: number;
  readonly onProgress?: (progress: ClientMediaEncryptionProgress) => void;
}

export interface ClientMediaDecryptInput {
  readonly ciphertext: Blob | ArrayBuffer | Uint8Array;
  readonly descriptor?: Partial<ClientMediaEncryptionDescriptor> | null;
  readonly mimeType?: string;
}

type ClientMediaEncryptionDescriptorLike = Omit<Partial<ClientMediaEncryptionDescriptor>, 'encrypted' | 'version' | 'suite' | 'plaintextSize' | 'ciphertextSize'> & {
  readonly encrypted?: boolean;
  readonly version?: number;
  readonly suite?: string;
  readonly plaintextSize?: number | string | bigint;
  readonly ciphertextSize?: number | string | bigint;
};

const AES_GCM_KEY_BITS = 256;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const MAX_CHUNK_COUNT = 0xffffffff;

export async function encryptClientMediaBlob(
  blob: Blob,
  options: ClientMediaEncryptionOptions = {},
): Promise<ClientEncryptedMediaAsset> {
  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
  options.onProgress?.({ phase: 'read', loaded: 0, total: blob.size });
  if (blob.size > chunkSize) {
    await drainBlobForProgress(blob, chunkSize, (loaded) => {
      options.onProgress?.({ phase: 'read', loaded, total: blob.size });
    });
  }
  const plaintext = new Uint8Array(await blob.arrayBuffer());
  options.onProgress?.({ phase: 'read', loaded: plaintext.byteLength, total: plaintext.byteLength });
  const keyBytes = crypto.getRandomValues(new Uint8Array(AES_GCM_KEY_BITS / 8));
  const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
  const key = await crypto.subtle.importKey('raw', arrayBufferFromBytes(keyBytes), { name: 'AES-GCM' }, false, ['encrypt']);
  options.onProgress?.({ phase: 'encrypt', loaded: 0, total: plaintext.byteLength });
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBufferFromBytes(nonce) }, key, arrayBufferFromBytes(plaintext));
  const ciphertext = new Uint8Array(ciphertextBuffer);
  options.onProgress?.({ phase: 'encrypt', loaded: plaintext.byteLength, total: plaintext.byteLength });
  options.onProgress?.({ phase: 'hash', loaded: 0, total: plaintext.byteLength + ciphertext.byteLength });
  const plaintextSha256B64 = base64FromBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', arrayBufferFromBytes(plaintext))));
  const ciphertextSha256B64 = base64FromBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', arrayBufferFromBytes(ciphertext))));
  options.onProgress?.({ phase: 'hash', loaded: plaintext.byteLength + ciphertext.byteLength, total: plaintext.byteLength + ciphertext.byteLength });

  const asset: ClientEncryptedMediaAsset = {
    encryptedBlob: new Blob([arrayBufferFromBytes(ciphertext)], { type: 'application/octet-stream' }),
    descriptor: {
      encrypted: true,
      version: CLIENT_MEDIA_ENCRYPTION_VERSION,
      suite: CLIENT_MEDIA_ENCRYPTION_SUITE,
      keyB64: base64FromBytes(keyBytes),
      nonceB64: base64FromBytes(nonce),
      plaintextSha256B64,
      ciphertextSha256B64,
      plaintextSize: plaintext.byteLength,
      ciphertextSize: ciphertext.byteLength,
    },
  };
  options.onProgress?.({ phase: 'done', loaded: plaintext.byteLength, total: plaintext.byteLength });
  return asset;
}

export async function encryptClientMediaBlobChunked(
  blob: Blob,
  options: ClientMediaEncryptionOptions = {},
): Promise<ClientEncryptedMediaAsset> {
  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const chunkCount = Math.max(1, Math.ceil(blob.size / chunkSize));
  if (chunkCount > MAX_CHUNK_COUNT) throw new Error('client-media:chunk-count-exceeded');

  const keyBytes = crypto.getRandomValues(new Uint8Array(AES_GCM_KEY_BITS / 8));
  const noncePrefix = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
  noncePrefix.set([0, 0, 0, 0], AES_GCM_NONCE_BYTES - 4);
  const key = await crypto.subtle.importKey('raw', arrayBufferFromBytes(keyBytes), { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintextHash = new Sha256();
  const ciphertextHash = new Sha256();
  const encryptedParts: BlobPart[] = [];
  let loaded = 0;
  let ciphertextSize = 0;

  options.onProgress?.({ phase: 'encrypt', loaded: 0, total: blob.size });
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const offset = chunkIndex * chunkSize;
    const plaintext = new Uint8Array(await blob.slice(offset, Math.min(offset + chunkSize, blob.size)).arrayBuffer());
    plaintextHash.update(plaintext);
    const nonce = nonceForChunk(noncePrefix, chunkIndex);
    const aad = aadForChunk(chunkIndex, blob.size, chunkSize);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: arrayBufferFromBytes(nonce), additionalData: arrayBufferFromBytes(aad), tagLength: AES_GCM_TAG_BYTES * 8 },
      key,
      arrayBufferFromBytes(plaintext),
    ));
    ciphertextHash.update(ciphertext);
    encryptedParts.push(arrayBufferFromBytes(ciphertext));
    ciphertextSize += ciphertext.byteLength;
    loaded += plaintext.byteLength;
    options.onProgress?.({ phase: 'encrypt', loaded, total: blob.size });
  }

  const descriptor: ClientMediaEncryptionDescriptor = {
    encrypted: true,
    version: CLIENT_MEDIA_CHUNKED_ENCRYPTION_VERSION,
    suite: CLIENT_MEDIA_CHUNKED_ENCRYPTION_SUITE,
    keyB64: base64FromBytes(keyBytes),
    nonceB64: base64FromBytes(noncePrefix),
    plaintextSha256B64: base64FromBytes(plaintextHash.digest()),
    ciphertextSha256B64: base64FromBytes(ciphertextHash.digest()),
    plaintextSize: blob.size,
    ciphertextSize,
    chunking: CLIENT_MEDIA_CHUNKING_FIXED_V1,
    chunkSize,
    chunkCount,
    tagSize: AES_GCM_TAG_BYTES,
    nonceStrategy: CLIENT_MEDIA_NONCE_STRATEGY_COUNTER32_BE,
  };
  options.onProgress?.({ phase: 'done', loaded: blob.size, total: blob.size });
  return { encryptedBlob: new Blob(encryptedParts, { type: 'application/octet-stream' }), descriptor };
}

export async function decryptClientMediaBlob({
  ciphertext,
  descriptor,
  mimeType = 'application/octet-stream',
}: ClientMediaDecryptInput): Promise<Blob> {
  if (!isClientMediaEncryptionDescriptor(descriptor)) {
    return ciphertext instanceof Blob ? ciphertext : new Blob([arrayBufferFromBytes(await bytesFromCiphertext(ciphertext))], { type: mimeType });
  }

  const ciphertextBytes = await bytesFromCiphertext(ciphertext);
  const expectedCiphertextHash = descriptor.ciphertextSha256B64;
  const actualCiphertextHash = base64FromBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', arrayBufferFromBytes(ciphertextBytes))));
  if (actualCiphertextHash !== expectedCiphertextHash) throw new Error('client-media:ciphertext-hash-mismatch');

  const key = await crypto.subtle.importKey(
    'raw',
    arrayBufferFromBytes(bytesFromBase64(descriptor.keyB64)),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  if (isChunkedDescriptor(descriptor)) {
    const plaintextParts: BlobPart[] = [];
    const plaintextHash = new Sha256();
    let ciphertextOffset = 0;
    for (let chunkIndex = 0; chunkIndex < descriptor.chunkCount; chunkIndex += 1) {
      const plaintextRemaining = descriptor.plaintextSize - chunkIndex * descriptor.chunkSize;
      const plaintextChunkSize = Math.min(descriptor.chunkSize, Math.max(0, plaintextRemaining));
      const ciphertextChunkSize = plaintextChunkSize + descriptor.tagSize;
      const ciphertextChunk = ciphertextBytes.subarray(ciphertextOffset, ciphertextOffset + ciphertextChunkSize);
      if (ciphertextChunk.byteLength !== ciphertextChunkSize) throw new Error('client-media:chunk-size-mismatch');
      const plaintextBuffer = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: arrayBufferFromBytes(nonceForChunk(bytesFromBase64(descriptor.nonceB64), chunkIndex)),
          additionalData: arrayBufferFromBytes(aadForChunk(chunkIndex, descriptor.plaintextSize, descriptor.chunkSize)),
          tagLength: descriptor.tagSize * 8,
        },
        key,
        arrayBufferFromBytes(ciphertextChunk),
      );
      const plaintext = new Uint8Array(plaintextBuffer);
      plaintextHash.update(plaintext);
      plaintextParts.push(arrayBufferFromBytes(plaintext));
      ciphertextOffset += ciphertextChunkSize;
    }
    if (ciphertextOffset !== ciphertextBytes.byteLength) throw new Error('client-media:ciphertext-size-mismatch');
    if (base64FromBytes(plaintextHash.digest()) !== descriptor.plaintextSha256B64) throw new Error('client-media:plaintext-hash-mismatch');
    return new Blob(plaintextParts, { type: mimeType });
  }

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: arrayBufferFromBytes(bytesFromBase64(descriptor.nonceB64)) },
    key,
    arrayBufferFromBytes(ciphertextBytes),
  );
  const plaintext = new Uint8Array(plaintextBuffer);
  const expectedPlaintextHash = descriptor.plaintextSha256B64;
  const actualPlaintextHash = base64FromBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', arrayBufferFromBytes(plaintext))));
  if (actualPlaintextHash !== expectedPlaintextHash) throw new Error('client-media:plaintext-hash-mismatch');

  return new Blob([arrayBufferFromBytes(plaintext)], { type: mimeType });
}

export function isClientMediaEncryptionDescriptor(
  descriptor: Partial<ClientMediaEncryptionDescriptor> | null | undefined,
): descriptor is ClientMediaEncryptionDescriptor {
  return Boolean(
    descriptor?.encrypted === true
      && (
        (descriptor.version === CLIENT_MEDIA_ENCRYPTION_VERSION && descriptor.suite === CLIENT_MEDIA_ENCRYPTION_SUITE)
        || (descriptor.version === CLIENT_MEDIA_CHUNKED_ENCRYPTION_VERSION && descriptor.suite === CLIENT_MEDIA_CHUNKED_ENCRYPTION_SUITE)
      )
      && descriptor.keyB64
      && descriptor.nonceB64
      && descriptor.plaintextSha256B64
      && descriptor.ciphertextSha256B64,
  );
}

function isChunkedDescriptor(descriptor: ClientMediaEncryptionDescriptor): descriptor is ClientMediaEncryptionDescriptor & {
  readonly version: typeof CLIENT_MEDIA_CHUNKED_ENCRYPTION_VERSION;
  readonly suite: typeof CLIENT_MEDIA_CHUNKED_ENCRYPTION_SUITE;
  readonly chunking: typeof CLIENT_MEDIA_CHUNKING_FIXED_V1;
  readonly chunkSize: number;
  readonly chunkCount: number;
  readonly tagSize: number;
  readonly nonceStrategy: typeof CLIENT_MEDIA_NONCE_STRATEGY_COUNTER32_BE;
} {
  const { chunkSize, chunkCount, tagSize } = descriptor;
  return descriptor.version === CLIENT_MEDIA_CHUNKED_ENCRYPTION_VERSION
    && descriptor.suite === CLIENT_MEDIA_CHUNKED_ENCRYPTION_SUITE
    && descriptor.chunking === CLIENT_MEDIA_CHUNKING_FIXED_V1
    && descriptor.nonceStrategy === CLIENT_MEDIA_NONCE_STRATEGY_COUNTER32_BE
    && chunkSize !== undefined
    && Number.isSafeInteger(chunkSize)
    && chunkSize > 0
    && chunkCount !== undefined
    && Number.isSafeInteger(chunkCount)
    && chunkCount > 0
    && tagSize === AES_GCM_TAG_BYTES;
}

export function clientMediaEncryptionDescriptorFromAttachment(
  attachment: {
    readonly mediaEncryption?: ClientMediaEncryptionDescriptorLike | null;
    readonly media_encryption?: ClientMediaEncryptionDescriptorLike | null;
    readonly encryptionSuite?: string;
    readonly encryption_suite?: string;
    readonly encryptionKeyB64?: string;
    readonly encryption_key_b64?: string;
    readonly encryptionNonceB64?: string;
    readonly encryption_nonce_b64?: string;
    readonly plaintextSha256B64?: string;
    readonly plaintext_sha256_b64?: string;
    readonly ciphertextSha256B64?: string;
    readonly ciphertext_sha256_b64?: string;
    readonly plaintextSize?: number | string | bigint;
    readonly plaintext_size?: number | string | bigint;
    readonly ciphertextSize?: number | string | bigint;
    readonly ciphertext_size?: number | string | bigint;
    readonly chunking?: string;
    readonly chunkSize?: number | string | bigint;
    readonly chunk_size?: number | string | bigint;
    readonly chunkCount?: number | string | bigint;
    readonly chunk_count?: number | string | bigint;
    readonly tagSize?: number | string | bigint;
    readonly tag_size?: number | string | bigint;
    readonly nonceStrategy?: string;
    readonly nonce_strategy?: string;
  },
  keyB64Override?: string,
): ClientMediaEncryptionDescriptor | null {
  const normalizedKeyOverride = keyB64Override?.trim() || undefined;
  const embeddedBase = normalizeDescriptor(attachment.mediaEncryption ?? attachment.media_encryption);
  const embedded = embeddedBase && normalizedKeyOverride && !embeddedBase.keyB64
    ? { ...embeddedBase, keyB64: normalizedKeyOverride }
    : embeddedBase;
  if (isClientMediaEncryptionDescriptor(embedded)) return embedded;
  const descriptor = normalizeDescriptor({
    encrypted: true,
    version: CLIENT_MEDIA_ENCRYPTION_VERSION,
    suite: (attachment.encryptionSuite ?? attachment.encryption_suite) as typeof CLIENT_MEDIA_ENCRYPTION_SUITE | undefined,
    keyB64: normalizedKeyOverride ?? attachment.encryptionKeyB64 ?? attachment.encryption_key_b64,
    nonceB64: attachment.encryptionNonceB64 ?? attachment.encryption_nonce_b64,
    plaintextSha256B64: attachment.plaintextSha256B64 ?? attachment.plaintext_sha256_b64,
    ciphertextSha256B64: attachment.ciphertextSha256B64 ?? attachment.ciphertext_sha256_b64,
    plaintextSize: numberFromDescriptorValue(attachment.plaintextSize ?? attachment.plaintext_size),
    ciphertextSize: numberFromDescriptorValue(attachment.ciphertextSize ?? attachment.ciphertext_size),
    chunking: attachment.chunking,
    chunkSize: numberFromDescriptorValue(attachment.chunkSize ?? attachment.chunk_size),
    chunkCount: numberFromDescriptorValue(attachment.chunkCount ?? attachment.chunk_count),
    tagSize: numberFromDescriptorValue(attachment.tagSize ?? attachment.tag_size),
    nonceStrategy: attachment.nonceStrategy ?? attachment.nonce_strategy,
  });
  return isClientMediaEncryptionDescriptor(descriptor) ? descriptor : null;
}

async function bytesFromCiphertext(ciphertext: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (ciphertext instanceof Uint8Array) return ciphertext;
  if (ciphertext instanceof ArrayBuffer) return new Uint8Array(ciphertext);
  return new Uint8Array(await ciphertext.arrayBuffer());
}

async function drainBlobForProgress(
  blob: Blob,
  chunkSize: number,
  onProgress: (loaded: number) => void,
): Promise<void> {
  let loaded = 0;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const chunk = blob.slice(offset, Math.min(offset + chunkSize, blob.size));
    loaded += (await chunk.arrayBuffer()).byteLength;
    onProgress(loaded);
  }
}

function normalizeDescriptor(
  descriptor: ClientMediaEncryptionDescriptorLike | null | undefined,
): Partial<ClientMediaEncryptionDescriptor> | null {
  if (!descriptor) return null;
  return {
    encrypted: descriptor.encrypted === true ? true : undefined,
    version: Number(descriptor.version) as typeof CLIENT_MEDIA_ENCRYPTION_VERSION,
    suite: descriptor.suite as typeof CLIENT_MEDIA_ENCRYPTION_SUITE,
    keyB64: descriptor.keyB64,
    nonceB64: descriptor.nonceB64,
    plaintextSha256B64: descriptor.plaintextSha256B64,
    ciphertextSha256B64: descriptor.ciphertextSha256B64,
    plaintextSize: numberFromDescriptorValue(descriptor.plaintextSize),
    ciphertextSize: numberFromDescriptorValue(descriptor.ciphertextSize),
    chunking: descriptor.chunking,
    chunkSize: numberFromDescriptorValue(descriptor.chunkSize),
    chunkCount: numberFromDescriptorValue(descriptor.chunkCount),
    tagSize: numberFromDescriptorValue(descriptor.tagSize),
    nonceStrategy: descriptor.nonceStrategy,
  };
}

function numberFromDescriptorValue(value: number | string | bigint | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim()) return Number(value);
  return 0;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function nonceForChunk(baseNonce: Uint8Array, chunkIndex: number): Uint8Array {
  if (baseNonce.byteLength !== AES_GCM_NONCE_BYTES) throw new Error('client-media:invalid-nonce');
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > MAX_CHUNK_COUNT) {
    throw new Error('client-media:invalid-chunk-index');
  }
  const nonce = new Uint8Array(baseNonce);
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  view.setUint32(AES_GCM_NONCE_BYTES - 4, chunkIndex, false);
  return nonce;
}

function aadForChunk(chunkIndex: number, plaintextSize: number, chunkSize: number): Uint8Array {
  return new TextEncoder().encode(`peers-touch-media:v2:${chunkIndex}:${plaintextSize}:${chunkSize}`);
}

class Sha256 {
  private h0 = 0x6a09e667;
  private h1 = 0xbb67ae85;
  private h2 = 0x3c6ef372;
  private h3 = 0xa54ff53a;
  private h4 = 0x510e527f;
  private h5 = 0x9b05688c;
  private h6 = 0x1f83d9ab;
  private h7 = 0x5be0cd19;
  private readonly buffer = new Uint8Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;
  private finished = false;

  update(data: Uint8Array): void {
    if (this.finished) throw new Error('client-media:hash-finalized');
    let position = 0;
    this.bytesHashed += data.byteLength;
    while (position < data.byteLength) {
      const take = Math.min(data.byteLength - position, 64 - this.bufferLength);
      this.buffer.set(data.subarray(position, position + take), this.bufferLength);
      this.bufferLength += take;
      position += take;
      if (this.bufferLength === 64) {
        this.processBlock(this.buffer);
        this.bufferLength = 0;
      }
    }
  }

  digest(): Uint8Array {
    if (!this.finished) {
      const bitLength = this.bytesHashed * 8;
      this.buffer[this.bufferLength] = 0x80;
      this.bufferLength += 1;
      if (this.bufferLength > 56) {
        this.buffer.fill(0, this.bufferLength, 64);
        this.processBlock(this.buffer);
        this.bufferLength = 0;
      }
      this.buffer.fill(0, this.bufferLength, 56);
      const view = new DataView(this.buffer.buffer);
      view.setUint32(56, Math.floor(bitLength / 0x100000000), false);
      view.setUint32(60, bitLength >>> 0, false);
      this.processBlock(this.buffer);
      this.finished = true;
    }
    const out = new Uint8Array(32);
    const view = new DataView(out.buffer);
    [this.h0, this.h1, this.h2, this.h3, this.h4, this.h5, this.h6, this.h7]
      .forEach((word, index) => view.setUint32(index * 4, word >>> 0, false));
    return out;
  }

  private processBlock(chunk: Uint8Array): void {
    const w = new Uint32Array(64);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    let e = this.h4;
    let f = this.h5;
    let g = this.h6;
    let h = this.h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
    this.h5 = (this.h5 + f) >>> 0;
    this.h6 = (this.h6 + g) >>> 0;
    this.h7 = (this.h7 + h) >>> 0;
  }
}

function rotr(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
