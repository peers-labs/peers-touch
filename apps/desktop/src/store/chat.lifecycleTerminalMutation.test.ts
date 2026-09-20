import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../services/desktop_api';
import { useChatStore } from './chat';

const conversationId = 'conversation-1';
const turnId = 'turn-1';
const assistantMessage = {
  id: 'assistant-1',
  role: 'assistant' as const,
  content: 'Durable completed result',
  loading: false,
  timestamp: 1,
  turnId,
  terminalStatus: 'completed' as const,
};

function terminalMutationError() {
  return Object.assign(new Error('Agent turn cancel rejected'), {
    details: {
      error_code: 'LIFECYCLE_TERMINAL_MUTATION',
      locale_key: 'agent.errors.lifecycleTerminalMutation',
      retryable: 'false',
      terminal: 'true',
      resource_id: turnId,
      terminal_status: 'completed',
    },
  });
}

describe('chat lifecycle terminal-mutation recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.getState().reset();
    useChatStore.setState({
      currentSessionKey: conversationId,
      messages: [assistantMessage],
      sessionBuffers: {
        [conversationId]: [assistantMessage],
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().reset();
  });

  it('projects the strict terminal mutation onto the existing assistant result', async () => {
    vi.spyOn(api, 'cancelAgentTurn').mockRejectedValueOnce(
      terminalMutationError(),
    );

    await expect(
      useChatStore.getState().requestTurnCancellation(
        turnId,
        assistantMessage.id,
      ),
    ).resolves.toBeUndefined();

    const projected = useChatStore.getState().messages[0];
    expect(projected).toMatchObject({
      id: assistantMessage.id,
      content: assistantMessage.content,
      loading: false,
      turnId,
      terminalStatus: 'completed',
      error: 'agent.errors.lifecycleTerminalMutation',
      typedError: {
        error_type: 'LIFECYCLE_TERMINAL_MUTATION',
        locale_key: 'agent.errors.lifecycleTerminalMutation',
        retryable: false,
        terminal: true,
        details: {
          resource_id: turnId,
          terminal_status: 'completed',
        },
      },
      resolution: {
        type: 'openResult',
        resourceId: turnId,
        turnId,
        terminalStatus: 'completed',
        label: 'agent.recovery.openResult',
      },
    });
    expect(useChatStore.getState().sessionBuffers[conversationId]?.[0])
      .toEqual(projected);
  });

  it('does not project or swallow an unrelated cancellation failure', async () => {
    vi.spyOn(api, 'cancelAgentTurn').mockRejectedValueOnce(
      new Error('network unavailable'),
    );

    await expect(
      useChatStore.getState().requestTurnCancellation(turnId),
    ).rejects.toThrow('network unavailable');
    expect(useChatStore.getState().messages).toEqual([assistantMessage]);
  });

  it('submits semantic cancellation once from the store stop intent', async () => {
    const cancel = vi.spyOn(api, 'cancelAgentTurn').mockResolvedValueOnce({
      turn_id: turnId,
      status: 'cancelled',
    });
    const abortController = new AbortController();
    useChatStore.setState({
      operations: {
        [conversationId]: {
          id: 'operation-1',
          sessionKey: conversationId,
          type: 'sendMessage',
          status: 'running',
          runState: 'streaming',
          assistantMessageId: assistantMessage.id,
          abortController,
          startedAt: 1,
          turnId,
        },
      },
    });

    useChatStore.getState().stopOperation(conversationId);

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(cancel).toHaveBeenCalledWith(turnId);
    expect(abortController.signal.aborted).toBe(true);
  });
});
