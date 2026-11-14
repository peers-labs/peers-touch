// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { MobileDraftEnvelopeV2Schema } from '../../gen/proto/domain/mobile/reliability_pb';
import { buildChatDraftEnvelope, readChatDraftEnvelope, isChatComposerDraftEmpty } from './chatDraftEnvelope';
import { recoveredComposerDraft } from './composerRecoveryProjection';

describe('Mobile Chat draft persistence contract', () => {
  const pageSource = readFileSync(
    new URL('../../pages/ChatPage.tsx', import.meta.url),
    'utf8',
  );
  const envelopeSource = readFileSync(
    new URL('./chatDraftEnvelope.ts', import.meta.url),
    'utf8',
  );

  it('uses the generated exact-scope draft envelope and canonical conversation ID', () => {
    expect(envelopeSource).toMatch(/ChatDraftPayloadSchema/);
    expect(envelopeSource).toMatch(/MobileDraftSurfaceKind\.CHAT_COMPOSER/);
    expect(envelopeSource).toMatch(/targetId,/);
    expect(pageSource).toMatch(/buildChatDraftEnvelope/);
    expect(pageSource).toMatch(/draftPort\.save\(/);
    expect(pageSource).toMatch(/draftPort\.load\(/);
    expect(pageSource).toMatch(/draftPort\.remove\(/);
    expect(pageSource).not.toMatch(/payloadJson|JSON\.stringify\([^)]*draft/);
  });

  it('keeps source IDs separate from encrypted object references', () => {
    expect(envelopeSource).toMatch(/replyToMessageId:\s*draft\.replyToMessageId/);
    expect(envelopeSource).toMatch(
      /draft\.encryptedAttachmentRefs[\s\S]*EncryptedBlobReferenceSchema/,
    );
    expect(pageSource).toMatch(
      /encryptedAttachmentRefs:\s*encryptedAttachmentRefsRef\.current/,
    );
    expect(pageSource).not.toMatch(
      /encryptedAttachmentRefs:\s*attachmentDrafts|blobId:\s*.*stageId/,
    );
  });

  it('roundtrips unsent sources, thread context and a pending send through protobuf', () => {
    const draft = {
      text: 'Unsent text', replyToMessageId: 'reply', threadRootMessageId: 'thread',
      stagedAttachmentIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'],
      encryptedAttachmentRefs: ['encrypted-object'], pendingMessageId: 'pending',
    };
    const envelope = buildChatDraftEnvelope({ stationPeerId: 'station-a', actorPtid: 'alice' }, 'conversation-a', draft, 1234);
    const restored = readChatDraftEnvelope(fromBinary(MobileDraftEnvelopeV2Schema, toBinary(MobileDraftEnvelopeV2Schema, envelope)));
    expect(restored).toEqual({ ...draft, savedAtMs: 1234 });
    expect(isChatComposerDraftEmpty({ text: '', replyToMessageId: '', encryptedAttachmentRefs: [],
      stagedAttachmentIds: draft.stagedAttachmentIds })).toBe(false);
  });

  it('recovers completion before envelope save and adoption before envelope update', () => {
    const stage = { stageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', filename: 'proof.txt',
      mimeType: 'text/plain', plaintextSize: 6, contentKind: 1, durationMs: 0,
      completed: true, maxChunkBytes: 1024 };
    const completed = recoveredComposerDraft(null, { stages: [stage], adoptedMessage: null });
    expect(completed.stagedAttachmentIds).toEqual([stage.stageId]);
    expect(completed.encryptedAttachmentRefs).toEqual([]);
    const adopted = recoveredComposerDraft(completed, { stages: [], adoptedMessage: {
      messageId: 'native-send', plaintext: 'Actual submission', replyToMessageId: 'reply',
      threadRootMessageId: 'thread', attachmentIds: ['encrypted-object'],
    } });
    expect(adopted.pendingMessageId).toBe('native-send');
    expect(adopted.stagedAttachmentIds).toEqual([]);
    expect(adopted.encryptedAttachmentRefs).toEqual(['encrypted-object']);
    expect(adopted.text).toBe('Actual submission');
  });

  it('clears authoritative sends while restoring the unsent draft after an edit', () => {
    expect(pageSource).toMatch(
      /isAuthoritativeMessageProjection[\s\S]*accepted[\s\S]*delivered[\s\S]*read[\s\S]*committed/,
    );
    expect(pageSource).toMatch(
      /isAuthoritativeMessageProjection\([\s\S]*enqueueDraftPersistence\(activeConversationId,\s*\{[\s\S]*encryptedAttachmentRefs:\s*\[\]/,
    );
    expect(pageSource).toMatch(
      /restoreComposerAfterEdit[\s\S]*suspendedComposerRef\.current[\s\S]*enqueueDraftPersistence\(activeConversationId,\s*restored\)/,
    );
    expect(pageSource).not.toMatch(
      /function applySendOutcome[\s\S]*setDraft\(''\)/,
    );
  });
});
