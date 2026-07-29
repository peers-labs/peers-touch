import { describe, expect, it } from 'vitest';
import type {
  AtelierProjectionEvent,
  AtelierProjectionSnapshot,
  AtelierTask,
} from '../domain/projection';
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
});
