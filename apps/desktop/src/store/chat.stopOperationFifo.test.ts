import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../services/desktop_api';
import { useChatStore } from './chat';

const conversationId = 'conversation-fifo-stop';
const runningTurnId = 'turn-running';
const queuedTurnPlaceholder = 'assistant-queued';
const runningAssistant = 'assistant-running';

function runningOperation(abortController: AbortController) {
  return {
    id: 'operation-running',
    sessionKey: conversationId,
    type: 'sendMessage' as const,
    status: 'running' as const,
    runState: 'streaming' as const,
    assistantMessageId: runningAssistant,
    abortController,
    startedAt: 1,
    turnId: runningTurnId,
  };
}

function queuedOperation(abortController: AbortController) {
  return {
    id: 'operation-queued',
    sessionKey: conversationId,
    type: 'sendMessage' as const,
    status: 'running' as const,
    runState: 'queued' as never,
    assistantMessageId: queuedTurnPlaceholder,
    abortController,
    startedAt: 2,
    awaitingAdmission: false,
  };
}

describe('stopOperation with FIFO queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.getState().reset();
    useChatStore.setState({ currentSessionKey: conversationId });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().reset();
  });

  it('durably cancels the admitted running turn when the session key holds the queued successor', async () => {
    const cancelTurn = vi.spyOn(api, 'cancelAgentTurn').mockResolvedValueOnce({
      turn_id: runningTurnId,
      status: 'cancelled',
    });
    const runningAbort = new AbortController();
    const queuedAbort = new AbortController();

    // The unbound queued successor occupies the session key (inserted last),
    // while the admitted predecessor runs under a parallel key.
    useChatStore.setState({
      operations: {
        [`${conversationId}::parallel::operation-running`]: runningOperation(runningAbort),
        [conversationId]: queuedOperation(queuedAbort),
      },
    });

    useChatStore.getState().stopOperation(conversationId);

    await vi.waitFor(() => expect(cancelTurn).toHaveBeenCalledTimes(1));
    expect(cancelTurn).toHaveBeenCalledWith(runningTurnId);
    expect(runningAbort.signal.aborted).toBe(true);
    expect(queuedAbort.signal.aborted).toBe(false);
  });
});
