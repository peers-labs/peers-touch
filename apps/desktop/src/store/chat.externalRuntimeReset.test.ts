import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CachedAgentMessage } from '@peers-touch/client-chat-core';
import { api, type AgentConversation, type Session } from '../services/desktop_api';

const agentChatCache = vi.hoisted(() => ({
  clearConversation: vi.fn(),
  getMessages: vi.fn(),
  getTurnEvents: vi.fn(),
  listConversations: vi.fn(),
  refreshConversation: vi.fn(),
  syncConversation: vi.fn(),
  upsertMessage: vi.fn(),
}));

vi.mock('../storage/desktopAgentChatCache', () => ({
  getDesktopAgentChatCache: () => agentChatCache,
}));

import { useChatStore } from './chat';

const conversationId = 'conversation-1';
const projectedSession: Session = {
  id: conversationId,
  key: conversationId,
  agent_name: 'agent-1',
  title: 'External runtime',
  message_count: 2,
  version: 4,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

function conversation(
  version: number,
  state: number,
  epoch: number,
  sessionId: string,
): AgentConversation {
  return {
    conversation_id: conversationId,
    agent_id: 'agent-1',
    ptid: 'ptid:person:owner',
    title: 'External runtime',
    provider_id: 'external-agent',
    model_name: 'external-agent',
    status: 'active',
    active_branch_message_id: 'assistant-1',
    queued_turn_count: 0,
    version,
    runtime_binding: {
      runtime_kind: 2,
      provider_id: 'external-agent',
      model_id: 'external-agent',
      runtime_profile_id: 'external-agent',
      external_session_id: sessionId,
      external_session_epoch: epoch,
      runtime_home_ref: `runtime-home-${epoch}`,
      capability_snapshot_hash: '',
      config_snapshot_hash: '',
      bound_at: null,
      state,
      last_error_code: state === 2 ? 'RUNTIME_RESUME_UNAVAILABLE' : '',
      updated_at: null,
    },
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:01:00Z',
  };
}

const failedMessage: CachedAgentMessage = {
  messageId: 'assistant-1',
  conversationId,
  turnId: 'turn-1',
  role: 'assistant',
  status: 'failed',
  content: '',
  seq: 2,
  errorJson: JSON.stringify({
    error: 'agent.errors.resumeUnavailable',
    error_type: 'RUNTIME_RESUME_UNAVAILABLE',
    locale_key: 'agent.errors.resumeUnavailable',
    retryable: true,
    terminal: true,
    details: {
      runtime_profile_id: 'external-agent',
      reason_code: 'session_not_found',
    },
  }),
  createdAt: '2026-10-01T00:00:30Z',
  updatedAt: '2026-10-01T00:00:30Z',
};

describe('chat external runtime reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.getState().reset();
    useChatStore.setState({
      currentSessionKey: conversationId,
      sessions: [projectedSession],
      messages: [{
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        loading: false,
        timestamp: 1,
        turnId: 'turn-1',
        terminalStatus: 'failed',
        error: 'agent.errors.resumeUnavailable',
        resolution: {
          type: 'confirmReset',
          runtimeProfileId: 'external-agent',
          reasonCode: 'session_not_found',
          label: 'agent.recovery.confirmReset',
        },
      }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().reset();
  });

  it('uses authoritative version, confirms destruction, and reconciles the result', async () => {
    vi.spyOn(api, 'getAgentConversation')
      .mockResolvedValue(conversation(7, 2, 1, 'session-old'));
    vi.spyOn(api, 'resetAgentConversationRuntime')
      .mockResolvedValue({
        conversation: conversation(8, 1, 2, ''),
        closed_external_session_epoch: 1,
        replayed: false,
      });
    agentChatCache.clearConversation.mockResolvedValue(undefined);
    agentChatCache.refreshConversation.mockResolvedValue([failedMessage]);

    const result = await useChatStore
      .getState()
      .resetExternalRuntime(conversationId);

    expect(api.resetAgentConversationRuntime).toHaveBeenCalledWith({
      conversation_id: conversationId,
      expected_conversation_version: 7,
      client_idempotency_key: `external-runtime-reset:${conversationId}:7`,
      destructive_confirmed: true,
    });
    expect(result.closed_external_session_epoch).toBe(1);
    expect(agentChatCache.clearConversation).toHaveBeenCalledWith(conversationId);
    expect(agentChatCache.refreshConversation).toHaveBeenCalledWith(conversationId);
    expect(useChatStore.getState().sessions[0].version).toBe(8);
    expect(useChatStore.getState().messages[0]).toMatchObject({
      id: 'assistant-1',
      error: 'agent.errors.resumeUnavailable',
      resolution: null,
    });
  });
});
