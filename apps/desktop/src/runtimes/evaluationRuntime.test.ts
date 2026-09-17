import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVENT } from '../kernel/events/catalog';

const handlers = vi.hoisted(
  () => new Map<string, (payload: unknown) => void>(),
);
const loadProjection = vi.hoisted(() => vi.fn());
const consumeRunEvents = vi.hoisted(() => vi.fn());
const refreshRun = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn());
const setActorScope = vi.hoisted(() => vi.fn());
const loadAgents = vi.hoisted(() => vi.fn());
const loadAgent = vi.hoisted(() => vi.fn());
const evaluationState = vi.hoisted(() => ({
  projectionPhase: 'idle',
  loadProjection,
  consumeRunEvents,
  refreshRun,
  reset,
  setActorScope,
}));

vi.mock('../kernel/events/bus', () => ({
  eventBus: {
    subscribe: vi.fn((
      event: string,
      handler: (payload: unknown) => void,
    ) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    }),
  },
}));

vi.mock('../store/evaluation', () => ({
  useEvaluationStore: {
    getState: () => evaluationState,
  },
}));

vi.mock('../store/agent', () => ({
  useAgentStore: {
    getState: () => ({
      agents: [{ id: 'agent-1' }],
      loadAgents,
    }),
  },
}));

vi.mock('../store/agentCapabilities', () => ({
  useAgentCapabilityStore: {
    getState: () => ({ loadAgent }),
  },
}));

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { evaluationRuntime } from './evaluationRuntime';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('evaluationRuntime', () => {
  beforeEach(() => {
    evaluationRuntime.teardown();
    handlers.clear();
    vi.clearAllMocks();
    evaluationState.projectionPhase = 'idle';
    loadProjection.mockImplementation(async () => {
      evaluationState.projectionPhase = 'ready';
    });
    loadAgents.mockResolvedValue(undefined);
    loadAgent.mockResolvedValue(undefined);
    consumeRunEvents.mockResolvedValue(undefined);
    refreshRun.mockResolvedValue(undefined);
  });

  afterEach(() => {
    evaluationRuntime.teardown();
  });

  it('bootstraps once per actor and restores Station projection truth', async () => {
    evaluationRuntime.install();

    await evaluationRuntime.bootstrap('ptid:actor-1');
    await evaluationRuntime.bootstrap('ptid:actor-1');

    expect(setActorScope).toHaveBeenCalledOnce();
    expect(setActorScope).toHaveBeenCalledWith('ptid:actor-1');
    expect(loadProjection).toHaveBeenCalledOnce();
    expect(loadProjection).toHaveBeenCalledWith('ptid:actor-1', 'bootstrap');
    expect(loadAgents).toHaveBeenCalledOnce();
    expect(loadAgent).toHaveBeenCalledWith('agent-1');
  });

  it('consumes run invalidation events through authoritative readback', async () => {
    evaluationRuntime.install();
    await evaluationRuntime.bootstrap('ptid:actor-1');

    handlers.get(EVENT.EVALUATION_PROJECTION_INVALIDATED)?.({
      reason: 'run-started',
      runId: 'run-1',
    });
    await vi.waitFor(() => {
      expect(refreshRun).toHaveBeenCalledWith('run-1');
    });
  });

  it('queues a reconciliation requested during an in-flight bootstrap', async () => {
    const first = deferred();
    loadProjection
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    evaluationRuntime.install();

    const bootstrap = evaluationRuntime.bootstrap('ptid:actor-1');
    handlers.get(EVENT.EVALUATION_PROJECTION_INVALIDATED)?.({
      reason: 'benchmark-created',
    });
    first.resolve();
    await bootstrap;

    await vi.waitFor(() => {
      expect(loadProjection).toHaveBeenCalledTimes(2);
      expect(loadProjection).toHaveBeenLastCalledWith(
        'ptid:actor-1',
        'reconcile',
      );
    });
  });
});
