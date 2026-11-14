import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  api,
  type AgentConversation,
  type Session,
} from '../services/desktop_api';
import { createAgentDraftKey } from './agentDraft';

import { useChatStore } from './chat';

const conversationId = 'conversation-1';

const projectedSession: Session = {
  id: conversationId,
  key: conversationId,
  agent_name: 'agent-1',
  title: 'Runtime rebind',
  message_count: 2,
  version: 4,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

function conversation(version: number, binding: AgentConversation['runtime_binding']): AgentConversation {
  return {
    conversation_id: conversationId,
    agent_id: 'agent-1',
    ptid: 'ptid:person:owner',
    title: 'Runtime rebind',
    provider_id: 'ark',
    model_name: 'doubao-current',
    status: 'active',
    active_branch_message_id: 'assistant-1',
    queued_turn_count: 0,
    version,
    runtime_binding: binding,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:01:00Z',
  };
}

const staleBinding: NonNullable<AgentConversation['runtime_binding']> = {
  runtime_kind: 1,
  provider_id: 'provider-retired',
  model_id: 'model-retired',
  runtime_profile_id: 'modern-chat-agent-v1',
  external_session_id: '',
  external_session_epoch: 0,
  runtime_home_ref: '',
  capability_snapshot_hash: 'cap-hash',
  config_snapshot_hash: 'cfg-hash',
  bound_at: null,
  state: 0,
  last_error_code: '',
  updated_at: null,
};

describe('chat conversation runtime rebind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.getState().reset();
    useChatStore.setState({
      currentSessionKey: conversationId,
      sessions: [projectedSession],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().reset();
  });

  it('uses the authoritative conversation version and reconciles the rebind result', async () => {
    vi.spyOn(api, 'getAgentConversation')
      .mockResolvedValue(conversation(7, staleBinding));
    const rebound = conversation(8, undefined);
    const rebindSpy = vi.spyOn(api, 'rebindAgentConversationRuntime')
      .mockResolvedValue({ ok: true, conversation: rebound });

    const result = await useChatStore
      .getState()
      .rebindConversationRuntime(conversationId);

    expect(rebindSpy).toHaveBeenCalledWith({
      conversation_id: conversationId,
      expected_conversation_version: 7,
    });
    expect(result.ok).toBe(true);
    expect(result.conversation.version).toBe(8);

    const session = useChatStore.getState().sessions[0];
    expect(session.version).toBe(8);
    expect(session.provider_override).toBe('ark');
    expect(session.model_override).toBe('doubao-current');
  });

  it('rejects draft conversations without calling the station', async () => {
    const draftKey = createAgentDraftKey('agent-1');
    useChatStore.setState({ currentSessionKey: draftKey });
    const rebindSpy = vi.spyOn(api, 'rebindAgentConversationRuntime');

    await expect(
      useChatStore.getState().rebindConversationRuntime(draftKey),
    ).rejects.toThrow('agent.errors.runtimeBindingStale');
    expect(rebindSpy).not.toHaveBeenCalled();
  });
});
