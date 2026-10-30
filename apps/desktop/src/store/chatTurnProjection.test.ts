import { create } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapabilityReadinessSnapshotSchema } from '../gen/proto/domain/agent/capability_pb';
import { agentService } from '../services/agent-service';
import { api } from '../services/desktop_api';
import type { Agent, AgentTurnStreamController } from '../services/desktop_api';
import {
  applyOperationEventIdentity,
  applyStreamEvent,
  liveTurnCorrelation,
  mergeServerMessages,
  type ChatMessage,
  useChatStore,
} from './chat';
import { createOperation } from './streaming/operations';
import { useAgentStore } from './agent';
import { useAgentCapabilityStore } from './agentCapabilities';

const conversationId = 'conversation-turn-1';
const turnId = 'turn-x';
const idempotencyKey = 'idem-turn-x';

function optimisticPair(): ChatMessage[] {
  return [
    {
      id: 'temp-user',
      role: 'user',
      content: 'hello',
      timestamp: 1000,
      clientIdempotencyKey: idempotencyKey,
    },
    {
      id: 'temp-assistant',
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: 1000,
      clientIdempotencyKey: idempotencyKey,
    },
  ];
}

function serverPair(): ChatMessage[] {
  return [
    {
      id: 'server-user',
      role: 'user',
      content: 'hello',
      timestamp: 1000,
      turnId,
    },
    {
      id: 'server-assistant',
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: 1000,
      turnId,
    },
  ];
}

describe('one turn projects as one assistant message', () => {
  it('absorbs pre-identity optimistic rows onto the server snapshot via idempotency correlation', () => {
    // Snapshot reconcile fires during the connect window: optimistic rows have
    // no turn id yet, while the live operation already correlates turn and key.
    const operations = {
      [conversationId]: {
        ...createOperation({
          sessionKey: conversationId,
          type: 'sendMessage',
          assistantMessageId: 'temp-assistant',
          abortController: new AbortController(),
          clientIdempotencyKey: idempotencyKey,
        }),
        turnId,
      },
    };

    const merged = mergeServerMessages(
      optimisticPair(),
      serverPair(),
      liveTurnCorrelation(operations, conversationId),
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((message) => message.id)).toEqual([
      'server-user',
      'server-assistant',
    ]);
    expect(merged.some((message) => message.id.startsWith('temp-'))).toBe(false);
  });

  it('without correlation the empty pending server row duplicates the optimistic assistant', () => {
    // Regression characterization of the pre-fix hazard: the optimistic user
    // row collapses by content match, while its empty assistant row survives
    // next to the pending server row — two assistant headers for one turn.
    const merged = mergeServerMessages(optimisticPair(), serverPair());
    expect(merged.filter((message) => message.role === 'assistant')).toHaveLength(2);
  });

  it('binds turn identity from the turn_identity admission event', () => {
    const bound = applyStreamEvent(optimisticPair()[1], {
      event: 'turn_identity',
      data: { turnId, conversationId },
    });
    expect(bound.turnId).toBe(turnId);
    expect(bound.loading).toBe(true);

    const operation = createOperation({
      sessionKey: conversationId,
      type: 'sendMessage',
      assistantMessageId: 'temp-assistant',
      abortController: new AbortController(),
    });
    const result = applyOperationEventIdentity(
      { [conversationId]: operation },
      conversationId,
      { event: 'turn_identity', data: { turnId, conversationId } },
    );
    expect(result.accepted).toBe(true);
    expect(result.operations[conversationId]).toMatchObject({
      turnId,
      runState: 'streaming',
      awaitingAdmission: false,
    });
  });

  it('queued admission binds the turn id before the turn leaves the queue', () => {
    const bound = applyStreamEvent(optimisticPair()[1], {
      event: 'queued',
      data: {
        admission: {
          turn_id: turnId,
          queue_entry: { queue_entry_id: 'entry-1', queue_position: 2 },
        },
      },
    });
    expect(bound.turnId).toBe(turnId);
    expect(bound.queued).toBe(true);
  });
});

describe('live send identity correlation', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useChatStore.setState({ currentSessionKey: conversationId });
    useAgentStore.setState({
      selectedAgent: 'assistant',
      agents: [{
        id: 'agent-1',
        name: 'assistant',
        provider: 'provider-1',
        model: 'model-1',
      } as Agent],
    });
    useAgentCapabilityStore.setState({
      readinessByAgentId: {
        'agent-1': create(CapabilityReadinessSnapshotSchema, {
          snapshotId: 'snapshot-1',
          agentId: 'agent-1',
          selectedClientSessionId: 'session-desktop',
        }),
      },
      capabilitySessions: [{
        session_id: 'session-desktop',
        ptid: 'ptid:actor-1',
        device_id: 'device-1',
        platform: 'CLIENT_PLATFORM_DESKTOP',
        typed_capabilities: [],
        expires_at: { seconds: Math.floor(Date.now() / 1000) + 3600, nanos: 0 },
        connection_id: 'connection-1',
        lease_id: 'lease-1',
        lease_revision: 1,
      }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().reset();
    useAgentCapabilityStore.getState().reset();
  });

  it('stamps one idempotency key on optimistic rows and the Station request', () => {
    const streamSpy = vi.spyOn(agentService, 'streamTurn').mockImplementation(
      () => {
        const controller = new AbortController() as AgentTurnStreamController;
        Object.defineProperty(controller, 'streamGeneration', {
          value: 1,
          enumerable: true,
        });
        return controller;
      },
    );

    expect(useChatStore.getState().sendMessage('hello')).toBe(true);

    const state = useChatStore.getState();
    expect(streamSpy).toHaveBeenCalledTimes(1);
    const requestKey = streamSpy.mock.calls[0]?.[0].client_idempotency_key;
    expect(requestKey).toBeTruthy();
    expect(state.messages).toHaveLength(2);
    for (const message of state.messages) {
      expect(message.clientIdempotencyKey).toBe(requestKey);
    }
  });

  it('continues streaming into the server row after a snapshot absorbs the optimistic row', () => {
    const streamSpy = vi.spyOn(agentService, 'streamTurn').mockImplementation(() => {
      const controller = new AbortController() as AgentTurnStreamController;
      Object.defineProperty(controller, 'streamGeneration', { value: 1 });
      return controller;
    });
    useChatStore.getState().sendMessage('hello');
    const onEvent = streamSpy.mock.calls[0][1];
    onEvent({ event: 'turn_identity', data: { turnId, conversationId } });
    const state = useChatStore.getState();
    const merged = mergeServerMessages(
      state.messages,
      serverPair(),
      liveTurnCorrelation(state.operations, conversationId),
    );
    useChatStore.setState({
      messages: merged,
      sessionBuffers: { [conversationId]: merged },
    });

    onEvent({ event: 'text', data: { turnId, content: 'still streaming' } });

    const updated = useChatStore.getState();
    for (const messages of [updated.messages, updated.sessionBuffers[conversationId]]) {
      expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
      expect(messages.find((message) => message.id === 'server-assistant')).toMatchObject({
        content: 'still streaming',
        loading: true,
      });
    }

    streamSpy.mock.calls[0][3](new Error('agent.error.turnFailed'));
    expect(useChatStore.getState().messages.find(
      (message) => message.id === 'server-assistant',
    )).toMatchObject({ loading: false, error: 'agent.error.turnFailed' });
  });

  it('recovery replay reuses the live optimistic row instead of minting a recovered-* row', () => {
    vi.spyOn(agentService, 'streamTurn').mockImplementation(() => {
      const controller = new AbortController() as AgentTurnStreamController;
      Object.defineProperty(controller, 'streamGeneration', {
        value: 1,
        enumerable: true,
      });
      return controller;
    });

    useChatStore.getState().sendMessage('hello');
    const optimisticAssistant = useChatStore
      .getState()
      .messages.find((message) => message.role === 'assistant');
    expect(optimisticAssistant).toBeDefined();

    useChatStore.getState().applyRecoveredTurnEvent(
      conversationId,
      'agent-1',
      turnId,
      {
        event: 'text',
        data: { turnId, content: 'hi' },
      },
    );

    const assistantMessages = useChatStore
      .getState()
      .messages.filter((message) => message.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      id: optimisticAssistant!.id,
      turnId,
      content: 'hi',
    });
  });

  it('keeps a recovered parallel operation under its original key', () => {
    const primary = {
      ...createOperation({
        sessionKey: conversationId,
        type: 'sendMessage',
        assistantMessageId: 'primary-assistant',
        abortController: new AbortController(),
      }),
      turnId: 'primary-turn',
    };
    const parallel = {
      ...createOperation({
        sessionKey: conversationId,
        type: 'sendMessage',
        assistantMessageId: 'parallel-assistant',
        abortController: new AbortController(),
      }),
      turnId,
    };
    const parallelKey = `${conversationId}::parallel::${parallel.id}`;
    useChatStore.setState({
      operations: { [conversationId]: primary, [parallelKey]: parallel },
      messages: [{
        id: 'parallel-assistant',
        role: 'assistant',
        content: '',
        loading: true,
        timestamp: 1000,
        turnId,
      }],
    });

    useChatStore.getState().applyRecoveredTurnEvent(
      conversationId, 'agent-1', turnId,
      { event: 'text', data: { turnId, content: 'recovered' } },
    );

    expect(useChatStore.getState().operations[conversationId]).toEqual(primary);
    expect(Object.values(useChatStore.getState().operations).filter(
      (operation) => operation.turnId === turnId,
    )).toHaveLength(1);
    expect(useChatStore.getState().messages[0].content).toBe('recovered');
  });

  it('settles the optimistic row immediately when a cancel is admitted', async () => {
    vi.spyOn(api, 'cancelAgentTurn').mockResolvedValue({ turn_id: turnId, status: 'cancelled' });
    vi.spyOn(agentService, 'streamTurn').mockImplementation(() => {
      const controller = new AbortController() as AgentTurnStreamController;
      Object.defineProperty(controller, 'streamGeneration', {
        value: 1,
        enumerable: true,
      });
      return controller;
    });

    useChatStore.getState().sendMessage('write a very long detailed essay');
    const optimisticAssistant = useChatStore
      .getState()
      .messages.find((message) => message.role === 'assistant');

    await useChatStore
      .getState()
      .requestTurnCancellation(turnId, optimisticAssistant!.id);

    const settled = useChatStore
      .getState()
      .messages.find((message) => message.id === optimisticAssistant!.id);
    expect(settled).toMatchObject({
      loading: false,
      cancelled: true,
      terminalStatus: 'cancelled',
    });
    expect(settled?.typedError?.error_type).toBe('LIFECYCLE_CANCELLED');
  });

  it('does not report cancellation when Station leaves the turn queued', async () => {
    vi.spyOn(api, 'cancelAgentTurn').mockResolvedValue({ turn_id: turnId, status: 'queued' });
    const messages = serverPair();
    useChatStore.setState({ messages, sessionBuffers: { [conversationId]: messages } });

    await useChatStore.getState().requestTurnCancellation(turnId, 'server-assistant');

    expect(useChatStore.getState().messages).toEqual(messages);
    expect(useChatStore.getState().messages[1].cancelled).not.toBe(true);
  });
});
