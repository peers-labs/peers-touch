import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { agentService } from '../services/agent-service';
import { useAgentStore } from './agent';
import { useChatStore } from './chat';

type AnyStreamEvent = { event: string; data?: Record<string, unknown> };

const conversationId = 'amend-conversation';

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

it('projects an amended admission onto the user message without a new turn', () => {
  const handlers: {
    onEvent: (event: AnyStreamEvent) => void;
    onComplete: () => void;
  } = { onEvent: () => undefined, onComplete: () => undefined };
  vi.spyOn(agentService, 'streamTurn').mockImplementation((_input, onEvent, onComplete) => {
    handlers.onEvent = onEvent as (event: AnyStreamEvent) => void;
    handlers.onComplete = onComplete as () => void;
    return Object.assign(new AbortController(), {
      streamId: 'stream-amend',
      streamGeneration: 1,
      disconnectTransport: async () => undefined,
    });
  });

  expect(useChatStore.getState().sendMessage('follow-up')).toBe(true);

  const before = useChatStore.getState().messages;
  expect(before).toHaveLength(2);
  const userMessage = before.find((message) => message.role === 'user');
  const assistantId = before.find((message) => message.role === 'assistant')?.id;
  expect(userMessage).toBeDefined();
  expect(assistantId).toBeDefined();

  handlers.onEvent({
    event: 'amended',
    data: { admission: { turnId: 'running-turn-1' } },
  } as unknown as AnyStreamEvent);

  const after = useChatStore.getState().messages;
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(userMessage!.id);
  expect(after[0].deliveryStatus).toBe('amended');
  expect(after[0].turnId).toBe('running-turn-1');
  expect(after.some((message) => message.id === assistantId)).toBe(false);

  // The amendment stream closes immediately; its operation is settled while
  // the buffer (and running turn) stays consistent for reconciliation.
  handlers.onComplete();
  expect(
    useChatStore.getState().messages.some((message) => message.deliveryStatus === 'amended'),
  ).toBe(true);
});
