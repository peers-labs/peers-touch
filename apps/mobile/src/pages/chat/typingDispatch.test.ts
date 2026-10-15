import { describe, expect, it, vi } from 'vitest';

import {
  dispatchSenderTypingRequest,
  type SenderTypingRequest,
} from '../../features/chat/typingDispatch';

function request(typing = true): SenderTypingRequest {
  return {
    conversationId: 'conversation-1',
    typing,
  };
}

describe('sender typing dispatch', () => {
  it('publishes typing pulses through the ephemeral transport', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);

    await expect(
      dispatchSenderTypingRequest(request(), dispatch),
    ).resolves.toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith('conversation-1', true);
  });

  it('swallows transport failures because typing is best-effort presence', async () => {
    const dispatch = vi.fn().mockRejectedValue(
      new Error('transport unavailable'),
    );

    await expect(
      dispatchSenderTypingRequest(request(), dispatch),
    ).resolves.toBeUndefined();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('publishes the stop pulse without requiring retry state', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);

    await dispatchSenderTypingRequest(
      request(false),
      dispatch,
    );

    expect(dispatch).toHaveBeenCalledWith('conversation-1', false);
  });
});
