import { beforeEach, describe, expect, it } from 'vitest';
import {
  reduceAgentTurnRecovery,
  type ActiveAgentTurnRecovery,
  useAgentTurnRecoveryStore,
} from './agentTurnRecovery';
import { parsePersistedAgentTurnRecoveries } from '../runtimes/chatRuntime';

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

describe('Agent turn recovery projection', () => {
  beforeEach(() => {
    useAgentTurnRecoveryStore.getState().reset();
  });

  it('deduplicates replay by turn_id and sequence', () => {
    const current = activeTurn();
    const reduction = reduceAgentTurnRecovery(
      current.actorId,
      current,
      {
        streamId: current.streamId,
        ptid: current.actorId,
        streamGeneration: current.streamGeneration,
        conversationId: current.conversationId,
        agentId: current.agentId,
        event: 'text',
        data: { turnId: current.turnId, seq: 4, content: 'duplicate' },
        timestampMs: 300,
      },
    );

    expect(reduction).toEqual({
      accepted: false,
      terminal: false,
      record: current,
    });
  });

  it('keeps transport loss non-terminal and advances the explicit recovery FSM', () => {
    const current = activeTurn();
    const lost = reduceAgentTurnRecovery(
      current.actorId,
      current,
      {
        streamId: current.streamId,
        ptid: current.actorId,
        streamGeneration: current.streamGeneration,
        conversationId: current.conversationId,
        agentId: current.agentId,
        event: 'connection_lost',
        data: { turnId: current.turnId, seq: 4 },
        timestampMs: 300,
      },
    );
    const reconnecting = reduceAgentTurnRecovery(
      current.actorId,
      lost.record,
      {
        streamId: current.streamId,
        ptid: current.actorId,
        streamGeneration: current.streamGeneration,
        conversationId: current.conversationId,
        agentId: current.agentId,
        event: 'reconnecting',
        data: { turnId: current.turnId, seq: 4 },
        timestampMs: 301,
      },
    );

    expect(lost.terminal).toBe(false);
    expect(lost.record?.phase).toBe('CONNECTION_LOST');
    expect(reconnecting.record?.phase).toBe('RECONNECTING');
  });

  it('rejects an older recovery result for a newer active turn', () => {
    const current = activeTurn({
      turnId: 'turn-new',
      streamId: 'stream-new',
      streamGeneration: 11,
      updatedAt: 500,
    });
    const reduction = reduceAgentTurnRecovery(
      current.actorId,
      current,
      {
        streamId: 'stream-old',
        ptid: current.actorId,
        streamGeneration: 10,
        conversationId: current.conversationId,
        agentId: current.agentId,
        event: 'snapshot',
        data: {
          turnId: 'turn-old',
          seq: 9,
          status: 'completed',
          text: 'stale',
        },
        timestampMs: 600,
      },
    );

    expect(reduction.accepted).toBe(false);
    expect(reduction.record).toBe(current);
  });

  it('removes a turn only when Station reports a terminal fact', () => {
    const current = activeTurn();
    const running = reduceAgentTurnRecovery(
      current.actorId,
      current,
      {
        streamId: current.streamId,
        ptid: current.actorId,
        streamGeneration: current.streamGeneration,
        conversationId: current.conversationId,
        agentId: current.agentId,
        event: 'snapshot',
        data: { turnId: current.turnId, seq: 5, status: 'running' },
        timestampMs: 300,
      },
    );
    const completed = reduceAgentTurnRecovery(
      current.actorId,
      running.record,
      {
        streamId: current.streamId,
        ptid: current.actorId,
        streamGeneration: current.streamGeneration,
        conversationId: current.conversationId,
        agentId: current.agentId,
        event: 'snapshot',
        data: { turnId: current.turnId, seq: 6, status: 'completed' },
        timestampMs: 301,
      },
    );

    expect(running.terminal).toBe(false);
    expect(running.record?.cursor).toBe(5);
    expect(completed).toEqual({ accepted: true, terminal: true });
  });

  it('accepts an authoritative terminal snapshot at the persisted cursor', () => {
    const current = activeTurn({ cursor: 7 });
    const reduction = reduceAgentTurnRecovery(
      current.actorId,
      current,
      {
        streamId: current.streamId,
        ptid: current.actorId,
        streamGeneration: current.streamGeneration,
        conversationId: current.conversationId,
        agentId: current.agentId,
        event: 'snapshot',
        data: { turnId: current.turnId, seq: 7, status: 'cancelled' },
        timestampMs: 300,
      },
    );

    expect(reduction).toEqual({ accepted: true, terminal: true });
  });

  it.each([
    ['snapshot', { status: 'completed' }],
    ['done', {}],
    ['error', { error: 'provider_failed' }],
    ['cancelled', {}],
    ['done', { seq: 0 }],
  ])('rejects stale terminal event %s below the persisted cursor', (event, data) => {
    const current = activeTurn({ cursor: 7 });
    const reduction = reduceAgentTurnRecovery(
      current.actorId,
      current,
      {
        streamId: current.streamId,
        ptid: current.actorId,
        streamGeneration: current.streamGeneration,
        conversationId: current.conversationId,
        agentId: current.agentId,
        event,
        data: { turnId: current.turnId, seq: 6, ...data },
        timestampMs: 300,
      },
    );

    expect(reduction).toEqual({
      accepted: false,
      terminal: false,
      record: current,
    });
  });

  it('rejects a non-snapshot terminal event at the persisted cursor', () => {
    const current = activeTurn({ cursor: 7 });
    const reduction = reduceAgentTurnRecovery(
      current.actorId,
      current,
      {
        streamId: current.streamId,
        ptid: current.actorId,
        streamGeneration: current.streamGeneration,
        conversationId: current.conversationId,
        agentId: current.agentId,
        event: 'done',
        data: { turnId: current.turnId, seq: 7 },
        timestampMs: 300,
      },
    );

    expect(reduction).toEqual({
      accepted: false,
      terminal: false,
      record: current,
    });
  });

  it('rejects a terminal event without a durable sequence', () => {
    const reduction = reduceAgentTurnRecovery(
      'ptid:person:alice',
      undefined,
      {
        streamId: 'stream-1',
        ptid: 'ptid:person:alice',
        streamGeneration: 1,
        conversationId: 'conversation-1',
        agentId: 'agent-1',
        event: 'done',
        data: { turnId: 'turn-1' },
        timestampMs: 300,
      },
    );

    expect(reduction).toEqual({
      accepted: false,
      terminal: false,
      record: undefined,
    });
  });

  it('rejects an event carrying another actor context', () => {
    const current = activeTurn();
    const reduction = reduceAgentTurnRecovery(
      'ptid:person:bob',
      current,
      {
        streamId: current.streamId,
        ptid: current.actorId,
        streamGeneration: current.streamGeneration,
        conversationId: current.conversationId,
        agentId: current.agentId,
        event: 'text',
        data: { turnId: current.turnId, seq: 5 },
        timestampMs: 300,
      },
    );

    expect(reduction.accepted).toBe(false);
    expect(reduction.record).toBe(current);
  });

  it('loads only actor-matched records whose map key is the conversation id', () => {
    const valid = activeTurn();
    const records = parsePersistedAgentTurnRecoveries(valid.actorId, {
      [valid.conversationId]: valid,
      'wrong-map-key': { ...valid, conversationId: 'conversation-2' },
      'conversation-3': {
        ...valid,
        actorId: 'ptid:person:bob',
        conversationId: 'conversation-3',
      },
    });

    expect(records).toEqual({ [valid.conversationId]: valid });
  });

  it('merges a delayed persisted read without replacing a newer live record', () => {
    const persisted = activeTurn({ cursor: 4, updatedAt: 200 });
    const store = useAgentTurnRecoveryStore.getState();
    store.beginActor(persisted.actorId);
    store.consume(persisted.actorId, {
      streamId: 'stream-live',
      ptid: persisted.actorId,
      streamGeneration: 11,
      conversationId: persisted.conversationId,
      agentId: persisted.agentId,
      event: 'text',
      data: { turnId: 'turn-live', seq: 8, content: 'newer live event' },
      timestampMs: 500,
    });

    useAgentTurnRecoveryStore.getState().mergePersisted(
      persisted.actorId,
      { [persisted.conversationId]: persisted },
    );

    expect(useAgentTurnRecoveryStore.getState().active[persisted.conversationId]).toMatchObject({
      turnId: 'turn-live',
      streamId: 'stream-live',
      streamGeneration: 11,
      cursor: 8,
    });
  });

  it('does not resurrect a persisted turn terminated while bootstrap read was pending', () => {
    const persisted = activeTurn();
    const store = useAgentTurnRecoveryStore.getState();
    store.beginActor(persisted.actorId);
    store.consume(persisted.actorId, {
      streamId: persisted.streamId,
      ptid: persisted.actorId,
      streamGeneration: persisted.streamGeneration,
      conversationId: persisted.conversationId,
      agentId: persisted.agentId,
      event: 'done',
      data: { turnId: persisted.turnId, seq: 5 },
      timestampMs: 500,
    });

    useAgentTurnRecoveryStore.getState().mergePersisted(
      persisted.actorId,
      { [persisted.conversationId]: persisted },
    );

    expect(useAgentTurnRecoveryStore.getState().active).toEqual({});
  });

  it('rejects live records from an actor other than the active bootstrap actor', () => {
    const store = useAgentTurnRecoveryStore.getState();
    store.beginActor('ptid:person:alice');

    const reduction = store.consume('ptid:person:bob', {
      streamId: 'stream-bob',
      ptid: 'ptid:person:bob',
      streamGeneration: 12,
      conversationId: 'conversation-bob',
      agentId: 'agent-1',
      event: 'text',
      data: { turnId: 'turn-bob', seq: 1 },
      timestampMs: 500,
    });

    expect(reduction.accepted).toBe(false);
    expect(useAgentTurnRecoveryStore.getState().active).toEqual({});
  });
});
