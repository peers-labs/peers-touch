/**
 * socialApiTypes.ts — Shared domain types and utilities for the social API surface.
 *
 * Extracted from the former socialApi.ts monolith during W8 gateway migration.
 * All gateway modules, stores, pages, and E2EE runtimes import shared types
 * from this module instead of the old monolithic API client.
 *
 * Contains:
 * - Chat attachment and conversation settings types
 * - Chat background constants and normalizer
 * - Moment draft types and post request builder
 * - Media upload utilities (chat attachments, moment images)
 */

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { encryptClientMediaBlob, encryptClientMediaBlobChunked, type ClientEncryptedMediaAsset } from '@peers-touch/client-media-security';

import type { MobileAuthSession } from '../auth/authSession';
import { EncryptedMediaDescriptorSchema } from '../../gen/proto/domain/common/common_pb';
import {
  Audience,
  CreateImagePostRequestSchema,
  CreatePostRequestSchema,
  CreateTextPostRequestSchema,
  ImageAttachmentSchema,
  PostType,
  type CreatePostRequest,
  type ImageAttachment,
  type Mention,
} from '../../gen/proto/domain/social/post_pb';
import { SocialApiError, readableErrorMessage } from './socialTypes';

// ---------------------------------------------------------------------------
// Chat attachment type (shared across friend and group chat)
// ---------------------------------------------------------------------------

export type ChatAttachmentInput = {
  cid: string;
  filename: string;
  mime_type: string;
  size: number;
  thumbnail_cid?: string;
  visibility?: string;
  encryption_suite?: string;
  encryption_key_b64?: string;
  encryption_nonce_b64?: string;
  plaintext_sha256_b64?: string;
  ciphertext_sha256_b64?: string;
  plaintext_size?: number;
  ciphertext_size?: number;
  chunking?: string;
  chunk_size?: number;
  chunk_count?: number;
  tag_size?: number;
  nonce_strategy?: string;
};

// ---------------------------------------------------------------------------
// Chat background constants and types
// ---------------------------------------------------------------------------

export const CHAT_BACKGROUND_OPTIONS = ['default', 'paper', 'mint', 'dusk', 'calm', 'graphite'] as const;
export type ChatBackgroundId = (typeof CHAT_BACKGROUND_OPTIONS)[number];

export function normalizeChatBackgroundId(value: unknown): ChatBackgroundId {
  if (typeof value === 'string' && (CHAT_BACKGROUND_OPTIONS as readonly string[]).includes(value)) {
    return value as ChatBackgroundId;
  }
  return 'default';
}

// ---------------------------------------------------------------------------
// Friend conversation settings
// ---------------------------------------------------------------------------

export interface FriendConversationSettings {
  sessionUlid: string;
  isMuted: boolean;
  isPinned: boolean;
  alertEnabled: boolean;
  background: ChatBackgroundId;
  clearedAt: number;
}

export interface UpdateFriendConversationSettingsInput {
  isMuted?: boolean;
  isPinned?: boolean;
  alertEnabled?: boolean;
  background?: ChatBackgroundId;
  clearedAt?: number;
}

// ---------------------------------------------------------------------------
// Moment draft types
// ---------------------------------------------------------------------------

interface MobileMomentDraftBase {
  audience: Audience;
  mentions?: Mention[];
  replyToPostId?: string;
}

export interface MobileTextMomentDraft extends MobileMomentDraftBase {
  kind: 'text';
  text: string;
}

export interface MobileImageMomentDraft extends MobileMomentDraftBase {
  kind: 'image';
  text: string;
  imageIds: string[];
  images?: ImageAttachment[];
}

export type MobileMomentDraft = MobileTextMomentDraft | MobileImageMomentDraft;

// ---------------------------------------------------------------------------
// Moment post request builder
// ---------------------------------------------------------------------------

export function buildMobileCreatePostRequest(draft: MobileMomentDraft): CreatePostRequest {
  const base = {
    audience: draft.audience,
    ...(draft.mentions?.length ? { mentions: draft.mentions } : {}),
    ...(draft.replyToPostId ? { replyToPostId: draft.replyToPostId } : {}),
  };

  switch (draft.kind) {
    case 'text':
      return create(CreatePostRequestSchema, {
        ...base,
        type: PostType.TEXT,
        content: {
          case: 'text',
          value: create(CreateTextPostRequestSchema, { text: draft.text }),
        },
      });
    case 'image': {
      const typedImages = draft.images ?? [];
      return create(CreatePostRequestSchema, {
        ...base,
        type: PostType.IMAGE,
        content: {
          case: 'image',
          value: create(CreateImagePostRequestSchema, {
            text: draft.text,
            imageIds: typedImages.length > 0 ? [] : draft.imageIds,
            images: typedImages,
          }),
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Media upload utilities
// ---------------------------------------------------------------------------

interface UploadedOssAttachment {
  key?: string;
  cid?: string;
  url?: string;
  size?: number;
  mime?: string;
  filename?: string;
}

export async function uploadMobileChatAttachment(
  session: MobileAuthSession,
  file: File,
  conversationId: string,
): Promise<ChatAttachmentInput> {
  const encrypted = await encryptClientMediaBlob(file);
  const uploaded = await uploadMobileEncryptedAttachment(session, file, encrypted, {
    bucket: 'chat',
    visibility: 'chat',
    chatSessionId: conversationId,
  });

  return {
    cid: String(uploaded.cid ?? ''),
    filename: String(uploaded.filename ?? file.name),
    mime_type: String(uploaded.mime ?? file.type ?? 'application/octet-stream'),
    size: file.size,
    thumbnail_cid: '',
    visibility: 'chat',
    encryption_suite: encrypted.descriptor.suite,
    encryption_key_b64: encrypted.descriptor.keyB64,
    encryption_nonce_b64: encrypted.descriptor.nonceB64,
    plaintext_sha256_b64: encrypted.descriptor.plaintextSha256B64,
    ciphertext_sha256_b64: encrypted.descriptor.ciphertextSha256B64,
    plaintext_size: encrypted.descriptor.plaintextSize,
    ciphertext_size: Number(uploaded.size ?? encrypted.descriptor.ciphertextSize),
    chunking: encrypted.descriptor.chunking,
    chunk_size: encrypted.descriptor.chunkSize,
    chunk_count: encrypted.descriptor.chunkCount,
    tag_size: encrypted.descriptor.tagSize,
    nonce_strategy: encrypted.descriptor.nonceStrategy,
  };
}

export async function uploadMobileMomentImage(
  session: MobileAuthSession,
  file: File,
): Promise<ImageAttachment> {
  const encrypted = await encryptClientMediaBlobChunked(file);
  const uploaded = await uploadMobileEncryptedAttachment(session, file, encrypted, {
    bucket: 'moments',
    visibility: 'public',
  });

  const cid = String(uploaded.cid ?? uploaded.url ?? '');
  if (!cid) {
    throw new SocialApiError({
      method: 'POST',
      path: '/sub-oss/upload',
      message: 'upload returned no cid',
    });
  }

  return create(ImageAttachmentSchema, {
    id: cid,
    url: cid,
    sizeBytes: BigInt(encrypted.descriptor.plaintextSize),
    mediaEncryption: create(EncryptedMediaDescriptorSchema, {
      encrypted: encrypted.descriptor.encrypted,
      version: encrypted.descriptor.version,
      suite: encrypted.descriptor.suite,
      keyB64: encrypted.descriptor.keyB64,
      nonceB64: encrypted.descriptor.nonceB64,
      plaintextSha256B64: encrypted.descriptor.plaintextSha256B64,
      ciphertextSha256B64: encrypted.descriptor.ciphertextSha256B64,
      plaintextSize: BigInt(encrypted.descriptor.plaintextSize),
      ciphertextSize: BigInt(Number(uploaded.size ?? encrypted.descriptor.ciphertextSize)),
      chunking: encrypted.descriptor.chunking ?? '',
      chunkSize: encrypted.descriptor.chunkSize ?? 0,
      chunkCount: encrypted.descriptor.chunkCount ?? 0,
      tagSize: encrypted.descriptor.tagSize ?? 0,
      nonceStrategy: encrypted.descriptor.nonceStrategy ?? '',
    }),
  });
}

async function uploadMobileEncryptedAttachment(
  session: MobileAuthSession,
  file: File,
  encrypted: ClientEncryptedMediaAsset,
  scope: { bucket: string; visibility: string; chatSessionId?: string },
): Promise<UploadedOssAttachment> {
  const stationUrl = session.stationUrl.replace(/\/+$/, '');
  const encryptedFile = new File([encrypted.encryptedBlob], file.name, { type: 'application/octet-stream' });
  const form = new FormData();
  form.set('file', encryptedFile, file.name);
  form.set('bucket', scope.bucket);
  form.set('visibility', scope.visibility);
  if (scope.chatSessionId) form.set('chat_session_id', scope.chatSessionId);

  let response: Response;
  try {
    response = await fetch(`${stationUrl}/sub-oss/upload`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: form,
    });
  } catch (error) {
    throw new SocialApiError({
      method: 'POST',
      path: '/sub-oss/upload',
      message: readableErrorMessage(error),
    });
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw buildUploadApiError(response.status, payload);
  }

  return payload as UploadedOssAttachment;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function buildUploadApiError(status: number, payload: unknown): SocialApiError {
  const envelope = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const message = String(envelope.message ?? envelope.msg ?? envelope.detail ?? 'upload_failed');
  return new SocialApiError({
    method: 'POST',
    path: '/sub-oss/upload',
    status,
    message: readableErrorMessage(message),
  });
}
