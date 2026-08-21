import { describe, expect, it } from 'vitest';

import {
  MessagingSendOutcomeError,
  requireQueuedMessagingSendOutcome,
} from './socialChat';
import type { MessagingSendOutcome } from '../services/im-service-contract';

function outcome(
  state: MessagingSendOutcome['state'],
  attachmentIds = ['attachment-1'],
): MessagingSendOutcome {
  return {
    commandId: state === 'pending' ? 'command-1' : undefined,
    messageId: 'message-1',
    attachmentIds,
    attachmentCount: attachmentIds.length,
    state,
  };
}

describe('social chat send outcome boundary', () => {
  it('accepts only a count-conserving queued outcome', () => {
    expect(requireQueuedMessagingSendOutcome(outcome('pending'), 1)).toMatchObject({
      commandId: 'command-1',
      state: 'pending',
      attachmentCount: 1,
    });
  });

  it.each(['draft', 'attachment_failed'] as const)(
    'rejects %s before post-send success handling',
    (state) => {
      expect(() => requireQueuedMessagingSendOutcome(outcome(state), 1))
        .toThrowError(MessagingSendOutcomeError);
      try {
        requireQueuedMessagingSendOutcome(outcome(state), 1);
      } catch (error) {
        expect(error).toMatchObject({ code: 'not_queued', outcome: { state } });
      }
    },
  );

  it('rejects pending outcomes without a command identity', () => {
    expect(() => requireQueuedMessagingSendOutcome({
      ...outcome('pending'),
      commandId: undefined,
    }, 1)).toThrowError(expect.objectContaining({ code: 'missing_command_id' }));
  });

  it('rejects pending outcomes that violate attachment count conservation', () => {
    expect(() => requireQueuedMessagingSendOutcome(outcome('pending'), 2))
      .toThrowError(expect.objectContaining({ code: 'attachment_count_mismatch' }));
    expect(() => requireQueuedMessagingSendOutcome({
      ...outcome('pending'),
      attachmentCount: 2,
    }, 1)).toThrowError(expect.objectContaining({ code: 'attachment_count_mismatch' }));
  });
});
