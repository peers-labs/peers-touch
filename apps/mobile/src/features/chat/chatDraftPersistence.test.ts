// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

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

  it('persists reply context and encrypted refs without persisting plaintext stage IDs', () => {
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

  it('deletes persisted state only after an authoritative projection or edit submission', () => {
    expect(pageSource).toMatch(
      /isAuthoritativeMessageProjection[\s\S]*accepted[\s\S]*delivered[\s\S]*read[\s\S]*committed/,
    );
    expect(pageSource).toMatch(
      /isAuthoritativeMessageProjection\([\s\S]*enqueueDraftPersistence\(activeConversationId,\s*\{[\s\S]*encryptedAttachmentRefs:\s*\[\]/,
    );
    expect(pageSource).toMatch(
      /clearComposerDraftAfterEdit[\s\S]*enqueueDraftPersistence\(activeConversationId,\s*\{[\s\S]*encryptedAttachmentRefs:\s*\[\]/,
    );
    expect(pageSource).not.toMatch(
      /function applySendOutcome[\s\S]*setDraft\(''\)/,
    );
  });
});
