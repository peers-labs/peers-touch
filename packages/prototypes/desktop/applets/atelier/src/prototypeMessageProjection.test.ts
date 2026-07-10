import { describe, expect, it } from 'vitest';
import {
  buildPrototypeMessageProjection,
  PROTOTYPE_MESSAGE_WAITING_FOR_STATION_TEXT,
} from './prototypeMessageProjection';
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

describe('prototypeMessageProjection', () => {
  it('appends trimmed user text and a Station-waiting projection acknowledgement', () => {
    const next = buildPrototypeMessageProjection({
      state: state({
        stream: {
          'task-1': [{ kind: 'agent', id: 'a-existing', text: 'Existing', at: '09:00', done: true }],
        },
      }),
      taskId: 'task-1',
      text: '  /implement the next guard  ',
      now: '10:00',
      suffix: 42,
    });

    expect(next.stream['task-1']).toEqual([
      { kind: 'agent', id: 'a-existing', text: 'Existing', at: '09:00', done: true },
      { kind: 'user', id: 'u-42', text: '/implement the next guard', at: '10:00' },
      {
        kind: 'agent',
        id: 'a-42',
        text: PROTOTYPE_MESSAGE_WAITING_FOR_STATION_TEXT,
        at: '10:00',
        done: true,
      },
    ]);
  });

  it('creates a stream bucket for a selected task without mutating task-owned side buckets', () => {
    const next = buildPrototypeMessageProjection({
      state: state({
        todos: { 'task-1': [{ id: 'todo-1', text: 'Keep', status: 'todo' }] },
        artifacts: { 'task-1': [] },
        gates: { 'task-1': [] },
      }),
      taskId: 'task-1',
      text: 'hello',
      now: '10:01',
      suffix: 'abc',
    });

    expect(next.stream['task-1']).toHaveLength(2);
    expect(next.todos['task-1']).toEqual([{ id: 'todo-1', text: 'Keep', status: 'todo' }]);
    expect(next.artifacts['task-1']).toEqual([]);
    expect(next.gates['task-1']).toEqual([]);
  });

  it('keeps empty message submissions as no-op projection updates', () => {
    const current = state({
      stream: {
        'task-1': [{ kind: 'agent', id: 'a-existing', text: 'Existing', at: '09:00', done: true }],
      },
    });

    expect(buildPrototypeMessageProjection({
      state: current,
      taskId: 'task-1',
      text: '   ',
      now: '10:02',
      suffix: 7,
    })).toBe(current);
  });

  it('keeps message projection text-only without execution-shaped payload fields', () => {
    const next = buildPrototypeMessageProjection({
      state: state(),
      taskId: 'task-1',
      text: 'run provider now',
      now: '10:03',
      suffix: 8,
    });

    expect(JSON.stringify(next.stream['task-1'])).not.toMatch(
      /provider\.invoke|runtime\.execute|shell|input_snapshot|memory\.write|gate\.run|artifact\.persist/,
    );
  });
});
