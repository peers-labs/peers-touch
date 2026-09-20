import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  App,
  Button,
  Empty,
  Form,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import type { ColumnsType } from 'antd/es/table';

import {
  EvaluationRunStatus,
  type EvaluationRun,
} from '../../gen/proto/domain/agent/evaluation_pb';
import { useAgentStore } from '../../store/agent';
import { useAgentCapabilityStore } from '../../store/agentCapabilities';
import {
  evaluationRunStatusName,
  useEvaluationStore,
} from '../../store/evaluation';
import {
  canCancelRun,
  canDeleteRun,
  isFormValidationFailure,
  mutationPending,
  statusColor,
} from './shared';
import { EvaluationRunDetail } from './RunDetail';

interface RunFormValues {
  datasetId: string;
  agentId: string;
}

export const EvaluationRunList = memo(() => {
  const { t } = useTranslation('agent');
  const { message } = App.useApp();
  const runs = useEvaluationStore((state) => state.runs);
  const datasets = useEvaluationStore((state) => state.datasets);
  const runDetailsById = useEvaluationStore((state) => state.runDetailsById);
  const pendingMutations = useEvaluationStore((state) => state.pendingMutations);
  const createRun = useEvaluationStore((state) => state.createRun);
  const startRun = useEvaluationStore((state) => state.startRun);
  const cancelRun = useEvaluationStore((state) => state.cancelRun);
  const deleteRun = useEvaluationStore((state) => state.deleteRun);
  const retryCases = useEvaluationStore((state) => state.retryCases);
  const refreshRun = useEvaluationStore((state) => state.refreshRun);
  const agents = useAgentStore((state) => state.agents);
  const readinessByAgentId = useAgentCapabilityStore(
    (state) => state.readinessByAgentId,
  );
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');
  const createRunButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [form] = Form.useForm<RunFormValues>();
  const performAction = useCallback(async <T,>(
    action: () => Promise<T>,
  ): Promise<T | undefined> => {
    try {
      return await action();
    } catch {
      message.error(t('agent.eval.actionFailed'));
      return undefined;
    }
  }, [message, t]);

  const listedRun = selectedRunId
    ? runs.find((run) => run.runId === selectedRunId)
    : undefined;
  const detail = listedRun
    ? runDetailsById[listedRun.runId]
    : undefined;
  const selectedRun = detail?.run ?? listedRun;

  const submitRun = async () => {
    try {
      const values = await form.validateFields();
      const dataset = datasets.find((item) => item.datasetId === values.datasetId);
      const agent = agents.find((item) => item.id === values.agentId);
      const readiness = readinessByAgentId[values.agentId];
      if (!dataset || !agent || !readiness?.snapshotId) {
        message.error(t('agent.eval.targetUnavailable'));
        return;
      }
      const run = await createRun({
        datasetId: dataset.datasetId,
        datasetRevision: dataset.revision,
        targetAgentId: agent.id,
        expectedAgentRevision: BigInt(agent.version),
        readinessSnapshotId: readiness.snapshotId,
        modelId: agent.model || undefined,
      });
      returnFocusRef.current = createRunButtonRef.current;
      setSelectedRunId(run.runId);
      setNewRunOpen(false);
      form.resetFields();
      message.success(t('agent.eval.runCreated'));
    } catch (error) {
      if (!isFormValidationFailure(error)) {
        message.error(t('agent.eval.actionFailed'));
      }
    }
  };

  const closeRunDetail = useCallback(() => {
    setSelectedRunId('');
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  const runColumns = useMemo<ColumnsType<EvaluationRun>>(
    () => [
      {
        title: t('agent.eval.dataset'),
        key: 'dataset',
        render: (_, run) => (
          datasets.find((dataset) => dataset.datasetId === run.datasetId)?.name
          ?? run.datasetId
        ),
      },
      {
        title: t('agent.eval.agent'),
        dataIndex: 'targetAgentId',
        key: 'targetAgentId',
      },
      {
        title: t('agent.eval.status'),
        key: 'status',
        width: 130,
        render: (_, run) => {
          const status = evaluationRunStatusName(run.status);
          return (
            <Tag
              data-pt-evaluation-run-state={status}
              color={statusColor(run.status)}
            >
              {t(`agent.eval.state.${status}`)}
            </Tag>
          );
        },
      },
      {
        title: t('agent.eval.progress'),
        key: 'progress',
        width: 120,
        render: (_, run) => `${run.completedCases}/${run.totalCases}`,
      },
      {
        title: t('agent.eval.actions'),
        key: 'actions',
        width: 230,
        render: (_, run) => (
          <Space>
            <Button
              data-pt-evaluation-open-run={run.runId}
              size="small"
              onClick={(event) => {
                returnFocusRef.current = event.currentTarget;
                setSelectedRunId(run.runId);
                void refreshRun(run.runId);
              }}
            >
              {t('agent.eval.detail')}
            </Button>
            {run.status === EvaluationRunStatus.PENDING && (
              <Button
                data-pt-evaluation-start-run={run.runId}
                loading={mutationPending(
                  pendingMutations,
                  `evaluation:run:start:${run.runId}:`,
                )}
                size="small"
                type="primary"
                onClick={() => performAction(() => startRun(run))}
              >
                {t('agent.eval.start')}
              </Button>
            )}
            {canCancelRun(run) && (
              <Button
                data-pt-evaluation-cancel-run={run.runId}
                danger
                loading={mutationPending(
                  pendingMutations,
                  `evaluation:run:cancel:${run.runId}:`,
                )}
                size="small"
                onClick={() => performAction(() => cancelRun(run))}
              >
                {t('agent.eval.cancel')}
              </Button>
            )}
            {canDeleteRun(run) && (
              <Popconfirm
                title={t('agent.eval.deleteRunConfirm')}
                onConfirm={() => performAction(() => deleteRun(run))}
              >
                <Button
                  aria-label={t('agent.eval.delete')}
                  data-pt-evaluation-delete-run={run.runId}
                  danger
                  icon={<Trash2 size={13} />}
                  loading={mutationPending(
                    pendingMutations,
                    `evaluation:run:delete:${run.runId}:`,
                  )}
                  size="small"
                />
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    [
      cancelRun,
      deleteRun,
      datasets,
      pendingMutations,
      performAction,
      refreshRun,
      startRun,
      t,
    ],
  );

  if (selectedRun) {
    return (
      <EvaluationRunDetail
        detail={detail}
        pendingMutations={pendingMutations}
        run={selectedRun}
        cases={detail?.cases ?? []}
        onBack={closeRunDetail}
        onCancel={(run) => performAction(() => cancelRun(run))}
        onDelete={async (run) => {
          const deleted = await performAction(() => deleteRun(run));
          if (deleted) closeRunDetail();
        }}
        onRetry={async (run, caseIds) => {
          const child = await performAction(() => retryCases(run, caseIds));
          if (child) setSelectedRunId(child.runId);
        }}
        onStart={(run) => performAction(() => startRun(run))}
      />
    );
  }

  return (
    <Flexbox data-pt-evaluation-runs gap={16}>
      <Flexbox horizontal align="center" justify="space-between">
        <Typography.Text type="secondary">
          {t('agent.eval.runCount', { count: runs.length })}
        </Typography.Text>
        <Button
          ref={createRunButtonRef}
          data-pt-evaluation-create-run
          type="primary"
          icon={<Plus size={14} />}
          disabled={datasets.length === 0 || agents.length === 0}
          onClick={() => setNewRunOpen(true)}
        >
          {t('agent.eval.createRun')}
        </Button>
      </Flexbox>

      {runs.length === 0 ? (
        <Empty
          data-pt-evaluation-empty="runs"
          description={t('agent.eval.noRuns')}
        />
      ) : (
        <Table
          data-pt-evaluation-run-list
          dataSource={runs}
          columns={runColumns}
          pagination={false}
          rowKey="runId"
          size="small"
          onRow={(run) => ({
            'data-pt-evaluation-run': run.runId,
          } as HTMLAttributes<HTMLTableRowElement>)}
        />
      )}

      <Modal
        open={newRunOpen}
        confirmLoading={mutationPending(
          pendingMutations,
          'evaluation:create:run:',
        )}
        okButtonProps={{
          'data-pt-evaluation-create-run-submit': '',
        }}
        title={t('agent.eval.createRun')}
        onCancel={() => setNewRunOpen(false)}
        onOk={() => void submitRun()}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="datasetId"
            label={t('agent.eval.selectDataset')}
            rules={[{ required: true }]}
          >
            <Select
              data-pt-evaluation-dataset
              options={datasets.map((dataset) => ({
                label: dataset.name,
                value: dataset.datasetId,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="agentId"
            label={t('agent.eval.selectAgent')}
            rules={[{ required: true }]}
          >
            <Select
              data-pt-evaluation-target-agent
              options={agents.map((agent) => {
                const readiness = readinessByAgentId[agent.id];
                return {
                  disabled: !readiness?.snapshotId,
                  label: agent.title || agent.name,
                  value: agent.id,
                };
              })}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Flexbox>
  );
});

EvaluationRunList.displayName = 'EvaluationRunList';
