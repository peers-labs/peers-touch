/**
 * socialApiTypes.ts — Shared domain types and utilities for the social API surface.
 *
 * Extracted from the former socialApi.ts monolith during W8 gateway migration.
 * All gateway modules, stores, and pages import shared types from this module
 * instead of the old monolithic API client.
 *
 * Contains:
 * - Chat conversation settings types
 * - Chat background constants and normalizer
 * - Moment draft types and post request builder
 * - Moment media upload utilities
 */

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { encryptClientMediaBlobChunked, type ClientEncryptedMediaAsset } from '@peers-touch/client-media-security';

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
