import { Button, Progress, Tag, Typography, theme } from 'antd';
import { ListTodo } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { HomeTaskStatus } from '../../gen/proto/domain/agent/home_pb';
import { useGoalExecutionStore } from '../../store/goalExecution';
import { useHomeStore } from '../../store/home';

const { useToken } = theme;

export function GoalProgressPanel() {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const projection = useHomeStore((state) => state.projection);
  const savedGoal = useHomeStore((state) => state.savedGoal);
  const lastAgentEvent = useHomeStore((state) => state.lastAgentEvent);
  const executions = useGoalExecutionStore((state) => state.executions);
  const selectedTaskId = useGoalExecutionStore(
    (state) => state.selectedTaskId,
  );
  const selectTask = useGoalExecutionStore((state) => state.selectTask);
  const current = executions.find(
    (execution) => execution.taskId === selectedTaskId,
  ) ?? executions[0];

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
      {executions.length > 1 ? (
        <Flexbox data-pt-goal-runs="" gap={4}>
          {executions.map((execution) => (
            <Button
              aria-pressed={execution.taskId === current.taskId}
              data-pt-goal-run={execution.taskId}
              data-pt-goal-run-status={HomeTaskStatus[execution.status]}
              icon={<ListTodo size={14} />}
              key={execution.taskId}
              onClick={() => selectTask(execution.taskId)}
              style={{
                border: 0,
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusSM,
                height: 'auto',
                justifyContent: 'flex-start',
                padding: '7px 0',
                textAlign: 'left',
              }}
              type="text"
            >
              {execution.title}
            </Button>
          ))}
        </Flexbox>
      ) : null}
    </Flexbox>
  );
}

function goalRunStatusLabel(
  status: HomeTaskStatus,
  t: (key: string) => string,
): string {
  switch (status) {
    case HomeTaskStatus.RUNNING:
      return t('agent.home.taskRunning');
    case HomeTaskStatus.NEEDS_USER:
      return t('agent.home.taskNeedsUser');
    case HomeTaskStatus.COMPLETED:
      return t('agent.home.taskCompleted');
    case HomeTaskStatus.FAILED:
      return t('agent.home.taskFailed');
    default:
      return t('agent.home.taskPending');
  }
}
