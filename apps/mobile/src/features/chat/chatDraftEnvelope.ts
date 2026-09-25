import { create } from '@bufbuild/protobuf';
import { timestampFromMs, timestampMs } from '@bufbuild/protobuf/wkt';

import {
  ChatDraftPayloadSchema,
  EncryptedBlobReferenceSchema,
  MobileDraftEnvelopeV2Schema,
  MobileDraftSurfaceKind,
  type MobileDraftEnvelopeV2,
} from '../../gen/proto/domain/mobile/reliability_pb';

export interface ChatDraftScope {
  readonly stationPeerId: string;
  readonly actorPtid: string;
}

export interface ChatComposerDraft {
  readonly text: string;
  readonly replyToMessageId: string;
  readonly encryptedAttachmentRefs: readonly string[];
}

export interface RestoredChatComposerDraft extends ChatComposerDraft {
  readonly savedAtMs: number;
}

export function buildChatDraftEnvelope(
  scope: ChatDraftScope,
  targetId: string,
  draft: ChatComposerDraft,
  savedAtMs: number,
): MobileDraftEnvelopeV2 {
  return create(MobileDraftEnvelopeV2Schema, {
    schemaRevision: 2,
    stationPeerId: scope.stationPeerId,
    actorPtid: scope.actorPtid,
    surfaceKind: MobileDraftSurfaceKind.CHAT_COMPOSER,
    targetId,
    updatedAt: timestampFromMs(savedAtMs),
    payload: {
      case: 'chat',
      value: create(ChatDraftPayloadSchema, {
        text: draft.text,
        replyToMessageId: draft.replyToMessageId,
        attachmentRefs: normalizeEncryptedAttachmentRefs(
          draft.encryptedAttachmentRefs,
        ).map((blobId) => create(EncryptedBlobReferenceSchema, { blobId })),
      }),
    },
  });
}

export function readChatDraftEnvelope(
  envelope: MobileDraftEnvelopeV2,
): RestoredChatComposerDraft | null {
  if (envelope.payload.case !== 'chat') return null;
  return {
    text: envelope.payload.value.text,
    replyToMessageId: envelope.payload.value.replyToMessageId,
    encryptedAttachmentRefs: normalizeEncryptedAttachmentRefs(
      envelope.payload.value.attachmentRefs.map((reference) => reference.blobId),
    ),
    savedAtMs: envelope.updatedAt ? timestampMs(envelope.updatedAt) : 0,
  };
}

export function isChatComposerDraftEmpty(draft: ChatComposerDraft): boolean {
  return !draft.text
    && !draft.replyToMessageId
    && draft.encryptedAttachmentRefs.length === 0;
}

export function normalizeEncryptedAttachmentRefs(
  references: readonly string[],
): string[] {
  return [...new Set(references.filter((reference) => (
    Boolean(reference) && reference.trim() === reference
  )))];
}
