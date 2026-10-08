import { Button, Tag, Typography, theme } from 'antd';
import {
  Ban,
  CheckCircle2,
  Circle,
  CircleDashed,
  LoaderCircle,
  XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { HomeTaskStatus } from '../../gen/proto/domain/agent/home_pb';
import {
  type GoalExecutionView,
  type GoalResultView,
  useGoalExecutionStore,
} from '../../store/goalExecution';
import { useHomeStore } from '../../store/home';

const { useToken } = theme;

type GoalTimelineRun = GoalExecutionView | GoalResultView;

export function GoalTimeline() {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const savedGoal = useHomeStore((state) => state.savedGoal);
  const executions = useGoalExecutionStore((state) => state.executions);
  const results = useGoalExecutionStore((state) => state.results);
  const selectedTaskId = useGoalExecutionStore(
    (state) => state.selectedTaskId,
  );
  const selectTask = useGoalExecutionStore((state) => state.selectTask);
  const goalId = savedGoal?.goalId
    || executions.find((run) => run.taskId === selectedTaskId)?.goalId
    || results.find((run) => run.taskId === selectedTaskId)?.goalId
    || executions[0]?.goalId
    || results[0]?.goalId;
  const runs = orderGoalTimelineRuns(executions, results, goalId);

  if (runs.length < 2) return null;

  return (
    <Flexbox
      data-pt-goal-timeline=""
      data-pt-goal-timeline-goal={goalId}
      gap={2}
      role="list"
    >
      {runs.map((run) => {
        const selected = run.taskId === selectedTaskId;
        return (
          <Button
            aria-current={selected ? 'step' : undefined}
            data-pt-goal-timeline-node={run.nodeId}
            data-pt-goal-timeline-selected={selected ? 'true' : 'false'}
            data-pt-goal-timeline-status={HomeTaskStatus[run.status]}
            data-pt-goal-timeline-task={run.taskId}
            icon={goalTimelineIcon(run.status)}
            key={run.taskId}
            onClick={() => selectTask(run.taskId)}
            role="listitem"
            style={{
              border: 0,
              borderLeft: `2px solid ${
                selected ? token.colorPrimary : token.colorBorderSecondary
              }`,
              borderRadius: token.borderRadiusSM,
              height: 38,
              justifyContent: 'flex-start',
              padding: '4px 8px',
              textAlign: 'left',
              width: '100%',
            }}
            type={selected ? 'default' : 'text'}
          >
            <Flexbox
              horizontal
              align="center"
              gap={8}
              justify="space-between"
              style={{ minWidth: 0, width: '100%' }}
            >
              <Typography.Text ellipsis style={{ minWidth: 0 }}>
                {run.title}
              </Typography.Text>
              <Tag style={{ flexShrink: 0, marginInlineEnd: 0 }}>
                {goalTimelineStatusLabel(run.status, t)}
              </Tag>
            </Flexbox>
          </Button>
        );
      })}
    </Flexbox>
  );
}

export function orderGoalTimelineRuns(
  executions: GoalExecutionView[],
  results: GoalResultView[],
  goalId?: string,
): GoalTimelineRun[] {
  if (!goalId) return [];
  const byTaskID = new Map<string, GoalTimelineRun>();
  for (const run of [...results, ...executions]) {
    if (run.goalId === goalId) byTaskID.set(run.taskId, run);
  }
  return [...byTaskID.values()].sort((left, right) => {
    const statusOrder =
      goalTimelineStatusRank(left.status) - goalTimelineStatusRank(right.status);
    return statusOrder || left.taskId.localeCompare(right.taskId);
  });
}

function goalTimelineStatusRank(status: HomeTaskStatus): number {
  switch (status) {
    case HomeTaskStatus.COMPLETED:
    case HomeTaskStatus.FAILED:
    case HomeTaskStatus.CANCELLED:
      return 0;
    case HomeTaskStatus.RUNNING:
      return 1;
    case HomeTaskStatus.NEEDS_USER:
      return 2;
    case HomeTaskStatus.PENDING:
      return 3;
    default:
      return 4;
  }
}

function goalTimelineIcon(status: HomeTaskStatus): ReactNode {
  const size = 15;
  switch (status) {
    case HomeTaskStatus.COMPLETED:
      return <CheckCircle2 size={size} />;
    case HomeTaskStatus.RUNNING:
      return <LoaderCircle size={size} />;
    case HomeTaskStatus.NEEDS_USER:
      return <CircleDashed size={size} />;
    case HomeTaskStatus.FAILED:
      return <XCircle size={size} />;
    case HomeTaskStatus.CANCELLED:
      return <Ban size={size} />;
    default:
      return <Circle size={size} />;
  }
}

function goalTimelineStatusLabel(
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
