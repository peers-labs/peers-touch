import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const agentChatCache = vi.hoisted(() => ({
  getMessages: vi.fn(),
  syncConversation: vi.fn(),
  upsertMessage: vi.fn(),
}));

vi.mock('../storage/desktopAgentChatCache', () => ({
  getDesktopAgentChatCache: () => agentChatCache,
}));

import { useChatArtifactStore } from './chatArtifacts';
import { useChatStore } from './chat';

const conversationId = 'conversation-1';
const turnId = 'turn-1';
const terminal = { status: 'completed' as const };

describe('chat terminal artifact reconciliation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    agentChatCache.syncConversation.mockResolvedValue([]);
    agentChatCache.getMessages.mockResolvedValue([]);
    useChatStore.getState().reset();
    useChatStore.setState({ currentSessionKey: conversationId });
  });

  afterEach(() => {
    vi.useRealTimers();
    useChatStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('refreshes artifacts on terminal reconcile even without a matching local operation', async () => {
    // Recovery replay can close a turn after a transport handoff or surface
    // remount settled/rekeyed the local operation; the terminal Station fact
    // must still refresh the conversation artifact projection.
    const load = vi
      .spyOn(useChatArtifactStore.getState(), 'load')
      .mockResolvedValue([]);

    await useChatStore.getState().reconcileRecoveredTurn(
      conversationId,
      turnId,
      terminal,
    );

    expect(load).toHaveBeenCalledWith(conversationId);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('refreshes artifacts when the terminal reconcile owns the local operation', async () => {
    const load = vi
      .spyOn(useChatArtifactStore.getState(), 'load')
      .mockResolvedValue([]);
    useChatStore.setState({
      operations: {
        [conversationId]: {
          id: 'operation-1',
          sessionKey: conversationId,
          type: 'sendMessage',
          status: 'running',
          runState: 'streaming',
          assistantMessageId: 'assistant-1',
          abortController: new AbortController(),
          startedAt: 1,
          turnId,
        },
      },
    });

    await useChatStore.getState().reconcileRecoveredTurn(
      conversationId,
      turnId,
      terminal,
    );

    expect(load).toHaveBeenCalledWith(conversationId);
  });

  it('does not refresh artifacts for a non-terminal recovery reconcile', async () => {
    const load = vi
      .spyOn(useChatArtifactStore.getState(), 'load')
      .mockResolvedValue([]);

    await useChatStore.getState().reconcileRecoveredTurn(
      conversationId,
      turnId,
      null,
    );

    expect(load).not.toHaveBeenCalled();
  });
});
