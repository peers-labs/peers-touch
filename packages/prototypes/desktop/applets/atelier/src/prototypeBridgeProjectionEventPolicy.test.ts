import { describe, expect, it } from 'vitest';

import type { AtelierProjectionEvent } from './projection';
import type { AtelierRuntimeSnapshot } from './runtime';
import type { Artifact, GateResult, Task } from './types';
import {
  applyPrototypeBridgeProjectionPatch,
  canApplyPrototypeBridgeProjectionPatch,
  createPrototypeBridgeProjectionEventMemory,
  MAX_PROTOTYPE_BRIDGE_PROJECTION_EVENT_KEYS,
  prototypeBridgeProjectionEventKey,
  prototypeBridgeProjectionSubscriptionRejectedError,
  rememberPrototypeBridgeProjectionEvent,
  rememberPrototypeBridgeProjectionSeq,
} from './prototypeBridgeProjectionEventPolicy';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    project: 'atelier',
    title: 'Build Atelier',
    status: 'active',
    ...overrides,
  };
}

function snapshot(): AtelierRuntimeSnapshot {
  return {
    selectedTaskId: 'task-1',
    state: {
      budgetSpent: 0,
      budgetCap: 1,
      model: 'openrouter-3o',
      tasks: [task()],
      selectedTaskId: 'task-1',
      stream: {
        'task-1': [
          { kind: 'agent', id: 'block-existing', text: 'Existing', at: 'now' },
          {
            kind: 'decision',
            id: 'decision-1',
            question: 'Continue?',
            spentSoFar: '$0.10',
            options: [{ text: 'Continue', recommended: true }],
            rollbackImpact: 'none',
          },
        ],
      },
      todos: {},
      context: {},
      artifacts: {},
      gates: {},
    },
  };
}

function event(overrides: Partial<AtelierProjectionEvent> = {}): AtelierProjectionEvent {
  return {
    version: 'atelier-projection/v0',
    id: 'evt-1',
    seq: 1,
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [] },
    ...overrides,
  };
}

describe('prototype bridge projection event policy', () => {
  it('keeps task-scoped patches fail-closed unless the task is known or being created', () => {
    const current = snapshot();

    expect(canApplyPrototypeBridgeProjectionPatch(current, { kind: 'stream.append', taskId: 'task-1', blocks: [] })).toBe(true);
    expect(canApplyPrototypeBridgeProjectionPatch(current, { kind: 'stream.append', taskId: 'task-unknown', blocks: [] })).toBe(false);
    expect(canApplyPrototypeBridgeProjectionPatch(current, { kind: 'task.upsert', task: task({ id: 'task-new' }) })).toBe(true);
  });

  it('applies projection patches without creating execution capabilities', () => {
    const artifact: Artifact = {
      id: 'artifact-1',
      name: 'Report',
      kind: 'markdown',
      meta: 'Station artifact metadata',
      bodyRef: 'artifact://task-1/artifact-1/body',
    };
    const gate: GateResult = {
      id: 'gate-1',
      name: 'Prototype gate',
      status: 'passed',
      summary: 'Passed locally',
      checks: [{ name: 'unit', status: 'passed' }],
    };
    const afterStream = applyPrototypeBridgeProjectionPatch(snapshot(), {
      kind: 'stream.append',
      taskId: 'task-1',
      blocks: [
        { kind: 'agent', id: 'block-existing', text: 'duplicate', at: 'now' },
        { kind: 'agent', id: 'block-new', text: 'New', at: 'now' },
      ],
    });
    const afterDecision = applyPrototypeBridgeProjectionPatch(afterStream, {
      kind: 'decision.resolved',
      taskId: 'task-1',
      blockId: 'decision-1',
      choice: 'Continue',
    });
    const afterArtifact = applyPrototypeBridgeProjectionPatch(afterDecision, {
      kind: 'artifact.upsert',
      taskId: 'task-1',
      artifact,
    });
    const afterGate = applyPrototypeBridgeProjectionPatch(afterArtifact, {
      kind: 'gate.upsert',
      taskId: 'task-1',
      gate,
    });
    const afterContext = applyPrototypeBridgeProjectionPatch(afterGate, {
      kind: 'context.replace',
      taskId: 'task-1',
      context: { files: [{ path: 'src/index.ts', reason: 'projected' }], other: ['note'] },
    });
    const afterTodo = applyPrototypeBridgeProjectionPatch(afterContext, {
      kind: 'todo.replace',
      taskId: 'task-1',
      todos: [{ id: 'todo-1', text: 'Review', status: 'open' }],
    });

    expect(afterTodo.state.stream['task-1']).toHaveLength(3);
    expect(afterTodo.state.stream['task-1']?.find((block) => block.id === 'decision-1')).toMatchObject({ chosen: 'Continue' });
    expect(afterTodo.state.artifacts['task-1']).toEqual([artifact]);
    expect(afterTodo.state.gates['task-1']).toEqual([gate]);
    expect(afterTodo.state.context['task-1']?.files[0]?.path).toBe('src/index.ts');
    expect(afterTodo.state.todos['task-1']?.[0]?.text).toBe('Review');
    expect(JSON.stringify(afterTodo)).not.toMatch(/provider\.invoke|model\.run|cli\.execute|shell\.execute|file\.open|gate\.run|input_snapshot/);
  });

  it('keeps accepted event patch object mutations from polluting runtime-owned state', () => {
    const patch = {
      kind: 'stream.append',
      taskId: 'task-1',
      blocks: [{ kind: 'agent', id: 'block-owned', text: 'Owned patch block', at: 'now' }],
    } as const;
    const afterPatch = applyPrototypeBridgeProjectionPatch(snapshot(), patch);

    patch.blocks[0].text = 'Externally mutated patch block';
    patch.blocks.push({ kind: 'agent', id: 'block-external', text: 'External patch mutation', at: 'now' });

    expect(afterPatch.state.stream['task-1']?.find((block) => block.id === 'block-owned')).toMatchObject({
      text: 'Owned patch block',
    });
    expect(afterPatch.state.stream['task-1']?.some((block) => block.id === 'block-external')).toBe(false);
    expect(JSON.stringify(afterPatch)).not.toMatch(/provider\.invoke|model\.run|cli\.execute|shell\.execute|file\.open|gate\.run|input_snapshot/);
  });

  it('keeps snapshot patch object mutations from polluting runtime-owned state', () => {
    const snapshotPatch = {
      kind: 'snapshot',
      snapshot: {
        version: 'atelier-projection/v0',
        selectedTaskId: 'task-1',
        workspace: {
          budgetSpent: 0,
          budgetCap: 1,
          model: 'openrouter-3o',
          tasks: [task({ title: 'Owned snapshot patch task' })],
          streams: { 'task-1': [] },
          todos: { 'task-1': [] },
          contexts: { 'task-1': { usedPct: 0, files: [] } },
          artifacts: { 'task-1': [] },
          gates: { 'task-1': [] },
        },
      },
    } as const;
    const afterPatch = applyPrototypeBridgeProjectionPatch(snapshot(), snapshotPatch);

    snapshotPatch.snapshot.workspace.tasks[0].title = 'Externally mutated snapshot patch task';
    snapshotPatch.snapshot.workspace.tasks.push(task({ id: 'task-external', title: 'External snapshot mutation' }));

    expect(afterPatch.state.tasks[0].title).toBe('Owned snapshot patch task');
    expect(afterPatch.state.tasks.some((item) => item.id === 'task-external')).toBe(false);
    expect(JSON.stringify(afterPatch)).not.toMatch(/provider\.invoke|model\.run|cli\.execute|shell\.execute|file\.open|gate\.run|input_snapshot/);
  });

  it('deduplicates projection events with a bounded cache and keeps stale replay fail-closed by scope seq', () => {
    const memory = createPrototypeBridgeProjectionEventMemory();
    const first = event({ id: 'evt-first', seq: 1 });

    expect(prototypeBridgeProjectionEventKey(first)).toBe('id:evt-first');
    expect(rememberPrototypeBridgeProjectionEvent(first, memory)).toBe(true);
    expect(rememberPrototypeBridgeProjectionEvent(first, memory)).toBe(false);
    expect(rememberPrototypeBridgeProjectionSeq(first, memory)).toBe(true);

    for (let seq = 2; seq <= MAX_PROTOTYPE_BRIDGE_PROJECTION_EVENT_KEYS + 2; seq += 1) {
      expect(rememberPrototypeBridgeProjectionEvent(event({ id: `evt-${seq}`, seq }), memory)).toBe(true);
      expect(rememberPrototypeBridgeProjectionSeq(event({ id: `evt-${seq}`, seq }), memory)).toBe(true);
    }

    expect(memory.seenEventKeys.size).toBe(MAX_PROTOTYPE_BRIDGE_PROJECTION_EVENT_KEYS);
    expect(memory.seenEventKeys.has('id:evt-first')).toBe(false);
    expect(rememberPrototypeBridgeProjectionEvent(first, memory)).toBe(true);
    expect(rememberPrototypeBridgeProjectionSeq(first, memory)).toBe(false);
  });

  it('tracks stale sequence rejection per workspace or task scope', () => {
    const memory = createPrototypeBridgeProjectionEventMemory();

    expect(rememberPrototypeBridgeProjectionSeq(event({ id: '', seq: 1, taskId: 'task-1' }), memory)).toBe(true);
    expect(rememberPrototypeBridgeProjectionSeq(event({ id: '', seq: 1, taskId: 'task-2' }), memory)).toBe(true);
    expect(rememberPrototypeBridgeProjectionSeq(event({ id: '', seq: 1, taskId: undefined }), memory)).toBe(true);
    expect(rememberPrototypeBridgeProjectionSeq(event({ id: '', seq: 1, taskId: 'task-1' }), memory)).toBe(false);
    expect(prototypeBridgeProjectionEventKey(event({ id: '', seq: 2, taskId: 'task-1' }))).toBe('seq:task-1:2');
  });

  it('builds stable subscription rejection errors without exposing execution payloads', () => {
    const codedError = prototypeBridgeProjectionSubscriptionRejectedError({
      kind: 'atelier.projection.subscription-rejected',
      method: 'events.subscribe',
      code: 'CONNECTION_CLOSED',
      reason: 'FORBIDDEN',
      providerInvoke: { provider: 'model' },
      runtimeExecute: { taskId: 'task-1' },
      input_snapshot: { prompt: 'must not leak' },
    });
    expect(codedError?.message).toBe('Atelier projection stream subscription events.subscribe rejected: FORBIDDEN');
    expect((codedError as Error & { cause?: unknown }).cause).toEqual({
      kind: 'atelier.projection.subscription-rejected',
      method: 'events.subscribe',
      code: 'CONNECTION_CLOSED',
      reason: 'FORBIDDEN',
    });
    expect(JSON.stringify((codedError as Error & { cause?: unknown }).cause)).not.toMatch(
      /provider\.invoke|providerInvoke|runtime\.execute|runtimeExecute|shell|memory\.write|input_snapshot|run\.execute/,
    );
    const malformedError = prototypeBridgeProjectionSubscriptionRejectedError({
      kind: 'atelier.projection.subscription-rejected',
      method: '',
      code: { nested: 'CONNECTION_CLOSED' },
      reason: { nested: 'do not trust malformed reason' },
      shellExecute: { command: 'open .' },
    });
    expect(malformedError?.message).toBe('Atelier projection stream subscription unknown rejected: unknown rejection');
    expect((malformedError as Error & { cause?: unknown }).cause).toEqual({
      kind: 'atelier.projection.subscription-rejected',
      method: 'unknown',
      reason: 'unknown rejection',
    });
    expect(JSON.stringify((malformedError as Error & { cause?: unknown }).cause)).not.toMatch(/shellExecute|CONNECTION_CLOSED|do not trust malformed reason/);
    expect(prototypeBridgeProjectionSubscriptionRejectedError({ kind: 'other' })).toBeUndefined();
    expect(prototypeBridgeProjectionSubscriptionRejectedError('bad')).toBeUndefined();
  });

  it('sanitizes typed subscription rejection reason text before message and cause construction', () => {
    const codedError = prototypeBridgeProjectionSubscriptionRejectedError({
      kind: 'atelier.projection.subscription-rejected',
      method: 'events.subscribe',
      code: 'CONNECTION_CLOSED',
      reason: 'providerInvoke runtimeExecute shellExecute input_snapshot should not leak',
    });

    expect(codedError?.message).toBe(
      'Atelier projection stream subscription events.subscribe rejected: Host projection subscription rejected',
    );
    expect((codedError as Error & { cause?: unknown }).cause).toEqual({
      kind: 'atelier.projection.subscription-rejected',
      method: 'events.subscribe',
      code: 'CONNECTION_CLOSED',
      reason: 'Host projection subscription rejected',
    });
    expect(JSON.stringify({ message: codedError?.message, cause: (codedError as Error & { cause?: unknown }).cause })).not.toMatch(
      /provider\.invoke|providerInvoke|runtime\.execute|runtimeExecute|shellExecute|memory\.write|input_snapshot|run\.execute/,
    );
  });

  it('keeps only known typed subscription rejection recovery codes in sanitized cause', () => {
    const normalizedError = prototypeBridgeProjectionSubscriptionRejectedError({
      kind: 'atelier.projection.subscription-rejected',
      method: 'events.subscribe',
      code: 'connection_closed',
      reason: 'stream closed',
    });

    expect((normalizedError as Error & { cause?: unknown }).cause).toEqual({
      kind: 'atelier.projection.subscription-rejected',
      method: 'events.subscribe',
      code: 'CONNECTION_CLOSED',
      reason: 'stream closed',
    });

    const hostileCodeError = prototypeBridgeProjectionSubscriptionRejectedError({
      kind: 'atelier.projection.subscription-rejected',
      method: 'events.subscribe',
      code: 'providerInvoke runtimeExecute shellExecute input_snapshot should not leak',
      reason: 'host sent unknown code',
    });

    expect((hostileCodeError as Error & { cause?: unknown }).cause).toEqual({
      kind: 'atelier.projection.subscription-rejected',
      method: 'events.subscribe',
      reason: 'host sent unknown code',
    });
    expect(JSON.stringify((hostileCodeError as Error & { cause?: unknown }).cause)).not.toMatch(
      /providerInvoke|runtimeExecute|shellExecute|input_snapshot/,
    );
  });
});
