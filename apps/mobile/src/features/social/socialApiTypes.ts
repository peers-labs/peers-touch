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
 */

import { create } from '@bufbuild/protobuf';

import {
  Audience,
  CreateImagePostRequestSchema,
  CreatePostRequestSchema,
  CreateTextPostRequestSchema,
  PostType,
  type CreatePostRequest,
  type ImageAttachment,
  type Mention,
} from '../../gen/proto/domain/social/post_pb';

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
