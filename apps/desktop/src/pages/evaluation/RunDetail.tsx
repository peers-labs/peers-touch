import { memo, useCallback, type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  Alert,
  Button,
  Empty,
  Popconfirm,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { ColumnsType } from 'antd/es/table';

import {
  EvaluationRunStatus,
  type EvaluationResult,
  type EvaluationRun,
  type EvaluationRunCaseSnapshot,
} from '../../gen/proto/domain/agent/evaluation_pb';
import {
  evaluationRunStatusName,
  type EvaluationRunDetail as EvaluationRunDetailProjection,
} from '../../store/evaluation';
import {
  canCancelRun,
  canDeleteRun,
  mutationPending,
  retryableCaseIds,
  statusColor,
} from './shared';

interface EvaluationRunDetailProps {
  detail?: EvaluationRunDetailProjection;
  pendingMutations: Record<string, true>;
  run: EvaluationRun;
  cases: EvaluationRunCaseSnapshot[];
  onBack: () => void;
  onCancel: (run: EvaluationRun) => Promise<unknown>;
  onDelete: (run: EvaluationRun) => Promise<unknown>;
  onRetry: (run: EvaluationRun, caseIds: string[]) => Promise<unknown>;
  onStart: (run: EvaluationRun) => Promise<unknown>;
}

export const EvaluationRunDetail = memo<EvaluationRunDetailProps>(({
  detail,
  pendingMutations,
  run,
  cases,
  onBack,
  onCancel,
  onDelete,
  onRetry,
  onStart,
}) => {
  const { t } = useTranslation('agent');
  const status = evaluationRunStatusName(run.status);
  const metrics = run.metrics;
  const retryCaseIds = retryableCaseIds(detail?.attempts ?? []);
  const percent = run.totalCases > 0
    ? Math.round((run.completedCases / run.totalCases) * 100)
    : 0;
  const results = detail?.results ?? [];
  const focusDetail = useCallback((node: HTMLDivElement | null) => {
    node?.focus();
  }, []);
  const resultColumns: ColumnsType<EvaluationResult> = [
    {
      title: t('agent.eval.input'),
      key: 'input',
      render: (_, result) => (
        cases.find((testCase) => testCase.caseId === result.caseId)?.input
        ?? result.caseId
      ),
    },
    {
      title: t('agent.eval.expected'),
      key: 'expected',
      render: (_, result) => (
        cases.find((testCase) => testCase.caseId === result.caseId)?.expected
        ?? ''
      ),
    },
    {
      title: t('agent.eval.actual'),
      dataIndex: 'output',
      key: 'output',
      ellipsis: true,
    },
    {
      title: t('agent.eval.score'),
      dataIndex: 'score',
      key: 'score',
      width: 90,
    },
    {
      title: t('agent.eval.latency'),
      key: 'latency',
      width: 100,
      render: (_, result) => t('agent.eval.latencyValue', {
        value: Number(result.latencyMs),
      }),
    },
  ];

  return (
    <Flexbox
      ref={focusDetail}
      data-pt-evaluation-run-detail={run.runId}
      data-pt-evaluation-run-state={status}
      gap={16}
      tabIndex={-1}
    >
      <Flexbox horizontal align="center" justify="space-between" gap={12}>
        <Space>
          <Button data-pt-evaluation-back-to-runs onClick={onBack}>
            {t('agent.eval.back')}
          </Button>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {t('agent.eval.runDetail')}
          </Typography.Title>
          <Tag color={statusColor(run.status)}>
            {t(`agent.eval.state.${status}`)}
          </Tag>
        </Space>
        <Space>
          {run.status === EvaluationRunStatus.PENDING && (
            <Button
              data-pt-evaluation-start-run={run.runId}
              icon={<Play size={14} />}
              loading={mutationPending(
                pendingMutations,
                `evaluation:run:start:${run.runId}:`,
              )}
              type="primary"
              onClick={() => void onStart(run)}
            >
              {t('agent.eval.start')}
            </Button>
          )}
          {canCancelRun(run) && (
            <Button
              data-pt-evaluation-cancel-run={run.runId}
              danger
              icon={<Square size={13} />}
              loading={mutationPending(
                pendingMutations,
                `evaluation:run:cancel:${run.runId}:`,
              )}
              onClick={() => void onCancel(run)}
            >
              {t('agent.eval.cancel')}
            </Button>
          )}
          {retryCaseIds.length > 0 && (
            <Button
              data-pt-evaluation-retry-run={run.runId}
              icon={<RotateCcw size={14} />}
              loading={mutationPending(
                pendingMutations,
                `evaluation:run:retry:${run.runId}:`,
              )}
              onClick={() => void onRetry(run, retryCaseIds)}
            >
              {t('agent.eval.retryCases', { count: retryCaseIds.length })}
            </Button>
          )}
          {canDeleteRun(run) && (
            <Popconfirm
              title={t('agent.eval.deleteRunConfirm')}
              onConfirm={() => void onDelete(run)}
            >
              <Button
                data-pt-evaluation-delete-run={run.runId}
                danger
                icon={<Trash2 size={14} />}
                loading={mutationPending(
                  pendingMutations,
                  `evaluation:run:delete:${run.runId}:`,
                )}
              >
                {t('agent.eval.delete')}
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Flexbox>

      {(status === 'cancelling'
        || status === 'partial'
        || status === 'failed'
        || status === 'cancelled') && (
        <Alert
          data-pt-evaluation-trust-state={status}
          title={t(`agent.eval.stateTitle.${status}`)}
          description={
            run.error?.localeKey
              ? t(run.error.localeKey, {
                  defaultValue: t(`agent.eval.stateDescription.${status}`),
                })
              : t(`agent.eval.stateDescription.${status}`)
          }
          type={status === 'failed' ? 'error' : 'warning'}
          showIcon
        />
      )}

      <Progress
        percent={percent}
        status={
          status === 'failed'
            ? 'exception'
            : status === 'completed'
              ? 'success'
              : 'active'
        }
      />

      <Flexbox
        data-pt-evaluation-metrics
        horizontal
        gap={8}
        wrap="wrap"
      >
        <Tag>{t('agent.eval.totalCasesValue', { count: metrics?.totalCases ?? run.totalCases })}</Tag>
        <Tag>{t('agent.eval.terminalCasesValue', { count: metrics?.terminalCases ?? run.completedCases })}</Tag>
        <Tag color="success">{t('agent.eval.passedCasesValue', { count: metrics?.passedCases ?? 0 })}</Tag>
        <Tag color={metrics?.comparable ? 'success' : 'warning'}>
          {metrics?.comparable
            ? t('agent.eval.comparable')
            : t('agent.eval.notComparable')}
        </Tag>
        <Tag>{t('agent.eval.averageScoreValue', { value: metrics?.averageScore ?? 0 })}</Tag>
      </Flexbox>

      <Typography.Text
        data-pt-evaluation-target-snapshot={
          run.targetAgentSnapshot?.runtimeProfileId ?? ''
        }
        type="secondary"
      >
        {t('agent.eval.targetSnapshot', {
          agent: run.targetAgentId,
          revision: run.targetAgentRevision.toString(),
          snapshot:
            run.targetAgentSnapshot?.runtimeProfileId
            || t('agent.eval.pending'),
        })}
      </Typography.Text>

      {results.length === 0 ? (
        <Empty
          data-pt-evaluation-empty="results"
          description={t('agent.eval.noResults')}
        />
      ) : (
        <Table
          data-pt-evaluation-results
          columns={resultColumns}
          dataSource={results}
          pagination={false}
          rowKey="resultId"
          size="small"
          onRow={(result) => ({
            'data-pt-evaluation-result': result.resultId,
          } as HTMLAttributes<HTMLTableRowElement>)}
        />
      )}
    </Flexbox>
  );
});

EvaluationRunDetail.displayName = 'EvaluationRunDetail';
