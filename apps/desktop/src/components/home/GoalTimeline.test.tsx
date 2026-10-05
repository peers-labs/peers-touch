import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { HomeTaskStatus } from '../../gen/proto/domain/agent/home_pb';
import { TaskSurface } from '../../gen/proto/domain/agent/orchestration_pb';
import type {
  GoalExecutionView,
  GoalResultView,
} from '../../store/goalExecution';
import { orderGoalTimelineRuns } from './GoalTimeline';

const source = readFileSync(
  fileURLToPath(new URL('./GoalTimeline.tsx', import.meta.url)),
  'utf8',
);

function execution(
  taskId: string,
  status: HomeTaskStatus,
  goalId = 'goal-1',
): GoalExecutionView {
  return {
    goalId,
    nodeId: `node-${taskId}`,
    taskId,
    stepId: `step-${taskId}`,
    attemptId: `attempt-${taskId}`,
    attempt: 1,
    agentId: 'agent-1',
    workspaceId: '',
    title: taskId,
    status,
    progressPercent: status === HomeTaskStatus.COMPLETED ? 100 : 0,
    surface: TaskSurface.DIRECT_RUN,
    legacySourceId: '',
    migrationState: 0,
    migrationBlockReason: '',
  };
}

describe('GoalTimeline', () => {
  it('orders one Goal from terminal work to its active ready frontier', () => {
    const completed = {
      ...execution('task-first', HomeTaskStatus.COMPLETED),
      summary: 'First node completed',
      artifactId: 'artifact-first',
    } satisfies GoalResultView;
    const running = execution('task-second', HomeTaskStatus.RUNNING);
    const pending = execution('task-third', HomeTaskStatus.PENDING);
    const unrelated = execution(
      'task-unrelated',
      HomeTaskStatus.RUNNING,
      'goal-2',
    );

    expect(orderGoalTimelineRuns(
      [pending, unrelated, running],
      [completed],
      'goal-1',
    ).map((run) => run.taskId)).toEqual([
      'task-first',
      'task-second',
      'task-third',
    ]);
  });

  it('exposes stable node, task, status, and selection readback', () => {
    for (const selector of [
      'data-pt-goal-timeline',
      'data-pt-goal-timeline-node',
      'data-pt-goal-timeline-task',
      'data-pt-goal-timeline-status',
      'data-pt-goal-timeline-selected',
    ]) {
      expect(source).toContain(selector);
    }
    expect(source).toContain('selectTask(run.taskId)');
  });
});
