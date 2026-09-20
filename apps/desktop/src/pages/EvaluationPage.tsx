import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  Alert,
  Button,
  Segmented,
  Spin,
  Typography,
  theme,
} from 'antd';
import {
  ClipboardCheck,
  Database,
  RefreshCw,
} from 'lucide-react';

import { EvaluationDefinitionsPanel } from './evaluation/DefinitionsPanel';
import { EvaluationRunList } from './evaluation/RunList';
import { refreshEvaluationProjection } from '../runtimes/evaluationRuntime';
import { useEvaluationStore } from '../store/evaluation';

type TabKey = 'definitions' | 'runs';

export const EvaluationPage = memo(() => {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const projectionPhase = useEvaluationStore((state) => state.projectionPhase);
  const error = useEvaluationStore((state) => state.error);
  const benchmarks = useEvaluationStore((state) => state.benchmarks);
  const datasets = useEvaluationStore((state) => state.datasets);
  const runs = useEvaluationStore((state) => state.runs);
  const clearError = useEvaluationStore((state) => state.clearError);
  const [activeTab, setActiveTab] = useState<TabKey>('definitions');

  const empty = (
    projectionPhase === 'ready'
    && benchmarks.length === 0
    && datasets.length === 0
    && runs.length === 0
  );
  const visibleState = projectionPhase === 'ready' && empty
    ? 'empty'
    : projectionPhase;

  return (
    <Flexbox
      data-pt-evaluation-page
      data-pt-evaluation-state={visibleState}
      padding={24}
      gap={18}
      style={{
        background: token.colorBgLayout,
        height: '100%',
        overflow: 'auto',
      }}
    >
      <Flexbox horizontal align="center" justify="space-between" gap={16}>
        <Flexbox gap={2}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('agent.eval.title')}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t('agent.eval.authority')}
          </Typography.Text>
        </Flexbox>
        <Button
          data-pt-evaluation-refresh
          icon={<RefreshCw size={14} />}
          loading={projectionPhase === 'loading' || projectionPhase === 'restoring'}
          onClick={() => void refreshEvaluationProjection()}
        >
          {t('agent.eval.refresh')}
        </Button>
      </Flexbox>

      {projectionPhase === 'restoring' && (
        <Alert
          data-pt-evaluation-restoring
          title={t('agent.eval.restoring')}
          description={t('agent.eval.restoringDescription')}
          type="info"
          showIcon
        />
      )}
      {projectionPhase === 'loading' && (
        <Flexbox
          data-pt-evaluation-loading
          align="center"
          justify="center"
          style={{ minHeight: 180 }}
        >
          <Spin tip={t('agent.eval.loading')} />
        </Flexbox>
      )}
      {error && (
        <Alert
          data-pt-evaluation-error
          title={t('agent.eval.error')}
          description={t(error, { defaultValue: t('agent.eval.errorDescription') })}
          action={(
            <Button
              onClick={() => {
                clearError();
                void refreshEvaluationProjection();
              }}
            >
              {t('agent.eval.retry')}
            </Button>
          )}
          type="error"
          showIcon
        />
      )}

      {projectionPhase !== 'loading' && (
        <>
          <Segmented
            value={activeTab}
            onChange={(value) => setActiveTab(value as TabKey)}
            options={[
              {
                label: (
                  <span data-pt-evaluation-tab="definitions">
                    {t('agent.eval.definitions')}
                  </span>
                ),
                value: 'definitions',
                icon: <Database size={14} />,
              },
              {
                label: (
                  <span data-pt-evaluation-tab="runs">
                    {t('agent.eval.runs')}
                  </span>
                ),
                value: 'runs',
                icon: <ClipboardCheck size={14} />,
              },
            ]}
          />
          {activeTab === 'definitions'
            ? <EvaluationDefinitionsPanel />
            : <EvaluationRunList />}
        </>
      )}
    </Flexbox>
  );
});

EvaluationPage.displayName = 'EvaluationPage';
