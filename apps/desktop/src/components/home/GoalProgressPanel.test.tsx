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
import { useHomeStore } from '../../store/home';

const source = readFileSync(
  fileURLToPath(new URL('./GoalProgressPanel.tsx', import.meta.url)),
  'utf8',
);

describe('GoalProgressPanel', () => {
  beforeEach(() => {
    useHomeStore.getState().reset();
    useGoalExecutionStore.getState().reset();
  });

  it('projects the latest canonical Goal task as the visible current node', () => {
    const projection = create(HomeWorkProjectionSchema, {
      ptid: 'ptid:actor-1',
      revision: 12n,
      activeTasks: [{
        goalId: 'goal-1',
        goalNodeId: 'node-1',
        taskId: 'task-1',
        stepId: 'step-1',
        attemptId: 'attempt-1',
        attempt: 1,
        title: 'Prepare live result',
        status: HomeTaskStatus.RUNNING,
        progressPercent: 25,
        surface: TaskSurface.DIRECT_RUN,
      }],
    });

    useHomeStore.getState().applyProjection(projection);
    useGoalExecutionStore.getState().applyProjection(projection);

    expect(useGoalExecutionStore.getState().executions[0]).toMatchObject({
      goalId: 'goal-1',
      nodeId: 'node-1',
      taskId: 'task-1',
      progressPercent: 25,
    });
    for (const selector of [
      'data-pt-goal-progress',
      'data-pt-goal-projection-revision',
      'data-pt-goal-node-id',
      'data-pt-goal-task-id',
      'data-pt-goal-step-id',
      'data-pt-goal-attempt-id',
      'data-pt-goal-budget',
    ]) {
      expect(source).toContain(selector);
    }
  });
});
