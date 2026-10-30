// Composer media decision — the single owner of the Moment
// composer's audience-keyed media routing.
//
// The production MomentComposer AND the acceptance harness MUST go
// through this module: a harness that calls a plaintext uploader
// directly could pass while the real composer still routed PUBLIC
// images through the (now removed) encryption wrapper.
//
//   PUBLIC  → per-file magic sniff + real decode check + plaintext
//             `oss_upload_attachment_social`; the resulting ImageAttachment
//             never carries an encryption descriptor.
//   PRIVATE → no OSS upload at all; the local file intents are handed
//             to Secure Content, which owns encryption end to end.

import { create } from '@bufbuild/protobuf';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Audience_Kind,
  ImageAttachmentSchema,
  type Audience,
  type ImageAttachment,
} from '../../gen/proto/domain/social/post_pb';

export type ComposerMediaErrorCode =
  | 'IMAGE_TYPE_UNSUPPORTED'
  | 'IMAGE_NOT_DECODABLE'
  | 'IMAGE_EMPTY'
  | 'IMAGE_UPLOAD_FAILED';

export class ComposerMediaError extends Error {
  readonly code: ComposerMediaErrorCode;
  readonly filePath: string;

  constructor(code: ComposerMediaErrorCode, filePath: string, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = 'ComposerMediaError';
    this.code = code;
    this.filePath = filePath;
  }
}

export interface ComposerMediaInput {
  filePath: string;
  previewSrc?: string;
}

export interface ComposerPublicUpload {
  cid: string;
  mime_type?: string;
  size?: number;
}

export type ComposerPublicUploader = (
  filePath: string,
) => Promise<ComposerPublicUpload>;

/** MIME types the renderer can actually decode without native HEIC
 * transcoding support. The native picker is filtered to the same set. */
export const DECODABLE_IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
] as const;

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(bytes[start + i] ?? 0);
  }
  return out;
}

/** Sniff the real image type from file signature, never the extension. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12
    && ascii(bytes, 0, 4) === 'RIFF'
    && ascii(bytes, 8, 4) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  // ISO-BMFF containers (ftyp at offset 4). HEIC/HEIF brands are
  // rejected explicitly because this runtime has no transcoder.
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).replace(/\0/g, '').toLowerCase();
    if (HEIC_BRANDS.has(brand)) return null;
  }
  return null;
}

// All magic signatures the sniffer inspects live within the first
// 12 bytes; ISO-BMFF ftyp brand is at offset 8..12.
const MAGIC_HEADER_BYTES = 32;

/**
 * Read only the leading magic header — never the whole file — by
 * pulling a bounded number of bytes from the response stream and then
 * cancelling it. Large picked images therefore do not pay a full
 * arrayBuffer decode just to reject an unsupported type.
 */
async function readMagicHeader(filePath: string): Promise<Uint8Array> {
  const src = convertFileSrc(filePath);
  const response = await fetch(src, {
    cache: 'no-store',
    headers: { Range: `bytes=0-${MAGIC_HEADER_BYTES - 1}` },
  });
  if (!response.ok) {
    throw new ComposerMediaError('IMAGE_NOT_DECODABLE', filePath, `HTTP ${response.status}`);
  }
  if (response.body) {
    const reader = response.body.getReader();
    try {
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < MAGIC_HEADER_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
      }
      const header = concatChunks(chunks, Math.min(total, MAGIC_HEADER_BYTES));
      return header;
    } finally {
      // Stop the transfer as soon as the magic window is captured.
      await reader.cancel().catch(() => undefined);
    }
  }
  // Fallback for environments without streaming fetch.
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer.slice(0, MAGIC_HEADER_BYTES));
}

function concatChunks(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    const next = Math.min(chunk.byteLength, length - offset);
    if (next <= 0) break;
    out.set(chunk.subarray(0, next), offset);
    offset += next;
  }
  return out;
}

async function readPickedBytes(filePath: string): Promise<Uint8Array> {
  const src = convertFileSrc(filePath);
  const response = await fetch(src, { cache: 'no-store' });
  if (!response.ok) {
    throw new ComposerMediaError('IMAGE_NOT_DECODABLE', filePath, `HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function assertBrowserDecodes(
  bytes: Uint8Array,
  mime: string,
  filePath: string,
): Promise<void> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      if (bitmap.width > 0 && bitmap.height > 0) {
        bitmap.close();
        return;
      }
    } catch {
      // fall through to legacy path / failure
    }
  }
  if (typeof Image === 'undefined') {
    throw new ComposerMediaError('IMAGE_NOT_DECODABLE', filePath, 'no image decoder');
  }
  await new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve();
      } else {
        reject(new ComposerMediaError('IMAGE_NOT_DECODABLE', filePath, 'zero dimensions'));
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ComposerMediaError('IMAGE_NOT_DECODABLE', filePath, 'decode error'));
    };
    image.src = url;
  });
}

/** Validate one picked file: bounded magic-header sniff first,
 * full decoder verification only after the signature is accepted. */
export async function validatePickedImage(
  input: ComposerMediaInput,
): Promise<{ mimeType: string; size: number }> {
  const header = await readMagicHeader(input.filePath);
  if (header.length === 0) {
    throw new ComposerMediaError('IMAGE_EMPTY', input.filePath);
  }
  const mime = sniffImageMime(header);
  if (!mime) {
    throw new ComposerMediaError('IMAGE_TYPE_UNSUPPORTED', input.filePath);
  }
  // Decoder verification needs the complete image.
  const bytes = await readPickedBytes(input.filePath);
  await assertBrowserDecodes(bytes, mime, input.filePath);
  return { mimeType: mime, size: bytes.length };
}

/** Cheap preflight for pickers that only need the magic decision and
 * do not want a full decode (e.g. rejecting a multi-select batch). */
export async function sniffPickedImageMagic(
  input: ComposerMediaInput,
): Promise<string> {
  const header = await readMagicHeader(input.filePath);
  if (header.length === 0) {
    throw new ComposerMediaError('IMAGE_EMPTY', input.filePath);
  }
  const mime = sniffImageMime(header);
  if (!mime) {
    throw new ComposerMediaError('IMAGE_TYPE_UNSUPPORTED', input.filePath);
  }
  return mime;
}

export interface PublicComposerAttachments {
  kind: 'public-attachments';
  imageIds: string[];
  attachments: ImageAttachment[];
  /** Per-file ordered validation+upload results, including reused
   * pre-uploaded slots. */
  results: PublicComposerImage[];
}

export interface LocalComposerFiles {
  kind: 'local-files';
}

export interface PublicComposerImage {
  cid: string;
  attachment: ImageAttachment;
  mimeType: string;
  size: number;
}

/** Validate one picked image and upload it as a plaintext PUBLIC
 * object. Throws ComposerMediaError on unsupported type, decode
 * failure, or upload failure — the caller keeps the draft and may
 * retry the same slot. */
export async function uploadPublicComposerImage(
  input: ComposerMediaInput,
  uploader: ComposerPublicUploader,
): Promise<PublicComposerImage> {
  const { mimeType, size } = await validatePickedImage(input);
  let uploaded: ComposerPublicUpload;
  try {
    uploaded = await uploader(input.filePath);
  } catch (error) {
    throw new ComposerMediaError(
      'IMAGE_UPLOAD_FAILED',
      input.filePath,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!uploaded?.cid) {
    throw new ComposerMediaError('IMAGE_UPLOAD_FAILED', input.filePath, 'missing cid');
  }
  return {
    cid: uploaded.cid,
    mimeType: uploaded.mime_type ?? mimeType,
    size: uploaded.size ?? size,
    attachment: create(ImageAttachmentSchema, {
      id: uploaded.cid,
      url: uploaded.cid,
      sizeBytes: BigInt(uploaded.size ?? size),
    }),
  };
}

/**
 * Execute the real composer media decision for a frozen audience.
 * PRIVATE audiences never reach OSS; PUBLIC audiences upload every
 * validated file through the injected (production: plaintext) uploader.
 *
 * `preuploaded` lets the optimistic composer UI reuse slots it already
 * uploaded through this same module instead of re-uploading them at
 * publish time. Both the production MomentComposer and the acceptance
 * harness must converge here so a routing regression cannot hide in a
 * harness-only path.
 */
export async function decideComposerImageAttachments(options: {
  audience: Audience;
  files: ComposerMediaInput[];
  uploader: ComposerPublicUploader;
  preuploaded?: ReadonlyMap<string, PublicComposerImage>;
}): Promise<PublicComposerAttachments | LocalComposerFiles> {
  const { audience, files, uploader, preuploaded } = options;
  const isPrivate = audience.kind !== Audience_Kind.PUBLIC
    && audience.kind !== Audience_Kind.KIND_UNSPECIFIED;
  if (isPrivate) {
    // Secure Content owns encryption + upload for private audiences;
    // the composer keeps local file intents only.
    return { kind: 'local-files' };
  }

  const attachments: ImageAttachment[] = [];
  const imageIds: string[] = [];
  const results: PublicComposerImage[] = [];
  for (const file of files) {
    const cached = preuploaded?.get(file.filePath);
    const result = cached
      ?? await uploadPublicComposerImage(file, uploader);
    results.push(result);
    imageIds.push(result.cid);
    attachments.push(result.attachment);
  }
  return { kind: 'public-attachments', imageIds, attachments, results };
}

/**
 * Validate picked files before they enter a draft so an unsupported
 * type is rejected at the picker stage with a retryable draft state.
 */
export async function validatePickedImages(
  files: ComposerMediaInput[],
): Promise<Array<{ filePath: string; mimeType: string; size: number }>> {
  return Promise.all(files.map(async (file) => {
    const validated = await validatePickedImage(file);
    return { filePath: file.filePath, ...validated };
  }));
}
