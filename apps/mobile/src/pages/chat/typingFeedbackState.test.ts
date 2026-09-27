import { describe, expect, it, vi } from 'vitest';

import {
  IDLE_SENDER_TYPING_FEEDBACK,
  beginSenderTypingFeedback,
  dispatchSenderTypingRequest,
  settleSenderTypingFeedback,
  type SenderTypingRequest,
} from '../../features/chat/typingFeedbackState';

function request(attempt: number): SenderTypingRequest {
  return {
    attempt,
    conversationId: 'conversation-1',
    typing: true,
  };
}

describe('sender typing feedback', () => {
  it('moves from waiting to failed without leaking the rejected dispatch', async () => {
    const transportError = new Error('transport unavailable');
    const dispatch = vi.fn().mockRejectedValue(transportError);
    const pending = beginSenderTypingFeedback(request(1), false);

    const result = await dispatchSenderTypingRequest(request(1), dispatch);
    const failed = settleSenderTypingFeedback(pending, result);

    expect(dispatch).toHaveBeenCalledWith('conversation-1', true);
    expect(result).toEqual({
      ok: false,
      request: request(1),
      error: transportError,
    });
    expect(failed).toEqual({
      phase: 'failed',
      request: request(1),
      error: transportError,
    });
  });

  it('exposes retrying and clears feedback only after retry succeeds', async () => {
    const failed = {
      phase: 'failed' as const,
      request: request(1),
      error: new Error('first attempt failed'),
    };
    const retryRequest = request(2);
    const retrying = beginSenderTypingFeedback(retryRequest, true);

    expect(retrying.phase).toBe('retrying');

    const result = await dispatchSenderTypingRequest(
      retryRequest,
      vi.fn().mockResolvedValue(undefined),
    );

    expect(settleSenderTypingFeedback(retrying, result)).toBe(
      IDLE_SENDER_TYPING_FEEDBACK,
    );
    expect(settleSenderTypingFeedback(failed, result)).toBe(failed);
  });

  it('does not let an older completion replace a newer waiting attempt', async () => {
    const newer = beginSenderTypingFeedback(request(2), false);
    const olderResult = await dispatchSenderTypingRequest(
      request(1),
      vi.fn().mockResolvedValue(undefined),
    );

    expect(settleSenderTypingFeedback(newer, olderResult)).toBe(newer);
  });
});
