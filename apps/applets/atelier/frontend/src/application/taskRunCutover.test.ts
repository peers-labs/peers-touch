import { describe, expect, it } from 'vitest';
import type { AtelierProjectionSnapshot } from '../domain/projection';
import { buildAtelierProjectCreateIntent } from './projectCreateActionGuards';
import { stateFromAtelierSnapshot } from './projectionReducer';

describe('Atelier TaskRun writer cutover', () => {
  it('keeps a stable command key and opens the returned canonical TaskRun', () => {
    const input = {
      goal: ' Ship a canonical Atelier work item ',
      intentPreset: 'work',
      model: 'gpt-5',
      runKind: 'agents',
      flowId: 'expert-hierarchy',
      project: 'peers-touch',
      pending: false,
    };
    const first = buildAtelierProjectCreateIntent(input);
    const replay = buildAtelierProjectCreateIntent(input);
    expect(first.status).toBe('ready');
    expect(replay.status).toBe('ready');
    if (first.status !== 'ready' || replay.status !== 'ready') return;
    expect(replay.submitKey).toBe(first.submitKey);

    const snapshot: AtelierProjectionSnapshot = {
      version: 'atelier-projection/v0',
      selectedTaskId: 'task-canonical',
      workspace: {
        budgetSpent: 0,
        budgetCap: 0,
        model: 'gpt-5',
        tasks: [{
          id: 'task-canonical',
          project: 'peers-touch',
          projectId: 'goal-canonical',
          goalId: 'goal-canonical',
          taskRunId: 'task-canonical',
          title: 'Ship a canonical Atelier work item',
          status: 'active',
          executionStatus: 'pending',
          stepId: 'step-canonical',
          attemptId: 'attempt-canonical',
          attempt: 1,
        }],
        projects: [],
        streams: { 'task-canonical': [] },
        todos: { 'task-canonical': [] },
        contexts: { 'task-canonical': { usedPct: 0, files: [] } },
        artifacts: { 'task-canonical': [] },
        gates: { 'task-canonical': [] },
        replay: {},
      },
    };

    const state = stateFromAtelierSnapshot(snapshot);
    expect(state.selectedTaskId).toBe('task-canonical');
    expect(state.snapshot?.workspace.tasks[0]).toMatchObject({
      id: 'task-canonical',
      goalId: 'goal-canonical',
      taskRunId: 'task-canonical',
    });
  });
});
