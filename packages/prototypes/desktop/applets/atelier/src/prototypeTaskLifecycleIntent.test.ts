import { describe, expect, it } from 'vitest';
import {
  buildPrototypeTaskLifecycleRequestKey,
  buildPrototypeTaskPurgeProjection,
  buildPrototypeTaskPurgeIntent,
  buildPrototypeTaskStatusProjection,
  buildPrototypeTaskStatusIntent,
  shouldApplyPrototypeTaskLifecycleSnapshot,
} from './prototypeTaskLifecycleIntent';
import type { AtelierState } from './types';

function state(input: Partial<AtelierState> = {}): AtelierState {
  return {
    budgetSpent: 0,
    budgetCap: 100,
    model: 'claude-sonnet',
    tasks: [],
    selectedTaskId: 'task-1',
    stream: {},
    todos: {},
    context: {},
    artifacts: {},
    gates: {},
    ...input,
  };
}

describe('buildPrototypeTaskStatusIntent', () => {
  it('builds Station-owned setStatus intents from generated lifecycle status values', () => {
    expect(buildPrototypeTaskStatusIntent({
      taskId: ' task-1 ',
      status: ' archived ',
    })).toEqual({
      status: 'setStatus',
      taskId: 'task-1',
      taskStatus: 'archived',
    });
  });

  it('blocks empty task ids before setting lifecycle status', () => {
    expect(buildPrototypeTaskStatusIntent({
      taskId: ' ',
      status: 'deleted',
    })).toEqual({ status: 'invalid' });
  });

  it('rejects execution-shaped status values before runtime calls', () => {
    for (const status of ['running', 'succeeded', 'failed', 'paused', 'blocked', 'execute']) {
      expect(buildPrototypeTaskStatusIntent({
        taskId: 'task-1',
        status,
      })).toEqual({ status: 'invalid' });
    }
  });

  it('projects generated task lifecycle status without creating execution payloads', () => {
    const next = buildPrototypeTaskStatusProjection({
      state: state({
        tasks: [
          { id: 'task-1', project: 'peers-touch', title: 'Task 1', status: 'active', running: true },
          { id: 'task-2', project: 'peers-touch', title: 'Task 2', status: 'active', running: true },
        ],
      }),
      taskId: ' task-1 ',
      status: 'archived',
    });

    expect(next.tasks).toEqual([
      { id: 'task-1', project: 'peers-touch', title: 'Task 1', status: 'archived', running: false },
      { id: 'task-2', project: 'peers-touch', title: 'Task 2', status: 'active', running: true },
    ]);
    expect(JSON.stringify(next.tasks)).not.toMatch(/provider\.invoke|runtime\.execute|shell|input_snapshot|memory\.write/);
  });

  it('preserves running metadata when projecting active lifecycle status', () => {
    expect(buildPrototypeTaskStatusProjection({
      state: state({
        tasks: [
          { id: 'task-1', project: 'peers-touch', title: 'Task 1', status: 'archived', running: true },
        ],
      }),
      taskId: 'task-1',
      status: 'active',
    }).tasks[0]).toMatchObject({
      status: 'active',
      running: true,
    });
  });

  it('keeps invalid task lifecycle projection input as a no-op state update', () => {
    const current = state({
      tasks: [{ id: 'task-1', project: 'peers-touch', title: 'Task 1', status: 'active' }],
    });

    expect(buildPrototypeTaskStatusProjection({
      state: current,
      taskId: ' ',
      status: 'archived',
    })).toBe(current);
  });
});

describe('buildPrototypeTaskPurgeIntent', () => {
  it('builds Station-owned purge intents from task ids only', () => {
    expect(buildPrototypeTaskPurgeIntent({
      taskId: ' task-1 ',
      taskStatus: 'deleted',
    })).toEqual({
      status: 'purge',
      taskId: 'task-1',
    });
  });

  it('blocks empty task ids before purging', () => {
    expect(buildPrototypeTaskPurgeIntent({
      taskId: ' ',
      taskStatus: 'deleted',
    })).toEqual({ status: 'invalid' });
  });

  it('rejects purge intents unless the projected task status is deleted', () => {
    for (const taskStatus of ['', 'active', 'archived', 'running']) {
      expect(buildPrototypeTaskPurgeIntent({
        taskId: 'task-1',
        taskStatus,
      })).toEqual({ status: 'invalid' });
    }
  });

  it('projects purge by removing task and task-owned side buckets', () => {
    const projection = buildPrototypeTaskPurgeProjection({
      state: state({
        selectedTaskId: 'task-1',
        tasks: [
          { id: 'task-1', project: 'peers-touch', title: 'Task 1', status: 'active' },
          { id: 'task-2', project: 'peers-touch', title: 'Task 2', status: 'active' },
        ],
        stream: { 'task-1': [{ kind: 'user', id: 'u-1', text: 'hello', at: '10:00' }], 'task-2': [] },
        todos: { 'task-1': [{ id: 'todo-1', text: 'Todo', status: 'todo' }], 'task-2': [] },
        context: { 'task-1': { usedPct: 10, files: [] }, 'task-2': { usedPct: 0, files: [] } },
        artifacts: { 'task-1': [{ id: 'artifact-1', kind: 'report', title: 'Report' }], 'task-2': [] },
        gates: { 'task-1': [{ id: 'gate-1', label: 'Gate', status: 'passed' }], 'task-2': [] },
      }),
      selectedTaskId: 'task-1',
      taskId: ' task-1 ',
    });

    expect(projection.selectedTaskId).toBe('task-2');
    expect(projection.state.selectedTaskId).toBe('task-2');
    expect(projection.state.tasks).toEqual([
      { id: 'task-2', project: 'peers-touch', title: 'Task 2', status: 'active' },
    ]);
    expect(projection.state.stream).toEqual({ 'task-2': [] });
    expect(projection.state.todos).toEqual({ 'task-2': [] });
    expect(projection.state.context).toEqual({ 'task-2': { usedPct: 0, files: [] } });
    expect(projection.state.artifacts).toEqual({ 'task-2': [] });
    expect(projection.state.gates).toEqual({ 'task-2': [] });
  });

  it('keeps selected task when purging a non-selected task', () => {
    const projection = buildPrototypeTaskPurgeProjection({
      state: state({
        selectedTaskId: 'task-1',
        tasks: [
          { id: 'task-1', project: 'peers-touch', title: 'Task 1', status: 'active' },
          { id: 'task-2', project: 'peers-touch', title: 'Task 2', status: 'active' },
        ],
      }),
      selectedTaskId: 'task-1',
      taskId: 'task-2',
    });

    expect(projection.selectedTaskId).toBe('task-1');
    expect(projection.state.tasks).toEqual([
      { id: 'task-1', project: 'peers-touch', title: 'Task 1', status: 'active' },
    ]);
  });

  it('keeps invalid purge projection input as a no-op state update', () => {
    const current = state({
      tasks: [{ id: 'task-1', project: 'peers-touch', title: 'Task 1', status: 'active' }],
    });

    expect(buildPrototypeTaskPurgeProjection({
      state: current,
      selectedTaskId: 'task-1',
      taskId: ' ',
    })).toEqual({
      state: current,
      selectedTaskId: 'task-1',
    });
  });
});

describe('prototype task lifecycle request ownership', () => {
  it('keys lifecycle snapshot requests by kind, task, and status without execution payloads', () => {
    expect(buildPrototypeTaskLifecycleRequestKey({
      kind: 'setStatus',
      taskId: ' task-1 ',
      status: ' archived ',
    })).toBe('kind:setStatus|task:task-1|status:archived');
    expect(buildPrototypeTaskLifecycleRequestKey({
      kind: 'purge',
      taskId: ' task-1 ',
    })).toBe('kind:purge|task:task-1|status:none');
    expect(buildPrototypeTaskLifecycleRequestKey({
      kind: 'purge',
    })).toBe('kind:purge|task:none|status:none');
  });

  it('rejects stale lifecycle snapshots after task, status, or operation ownership changes', () => {
    const currentRequestKey = buildPrototypeTaskLifecycleRequestKey({
      kind: 'setStatus',
      taskId: 'task-2',
      status: 'archived',
    });
    const staleTaskKey = buildPrototypeTaskLifecycleRequestKey({
      kind: 'setStatus',
      taskId: 'task-1',
      status: 'archived',
    });
    const staleKindKey = buildPrototypeTaskLifecycleRequestKey({
      kind: 'purge',
      taskId: 'task-2',
    });

    expect(shouldApplyPrototypeTaskLifecycleSnapshot({
      currentRequestKey,
      responseRequestKey: currentRequestKey,
    })).toBe(true);
    expect(shouldApplyPrototypeTaskLifecycleSnapshot({
      currentRequestKey,
      responseRequestKey: staleTaskKey,
    })).toBe(false);
    expect(shouldApplyPrototypeTaskLifecycleSnapshot({
      currentRequestKey,
      responseRequestKey: staleKindKey,
    })).toBe(false);
    expect(shouldApplyPrototypeTaskLifecycleSnapshot({
      currentRequestKey,
      responseRequestKey: '',
    })).toBe(false);
    expect(`${currentRequestKey} ${staleTaskKey} ${staleKindKey}`).not.toMatch(/provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
  });
});
