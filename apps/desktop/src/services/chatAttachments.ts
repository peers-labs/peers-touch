import {
  api,
  type ChatAttachmentInput,
  type OssAttachmentUploaded,
  type SocialEncryptedAttachmentUploaded,
  type SocialEncryptedMediaDescriptorWire,
} from './desktop_api';
import type { ChatAttachmentVisibility } from '@peers-touch/client-chat-core';
import { encryptClientMediaBlobChunked } from '@peers-touch/client-media-security';
import { registerOssAttachmentObjectUrl } from './ossAttachmentUrlCache';

export interface ChatAttachmentScope {
  conversationId: string;
  bucket?: string;
  visibility?: ChatAttachmentVisibility;
}

export interface ChatAttachmentSource {
  filename: string;
  mimeType: string;
  size: number;
  bytes: number[];
  localBlob?: Blob;
}

const DEFAULT_BUCKET = 'chat';
const DEFAULT_VISIBILITY: ChatAttachmentVisibility = 'chat';

function descriptorFromWire(wire: SocialEncryptedMediaDescriptorWire) {
  return {
    encrypted: true as const,
    version: wire.version as 1 | 2,
    suite: wire.suite as 'AES-256-GCM' | 'AES-256-GCM-CHUNKED',
    keyB64: wire.key_b64,
    nonceB64: wire.nonce_b64,
    plaintextSha256B64: wire.plaintext_sha256_b64,
    ciphertextSha256B64: wire.ciphertext_sha256_b64,
    plaintextSize: wire.plaintext_size,
    ciphertextSize: wire.ciphertext_size,
    chunking: wire.chunking,
    chunkSize: wire.chunk_size,
    chunkCount: wire.chunk_count,
    tagSize: wire.tag_size,
    nonceStrategy: wire.nonce_strategy,
  };
}

export async function fileToChatAttachmentSource(file: File): Promise<ChatAttachmentSource> {
  const buffer = await file.arrayBuffer();
  return {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    bytes: Array.from(new Uint8Array(buffer)),
    localBlob: file,
  };
}

export function uploadedToChatAttachment(
  uploaded: OssAttachmentUploaded,
  source?: ChatAttachmentSource,
  encryption?: Awaited<ReturnType<typeof encryptClientMediaBlobChunked>>['descriptor'],
): ChatAttachmentInput {
  return {
    cid: uploaded.cid,
    filename: source?.filename ?? uploaded.filename,
    mime_type: source?.mimeType ?? uploaded.mime_type,
    size: source?.size ?? uploaded.size,
    thumbnail_cid: '',
    visibility: uploaded.visibility ?? DEFAULT_VISIBILITY,
    ...(encryption ? {
      encryption_suite: encryption.suite,
      encryption_key_b64: encryption.keyB64,
      encryption_nonce_b64: encryption.nonceB64,
      plaintext_sha256_b64: encryption.plaintextSha256B64,
      ciphertext_sha256_b64: encryption.ciphertextSha256B64,
      plaintext_size: encryption.plaintextSize,
      ciphertext_size: Number(uploaded.size || encryption.ciphertextSize),
      chunking: encryption.chunking,
      chunk_size: encryption.chunkSize,
      chunk_count: encryption.chunkCount,
      tag_size: encryption.tagSize,
      nonce_strategy: encryption.nonceStrategy,
    } : {}),
  };
}

export function encryptedUploadedToChatAttachment(
  uploaded: SocialEncryptedAttachmentUploaded,
): ChatAttachmentInput {
  return uploadedToChatAttachment(uploaded, undefined, descriptorFromWire(uploaded.media_encryption));
}

export async function uploadChatAttachmentSource(
  scope: ChatAttachmentScope,
  source: ChatAttachmentSource,
): Promise<ChatAttachmentInput> {
  const plaintextBlob = source.localBlob
    ?? new Blob([new Uint8Array(source.bytes)], { type: source.mimeType || 'application/octet-stream' });
  const encrypted = await encryptClientMediaBlobChunked(plaintextBlob);
  const encryptedBytes = Array.from(new Uint8Array(await encrypted.encryptedBlob.arrayBuffer()));
  const uploaded = await api.ossUploadAttachmentBytesChat({
    filename: source.filename,
    mime_type: 'application/octet-stream',
    bytes: encryptedBytes,
    bucket: scope.bucket ?? DEFAULT_BUCKET,
    visibility: scope.visibility ?? DEFAULT_VISIBILITY,
    chat_session_id: scope.conversationId,
  });
  registerOssAttachmentObjectUrl(uploaded.cid, encrypted.encryptedBlob);
  return uploadedToChatAttachment(uploaded, source, encrypted.descriptor);
}

export async function uploadChatAttachmentFile(
  scope: ChatAttachmentScope,
  file: File,
): Promise<ChatAttachmentInput> {
  return uploadChatAttachmentSource(scope, await fileToChatAttachmentSource(file));
}

export async function uploadChatAttachmentPath(
  scope: ChatAttachmentScope,
  filePath: string,
): Promise<ChatAttachmentInput> {
  const uploaded = await api.ossUploadEncryptedAttachmentChat({
    file_path: filePath,
    bucket: scope.bucket ?? DEFAULT_BUCKET,
    visibility: scope.visibility ?? DEFAULT_VISIBILITY,
    chat_session_id: scope.conversationId,
  });
  return encryptedUploadedToChatAttachment(uploaded);
}

export async function captureChatScreenshot(
  scope: ChatAttachmentScope,
): Promise<ChatAttachmentInput> {
  const uploaded = await api.ossCaptureScreenshotChat({
    bucket: scope.bucket ?? DEFAULT_BUCKET,
    visibility: scope.visibility ?? DEFAULT_VISIBILITY,
    chat_session_id: scope.conversationId,
  });
  return uploadedToChatAttachment(uploaded);
}
