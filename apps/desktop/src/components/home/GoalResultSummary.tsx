import { Tag, Typography, theme } from 'antd';
import { CheckCircle2, CircleX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { HomeTaskStatus } from '../../gen/proto/domain/agent/home_pb';
import { useGoalExecutionStore } from '../../store/goalExecution';

const { useToken } = theme;

export function GoalResultSummary() {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const results = useGoalExecutionStore((state) => state.results);

  if (results.length === 0) return null;

  return (
    <Flexbox data-pt-goal-results="" gap={12}>
      {results.map((result) => {
        const failed = result.status === HomeTaskStatus.FAILED;
        const StatusIcon = failed ? CircleX : CheckCircle2;
        return (
          <Flexbox
            data-pt-goal-result={result.taskId}
            data-pt-goal-id={result.goalId}
            data-pt-goal-node-id={result.nodeId}
            data-pt-goal-step-id={result.stepId}
            data-pt-goal-attempt-id={result.attemptId}
            data-pt-goal-result-status={failed ? 'failed' : 'succeeded'}
            data-pt-goal-result-artifact-id={result.artifactId}
            gap={6}
            key={result.taskId}
            style={{
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              paddingBottom: 12,
            }}
          >
            <Flexbox horizontal align="center" gap={8}>
              <StatusIcon
                color={failed ? token.colorError : token.colorSuccess}
                size={16}
              />
              <Typography.Text ellipsis strong style={{ flex: 1 }}>
                {result.title}
              </Typography.Text>
              <Tag color={failed ? 'error' : 'success'}>
                {failed
                  ? t('agent.home.taskFailed')
                  : t('agent.home.taskCompleted')}
              </Tag>
            </Flexbox>
            <Typography.Paragraph
              data-pt-goal-result-summary=""
              ellipsis={{ rows: 4, expandable: true }}
              style={{ margin: 0 }}
              type="secondary"
            >
              {result.summary}
            </Typography.Paragraph>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
}
