import { create } from '@bufbuild/protobuf';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  HomeTaskStatus,
  HomeWorkProjectionSchema,
} from '../../gen/proto/domain/agent/home_pb';
import { TaskSurface } from '../../gen/proto/domain/agent/orchestration_pb';
import { useGoalExecutionStore } from '../../store/goalExecution';

const source = readFileSync(
  fileURLToPath(new URL('./GoalProgressPanel.tsx', import.meta.url)),
  'utf8',
);
const homeSource = readFileSync(
  fileURLToPath(new URL('../../pages/HomePage.tsx', import.meta.url)),
  'utf8',
);

describe('GoalRunSummary', () => {
  beforeEach(() => {
    useGoalExecutionStore.getState().reset();
  });

  it('keeps canonical Goal, node, task, step, and attempt identifiers', () => {
    useGoalExecutionStore.getState().applyProjection(
      create(HomeWorkProjectionSchema, {
        activeTasks: [{
          goalId: 'goal-1',
          goalNodeId: 'node-1',
          taskId: 'task-1',
          stepId: 'step-1',
          attemptId: 'attempt-1',
          attempt: 1,
          title: 'Prepare durable result',
          status: HomeTaskStatus.PENDING,
          surface: TaskSurface.DIRECT_RUN,
        }],
      }),
    );
    useGoalExecutionStore.getState().selectTask('task-1');

    expect(useGoalExecutionStore.getState()).toMatchObject({
      selectedTaskId: 'task-1',
      executions: [{
        goalId: 'goal-1',
        nodeId: 'node-1',
        taskId: 'task-1',
        stepId: 'step-1',
        attemptId: 'attempt-1',
        attempt: 1,
        status: HomeTaskStatus.PENDING,
        surface: TaskSurface.DIRECT_RUN,
      }],
    });
  });

  it('exposes the selected canonical Station identity to acceptance', () => {
    for (const selector of [
      'data-pt-goal-run',
      'data-pt-goal-run-readback',
      'data-pt-goal-id',
      'data-pt-goal-node-id',
      'data-pt-goal-task-id',
      'data-pt-goal-step-id',
      'data-pt-goal-attempt-id',
    ]) {
      expect(source).toContain(selector);
    }
    expect(source).toContain('aria-pressed');
    expect(source).toContain('selectTask(execution.taskId)');
  });

  it('remains visible when the actor has no pinned Agent', () => {
    expect(homeSource).toContain('data-pt-home-empty-goal-runs');
    expect(homeSource).toContain(
      'goalExecutions.length || goalResults.length ?',
    );
    expect(homeSource).toContain('<GoalProgressPanel />');
  });
});
