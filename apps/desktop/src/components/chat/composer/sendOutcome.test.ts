import { describe, expect, it } from 'vitest';

import { didQueueExpectedChatAttachments } from './sendOutcome';

describe('chat composer send outcome', () => {
  const pendingRecord = {
    revision: 2,
    outcome: {
      commandId: 'command-1',
      messageId: 'message-1',
      attachmentIds: ['attachment-1', 'attachment-2'],
      attachmentCount: 2,
      state: 'pending' as const,
    },
  };

  it('releases attachment drafts only after a new count-conserving pending outcome', () => {
    expect(didQueueExpectedChatAttachments(1, 2, pendingRecord)).toBe(true);
  });

  it.each([
    ['unchanged outcome', 2, 2, pendingRecord],
    ['missing outcome', 1, 2, undefined],
    ['count mismatch', 1, 1, pendingRecord],
    ['ID mismatch', 1, 2, {
      ...pendingRecord,
      outcome: { ...pendingRecord.outcome, attachmentCount: 1 },
    }],
    ['deferred draft', 1, 2, {
      ...pendingRecord,
      outcome: { ...pendingRecord.outcome, commandId: undefined, state: 'draft' as const },
    }],
    ['attachment failure', 1, 2, {
      ...pendingRecord,
      outcome: {
        ...pendingRecord.outcome,
        commandId: undefined,
        state: 'attachment_failed' as const,
      },
    }],
  ])('retains attachment drafts for %s', (_label, previousRevision, expectedCount, record) => {
    expect(didQueueExpectedChatAttachments(previousRevision, expectedCount, record)).toBe(false);
  });
});
