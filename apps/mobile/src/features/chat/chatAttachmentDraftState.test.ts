// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { describe, expect, it } from 'vitest';

import {
  markChatAttachmentDraftsSubmitted,
  markSubmittedChatAttachmentDraftsFailed,
  patchChatAttachmentDraft,
  readyChatAttachmentStages,
} from './chatAttachmentDraftState';

function attachmentDraft(id: string) {
  return {
    id,
    file: { name: `${id}.png`, type: 'image/png', size: 4 },
    filename: `${id}.png`,
    mimeType: 'image/png',
    previewUrl: `blob:${id}`,
    attempt: 1,
    status: 'uploading',
  };
}

describe('Chat attachment draft state', () => {
  it('preserves a successful attachment when another staging attempt fails', () => {
    const first = attachmentDraft('first');
    const second = attachmentDraft('second');
    const firstStage = {
      stageId: 'stage-first',
      filename: first.filename,
      mimeType: first.mimeType,
      plaintextSize: 4,
      completed: true,
      maxChunkBytes: 1024,
    };

    const withReady = patchChatAttachmentDraft(
      [first, second],
      first.id,
      { status: 'ready', attachment: firstStage },
    );
    const withFailure = patchChatAttachmentDraft(
      withReady,
      second.id,
      { status: 'failed' },
    );

    expect(withFailure[0]).toMatchObject({
      id: 'first',
      status: 'ready',
      attachment: firstStage,
    });
    expect(withFailure[1]).toMatchObject({
      id: 'second',
      status: 'failed',
    });
    expect(readyChatAttachmentStages(withFailure)).toEqual([firstStage]);
  });

  it('keeps source files available for retry after a terminal send failure', () => {
    const source = attachmentDraft('first');
    const ready = patchChatAttachmentDraft([source], source.id, {
      status: 'ready',
      attachment: {
        stageId: 'plaintext-stage-id',
        filename: source.filename,
        mimeType: source.mimeType,
        plaintextSize: 4,
        completed: true,
        maxChunkBytes: 1024,
      },
    });
    const submitted = markChatAttachmentDraftsSubmitted(ready);
    const failed = markSubmittedChatAttachmentDraftsFailed(submitted);

    expect(submitted[0]).toMatchObject({
      status: 'submitted',
      attachment: undefined,
      file: source.file,
    });
    expect(failed[0]).toMatchObject({
      status: 'failed',
      file: source.file,
    });
  });
});
