// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { describe, expect, it } from 'vitest';

import {
  buildChatDraftEnvelope,
  isChatComposerDraftEmpty,
  readChatDraftEnvelope,
} from './chatDraftEnvelope';

describe('Chat draft generated contract', () => {
  it('round-trips reply context and existing encrypted attachment references', () => {
    const envelope = buildChatDraftEnvelope(
      {
        stationPeerId: 'station-1',
        actorPtid: 'ptid:alice',
      },
      'conversation-1',
      {
        text: 'Draft reply',
        replyToMessageId: 'message-parent',
        encryptedAttachmentRefs: [
          'attachment-encrypted-1',
          'attachment-encrypted-2',
          'attachment-encrypted-1',
        ],
      },
      1_700_000_000_000,
    );

    expect(envelope.payload.case).toBe('chat');
    expect(envelope.payload.value).toMatchObject({
      text: 'Draft reply',
      replyToMessageId: 'message-parent',
    });
    expect(
      envelope.payload.value.attachmentRefs.map((reference) => reference.blobId),
    ).toEqual(['attachment-encrypted-1', 'attachment-encrypted-2']);
    expect(readChatDraftEnvelope(envelope)).toEqual({
      text: 'Draft reply',
      replyToMessageId: 'message-parent',
      encryptedAttachmentRefs: [
        'attachment-encrypted-1',
        'attachment-encrypted-2',
      ],
      savedAtMs: 1_700_000_000_000,
    });
  });

  it('keeps reply-only and encrypted-reference-only drafts durable', () => {
    expect(isChatComposerDraftEmpty({
      text: '',
      replyToMessageId: 'message-parent',
      encryptedAttachmentRefs: [],
    })).toBe(false);
    expect(isChatComposerDraftEmpty({
      text: '',
      replyToMessageId: '',
      encryptedAttachmentRefs: ['attachment-encrypted-1'],
    })).toBe(false);
    expect(isChatComposerDraftEmpty({
      text: '',
      replyToMessageId: '',
      encryptedAttachmentRefs: [],
    })).toBe(true);
  });
});
