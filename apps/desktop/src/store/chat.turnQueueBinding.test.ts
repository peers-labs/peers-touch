import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const agentChatCache = vi.hoisted(() => ({
  getMessages: vi.fn(),
  syncConversation: vi.fn(),
  upsertMessage: vi.fn(),
  refreshConversation: vi.fn(),
}));

const bus = vi.hoisted(() => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  return {
    listeners,
    publish: (type: string, payload: unknown) => {
      listeners.get(type)?.forEach((listener) => listener(payload));
    },
    subscribe: (type: string, listener: (payload: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
      return () => listeners.get(type)?.delete(listener);
    },
  };
});

vi.mock('../storage/desktopAgentChatCache', () => ({
  getDesktopAgentChatCache: () => agentChatCache,
}));

vi.mock('../kernel/events', () => ({
  EVENT: {
    AGENT_TURN_ADMITTED: 'agent.turn_admitted',
    AGENT_TURN_QUEUE_CANCELLED: 'agent.turn_queue_cancelled',
    AGENT_TURN_RECOVERY_RETRY_REQUESTED: 'agent.turn_recovery_retry_requested',
  },
  eventBus: {
    publish: bus.publish,
    subscribe: bus.subscribe,
  },
}));

import { api } from '../services/desktop_api';
import { useChatStore, type ChatMessage } from './chat';

const TURN_ADMITTED = 'agent.turn_admitted';
const TURN_QUEUE_CANCELLED = 'agent.turn_queue_cancelled';

const conversationId = 'conversation-1';

function queuedPlaceholder(id: string, queueEntryId: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp: 1_700_000_000_000,
    queued: true,
    queueEntryId,
    loading: false,
  };
}

function queueEntry(
  queueEntryId: string,
  admittedTurnId: string,
  position: number,
  sequence: number,
) {
  return {
    queue_entry_id: queueEntryId,
    conversation_id: conversationId,
    agent_id: 'agent-1',
    client_idempotency_key: `key-${queueEntryId}`,
    status: 'TURN_QUEUE_STATUS_PENDING',
    queue_sequence: sequence,
    queue_position: position,
    admitted_turn_id: admittedTurnId,
    user_input: `input-${queueEntryId}`,
  };
}

describe('syncTurnQueue pre-bound turn identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentChatCache.getMessages.mockResolvedValue([]);
    agentChatCache.syncConversation.mockResolvedValue([]);
    agentChatCache.refreshConversation.mockResolvedValue([]);
    useChatStore.getState().reset();
    useChatStore.setState({
      currentSessionKey: conversationId,
      messages: [
        queuedPlaceholder('assistant-1', 'queue-1'),
        queuedPlaceholder('assistant-2', 'queue-2'),
      ],
    });
  });

  afterEach(() => {
    useChatStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('tails only the FIFO head and binds every placeholder turn id', async () => {
    vi.spyOn(api, 'listAgentTurnQueue').mockResolvedValue({
      entries: [
        queueEntry('queue-1', 'turn-1', 1, 1),
        queueEntry('queue-2', 'turn-2', 2, 2),
      ],
      conversation_version: 4,
      queue_capacity: 8,
    });
    const admitted: Array<{
      conversationId: string;
      agentId: string;
      turnId: string;
    }> = [];
    const unsubscribe = bus.subscribe(TURN_ADMITTED, (payload) => {
      admitted.push(payload as {
        conversationId: string;
        agentId: string;
        turnId: string;
      });
    });

    await useChatStore.getState().syncTurnQueue(conversationId);
    unsubscribe();

    expect(admitted).toEqual([
      {
        conversationId: conversationId,
        agentId: 'agent-1',
        turnId: 'turn-1',
      },
    ]);
    const messages = useChatStore.getState().messages;
    expect(messages.map((message) => message.turnId)).toEqual([
      'turn-1',
      'turn-2',
    ]);
  });

  it('publishes queue cancellation with the pre-bound turn id and settles the placeholder', async () => {
    const listSpy = vi
      .spyOn(api, 'listAgentTurnQueue')
      .mockResolvedValueOnce({
        entries: [queueEntry('queue-1', 'turn-1', 1, 1)],
        conversation_version: 4,
        queue_capacity: 8,
      })
      .mockResolvedValueOnce({
        entries: [],
        conversation_version: 5,
        queue_capacity: 8,
      });
    const cancelSpy = vi
      .spyOn(api, 'cancelQueuedAgentTurn')
      .mockResolvedValue({ conversation_version: 5 } as never);
    vi.spyOn(useChatStore.getState(), 'loadSessions').mockResolvedValue();

    const cancellations: Array<{ conversationId: string; turnId: string }> = [];
    const unsubscribe = bus.subscribe(TURN_QUEUE_CANCELLED, (payload) => {
      cancellations.push(payload as { conversationId: string; turnId: string });
    });

    await useChatStore.getState().cancelQueuedTurn(conversationId, 'queue-1');
    unsubscribe();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancellations).toEqual([
      { conversationId: conversationId, turnId: 'turn-1' },
    ]);
    expect(listSpy).toHaveBeenCalledTimes(2);
    const settled = useChatStore
      .getState()
      .messages.find((message) => message.queueEntryId === 'queue-1');
    expect(settled?.terminalStatus).toBe('cancelled');
    expect(settled?.cancelled).toBe(true);
  });
});
