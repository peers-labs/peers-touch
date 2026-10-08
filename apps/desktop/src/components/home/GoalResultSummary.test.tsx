import { create } from '@bufbuild/protobuf';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  HomeTaskStatus,
  HomeWorkProjectionSchema,
} from '../../gen/proto/domain/agent/home_pb';
import { TaskSurface } from '../../gen/proto/domain/agent/orchestration_pb';
import {
  normalizeGoalResults,
  useGoalExecutionStore,
} from '../../store/goalExecution';

const source = readFileSync(
  fileURLToPath(new URL('./GoalResultSummary.tsx', import.meta.url)),
  'utf8',
);
const homeSource = readFileSync(
  fileURLToPath(new URL('../../pages/HomePage.tsx', import.meta.url)),
  'utf8',
);

describe('GoalResultSummary', () => {
  beforeEach(() => {
    useGoalExecutionStore.getState().reset();
  });

  it('reconstructs terminal Goal results from Station projection readback', () => {
    const projection = create(HomeWorkProjectionSchema, {
      activeTasks: [
        {
          goalId: 'goal-1',
          goalNodeId: 'node-1',
          taskId: 'task-success',
          stepId: 'step-1',
          attemptId: 'attempt-1',
          attempt: 1,
          title: 'Prepare result',
          status: HomeTaskStatus.COMPLETED,
          progressPercent: 100,
          surface: TaskSurface.DIRECT_RUN,
        },
        {
          goalId: 'goal-2',
          goalNodeId: 'node-2',
          taskId: 'task-failure',
          stepId: 'step-2',
          attemptId: 'attempt-2',
          attempt: 1,
          title: 'Prepare fallback',
          status: HomeTaskStatus.FAILED,
          surface: TaskSurface.DIRECT_RUN,
        },
      ],
      briefItems: [
        {
          briefId: 'goal-result:artifact-success',
          sourceRef: 'task-success',
          title: 'Prepare result',
          summary: 'Durable model result',
        },
        {
          briefId: 'goal-result:artifact-failure',
          sourceRef: 'task-failure',
          title: 'Prepare fallback',
          summary: 'Provider execution failed',
        },
      ],
    });

    expect(normalizeGoalResults(projection)).toEqual([
      expect.objectContaining({
        taskId: 'task-success',
        status: HomeTaskStatus.COMPLETED,
        summary: 'Durable model result',
        artifactId: 'artifact-success',
      }),
      expect.objectContaining({
        taskId: 'task-failure',
        status: HomeTaskStatus.FAILED,
        summary: 'Provider execution failed',
        artifactId: 'artifact-failure',
      }),
    ]);
    useGoalExecutionStore.getState().applyProjection(projection);
    expect(useGoalExecutionStore.getState().executions).toEqual([]);
    expect(useGoalExecutionStore.getState().results).toHaveLength(2);
  });

  it('exposes terminal status, summary, artifact, and canonical identities', () => {
    for (const selector of [
      'data-pt-goal-results',
      'data-pt-goal-result',
      'data-pt-goal-id',
      'data-pt-goal-node-id',
      'data-pt-goal-step-id',
      'data-pt-goal-attempt-id',
      'data-pt-goal-result-status',
      'data-pt-goal-result-summary',
      'data-pt-goal-result-artifact-id',
    ]) {
      expect(source).toContain(selector);
    }
    expect(homeSource).toContain('<GoalResultSummary />');
    expect(homeSource).toContain("t('agent.home.goalResults')");
  });
});
