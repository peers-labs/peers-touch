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

// Client-side downsampling for PUBLIC photos: long edge at most this many
// pixels, re-encoded as baseline JPEG at this quality. Private (Secure
// Content) images are never transcoded — the original file is preserved.
export const PUBLIC_IMAGE_MAX_EDGE = 2048;
export const PUBLIC_IMAGE_JPEG_QUALITY = 0.85;

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

export type PreparedPublicImageUpload =
  | { kind: 'path'; filePath: string }
  | { kind: 'bytes'; filename: string; mime: string; bytes: Uint8Array };

export interface PreparedPublicImage {
  upload: PreparedPublicImageUpload;
  /** Detected MIME of the SOURCE file (upload echo wins when present). */
  sourceMime: string;
  /** Source file size in bytes. */
  sourceSize: number;
}

/** Pure dimension math for the downsample decision. */
export function scaleImageDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number; scale: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest <= 0) {
    return { width, height, scale: 1 };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** GIF keeps animation (canvas re-encode would drop it); other formats
 * downsample whenever the long edge exceeds the cap. */
export function shouldDownscaleImage(mime: string, width: number, height: number): boolean {
  return mime !== 'image/gif'
    && Math.max(width, height) > PUBLIC_IMAGE_MAX_EDGE;
}

function jpegFilenameFromPath(filePath: string): string {
  const basename = filePath.split(/[\\/]/).pop() ?? 'image';
  const stem = basename.replace(/\.[^.]+$/, '');
  return `${stem || 'image'}.jpg`;
}

async function encodeResizedJpeg(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({
      type: 'image/jpeg',
      quality: PUBLIC_IMAGE_JPEG_QUALITY,
    });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('jpeg encode failed'))),
      'image/jpeg',
      PUBLIC_IMAGE_JPEG_QUALITY,
    );
  });
}

/**
 * Validate one picked file and prepare it for the PUBLIC upload path:
 * oversized still images are downsampled to ≤2048px long edge and
 * re-encoded as JPEG 0.85; small files and GIFs keep their original path.
 */
export async function preparePublicComposerImage(
  input: ComposerMediaInput,
): Promise<PreparedPublicImage> {
  const header = await readMagicHeader(input.filePath);
  if (header.length === 0) {
    throw new ComposerMediaError('IMAGE_EMPTY', input.filePath);
  }
  const mime = sniffImageMime(header);
  if (!mime) {
    throw new ComposerMediaError('IMAGE_TYPE_UNSUPPORTED', input.filePath);
  }
  if (mime === 'image/gif') {
    return {
      upload: { kind: 'path', filePath: input.filePath },
      sourceMime: mime,
      sourceSize: 0,
    };
  }
  const bytes = await readPickedBytes(input.filePath);
  await assertBrowserDecodes(bytes, mime, input.filePath);
  const sourceBlob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    if (!shouldDownscaleImage(mime, bitmap.width, bitmap.height)) {
      return {
        upload: { kind: 'path', filePath: input.filePath },
        sourceMime: mime,
        sourceSize: bytes.length,
      };
    }
    const target = scaleImageDimensions(
      bitmap.width,
      bitmap.height,
      PUBLIC_IMAGE_MAX_EDGE,
    );
    const encoded = await encodeResizedJpeg(bitmap, target.width, target.height);
    const buffer = await encoded.arrayBuffer();
    return {
      upload: {
        kind: 'bytes',
        filename: jpegFilenameFromPath(input.filePath),
        mime: 'image/jpeg',
        bytes: new Uint8Array(buffer),
      },
      sourceMime: mime,
      sourceSize: bytes.length,
    };
  } finally {
    bitmap.close();
  }
}

export type ComposerSocialBytesUploader = (input: {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}) => Promise<ComposerPublicUpload>;

function mapPublicUpload(
  input: ComposerMediaInput,
  prepared: PreparedPublicImage,
  uploaded: ComposerPublicUpload,
): PublicComposerImage {
  if (!uploaded?.cid) {
    throw new ComposerMediaError('IMAGE_UPLOAD_FAILED', input.filePath, 'missing cid');
  }
  const encodedSize = prepared.upload.kind === 'bytes'
    ? prepared.upload.bytes.byteLength
    : prepared.sourceSize;
  const mime = uploaded.mime_type
    ?? (prepared.upload.kind === 'bytes' ? prepared.upload.mime : prepared.sourceMime);
  const size = uploaded.size ?? encodedSize;
  return {
    cid: uploaded.cid,
    mimeType: mime,
    size,
    attachment: create(ImageAttachmentSchema, {
      id: uploaded.cid,
      url: uploaded.cid,
      sizeBytes: BigInt(size),
    }),
  };
}

/** Validate, downsample when needed, and upload one PUBLIC image. */
export async function uploadPreparedPublicImage(
  input: ComposerMediaInput,
  uploaders: {
    uploadPath: ComposerPublicUploader;
    uploadBytes?: ComposerSocialBytesUploader;
  },
): Promise<PublicComposerImage> {
  const prepared = await preparePublicComposerImage(input);
  let uploaded: ComposerPublicUpload;
  try {
    if (prepared.upload.kind === 'bytes') {
      if (!uploaders.uploadBytes) {
        throw new ComposerMediaError(
          'IMAGE_UPLOAD_FAILED',
          input.filePath,
          'bytes uploader unavailable',
        );
      }
      uploaded = await uploaders.uploadBytes({
        filename: prepared.upload.filename,
        mime: prepared.upload.mime,
        bytes: prepared.upload.bytes,
      });
    } else {
      uploaded = await uploaders.uploadPath(prepared.upload.filePath);
    }
  } catch (error) {
    throw new ComposerMediaError(
      'IMAGE_UPLOAD_FAILED',
      input.filePath,
      error instanceof Error ? error.message : String(error),
    );
  }
  return mapPublicUpload(input, prepared, uploaded);
}

/**
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
  /** Renderer-re-encoded (downsampled) upload path; optional for
   * harness callers that only exercise the path flow. */
  bytesUploader?: ComposerSocialBytesUploader;
  preuploaded?: ReadonlyMap<string, PublicComposerImage>;
}): Promise<PublicComposerAttachments | LocalComposerFiles> {
  const { audience, files, uploader, bytesUploader, preuploaded } = options;
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
      ?? await uploadPreparedPublicImage(file, {
        uploadPath: uploader,
        uploadBytes: bytesUploader,
      });
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
