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
import { selectGoalProgressRun } from './GoalProgressPanel';

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
    expect(source).toContain('<GoalTimeline />');
  });

  it('keeps the current Goal TaskRun visible after it becomes terminal', () => {
    const runningProjection = create(HomeWorkProjectionSchema, {
      activeTasks: [{
        goalId: 'goal-current',
        goalNodeId: 'node-current',
        taskId: 'task-current',
        stepId: 'step-current',
        attemptId: 'attempt-current',
        attempt: 1,
        title: 'Current Goal result',
        status: HomeTaskStatus.RUNNING,
        progressPercent: 50,
        surface: TaskSurface.DIRECT_RUN,
      }],
    });
    useGoalExecutionStore.getState().applyProjection(runningProjection);
    useGoalExecutionStore.getState().selectTask('task-current');

    const terminalProjection = create(HomeWorkProjectionSchema, {
      activeTasks: [
        {
          goalId: 'goal-unrelated',
          goalNodeId: 'node-unrelated',
          taskId: 'task-unrelated',
          stepId: 'step-unrelated',
          attemptId: 'attempt-unrelated',
          attempt: 1,
          title: 'Unrelated active work',
          status: HomeTaskStatus.PENDING,
          surface: TaskSurface.DIRECT_RUN,
        },
        {
          goalId: 'goal-current',
          goalNodeId: 'node-current',
          taskId: 'task-current',
          stepId: 'step-current',
          attemptId: 'attempt-current',
          attempt: 1,
          title: 'Current Goal result',
          status: HomeTaskStatus.COMPLETED,
          progressPercent: 100,
          surface: TaskSurface.DIRECT_RUN,
        },
      ],
      briefItems: [{
        briefId: 'goal-result:artifact-current',
        sourceRef: 'task-current',
        title: 'Current Goal result',
        summary: 'Completed',
      }],
    });
    useGoalExecutionStore.getState().applyProjection(terminalProjection);

    const state = useGoalExecutionStore.getState();
    expect(state.selectedTaskId).toBe('task-current');
    expect(selectGoalProgressRun(
      state.executions,
      state.results,
      state.selectedTaskId,
      'goal-current',
    )).toMatchObject({
      goalId: 'goal-current',
      taskId: 'task-current',
      status: HomeTaskStatus.COMPLETED,
    });
  });
});
