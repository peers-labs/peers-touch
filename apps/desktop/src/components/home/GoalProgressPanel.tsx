import { Progress, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { HomeTaskStatus } from '../../gen/proto/domain/agent/home_pb';
import {
  type GoalExecutionView,
  type GoalResultView,
  useGoalExecutionStore,
} from '../../store/goalExecution';
import { useHomeStore } from '../../store/home';
import { GoalActiveCancelControl } from './GoalActiveCancelControl';
import { GoalTimeline } from './GoalTimeline';
import { MigratedWorkBadge } from './MigratedWorkBadge';

export function GoalProgressPanel() {
  const { t } = useTranslation('agent');
  const projection = useHomeStore((state) => state.projection);
  const savedGoal = useHomeStore((state) => state.savedGoal);
  const lastAgentEvent = useHomeStore((state) => state.lastAgentEvent);
  const executions = useGoalExecutionStore((state) => state.executions);
  const results = useGoalExecutionStore((state) => state.results);
  const selectedTaskId = useGoalExecutionStore(
    (state) => state.selectedTaskId,
  );
  const current = selectGoalProgressRun(
    executions,
    results,
    selectedTaskId,
    savedGoal?.goalId,
  );

  if (!current) return null;

  const budget = savedGoal?.goalId === current.goalId
    ? savedGoal.budget
    : undefined;

  return (
    <Flexbox
      data-pt-goal-progress=""
      data-pt-goal-id={current.goalId}
      data-pt-goal-node-id={current.nodeId}
      data-pt-goal-run={current.taskId}
      data-pt-goal-run-status={HomeTaskStatus[current.status]}
      data-pt-goal-task-id={current.taskId}
      data-pt-goal-step-id={current.stepId}
      data-pt-goal-attempt-id={current.attemptId}
      data-pt-goal-projection-revision={projection?.revision.toString() ?? '0'}
      data-pt-goal-event-id={lastAgentEvent?.domainEventId ?? ''}
      data-pt-goal-event-sequence={
        lastAgentEvent?.domainSequence.toString() ?? '0'
      }
      gap={10}
    >
      <Flexbox horizontal align="center" gap={8} wrap="wrap">
        <Typography.Text strong>{current.title}</Typography.Text>
        <Tag>{goalRunStatusLabel(current.status, t)}</Tag>
        <MigratedWorkBadge
          blockReason={current.migrationBlockReason}
          sourceId={current.legacySourceId}
          state={current.migrationState}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('agent.home.goalLiveRevision', {
            revision: projection?.revision.toString() ?? '0',
          })}
        </Typography.Text>
      </Flexbox>
      <Progress
        percent={current.progressPercent}
        size="small"
        status={
          current.status === HomeTaskStatus.FAILED
            ? 'exception'
            : undefined
        }
      />
      <Typography.Text
        code
        data-pt-goal-run-readback=""
        type="secondary"
        style={{
          display: 'block',
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {t('agent.home.goalExecutionIdentity', {
          node: current.nodeId,
          step: current.stepId,
          attempt: current.attempt,
        })}
      </Typography.Text>
      {budget ? (
        <Typography.Text
          data-pt-goal-budget=""
          type="secondary"
          style={{ fontSize: 12 }}
        >
          {t('agent.home.goalLiveBudget', {
            budget: t('agent.home.goalBudgetSummary', {
              tokens: budget.maxTokens.toString(),
              cost: budget.maxCost ?? t('agent.home.goalNone'),
              minutes: (budget.wallTimeMs / 60_000n).toString(),
              parallel: budget.maxParallelTasks,
            }),
          })}
        </Typography.Text>
      ) : null}
      {savedGoal?.goalId === current.goalId ? (
        <GoalActiveCancelControl goal={savedGoal} />
      ) : null}
      <GoalTimeline />
    </Flexbox>
  );
}

export function selectGoalProgressRun(
  executions: GoalExecutionView[],
  results: GoalResultView[],
  selectedTaskId: string | null,
  savedGoalId?: string,
): GoalExecutionView | GoalResultView | undefined {
  const runs = [...executions, ...results];
  return runs.find((run) => run.taskId === selectedTaskId)
    ?? runs.find((run) => run.goalId === savedGoalId)
    ?? executions[0]
    ?? results[0];
}

function goalRunStatusLabel(
  status: HomeTaskStatus,
  t: (key: string) => string,
): string {
  switch (status) {
    case HomeTaskStatus.PENDING:
      return t('agent.home.taskPending');
    case HomeTaskStatus.RUNNING:
      return t('agent.home.taskRunning');
    case HomeTaskStatus.NEEDS_USER:
      return t('agent.home.taskNeedsUser');
    case HomeTaskStatus.COMPLETED:
      return t('agent.home.taskCompleted');
    case HomeTaskStatus.FAILED:
      return t('agent.home.taskFailed');
    case HomeTaskStatus.CANCELLED:
      return t('agent.home.taskCancelled');
    default:
      return t('agent.home.taskUnavailable');
  }
}
