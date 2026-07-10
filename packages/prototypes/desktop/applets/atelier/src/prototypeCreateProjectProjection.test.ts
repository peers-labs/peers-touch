import { describe, expect, it } from 'vitest';
import { ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING } from './projection.contract.generated';
import {
  buildPrototypeCreateProjectProjection,
  prototypeCreateProjectAcknowledgement,
  prototypeCreateProjectIntentPresetMetadata,
  prototypeCreateProjectWorkspaceUri,
} from './prototypeCreateProjectProjection';
import type { AtelierState } from './types';

function state(input: Partial<AtelierState> = {}): AtelierState {
  return {
    budgetSpent: 0,
    budgetCap: 100,
    model: 'claude-sonnet',
    tasks: [],
    selectedTaskId: '',
    stream: {},
    todos: {},
    context: {},
    artifacts: {},
    gates: {},
    ...input,
  };
}

describe('prototypeCreateProjectProjection', () => {
  it('derives intent preset metadata from generated create-from-goal mapping', () => {
    expect(prototypeCreateProjectIntentPresetMetadata('code')).toEqual({
      intentPreset: 'code',
      providerStrategyPreset: ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING.code.providerStrategyPreset,
      gatePlanPreset: ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING.code.gatePlanPreset,
    });
  });

  it('builds canonical prototype workspace URIs without exposing file or shell paths', () => {
    expect(prototypeCreateProjectWorkspaceUri('task/1', 'peers touch')).toBe(
      'pt-workspace://task/task%2F1?workspace=peers%20touch',
    );
  });

  it('uses different projection acknowledgements for model and agents run metadata', () => {
    expect(prototypeCreateProjectAcknowledgement('model')).toContain('当前模型直接推进');
    expect(prototypeCreateProjectAcknowledgement('agents')).toContain('agent 编排层创建协作运行');
  });

  it('builds a projection-only task, stream, and empty buckets for create-from-goal', () => {
    const projection = buildPrototypeCreateProjectProjection({
      state: state({
        tasks: [{ id: 'existing', project: 'demo', title: 'Existing', status: 'active' }],
        stream: { existing: [{ kind: 'user', id: 'existing-user', text: 'hello', at: '09:00' }] },
      }),
      taskId: 'task-1',
      now: '10:30',
      goal: '  Build acceptance evidence  ',
      project: 'peers touch',
      intentPreset: 'design',
      runKind: 'agents',
    });

    expect(projection.selectedTaskId).toBe('task-1');
    expect(projection.state.selectedTaskId).toBe('task-1');
    expect(projection.state.tasks[0]).toMatchObject({
      id: 'task-1',
      project: 'peers touch',
      title: 'Build acceptance evidence',
      status: 'active',
      running: true,
      intentPreset: 'design',
      providerStrategyPreset: ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING.design.providerStrategyPreset,
      gatePlanPreset: ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING.design.gatePlanPreset,
      workspaceOpenTarget: {
        workspaceId: 'peers touch',
        workspaceUri: 'pt-workspace://task/task-1?workspace=peers%20touch',
        label: 'peers touch',
        ideHint: 'vscode',
      },
    });
    expect(projection.state.stream['task-1']).toEqual([
      { kind: 'user', id: 'task-1', text: 'Build acceptance evidence', at: '10:30' },
      {
        kind: 'agent',
        id: 'task-1-ack',
        text: prototypeCreateProjectAcknowledgement('agents'),
        at: '10:30',
        done: true,
      },
    ]);
    expect(projection.state.todos['task-1']).toEqual([]);
    expect(projection.state.artifacts['task-1']).toEqual([]);
    expect(projection.state.gates['task-1']).toEqual([]);
    expect(projection.state.context['task-1']).toEqual({ usedPct: 8, files: [] });
  });

  it('falls back to a new-task title and default project without creating execution payloads', () => {
    const projection = buildPrototypeCreateProjectProjection({
      state: state(),
      taskId: 'task-1',
      now: '10:30',
      goal: '   ',
      runKind: 'model',
    });

    expect(projection.state.tasks[0]).toMatchObject({
      title: '新任务',
      project: 'peers-touch',
      workspaceOpenTarget: {
        workspaceUri: 'pt-workspace://task/task-1?workspace=peers-touch',
      },
    });
    expect(JSON.stringify(projection)).not.toMatch(/provider\.invoke|runtime\.execute|shell|input_snapshot|memory\.write/);
  });
});
