import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT, eventBus } from '../kernel/events';
import type { AgentTurnStreamEventPayload } from '../kernel/events/types';
import type { StreamEvent } from '../services/desktop_api';
import type { ActiveAgentTurnRecovery } from '../store/agentTurnRecovery';
import { useAgentTurnRecoveryStore } from '../store/agentTurnRecovery';

const mocks = vi.hoisted(() => ({
  readValue: vi.fn(),
  write: vi.fn(),
  applyRecoveredTurnEvent: vi.fn(),
  reconcileRecoveredTurn: vi.fn(),
  replayControllers: [] as AbortController[],
  replayInputs: [] as Array<{
    conversation_id: string;
    turn_id: string;
    after_seq: number;
  }>,
  replayOnEvents: [] as Array<(event: StreamEvent) => void>,
  replayOnErrors: [] as Array<(error: Error) => void>,
  subscribers: new Map<string, Set<(payload: unknown) => void>>(),
}));

vi.mock('../kernel/events', () => ({
  EVENT: {
    AGENT_TURN_STREAM_EVENT: 'agent:turn-stream-event',
    AGENT_TURN_RECOVERY_RETRY_REQUESTED: 'agent:turn-recovery-retry-requested',
  },
  eventBus: {
    publish: (type: string, payload: unknown) => {
      for (const handler of mocks.subscribers.get(type) || []) handler(payload);
    },
    subscribe: (type: string, handler: (payload: unknown) => void) => {
      const handlers = mocks.subscribers.get(type) || new Set();
      handlers.add(handler);
      mocks.subscribers.set(type, handlers);
      return () => handlers.delete(handler);
    },
  },
}));

vi.mock('../storage/desktopClientStorage', () => ({
  createDesktopClientStorageRuntime: () => ({
    repositories: {
      runtimeProjection: {
        readValue: mocks.readValue,
        write: mocks.write,
      },
    },
  }),
}));

vi.mock('../services/desktop_api', () => ({
  classifyAgentTurnTerminalEvent: (event: { event: string; data: Record<string, unknown> }) => {
    if (event.event === 'done') return 'completed';
    if (event.event === 'cancelled') return 'cancelled';
    if (event.event === 'error') return 'failed';
    if (event.event !== 'snapshot') return null;
    const status = String(event.data.status || '');
    if (status === 'completed') return 'completed';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'failed') return 'failed';
    if (status === 'interrupted') return 'interrupted';
    return null;
  },
  streamAgentTurnReplay: (
    input: {
      conversation_id: string;
      turn_id: string;
      after_seq: number;
    },
    onEvent: (event: StreamEvent) => void,
    onError: (error: Error) => void,
    sourcePtid: string,
  ) => {
    const controller = new AbortController();
    mocks.replayControllers.push(controller);
    mocks.replayInputs.push(input);
    mocks.replayOnEvents.push((event) => onEvent({ ...event, ptid: sourcePtid }));
    mocks.replayOnErrors.push(onError);
    return controller;
  },
}));

vi.mock('../store/chat', () => ({
  useChatStore: {
    getState: () => ({
      applyRecoveredTurnEvent: mocks.applyRecoveredTurnEvent,
      reconcileRecoveredTurn: mocks.reconcileRecoveredTurn,
    }),
  },
}));

vi.mock('../utils/logger', () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  chatRuntime,
  flushAgentTurnRecoveryPersistence,
  reloadAgentTurnSnapshot,
} from './chatRuntime';

function activeTurn(overrides: Partial<ActiveAgentTurnRecovery> = {}): ActiveAgentTurnRecovery {
  return {
    actorId: 'ptid:person:alice',
    conversationId: 'conversation-1',
    agentId: 'agent-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    streamGeneration: 10,
    cursor: 4,
    phase: 'CONNECTED',
    startedAt: 100,
    updatedAt: 200,
    recoveryEpoch: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function stationSnapshot(
  data: Record<string, unknown>,
): {
  event: 'snapshot';
  data: Record<string, unknown>;
  sourceDelivery: {
    transport: 'station-sse';
    ptid: string;
    conversationId: string;
    turnId: string;
    sequence: number;
    rawPayload: { eventType: string; data: Record<string, unknown> };
  };
} {
  const sourceData = { ...data };
  return {
    event: 'snapshot',
    data,
    sourceDelivery: {
      transport: 'station-sse',
      ptid: 'ptid:person:alice',
      conversationId: String(data.conversationId),
      turnId: String(data.turnId),
      sequence: Number(data.seq),
      rawPayload: { eventType: 'snapshot', data: sourceData },
    },
  };
}

describe('chatRuntime Agent turn recovery', () => {
  beforeEach(() => {
    chatRuntime.teardown();
    useAgentTurnRecoveryStore.getState().reset();
    mocks.readValue.mockReset();
    mocks.write.mockReset().mockResolvedValue(undefined);
    mocks.applyRecoveredTurnEvent.mockReset();
    mocks.reconcileRecoveredTurn.mockReset().mockResolvedValue(undefined);
    mocks.replayControllers.length = 0;
    mocks.replayInputs.length = 0;
    mocks.replayOnEvents.length = 0;
    mocks.replayOnErrors.length = 0;
    mocks.subscribers.clear();
    chatRuntime.install();
  });

  afterEach(() => {
    chatRuntime.teardown();
  });

  it('merges a delayed bootstrap read with a newer live record for the same actor', async () => {
    const persistedRead = deferred<unknown>();
    mocks.readValue.mockReturnValueOnce(persistedRead.promise);
    const bootstrap = chatRuntime.bootstrap('ptid:person:alice');
    const livePayload: AgentTurnStreamEventPayload = {
      streamId: 'stream-live',
      streamGeneration: 11,
      ptid: 'ptid:person:alice',
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      event: 'text',
      data: { turnId: 'turn-live', seq: 8 },
      timestampMs: 500,
    };
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, livePayload);

    persistedRead.resolve({ 'conversation-1': activeTurn() });
    await bootstrap;

    expect(useAgentTurnRecoveryStore.getState().active['conversation-1']).toMatchObject({
      turnId: 'turn-live',
      streamGeneration: 11,
      cursor: 8,
    });
  });

  it('ignores a stale actor bootstrap that resolves after the active actor changes', async () => {
    const aliceRead = deferred<unknown>();
    const bobRead = deferred<unknown>();
    mocks.readValue
      .mockReturnValueOnce(aliceRead.promise)
      .mockReturnValueOnce(bobRead.promise);

    const aliceBootstrap = chatRuntime.bootstrap('ptid:person:alice');
    const bobBootstrap = chatRuntime.bootstrap('ptid:person:bob');
    bobRead.resolve({});
    await bobBootstrap;
    aliceRead.resolve({ 'conversation-1': activeTurn() });
    await aliceBootstrap;

    expect(useAgentTurnRecoveryStore.getState().actorId).toBe('ptid:person:bob');
    expect(useAgentTurnRecoveryStore.getState().active).toEqual({});
  });

  it('hands a native connection loss to the interruptible replay transport', async () => {
    mocks.readValue.mockResolvedValueOnce({});
    await chatRuntime.bootstrap('ptid:person:alice');
    const basePayload = {
      streamId: 'stream-1',
      streamGeneration: 10,
      ptid: 'ptid:person:alice',
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      timestampMs: 500,
    };
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connected',
      data: { turnId: 'turn-1', seq: 1 },
    });
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connection_lost',
      data: { turnId: 'turn-1', seq: 1, recoveryHandoff: true },
    });

    expect(mocks.replayOnEvents).toHaveLength(1);
  });

  it('leaves a live connected turn under its stream owner during periodic reconcile', async () => {
    mocks.readValue.mockResolvedValueOnce({});
    await chatRuntime.bootstrap('ptid:person:alice');
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      streamId: 'stream-1',
      streamGeneration: 10,
      ptid: 'ptid:person:alice',
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      event: 'connected',
      data: { turnId: 'turn-1', seq: 1 },
      timestampMs: 500,
    });

    await chatRuntime.reconcile?.('periodic');

    expect(mocks.replayInputs).toHaveLength(0);
    expect(useAgentTurnRecoveryStore.getState().active['conversation-1']).toMatchObject({
      phase: 'CONNECTED',
      recoveryEpoch: 0,
    });
  });

  it('flushes the current recovery phase before a client restart', async () => {
    mocks.readValue.mockResolvedValueOnce({});
    await chatRuntime.bootstrap('ptid:person:alice');
    const basePayload = {
      streamId: 'stream-1',
      streamGeneration: 10,
      ptid: 'ptid:person:alice',
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      timestampMs: 500,
    };
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connected',
      data: { turnId: 'turn-1', seq: 1 },
    });
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connection_lost',
      data: { turnId: 'turn-1', seq: 1, recoveryHandoff: true },
    });
    mocks.replayOnErrors[0](new Error('station unavailable'));
    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active['conversation-1'].phase)
        .toBe('RECOVERY_FAILED');
    });

    await flushAgentTurnRecoveryPersistence();

    expect(mocks.write).toHaveBeenLastCalledWith(
      'agent-turn-recovery',
      expect.objectContaining({
        'conversation-1': expect.objectContaining({
          phase: 'RECOVERY_FAILED',
          turnId: 'turn-1',
        }),
      }),
    );
  });

  it('keeps a failed recovery idle until an explicit retry', async () => {
    mocks.readValue.mockResolvedValueOnce({});
    await chatRuntime.bootstrap('ptid:person:alice');
    const basePayload = {
      streamId: 'stream-1',
      streamGeneration: 10,
      ptid: 'ptid:person:alice',
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      timestampMs: 500,
    };
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connected',
      data: { turnId: 'turn-1', seq: 1 },
    });
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connection_lost',
      data: { turnId: 'turn-1', seq: 1, recoveryHandoff: true },
    });
    mocks.replayOnErrors[0](new Error('station unavailable'));
    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active['conversation-1'].phase)
        .toBe('RECOVERY_FAILED');
    });
    const failed =
      useAgentTurnRecoveryStore.getState().active['conversation-1'];

    await chatRuntime.reconcile?.('periodic');

    expect(mocks.replayInputs).toHaveLength(1);
    expect(useAgentTurnRecoveryStore.getState().active['conversation-1']).toMatchObject({
      phase: 'RECOVERY_FAILED',
      recoveryEpoch: failed.recoveryEpoch,
    });

    eventBus.publish(EVENT.AGENT_TURN_RECOVERY_RETRY_REQUESTED, {
      conversationId: 'conversation-1',
    });

    expect(mocks.replayInputs).toHaveLength(2);
    expect(useAgentTurnRecoveryStore.getState().active['conversation-1']).toMatchObject({
      phase: 'REPLAYING',
      recoveryEpoch: failed.recoveryEpoch + 1,
    });
  });

  it('preserves an in-memory failed recovery across same-actor bootstrap', async () => {
    mocks.readValue.mockResolvedValueOnce({});
    await chatRuntime.bootstrap('ptid:person:alice');
    const basePayload = {
      streamId: 'stream-1',
      streamGeneration: 10,
      ptid: 'ptid:person:alice',
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      timestampMs: 500,
    };
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connected',
      data: { turnId: 'turn-1', seq: 1 },
    });
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connection_lost',
      data: { turnId: 'turn-1', seq: 1, recoveryHandoff: true },
    });
    mocks.replayOnErrors[0](new Error('station unavailable'));
    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active['conversation-1'].phase)
        .toBe('RECOVERY_FAILED');
    });
    const failed =
      useAgentTurnRecoveryStore.getState().active['conversation-1'];
    mocks.readValue.mockResolvedValueOnce({
      'conversation-1': failed,
    });

    await chatRuntime.bootstrap('ptid:person:alice');

    expect(mocks.replayInputs).toHaveLength(1);
    expect(useAgentTurnRecoveryStore.getState().active['conversation-1']).toMatchObject({
      phase: 'RECOVERY_FAILED',
      recoveryEpoch: failed.recoveryEpoch,
    });
  });

  it('preserves a failed recovery across same-process teardown and bootstrap', async () => {
    mocks.readValue.mockResolvedValueOnce({});
    await chatRuntime.bootstrap('ptid:person:alice');
    const basePayload = {
      streamId: 'stream-1',
      streamGeneration: 10,
      ptid: 'ptid:person:alice',
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      timestampMs: 500,
    };
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connected',
      data: { turnId: 'turn-1', seq: 1 },
    });
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connection_lost',
      data: { turnId: 'turn-1', seq: 1, recoveryHandoff: true },
    });
    mocks.replayOnErrors[0](new Error('station unavailable'));
    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active['conversation-1'].phase)
        .toBe('RECOVERY_FAILED');
    });
    const failed =
      useAgentTurnRecoveryStore.getState().active['conversation-1'];
    await flushAgentTurnRecoveryPersistence();

    chatRuntime.teardown();
    mocks.replayControllers.length = 0;
    mocks.replayInputs.length = 0;
    mocks.replayOnEvents.length = 0;
    mocks.replayOnErrors.length = 0;
    mocks.readValue.mockResolvedValueOnce({
      'conversation-1': failed,
    });
    chatRuntime.install();
    await chatRuntime.bootstrap('ptid:person:alice');

    expect(mocks.replayInputs).toHaveLength(0);
    expect(useAgentTurnRecoveryStore.getState().active['conversation-1']).toMatchObject({
      phase: 'RECOVERY_FAILED',
      recoveryEpoch: failed.recoveryEpoch,
    });
  });

  it('publishes source-bound replay metadata without making it a second state input', async () => {
    mocks.readValue.mockResolvedValueOnce({ 'conversation-1': activeTurn() });
    const observed: unknown[] = [];
    eventBus.subscribe(EVENT.AGENT_TURN_STREAM_EVENT, (payload) => observed.push(payload));
    await chatRuntime.bootstrap('ptid:person:alice');
    mocks.applyRecoveredTurnEvent.mockClear();

    const rawData = {
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      seq: 5,
      text: 'replayed',
    };
    mocks.replayOnEvents[0]({
      event: 'text',
      data: rawData,
      sourceDelivery: {
        transport: 'station-sse',
        ptid: 'ptid:person:alice',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        sequence: 5,
        rawPayload: { eventType: 'text', data: { ...rawData } },
      },
    });

    await vi.waitFor(() => {
      expect(observed).toContainEqual(expect.objectContaining({
        deliveryOnly: true,
        sourceDelivery: {
          transport: 'station-sse',
          ptid: 'ptid:person:alice',
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          sequence: 5,
          rawPayload: { eventType: 'text', data: rawData },
        },
      }));
    });
    expect(useAgentTurnRecoveryStore.getState().active['conversation-1'].cursor).toBe(5);
    expect(mocks.applyRecoveredTurnEvent).toHaveBeenCalledTimes(1);
  });

  it('retains catch-up terminal recovery until the authoritative snapshot', async () => {
    mocks.readValue.mockResolvedValueOnce({ 'conversation-1': activeTurn() });
    await chatRuntime.bootstrap('ptid:person:alice');

    mocks.replayOnEvents[0]({
      event: 'error',
      data: {
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        seq: 5,
        error: 'station_restart_interrupted',
      },
    });

    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active['conversation-1']).toMatchObject({
        cursor: 5,
        turnId: 'turn-1',
      });
    });
    expect(mocks.replayControllers[0].signal.aborted).toBe(false);
    expect(mocks.reconcileRecoveredTurn).not.toHaveBeenCalled();

    mocks.replayOnEvents[0](stationSnapshot({
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      status: 'interrupted',
      terminal_reason: 'station_restart_interrupted',
      text: 'authoritative replay text',
      seq: 5,
    }));

    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active).toEqual({});
      expect(mocks.replayControllers[0].signal.aborted).toBe(true);
    });
    expect(mocks.reconcileRecoveredTurn).toHaveBeenCalledWith(
      'conversation-1',
      'turn-1',
      {
        status: 'interrupted',
        reason: 'station_restart_interrupted',
        content: 'authoritative replay text',
      },
    );
  });

  it('does not recreate recovery after connected reconciliation closes the turn', async () => {
    mocks.readValue.mockResolvedValueOnce({});
    await chatRuntime.bootstrap('ptid:person:alice');
    const basePayload = {
      streamId: 'stream-1',
      ptid: 'ptid:person:alice',
      streamGeneration: 10,
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      timestampMs: 500,
    };
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connected',
      data: { turnId: 'turn-1', seq: 1 },
    });
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...basePayload,
      event: 'connection_lost',
      data: { turnId: 'turn-1', seq: 1, recoveryHandoff: true },
    });
    expect(mocks.replayOnEvents).toHaveLength(1);
    mocks.reconcileRecoveredTurn.mockImplementationOnce(async () => {
      useAgentTurnRecoveryStore.getState().clear(
        'conversation-1',
        'turn-1',
      );
    });
    mocks.applyRecoveredTurnEvent.mockClear();

    mocks.replayOnEvents[0]({
      event: 'connected',
      data: {
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        seq: 5,
      },
    });

    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active).toEqual({});
      expect(mocks.replayControllers[0].signal.aborted).toBe(true);
    });
    expect(mocks.applyRecoveredTurnEvent).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenLastCalledWith('agent-turn-recovery', {});
  });

  it('closes recovery on a terminal event after catch-up reaches the live tail', async () => {
    mocks.readValue.mockResolvedValueOnce({ 'conversation-1': activeTurn() });
    await chatRuntime.bootstrap('ptid:person:alice');

    mocks.replayOnEvents[0]({
      event: 'catchup_done',
      data: {
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        seq: 4,
      },
    });
    mocks.replayOnEvents[0]({
      event: 'error',
      data: {
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        seq: 5,
        error: 'provider_failed',
      },
    });

    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active).toEqual({});
      expect(mocks.replayControllers[0].signal.aborted).toBe(true);
    });
    expect(mocks.reconcileRecoveredTurn).toHaveBeenCalledWith(
      'conversation-1',
      'turn-1',
      {
        status: 'failed',
        reason: 'provider_failed',
      },
    );
  });

  it('preserves the live cancellation reason during terminal reconciliation', async () => {
    mocks.readValue.mockResolvedValueOnce({ 'conversation-1': activeTurn() });
    await chatRuntime.bootstrap('ptid:person:alice');

    mocks.replayOnEvents[0]({
      event: 'catchup_done',
      data: {
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        seq: 4,
      },
    });
    mocks.replayOnEvents[0]({
      event: 'cancelled',
      data: {
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        seq: 5,
        reason: 'cancelled_by_user',
      },
    });

    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active).toEqual({});
      expect(mocks.replayControllers[0].signal.aborted).toBe(true);
    });
    expect(mocks.reconcileRecoveredTurn).toHaveBeenCalledWith(
      'conversation-1',
      'turn-1',
      {
        status: 'cancelled',
        reason: 'cancelled_by_user',
      },
    );
  });

  it('rejects a late stream event from a different authenticated actor', async () => {
    mocks.readValue.mockResolvedValueOnce({});
    await chatRuntime.bootstrap('ptid:person:alice');

    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      streamId: 'stream-bob',
      streamGeneration: 12,
      ptid: 'ptid:person:bob',
      conversationId: 'conversation-bob',
      agentId: 'agent-1',
      event: 'text',
      data: { turnId: 'turn-bob', seq: 1 },
      timestampMs: 500,
    });

    expect(useAgentTurnRecoveryStore.getState().active).toEqual({});
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.applyRecoveredTurnEvent).not.toHaveBeenCalled();
  });

  it('uses the canonical PTID supplied by the runtime kernel', async () => {
    mocks.readValue.mockResolvedValueOnce({});
    await chatRuntime.bootstrap('ptid:person:alice');

    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      streamId: 'stream-ptid',
      streamGeneration: 12,
      ptid: 'ptid:person:alice',
      conversationId: 'conversation-ptid',
      agentId: 'agent-1',
      event: 'text',
      data: { turnId: 'turn-ptid', seq: 1 },
      timestampMs: 500,
    });

    expect(useAgentTurnRecoveryStore.getState().actorId).toBe('ptid:person:alice');
    expect(useAgentTurnRecoveryStore.getState().active['conversation-ptid']).toMatchObject({
      actorId: 'ptid:person:alice',
      turnId: 'turn-ptid',
    });
  });

  it('reloads the Station Turn snapshot from the durable replay path', async () => {
    const observed: unknown[] = [];
    eventBus.subscribe(EVENT.AGENT_TURN_STREAM_EVENT, (payload) => observed.push(payload));
    mocks.readValue.mockResolvedValueOnce({
      'conversation-1': activeTurn({
        phase: 'RECOVERY_FAILED',
        failureKey: 'chat.agentTurnRecovery.recoveryFailed',
      }),
    });
    await chatRuntime.bootstrap('ptid:person:alice');
    mocks.replayOnErrors[0](new Error('station unavailable'));
    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active['conversation-1'].phase)
        .toBe('RECOVERY_FAILED');
    });
    mocks.replayControllers.length = 0;
    mocks.replayInputs.length = 0;
    mocks.replayOnEvents.length = 0;
    mocks.replayOnErrors.length = 0;
    mocks.applyRecoveredTurnEvent.mockClear();

    const reload = reloadAgentTurnSnapshot('conversation-1');
    expect(mocks.replayInputs).toEqual([{
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      after_seq: 4,
    }]);
    const terminalData = {
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      seq: 5,
      error: 'station_restart_interrupted',
    };
    mocks.replayOnEvents[0]({
      event: 'error',
      data: terminalData,
      sourceDelivery: {
        transport: 'station-sse',
        ptid: 'ptid:person:alice',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        sequence: 5,
        rawPayload: { eventType: 'error', data: terminalData },
      },
    });
    mocks.replayOnEvents[0](stationSnapshot({
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'interrupted',
        terminal_reason: 'station_restart_interrupted',
        text: 'authoritative replay text',
        seq: 5,
    }));
    const result = await reload;

    await vi.waitFor(() => {
      expect(mocks.reconcileRecoveredTurn).toHaveBeenCalledWith(
        'conversation-1',
        'turn-1',
        {
          status: 'interrupted',
          reason: 'station_restart_interrupted',
          content: 'authoritative replay text',
        },
      );
      expect(useAgentTurnRecoveryStore.getState().active).toEqual({});
    });
    expect(mocks.replayControllers[0].signal.aborted).toBe(true);
    expect(mocks.applyRecoveredTurnEvent).toHaveBeenCalledWith(
      'conversation-1',
      'agent-1',
      'turn-1',
      expect.objectContaining({ event: 'reconciling' }),
    );
    expect(mocks.applyRecoveredTurnEvent).toHaveBeenCalledWith(
      'conversation-1',
      'agent-1',
      'turn-1',
      expect.objectContaining({ event: 'connected' }),
    );
    expect(observed).toContainEqual(expect.objectContaining({
      deliveryOnly: true,
      sourceDelivery: expect.objectContaining({
        transport: 'station-sse',
        turnId: 'turn-1',
        sequence: 5,
      }),
    }));
    expect(observed).toContainEqual(expect.objectContaining({
      event: 'error',
      deliveryOnly: true,
      sourceDelivery: expect.objectContaining({
        transport: 'station-sse',
        turnId: 'turn-1',
        sequence: 5,
      }),
    }));
    expect(result).toMatchObject({
      source: 'station-snapshot-reconcile',
      actorId: 'ptid:person:alice',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      streamId: 'stream-1',
      streamGeneration: 10,
      status: 'interrupted',
      sequence: 5,
      terminal: true,
      terminalStatus: 'interrupted',
      sourceDelivery: {
        transport: 'station-sse',
        ptid: 'ptid:person:alice',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        sequence: 5,
      },
    });
  });

  it('does not report reload progress when the authoritative snapshot is invalid', async () => {
    mocks.readValue.mockResolvedValueOnce({
      'conversation-1': activeTurn({
        phase: 'RECOVERY_FAILED',
        failureKey: 'chat.agentTurnRecovery.recoveryFailed',
        recoveryEpoch: 3,
      }),
    });
    await chatRuntime.bootstrap('ptid:person:alice');
    mocks.replayOnErrors[0](new Error('station unavailable'));
    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active['conversation-1'].phase)
        .toBe('RECOVERY_FAILED');
    });
    mocks.replayControllers.length = 0;
    mocks.replayInputs.length = 0;
    mocks.replayOnEvents.length = 0;
    mocks.replayOnErrors.length = 0;
    mocks.reconcileRecoveredTurn.mockClear();
    const recoveryEpochBefore =
      useAgentTurnRecoveryStore.getState().active['conversation-1'].recoveryEpoch;

    const reload = reloadAgentTurnSnapshot('conversation-1');
    mocks.replayOnEvents[0](stationSnapshot({
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'interrupted',
        terminal_reason: 'station_restart_interrupted',
        seq: 3,
    }));
    await expect(reload).rejects.toThrow('chat.agentTurnRecovery.snapshotInvalid');

    expect(useAgentTurnRecoveryStore.getState().active['conversation-1']).toMatchObject({
      phase: 'RECOVERY_FAILED',
      recoveryEpoch: recoveryEpochBefore,
    });
    expect(mocks.reconcileRecoveredTurn).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileRecoveredTurn).toHaveBeenCalledWith(
      'conversation-1',
      'turn-1',
      null,
    );
  });

  it('reports a non-terminal reload only after authoritative reconciliation succeeds', async () => {
    mocks.readValue.mockResolvedValueOnce({
      'conversation-1': activeTurn({
        phase: 'RECOVERY_FAILED',
        failureKey: 'chat.agentTurnRecovery.recoveryFailed',
      }),
    });
    await chatRuntime.bootstrap('ptid:person:alice');
    mocks.replayOnErrors[0](new Error('station unavailable'));
    await vi.waitFor(() => {
      expect(useAgentTurnRecoveryStore.getState().active['conversation-1'].phase)
        .toBe('RECOVERY_FAILED');
    });
    mocks.replayControllers.length = 0;
    mocks.replayInputs.length = 0;
    mocks.replayOnEvents.length = 0;
    mocks.replayOnErrors.length = 0;
    const reconciliation = deferred<void>();
    mocks.reconcileRecoveredTurn.mockReturnValueOnce(reconciliation.promise);

    const reload = reloadAgentTurnSnapshot('conversation-1');
    mocks.replayOnEvents[0](stationSnapshot({
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        seq: 7,
    }));
    await Promise.resolve();

    const beforeReconciliation =
      useAgentTurnRecoveryStore.getState().active['conversation-1'];
    expect(beforeReconciliation.phase).toBe('RECOVERY_FAILED');
    expect(beforeReconciliation.cursor).toBe(4);

    reconciliation.resolve();
    const result = await reload;

    expect(useAgentTurnRecoveryStore.getState().active['conversation-1']).toMatchObject({
      phase: 'CONNECTED',
      cursor: 7,
    });
    expect(result).toMatchObject({
      source: 'station-snapshot-reconcile',
      status: 'running',
      sequence: 7,
      terminal: false,
      terminalStatus: null,
    });
  });

  it('persists terminal removal and tears down replay when message sync fails', async () => {
    mocks.readValue.mockResolvedValueOnce({ 'conversation-1': activeTurn() });
    mocks.reconcileRecoveredTurn.mockRejectedValueOnce(new Error('sync failed'));
    await chatRuntime.bootstrap('ptid:person:alice');
    expect(mocks.replayOnEvents).toHaveLength(1);

    mocks.replayOnEvents[0]({
      event: 'snapshot',
      data: { status: 'completed', seq: 5 },
    });

    await vi.waitFor(() => {
      expect(mocks.write).toHaveBeenCalledWith('agent-turn-recovery', {});
      expect(mocks.replayControllers[0].signal.aborted).toBe(true);
    });
    expect(useAgentTurnRecoveryStore.getState().active).toEqual({});

    chatRuntime.teardown();
    const lastWrite = mocks.write.mock.calls[mocks.write.mock.calls.length - 1];
    mocks.readValue.mockResolvedValueOnce(lastWrite?.[1]);
    mocks.replayControllers.length = 0;
    mocks.replayOnEvents.length = 0;
    chatRuntime.install();
    await chatRuntime.bootstrap('ptid:person:alice');

    expect(useAgentTurnRecoveryStore.getState().active).toEqual({});
    expect(mocks.replayOnEvents).toHaveLength(0);
  });
});
