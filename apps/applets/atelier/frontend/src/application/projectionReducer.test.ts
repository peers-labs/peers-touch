import { describe, expect, it } from 'vitest';
import type {
  AtelierProjectionEvent,
  AtelierProjectionSnapshot,
  AtelierTask,
} from '../domain/projection';
import { isAtelierProjectionPatch } from '../domain/projection';
import {
  applyAtelierProjectionEventWithResult,
  createAtelierProjectionRuntimeState,
  stateFromAtelierSnapshot,
} from './projectionReducer';

function task(id: string, title = id): AtelierTask {
  return {
    id,
    project: `project-${id}`,
    title,
    status: 'active',
    executionStatus: 'pending',
    stepId: `step-${id}`,
    attemptId: `attempt-${id}`,
    attempt: 1,
  };
}

function snapshot(tasks = [task('task-a')], selectedTaskId = tasks[0]?.id ?? ''): AtelierProjectionSnapshot {
  return {
    version: 'atelier-projection/v0',
    selectedTaskId,
    workspace: {
      budgetSpent: 0,
      budgetCap: 100,
      model: 'model-a',
      tasks,
      streams: Object.fromEntries(tasks.map((item) => [item.id, []])),
      todos: Object.fromEntries(tasks.map((item) => [item.id, []])),
      contexts: Object.fromEntries(tasks.map((item) => [item.id, { usedPct: 0, files: [] }])),
      artifacts: Object.fromEntries(tasks.map((item) => [item.id, []])),
      gates: Object.fromEntries(tasks.map((item) => [item.id, []])),
    },
  };
}

function event(overrides: Partial<AtelierProjectionEvent>): AtelierProjectionEvent {
  return {
    id: overrides.id ?? `evt-${overrides.seq ?? 1}`,
    seq: overrides.seq ?? 1,
    taskId: overrides.taskId,
    receivedAt: overrides.receivedAt ?? '2026-07-07T00:00:00.000Z',
    patch: overrides.patch ?? { kind: 'snapshot', snapshot: snapshot() },
  };
}

describe('Atelier projection reducer', () => {
  it('accepts stable migration identities and rejects inferred canonical links', () => {
    expect(isAtelierProjectionPatch({
      kind: 'task.upsert',
      task: {
        ...task('task-native'),
        projectId: 'goal-native',
        goalId: 'goal-native',
        taskRunId: 'task-native',
      },
    })).toBe(true);
    expect(isAtelierProjectionPatch({
      kind: 'task.upsert',
      task: {
        ...task('legacy-task'),
        projectId: 'goal-canonical',
        goalId: 'goal-canonical',
        taskRunId: 'legacy-task',
        legacySourceId: 'legacy-task',
        migrationState: 'migrated',
      },
    })).toBe(true);
    expect(isAtelierProjectionPatch({
      kind: 'task.upsert',
      task: {
        ...task('legacy-task'),
        projectId: 'legacy-project',
        goalId: 'goal-canonical',
        taskRunId: 'legacy-task',
        legacySourceId: 'legacy-task',
        migrationState: 'migrated',
      },
    })).toBe(false);
    expect(isAtelierProjectionPatch({
      kind: 'task.upsert',
      task: {
        ...task('legacy-task'),
        legacySourceId: 'legacy-task',
        migrationState: 'blocked',
        migrationBlockReason: 'identity_metadata_ambiguous',
      },
    })).toBe(true);
  });

  it('initializes from snapshots and falls back to the first task when selected task is empty', () => {
    const state = stateFromAtelierSnapshot(snapshot([task('task-a'), task('task-b')], ''));

    expect(state.selectedTaskId).toBe('task-a');
    expect(state.snapshot?.selectedTaskId).toBe('');
    expect(state.seenEventKeys).toEqual([]);
    expect(state.lastSeqByScope).toEqual({});
  });

  it('applies snapshot events to an empty runtime state and records workspace sequence', () => {
    const result = applyAtelierProjectionEventWithResult(
      createAtelierProjectionRuntimeState(),
      event({
        id: 'snapshot-1',
        seq: 3,
        patch: { kind: 'snapshot', snapshot: snapshot([task('task-a')]) },
      }),
    );

    expect(result.outcome).toBe('applied');
    expect(result.state.selectedTaskId).toBe('task-a');
    expect(result.state.seenEventKeys).toEqual(['id:snapshot-1']);
    expect(result.state.lastSeqByScope).toEqual({ workspace: 3 });
  });

  it('rejects duplicate and stale events without mutating the last valid projection', () => {
    const current = stateFromAtelierSnapshot(snapshot([task('task-a')]));
    const first = applyAtelierProjectionEventWithResult(
      current,
      event({
        id: 'stream-1',
        seq: 4,
        taskId: 'task-a',
        patch: { kind: 'stream.append', taskId: 'task-a', blocks: [{ id: 'block-a', kind: 'text', text: 'A' }] },
      }),
    );
    const duplicate = applyAtelierProjectionEventWithResult(first.state, {
      ...event({
        id: 'stream-1',
        seq: 5,
        taskId: 'task-a',
        patch: { kind: 'stream.append', taskId: 'task-a', blocks: [{ id: 'block-b', kind: 'text', text: 'B' }] },
      }),
    });
    const stale = applyAtelierProjectionEventWithResult(first.state, event({
      id: 'stream-0',
      seq: 4,
      taskId: 'task-a',
      patch: { kind: 'stream.append', taskId: 'task-a', blocks: [{ id: 'block-c', kind: 'text', text: 'C' }] },
    }));

    expect(first.outcome).toBe('applied');
    expect(duplicate.outcome).toBe('duplicate');
    expect(stale.outcome).toBe('stale');
    expect(duplicate.state).toBe(first.state);
    expect(stale.state).toBe(first.state);
    expect(first.state.snapshot?.workspace.streams['task-a']).toEqual([{ id: 'block-a', kind: 'text', text: 'A' }]);
  });

  it('deduplicates canonical invalidations and detects sequence gaps before readback', () => {
    const current = stateFromAtelierSnapshot(snapshot([task('task-a')]));
    const invalidation = (id: string, seq: number): AtelierProjectionEvent => event({
      id,
      seq,
      taskId: 'task-a',
      patch: {
        kind: 'snapshot.invalidate',
        streamEventId: `stream-${seq}`,
        eventType: 'agent.task.running',
        goalId: 'goal-1',
        taskId: 'task-a',
        goalRevision: seq,
        schemaVersion: 1,
      },
    });

    const first = applyAtelierProjectionEventWithResult(current, invalidation('domain-1', 1));
    const duplicate = applyAtelierProjectionEventWithResult(first.state, invalidation('domain-1', 1));
    const gap = applyAtelierProjectionEventWithResult(first.state, invalidation('domain-3', 3));

    expect(first.outcome).toBe('reconcile');
    expect(first.state.snapshot).toBe(current.snapshot);
    expect(duplicate.outcome).toBe('duplicate');
    expect(gap.outcome).toBe('gap');
    expect(gap.state.lastSeqByScope['task:task-a']).toBe(3);
  });

  it('rejects non-snapshot patches for unknown tasks while allowing selected task upsert', () => {
    const current = stateFromAtelierSnapshot(snapshot([task('task-a')]));
    const unknown = applyAtelierProjectionEventWithResult(current, event({
      id: 'unknown-stream',
      seq: 1,
      taskId: 'missing-task',
      patch: { kind: 'stream.append', taskId: 'missing-task', blocks: [{ id: 'block-a', kind: 'text' }] },
    }));
    const upsert = applyAtelierProjectionEventWithResult(current, event({
      id: 'upsert-task',
      seq: 1,
      taskId: 'task-b',
      patch: { kind: 'task.upsert', task: task('task-b', 'Task B'), select: true },
    }));

    expect(unknown.outcome).toBe('unknown-task');
    expect(unknown.state).toBe(current);
    expect(upsert.outcome).toBe('applied');
    expect(upsert.state.selectedTaskId).toBe('task-b');
    expect(upsert.state.snapshot?.workspace.tasks.map((item) => item.id)).toEqual(['task-b', 'task-a']);
  });

  it('appends stream blocks once and resolves decisions on the selected task', () => {
    const base = snapshot([task('task-a')]);
    base.workspace.streams['task-a'] = [
      { id: 'decision-a', kind: 'decision', question: 'Proceed?', options: [{ text: 'Continue' }] },
    ];
    const current = stateFromAtelierSnapshot(base);
    const appended = applyAtelierProjectionEventWithResult(current, event({
      id: 'append-blocks',
      seq: 1,
      taskId: 'task-a',
      patch: {
        kind: 'stream.append',
        taskId: 'task-a',
        blocks: [
          { id: 'block-a', kind: 'text', text: 'A' },
          { id: 'block-a', kind: 'text', text: 'A duplicate' },
        ],
      },
    }));
    const resolved = applyAtelierProjectionEventWithResult(appended.state, event({
      id: 'resolve-decision',
      seq: 2,
      taskId: 'task-a',
      patch: { kind: 'decision.resolved', taskId: 'task-a', blockId: 'decision-a', choice: 'Continue' },
    }));

    expect(appended.state.snapshot?.workspace.streams['task-a'].map((block) => block.id)).toEqual([
      'decision-a',
      'block-a',
    ]);
    expect(resolved.state.snapshot?.workspace.streams['task-a'][0]).toMatchObject({
      id: 'decision-a',
      chosen: 'Continue',
    });
  });

  it('updates task metadata and projection indexes without exposing execution ownership', () => {
    const current = stateFromAtelierSnapshot(snapshot([task('task-a')]));
    const status = applyAtelierProjectionEventWithResult(current, event({
      id: 'task-status',
      seq: 1,
      taskId: 'task-a',
      patch: { kind: 'task.status', taskId: 'task-a', status: 'archived' },
    }));
    const artifact = applyAtelierProjectionEventWithResult(status.state, event({
      id: 'artifact',
      seq: 2,
      taskId: 'task-a',
      patch: { kind: 'artifact.upsert', taskId: 'task-a', artifact: { id: 'artifact-a', name: 'Artifact' } },
    }));
    const gate = applyAtelierProjectionEventWithResult(artifact.state, event({
      id: 'gate',
      seq: 3,
      taskId: 'task-a',
      patch: { kind: 'gate.upsert', taskId: 'task-a', gate: { id: 'gate-a', name: 'Gate', status: 'passed' } },
    }));
    const context = applyAtelierProjectionEventWithResult(gate.state, event({
      id: 'context',
      seq: 4,
      taskId: 'task-a',
      patch: { kind: 'context.replace', taskId: 'task-a', context: { usedPct: 42, files: [{ name: 'a.ts', group: 'hot' }] } },
    }));
    const todo = applyAtelierProjectionEventWithResult(context.state, event({
      id: 'todo',
      seq: 5,
      taskId: 'task-a',
      patch: { kind: 'todo.replace', taskId: 'task-a', todos: [{ id: 'todo-a', text: 'Review', status: 'open' }] },
    }));

    expect(todo.state.snapshot?.workspace.tasks[0].status).toBe('archived');
    expect(todo.state.snapshot?.workspace.artifacts['task-a']).toEqual([{ id: 'artifact-a', name: 'Artifact' }]);
    expect(todo.state.snapshot?.workspace.gates?.['task-a']).toEqual([{ id: 'gate-a', name: 'Gate', status: 'passed' }]);
    expect(todo.state.snapshot?.workspace.contexts['task-a']).toEqual({ usedPct: 42, files: [{ name: 'a.ts', group: 'hot' }] });
    expect(todo.state.snapshot?.workspace.todos['task-a']).toEqual([{ id: 'todo-a', text: 'Review', status: 'open' }]);
  });

  it('normalizes unknown snapshot and event TaskRun states to unavailable', () => {
    const unknownSnapshot = snapshot([{
      ...task('task-a'),
      executionStatus: 'future_state',
    } as unknown as AtelierTask]);
    const current = stateFromAtelierSnapshot(unknownSnapshot);

    expect(current.snapshot?.workspace.tasks[0].executionStatus).toBe('unavailable');

    const updated = applyAtelierProjectionEventWithResult(current, event({
      id: 'unknown-taskrun-status',
      seq: 1,
      taskId: 'task-a',
      patch: {
        kind: 'task.executionStatus',
        taskId: 'task-a',
        status: 'another_future_state',
      },
    }));

    expect(updated.outcome).toBe('applied');
    expect(updated.state.snapshot?.workspace.tasks[0].executionStatus).toBe('unavailable');
  });
});
