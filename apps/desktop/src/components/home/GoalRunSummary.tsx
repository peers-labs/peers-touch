import { Button, Progress, Tag, Typography, theme } from 'antd';
import { ListTodo } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { HomeTaskStatus } from '../../gen/proto/domain/agent/home_pb';
import { useGoalExecutionStore } from '../../store/goalExecution';

const { useToken } = theme;

export function GoalRunSummary() {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const executions = useGoalExecutionStore((state) => state.executions);
  const selectedTaskId = useGoalExecutionStore(
    (state) => state.selectedTaskId,
  );
  const selectTask = useGoalExecutionStore((state) => state.selectTask);
  const selected = executions.find(
    (execution) => execution.taskId === selectedTaskId,
  );

  if (executions.length === 0) return null;

  return (
    <Flexbox data-pt-goal-runs="" gap={10}>
      {executions.map((execution) => {
        const active = execution.taskId === selectedTaskId;
        return (
          <Button
            aria-pressed={active}
            data-pt-goal-run={execution.taskId}
            data-pt-goal-run-status={HomeTaskStatus[execution.status]}
            key={execution.taskId}
            onClick={() => selectTask(execution.taskId)}
            style={{
              background: active
                ? token.colorFillSecondary
                : 'transparent',
              border: 0,
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: token.borderRadiusSM,
              height: 'auto',
              padding: '10px 0',
              textAlign: 'left',
              width: '100%',
            }}
            type="text"
          >
            <Flexbox gap={6} style={{ width: '100%' }}>
              <Flexbox horizontal align="center" gap={8}>
                <ListTodo size={15} />
                <Typography.Text ellipsis strong style={{ flex: 1 }}>
                  {execution.title}
                </Typography.Text>
                <Tag>{goalRunStatusLabel(execution.status, t)}</Tag>
              </Flexbox>
              <Progress
                percent={execution.progressPercent}
                showInfo={false}
                size="small"
              />
            </Flexbox>
          </Button>
        );
      })}
      {selected ? (
        <Typography.Text
          code
          data-pt-goal-run-readback=""
          data-pt-goal-id={selected.goalId}
          data-pt-goal-node-id={selected.nodeId}
          data-pt-goal-step-id={selected.stepId}
          data-pt-goal-task-id={selected.taskId}
          data-pt-goal-attempt-id={selected.attemptId}
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
            node: selected.nodeId,
            step: selected.stepId,
            attempt: selected.attempt,
          })}
        </Typography.Text>
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
    default:
      return t('agent.home.taskPending');
  }
}
