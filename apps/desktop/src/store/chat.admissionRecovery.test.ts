import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { CapabilityReadinessSnapshotSchema } from '../gen/proto/domain/agent/capability_pb';
import { agentService } from '../services/agent-service';
import { api } from '../services/desktop_api';
import { useAgentStore } from './agent';
import { useAgentCapabilityStore } from './agentCapabilities';
import { foldToolMessages, liveTurnCorrelation, mergeServerMessages, useChatStore } from './chat';
import { createOperation } from './streaming/operations';

const conversationId = 'recovery-conversation';
const turnId = 'recovery-turn';

beforeEach(() => {
  useChatStore.getState().reset();
  useChatStore.setState({ currentSessionKey: conversationId });
  useAgentStore.setState({
    selectedAgent: 'assistant',
    agents: [{ id: 'agent-1', name: 'assistant', provider: 'provider-1', model: 'model-1' } as never],
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
      ptid: 'ptid:recovery-actor',
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

it('absorbs the optimistic projection when a folded snapshot precedes admission identity', () => {
  const stream = vi.spyOn(agentService, 'streamTurn').mockImplementation(() => {
    return Object.assign(new AbortController(), {
      streamId: 'stream-1',
      streamGeneration: 1,
      disconnectTransport: async () => undefined,
    });
  });
  expect(useChatStore.getState().sendMessage('hello')).toBe(true);
  const onEvent = stream.mock.calls[0][1];
  const optimistic = useChatStore.getState().messages;
  const snapshot = foldToolMessages([
    {
      id: 'server-user', role: 'user', content: 'hello',
      timestamp: optimistic[0].timestamp, turnId,
    },
    {
      id: 'server-assistant', role: 'assistant', content: '',
      timestamp: optimistic[0].timestamp, turnId, loading: true,
    },
  ]);
  const state = useChatStore.getState();
  const merged = mergeServerMessages(
    state.messages, snapshot, liveTurnCorrelation(state.operations, conversationId),
  );
  useChatStore.setState({ messages: merged, sessionBuffers: { [conversationId]: merged } });
  onEvent({ event: 'turn_identity', data: { turnId, conversationId, streamGeneration: 1 } });
  const bound = useChatStore.getState();
  expect(bound.messages.map((message) => message.id)).toEqual(['server-user', 'server-assistant']);
  expect(bound.sessionBuffers[conversationId]).toEqual(bound.messages);

  const failedSnapshot = snapshot.map((message) => message.role === 'assistant'
    ? { ...message, terminalStatus: 'failed' as const, loading: false }
    : message);
  const afterFailure = mergeServerMessages(
    bound.messages, failedSnapshot, liveTurnCorrelation(bound.operations, conversationId),
  );
  expect(afterFailure.filter((message) => message.role === 'assistant')).toEqual([
    expect.objectContaining({ id: 'server-assistant', terminalStatus: 'failed', loading: false }),
  ]);
});

it('absorbs correlation even when the server row already has an exact ID match', () => {
  const rows = [
    { id: 'server-assistant', role: 'assistant' as const, content: '', timestamp: 1, turnId, loading: true },
    {
      id: 'temp-assistant', role: 'assistant' as const, content: '', timestamp: 2,
      clientIdempotencyKey: 'send-key', loading: true, thinking: 'working',
    },
  ];
  const merged = mergeServerMessages(rows, [rows[0]], {
    idempotencyByTurnId: new Map([[turnId, 'send-key']]),
  });
  expect(merged).toEqual([expect.objectContaining({
    id: 'server-assistant', turnId, thinking: 'working',
  })]);
});

it('stops a recovered turn behind a completed primary operation', () => {
  const primary = {
    ...createOperation({
      sessionKey: conversationId, type: 'sendMessage',
      assistantMessageId: 'older-assistant', abortController: new AbortController(),
    }),
    turnId: 'older-turn',
    status: 'completed' as const,
    runState: 'completed' as const,
  };
  useChatStore.setState({ operations: { [conversationId]: primary }, messages: [] });
  useChatStore.getState().applyRecoveredTurnEvent(conversationId, 'agent-1', turnId, {
    event: 'reconnecting', data: { turnId, conversationId, streamGeneration: 2 },
  });
  const cancel = vi.spyOn(api, 'cancelAgentTurn').mockResolvedValue({ turn_id: turnId, status: 'cancelled' });
  const recovered = Object.values(useChatStore.getState().operations).find((op) => op.turnId === turnId)!;
  useChatStore.getState().stopStreaming();
  expect(cancel).toHaveBeenCalledWith(turnId);
  expect(recovered.abortController.signal.aborted).toBe(true);
  expect(useChatStore.getState().isStreaming).toBe(false);
  expect(useChatStore.getState().operations[conversationId]).toBe(primary);
});

it('preserves sibling operations, loading rows and buffers when one operation stops', () => {
  const controller = new AbortController();
  const siblingController = new AbortController();
  const active = {
    ...createOperation({
      sessionKey: conversationId, type: 'sendMessage',
      assistantMessageId: 'assistant-1', abortController: controller,
    }),
    turnId,
  };
  const sibling = createOperation({
    sessionKey: conversationId, type: 'sendMessage',
    assistantMessageId: 'assistant-2', abortController: siblingController,
    awaitingAdmission: true,
  });
  const messages = [
    { id: 'assistant-1', role: 'assistant' as const, content: '', timestamp: 1, turnId, loading: true },
    { id: 'assistant-2', role: 'assistant' as const, content: '', timestamp: 2, loading: true },
  ];
  useChatStore.setState({
    operations: { [conversationId]: active, [`${conversationId}::parallel::${sibling.id}`]: sibling },
    messages, sessionBuffers: { [conversationId]: messages }, isStreaming: true,
  });
  vi.spyOn(api, 'cancelAgentTurn').mockResolvedValue({ turn_id: turnId, status: 'cancelled' });
  useChatStore.getState().stopStreaming();
  expect(controller.signal.aborted).toBe(true);
  expect(siblingController.signal.aborted).toBe(false);
  expect(useChatStore.getState().messages.map((message) => message.loading)).toEqual([false, true]);
  expect(useChatStore.getState().sessionBuffers[conversationId]).toEqual(useChatStore.getState().messages);
  expect(useChatStore.getState().isStreaming).toBe(true);
});
