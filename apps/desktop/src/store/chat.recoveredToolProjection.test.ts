import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const agentChatCache = vi.hoisted(() => ({
  getMessages: vi.fn(),
  syncConversation: vi.fn(),
  upsertMessage: vi.fn(),
}));

vi.mock('../storage/desktopAgentChatCache', () => ({
  getDesktopAgentChatCache: () => agentChatCache,
}));

import { api } from '../services/desktop_api';
import { toolRuntime } from '../runtimes/toolRuntime';
import { useChatStore } from './chat';

const conversationId = 'conversation-1';
const turnId = 'turn-1';
const toolCallId = 'tool-call-1';

describe('recovered turn tool projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentChatCache.syncConversation.mockResolvedValue([]);
    agentChatCache.getMessages.mockResolvedValue([]);
    vi.spyOn(api, 'exportAgentTurnDiagnostics').mockResolvedValue({
      replay: { toolCalls: [] },
    } as never);
    useChatStore.getState().reset();
    toolRuntime.reset();
    useChatStore.setState({ currentSessionKey: conversationId });
  });

  afterEach(() => {
    useChatStore.getState().reset();
    toolRuntime.reset();
    vi.restoreAllMocks();
  });

  it('projects an approval card for tool events delivered on the recovery replay stream', () => {
    // Turns admitted from the FIFO queue are driven by the recovery replay
    // stream; their approval requests must reach the tool projection exactly
    // like live stream events, otherwise the decision card never mounts.
    useChatStore.getState().applyRecoveredTurnEvent(
      conversationId,
      'agent-1',
      turnId,
      {
        event: 'tool_approval_required',
        data: {
          toolCallId,
          turnId,
          toolName: 'local_file_edit',
          approvalId: 'approval-1',
          decisionId: 'decision-1',
          decisionRevision: 1,
        },
      },
    );

    const projection = toolRuntime.getProjection(toolCallId);
    expect(projection).toMatchObject({
      turnId,
      toolName: 'local_file_edit',
      status: 'approval_required',
      pending: true,
      approvalId: 'approval-1',
    });
  });
});
