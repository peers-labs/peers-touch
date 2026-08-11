import { encryptClientMediaBlobChunked } from '@peers-touch/client-media-security';

import {
  api,
  type ChatAttachmentInput,
  type OssAttachmentUploaded,
} from './desktop_api';
import { registerOssAttachmentObjectUrl } from './ossAttachmentUrlCache';

export interface AgentAttachmentScope {
  conversationId: string;
}

function uploadedToAgentAttachment(
  uploaded: OssAttachmentUploaded,
  file: File,
  encryption: Awaited<ReturnType<typeof encryptClientMediaBlobChunked>>['descriptor'],
): ChatAttachmentInput {
  return {
    cid: uploaded.cid,
    filename: file.name || uploaded.filename,
    mime_type: file.type || uploaded.mime_type || 'application/octet-stream',
    size: file.size || uploaded.size,
    thumbnail_cid: '',
    visibility: uploaded.visibility ?? 'private',
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
  };
}

export async function uploadAgentAttachmentFile(
  scope: AgentAttachmentScope,
  file: File,
): Promise<ChatAttachmentInput> {
  const encrypted = await encryptClientMediaBlobChunked(file);
  const uploaded = await api.ossUploadAgentAttachmentBytes({
    filename: file.name,
    mime_type: 'application/octet-stream',
    bytes: Array.from(new Uint8Array(await encrypted.encryptedBlob.arrayBuffer())),
    bucket: 'agent',
    visibility: 'private',
    chat_session_id: scope.conversationId,
  });
  registerOssAttachmentObjectUrl(uploaded.cid, encrypted.encryptedBlob);
  return uploadedToAgentAttachment(uploaded, file, encrypted.descriptor);
}
