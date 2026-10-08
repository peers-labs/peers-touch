import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtelierProjectionSnapshot } from '../../domain/projection';
import { ATELIER_PROJECTION_EVENT_TOPIC } from '../../domain/projection.contract.generated';
import { subscribeAtelierProjectionEvents } from './atelierClient';

const sdkState = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@peers-touch/applet-sdk', () => ({
  sdk: {
    events: {
      on: vi.fn((topic: string, handler: (payload: unknown) => void) => {
        sdkState.handlers.set(topic, handler);
        return () => {
          sdkState.handlers.delete(topic);
        };
      }),
      subscribe: sdkState.subscribe,
      unsubscribe: sdkState.unsubscribe,
    },
    invoke: sdkState.invoke,
  },
}));

function snapshot(): AtelierProjectionSnapshot {
  return {
    version: 'atelier-projection/v0',
    selectedTaskId: 'task-1',
    workspace: {
      budgetSpent: 0,
      budgetCap: 100,
      model: 'direct-model',
      tasks: [{
        id: 'task-1',
        project: 'atelier',
        title: 'Task',
        status: 'active',
        executionStatus: 'running',
        stepId: 'step-1',
        attemptId: 'attempt-1',
        attempt: 1,
      }],
      streams: { 'task-1': [] },
      todos: { 'task-1': [] },
      contexts: { 'task-1': { usedPct: 0, files: [] } },
      artifacts: { 'task-1': [] },
      gates: { 'task-1': [] },
    },
  };
}

function invalidation(id = 'domain-1') {
  return {
    id,
    seq: 1,
    taskId: 'task-1',
    receivedAt: '2026-10-04T00:00:00.000Z',
    patch: {
      kind: 'snapshot.invalidate',
      streamEventId: 'stream-1',
      eventType: 'agent.task.running',
      goalId: 'goal-1',
      taskId: 'task-1',
      goalRevision: 2,
      schemaVersion: 1,
    },
  };
}

beforeEach(() => {
  sdkState.handlers.clear();
  sdkState.subscribe.mockReset();
  sdkState.unsubscribe.mockReset();
  sdkState.invoke.mockReset();
  sdkState.subscribe.mockResolvedValue(undefined);
  sdkState.unsubscribe.mockResolvedValue(undefined);
});

describe('official Atelier canonical projection subscription', () => {
  it('uses only the generic Host topic and delivers canonical invalidations', async () => {
    const seen: unknown[] = [];
    const release = await subscribeAtelierProjectionEvents(
      snapshot(),
      'task-1',
      (event) => seen.push(event),
    );

    expect(sdkState.subscribe).toHaveBeenCalledWith(ATELIER_PROJECTION_EVENT_TOPIC);
    expect(sdkState.invoke).not.toHaveBeenCalled();

    sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.(invalidation());
    expect(seen).toEqual([invalidation()]);

    release();
    expect(sdkState.unsubscribe).toHaveBeenCalledWith(ATELIER_PROJECTION_EVENT_TOPIC);
    sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.(invalidation('late'));
    expect(seen).toHaveLength(1);
  });

  it('surfaces malformed payloads without advancing projection state', async () => {
    const malformed: unknown[] = [];
    const release = await subscribeAtelierProjectionEvents(
      snapshot(),
      'task-1',
      () => undefined,
      (payload) => malformed.push(payload),
    );

    const payload = { id: 'bad', seq: 1, patch: { kind: 'snapshot.invalidate' } };
    sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.(payload);
    expect(malformed).toEqual([payload]);
    release();
  });

  it('requests authoritative reconciliation for canonical Resync', async () => {
    const onResync = vi.fn();
    const release = await subscribeAtelierProjectionEvents(
      snapshot(),
      'task-1',
      () => undefined,
      undefined,
      undefined,
      onResync,
    );

    sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.({
      kind: 'atelier.projection.resync',
      eventId: 'stream-resync',
      newestEventId: 'stream-20',
      reason: 'cursor outside retained window',
    });
    expect(onResync).toHaveBeenCalledOnce();
    release();
  });

  it('cleans the local handler and Host topic when subscription fails', async () => {
    sdkState.subscribe.mockRejectedValueOnce(new Error('topic denied'));
    await expect(subscribeAtelierProjectionEvents(
      snapshot(),
      'task-1',
      () => undefined,
    )).rejects.toThrow('topic denied');

    expect(sdkState.handlers.has(ATELIER_PROJECTION_EVENT_TOPIC)).toBe(false);
    expect(sdkState.unsubscribe).toHaveBeenCalledWith(ATELIER_PROJECTION_EVENT_TOPIC);
    expect(sdkState.invoke).not.toHaveBeenCalled();
  });
});
