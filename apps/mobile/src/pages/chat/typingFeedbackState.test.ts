import { describe, expect, it, vi } from 'vitest';

import {
  dispatchSenderTypingRequest,
  type SenderTypingRequest,
} from '../../features/chat/typingFeedbackState';

function request(attempt: number): SenderTypingRequest {
  return {
    attempt,
    conversationId: 'conversation-1',
    typing: true,
  };
}

describe('best-effort sender typing publication', () => {
  it('contains an ephemeral transport rejection without a composer feedback state', async () => {
    const transportError = new Error('transport unavailable');
    const dispatch = vi.fn().mockRejectedValue(transportError);
    const result = await dispatchSenderTypingRequest(request(1), dispatch);

    expect(dispatch).toHaveBeenCalledWith('conversation-1', true);
    expect(result).toEqual({
      ok: false,
      request: request(1),
      error: transportError,
    });
  });

  it('publishes the requested conversation and preserves the diagnostic result', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const result = await dispatchSenderTypingRequest(
      request(1),
      dispatch,
    );
    expect(dispatch).toHaveBeenCalledWith('conversation-1', true);
    expect(result).toEqual({ ok: true, request: request(1) });
  });
});
