import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  Audience_Kind,
  AudienceSchema,
} from '../../gen/proto/domain/social/post_pb';
import {
  ComposerMediaError,
  PUBLIC_IMAGE_MAX_EDGE,
  decideComposerImageAttachments,
  scaleImageDimensions,
  shouldDownscaleImage,
  sniffImageMime,
} from './composerMediaDecision';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path.replace(/^\//, '')}`,
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const BMP = new Uint8Array([0x42, 0x4d, 0x10, 0x00]);
function heic(): Uint8Array {
  const bytes = new Uint8Array(12);
  bytes.set([0, 0, 0, 24], 0);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
  bytes.set([0x68, 0x65, 0x69, 0x63], 8); // heic
  return bytes;
}

describe('sniffImageMime', () => {
  it('recognizes supported magic signatures', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(GIF)).toBe('image/gif');
    expect(sniffImageMime(WEBP)).toBe('image/webp');
    expect(sniffImageMime(BMP)).toBe('image/bmp');
  });

  it('rejects HEIC containers without a transcoder', () => {
    expect(sniffImageMime(heic())).toBeNull();
  });

  it('rejects unknown signatures', () => {
    expect(sniffImageMime(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});

describe('public image downsample policy', () => {
  it('keeps small dimensions untouched', () => {
    expect(scaleImageDimensions(1024, 768, PUBLIC_IMAGE_MAX_EDGE)).toEqual({
      width: 1024,
      height: 768,
      scale: 1,
    });
  });

  it('scales the long edge to the cap while preserving aspect ratio', () => {
    const landscape = scaleImageDimensions(4032, 3024, PUBLIC_IMAGE_MAX_EDGE);
    expect(landscape.scale).toBeCloseTo(2048 / 4032, 5);
    expect(landscape.width).toBe(2048);
    expect(landscape.height).toBe(1536);

    const portrait = scaleImageDimensions(1000, 4000, PUBLIC_IMAGE_MAX_EDGE);
    expect(portrait.width).toBe(512);
    expect(portrait.height).toBe(2048);
  });

  it('never enlarges small images', () => {
    expect(scaleImageDimensions(100, 200, PUBLIC_IMAGE_MAX_EDGE).scale).toBe(1);
  });

  it('downsamples oversized still images but preserves GIF animation', () => {
    expect(shouldDownscaleImage('image/jpeg', 3000, 2000)).toBe(true);
    expect(shouldDownscaleImage('image/png', 2049, 100)).toBe(true);
    expect(shouldDownscaleImage('image/gif', 4000, 3000)).toBe(false);
    expect(shouldDownscaleImage('image/webp', 1024, 1024)).toBe(false);
  });
});

describe('decideComposerImageAttachments', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => PNG.buffer.slice(0),
      })),
    );
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never reaches OSS for private audiences', async () => {
    const uploader = vi.fn();
    const audience = create(AudienceSchema, { kind: Audience_Kind.FRIENDS });
    const result = await decideComposerImageAttachments({
      audience,
      files: [{ filePath: '/secret.png' }],
      uploader,
    });
    expect(result.kind).toBe('local-files');
    expect(uploader).not.toHaveBeenCalled();
  });

  it('uploads plaintext public attachments without encryption descriptors', async () => {
    const uploader = vi.fn(async () => ({
      cid: 'oss://station/p.png',
      mime_type: 'image/png',
      size: PNG.byteLength,
    }));
    const audience = create(AudienceSchema, { kind: Audience_Kind.PUBLIC });
    const result = await decideComposerImageAttachments({
      audience,
      files: [{ filePath: '/tmp/p.png' }],
      uploader,
    });
    expect(result.kind).toBe('public-attachments');
    expect(uploader).toHaveBeenCalledWith('/tmp/p.png');
    if (result.kind !== 'public-attachments') throw new Error('guard');
    expect(result.imageIds).toEqual(['oss://station/p.png']);
    expect(result.attachments[0]?.id).toBe('oss://station/p.png');
    expect((result.attachments[0] as Record<string, unknown>).mediaEncryption).toBeUndefined();
  });

  it('surfaces unsupported media as a typed error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => heic().buffer.slice(0),
      })),
    );
    const uploader = vi.fn();
    const audience = create(AudienceSchema, { kind: Audience_Kind.PUBLIC });
    await expect(decideComposerImageAttachments({
      audience,
      files: [{ filePath: '/tmp/p.heic' }],
      uploader,
    })).rejects.toBeInstanceOf(ComposerMediaError);
    expect(uploader).not.toHaveBeenCalled();
  });
});
