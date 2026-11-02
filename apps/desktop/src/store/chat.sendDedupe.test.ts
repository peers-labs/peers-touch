import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentService } from '../services/agent-service';
import type { AgentTurnStreamError } from '../services/desktop_api';
import { useAgentStore } from './agent';
import { useChatStore } from './chat';

const conversationId = 'conversation-send-dedupe';

function mockStreamTransport() {
  return vi.spyOn(agentService, 'streamTurn').mockImplementation(() =>
    Object.assign(new AbortController(), {
      streamId: 'stream-1',
      streamGeneration: 1,
      disconnectTransport: async () => undefined,
    }) as never,
  );
}

describe('sendMessage in-flight submission dedupe (D1)', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useChatStore.setState({ currentSessionKey: conversationId });
    useAgentStore.setState({
      selectedAgent: 'assistant',
      agents: [{ id: 'agent-1', name: 'assistant', provider: 'provider-1', model: 'model-1' } as never],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().reset();
  });

  it('suppresses a duplicate double-submit gesture before Station admission so only one Turn is created', () => {
    const stream = mockStreamTransport();

    const first = useChatStore.getState().sendMessage('write the report');
    // Second Enter/click lands before any Station event arrives (pre-admission
    // window): same draft content on the same conversation.
    const second = useChatStore.getState().sendMessage('write the report');

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(stream).toHaveBeenCalledTimes(1);

    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(messages[0].clientIdempotencyKey).toBeDefined();
    expect(messages[0].clientIdempotencyKey).toBe(messages[1].clientIdempotencyKey);
  });

  it('allows an intentional identical resend as a new Turn after Station admits the first', () => {
    const stream = mockStreamTransport();

    expect(useChatStore.getState().sendMessage('again')).toBe(true);
    // A non-error event means STARTED/QUEUED admission: the gesture is now
    // owned by Station and the local guard releases.
    stream.mock.calls[0][1]({ event: 'turn_identity', data: { turnId: 'turn-1', conversationId } });

    expect(useChatStore.getState().sendMessage('again')).toBe(true);
    expect(stream).toHaveBeenCalledTimes(2);
    // Each admitted gesture owns a distinct idempotency key.
    expect(stream.mock.calls[0][0].client_idempotency_key)
      .not.toBe(stream.mock.calls[1][0].client_idempotency_key);
  });

  it('releases the guard on a pre-admission error so retry can send again', () => {
    const stream = mockStreamTransport();

    expect(useChatStore.getState().sendMessage('retry me')).toBe(true);
    const error = new Error('agent.errors.providerRateLimit') as AgentTurnStreamError;
    error.typedError = {
      error: 'agent.errors.providerRateLimit',
      error_type: 'PROVIDER_RATE_LIMIT',
      locale_key: 'agent.errors.providerRateLimit',
      retryable: true,
      terminal: false,
      details: {},
    };
    stream.mock.calls[0][3](error);

    expect(useChatStore.getState().sendMessage('retry me')).toBe(true);
    expect(stream).toHaveBeenCalledTimes(2);
  });
});
