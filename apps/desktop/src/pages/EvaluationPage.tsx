// Evaluation page — benchmark agent quality with datasets and runs.
// Part of P3-M4 "Evaluation System".

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  theme,
  Typography,
} from 'antd';
import { ClipboardCheck, Database, Play, Plus, Trash2 } from 'lucide-react';
import type { ColumnsType } from 'antd/es/table';

import { useEvaluationStore } from '../store/evaluation';
import { useAgentStore } from '../store/agent';
import type { EvalDataset, EvalDatasetItem, EvalRun, EvalRunResult } from '../store/evaluation';

type TabKey = 'datasets' | 'runs';

export const EvaluationPage = memo(() => {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  const [activeTab, setActiveTab] = useState<TabKey>('datasets');

  // Load datasets on mount
  const loadDatasets = useEvaluationStore((s) => s.loadDatasets);
  useEffect(() => { loadDatasets(); }, [loadDatasets]);

  return (
    <Flexbox
      padding={24}
      gap={20}
      style={{ height: '100%', overflow: 'auto', background: token.colorBgLayout }}
    >
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('agent.eval.title')}
      </Typography.Title>

      <Segmented
        value={activeTab}
        onChange={(val) => setActiveTab(val as TabKey)}
        options={[
          { label: t('agent.eval.datasets'), value: 'datasets', icon: <Database size={14} /> },
          { label: t('agent.eval.runs'), value: 'runs', icon: <ClipboardCheck size={14} /> },
        ]}
      />

      {activeTab === 'datasets' ? <DatasetsTab /> : <RunsTab />}
    </Flexbox>
  );
});

EvaluationPage.displayName = 'EvaluationPage';

// ── Datasets Tab ──

const DatasetsTab = memo(() => {
  const { t } = useTranslation('agent');
  const { message } = App.useApp();

  const datasets = useEvaluationStore((s) => s.datasets);
  const createDataset = useEvaluationStore((s) => s.createDataset);
  const deleteDataset = useEvaluationStore((s) => s.deleteDataset);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingDataset, setEditingDataset] = useState<EvalDataset | null>(null);
  const [form] = Form.useForm<{ name: string; description: string }>();

  const handleCreate = useCallback(() => {
    form.validateFields().then((values) => {
      createDataset(values.name, values.description);
      setCreateOpen(false);
      form.resetFields();
      message.success(t('agent.eval.createDataset'));
    });
  }, [createDataset, form, message, t]);

  const columns: ColumnsType<EvalDataset> = useMemo(
    () => [
      { title: t('agent.eval.datasetName'), dataIndex: 'name', key: 'name' },
      { title: t('agent.eval.description'), dataIndex: 'description', key: 'description', ellipsis: true },
      {
        title: t('agent.eval.itemCount'),
        key: 'items',
        width: 100,
        render: (_, record) => record.items.length,
      },
      {
        title: '',
        key: 'actions',
        width: 120,
        render: (_, record) => (
          <Space>
            <Button size="small" onClick={() => setEditingDataset(record)}>
              {t('agent.eval.edit')}
            </Button>
            <Popconfirm
              title={t('agent.eval.deleteConfirm')}
              onConfirm={() => deleteDataset(record.id)}
            >
              <Button size="small" danger icon={<Trash2 size={12} />} />
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [deleteDataset, t],
  );

  if (editingDataset) {
    return (
      <DatasetEditor
        dataset={editingDataset}
        onBack={() => setEditingDataset(null)}
      />
    );
  }

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" justify="space-between">
        <Typography.Text type="secondary">
          {datasets.length === 0 ? t('agent.eval.noDatasets') : `${datasets.length} dataset(s)`}
        </Typography.Text>
        <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
          {t('agent.eval.createDataset')}
        </Button>
      </Flexbox>

      {datasets.length > 0 && (
        <Table
          dataSource={datasets}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="small"
        />
      )}

      {datasets.length === 0 && <Empty description={t('agent.eval.noDatasets')} />}

      <Modal
        open={createOpen}
        title={t('agent.eval.createDataset')}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('agent.eval.datasetName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('agent.eval.description')}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Flexbox>
  );
});

DatasetsTab.displayName = 'DatasetsTab';

// ── Dataset Editor ──

interface DatasetEditorProps {
  dataset: EvalDataset;
  onBack: () => void;
}

const DatasetEditor = memo<DatasetEditorProps>(({ dataset, onBack }) => {
  const { t } = useTranslation('agent');

  const addItem = useEvaluationStore((s) => s.addItem);
  const removeItem = useEvaluationStore((s) => s.removeItem);
  const datasets = useEvaluationStore((s) => s.datasets);

  // Re-read dataset from store to get fresh items
  const currentDataset = datasets.find((d) => d.id === dataset.id) ?? dataset;

  const [addOpen, setAddOpen] = useState(false);
  const [form] = Form.useForm<{ input: string; expectedOutput: string; tags: string }>();

  const handleAdd = useCallback(() => {
    form.validateFields().then((values) => {
      const tags = values.tags ? values.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean) : [];
      addItem(dataset.id, { input: values.input, expectedOutput: values.expectedOutput, tags });
      setAddOpen(false);
      form.resetFields();
    });
  }, [addItem, dataset.id, form]);

  const columns: ColumnsType<EvalDatasetItem> = useMemo(
    () => [
      {
        title: t('agent.eval.input'),
        dataIndex: 'input',
        key: 'input',
        ellipsis: true,
        width: '35%',
      },
      {
        title: t('agent.eval.expected'),
        dataIndex: 'expectedOutput',
        key: 'expectedOutput',
        ellipsis: true,
        width: '35%',
      },
      {
        title: t('agent.eval.tags'),
        key: 'tags',
        width: '15%',
        render: (_, record) =>
          record.tags.map((tag) => <Tag key={tag}>{tag}</Tag>),
      },
      {
        title: '',
        key: 'actions',
        width: 60,
        render: (_, record) => (
          <Popconfirm
            title={t('agent.eval.deleteConfirm')}
            onConfirm={() => removeItem(dataset.id, record.id)}
          >
            <Button size="small" danger icon={<Trash2 size={12} />} />
          </Popconfirm>
        ),
      },
    ],
    [dataset.id, removeItem, t],
  );

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" gap={12}>
        <Button onClick={onBack}>{t('agent.eval.back')}</Button>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {currentDataset.name}
        </Typography.Title>
      </Flexbox>

      <Flexbox horizontal align="center" justify="flex-end">
        <Button icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
          {t('agent.eval.addItem')}
        </Button>
      </Flexbox>

      <Table
        dataSource={currentDataset.items}
        columns={columns}
        rowKey="id"
        pagination={false}
        size="small"
      />

      <Modal
        open={addOpen}
        title={t('agent.eval.addItem')}
        onCancel={() => setAddOpen(false)}
        onOk={handleAdd}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="input" label={t('agent.eval.input')} rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="expectedOutput" label={t('agent.eval.expected')} rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="tags" label={t('agent.eval.tags')}>
            <Input placeholder="tag1, tag2" />
          </Form.Item>
        </Form>
      </Modal>
    </Flexbox>
  );
});

DatasetEditor.displayName = 'DatasetEditor';

// ── Runs Tab ──

const RunsTab = memo(() => {
  const { t } = useTranslation('agent');
  const { message } = App.useApp();

  const runs = useEvaluationStore((s) => s.runs);
  const datasets = useEvaluationStore((s) => s.datasets);
  const startRun = useEvaluationStore((s) => s.startRun);
  const cancelRun = useEvaluationStore((s) => s.cancelRun);
  const activeRunId = useEvaluationStore((s) => s.activeRunId);
  const agents = useAgentStore((s) => s.agents);

  const [newRunOpen, setNewRunOpen] = useState(false);
  const [selectedRunDetail, setSelectedRunDetail] = useState<EvalRun | null>(null);
  const [form] = Form.useForm<{ datasetId: string; agentId: string }>();

  const handleStartRun = useCallback(() => {
    form.validateFields().then((values) => {
      setNewRunOpen(false);
      form.resetFields();
      void startRun(values.datasetId, values.agentId);
      message.info(t('agent.eval.running'));
    });
  }, [form, message, startRun, t]);

  const statusColor = (status: EvalRun['status']): string => {
    switch (status) {
      case 'completed': return 'green';
      case 'running': return 'blue';
      case 'failed': return 'red';
      default: return 'default';
    }
  };

  const columns: ColumnsType<EvalRun> = useMemo(
    () => [
      {
        title: t('agent.eval.dataset'),
        key: 'dataset',
        render: (_, record) => {
          const ds = datasets.find((d) => d.id === record.datasetId);
          return ds?.name ?? record.datasetId;
        },
      },
      { title: t('agent.eval.agent'), dataIndex: 'agentId', key: 'agentId' },
      {
        title: t('agent.eval.status'),
        key: 'status',
        width: 120,
        render: (_, record) => (
          <Tag color={statusColor(record.status)}>
            {record.status === 'completed'
              ? t('agent.eval.completed')
              : record.status === 'running'
                ? t('agent.eval.running')
                : record.status === 'failed'
                  ? t('agent.eval.failed')
                  : record.status}
          </Tag>
        ),
      },
      {
        title: t('agent.eval.accuracy'),
        key: 'accuracy',
        width: 100,
        render: (_, record) => `${(record.metrics.accuracy * 100).toFixed(1)}%`,
      },
      {
        title: t('agent.eval.avgLatency'),
        key: 'latency',
        width: 120,
        render: (_, record) => `${record.metrics.avgLatency}ms`,
      },
      {
        title: '',
        key: 'actions',
        width: 100,
        render: (_, record) => (
          <Space>
            <Button size="small" onClick={() => setSelectedRunDetail(record)}>
              {t('agent.eval.detail')}
            </Button>
            {record.status === 'running' && (
              <Button size="small" danger onClick={() => cancelRun(record.id)}>
                {t('agent.eval.cancel')}
              </Button>
            )}
          </Space>
        ),
      },
    ],
    [cancelRun, datasets, t],
  );

  if (selectedRunDetail) {
    // Re-read from store for live updates
    const liveRun = runs.find((r) => r.id === selectedRunDetail.id) ?? selectedRunDetail;
    return <RunDetail run={liveRun} onBack={() => setSelectedRunDetail(null)} />;
  }

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" justify="space-between">
        <Typography.Text type="secondary">
          {runs.length === 0 ? t('agent.eval.noRuns') : `${runs.length} run(s)`}
        </Typography.Text>
        <Button
          type="primary"
          icon={<Play size={14} />}
          onClick={() => setNewRunOpen(true)}
          disabled={datasets.length === 0 || activeRunId !== null}
        >
          {t('agent.eval.createRun')}
        </Button>
      </Flexbox>

      {runs.length > 0 && (
        <Table dataSource={[...runs].reverse()} columns={columns} rowKey="id" pagination={false} size="small" />
      )}

      {runs.length === 0 && <Empty description={t('agent.eval.noRuns')} />}

      <Modal
        open={newRunOpen}
        title={t('agent.eval.createRun')}
        onCancel={() => setNewRunOpen(false)}
        onOk={handleStartRun}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="datasetId" label={t('agent.eval.selectDataset')} rules={[{ required: true }]}>
            <Select
              options={datasets.map((d) => ({ label: d.name, value: d.id }))}
              placeholder={t('agent.eval.selectDataset')}
            />
          </Form.Item>
          <Form.Item name="agentId" label={t('agent.eval.selectAgent')} rules={[{ required: true }]}>
            <Select
              options={agents.map((a) => ({ label: a.title || a.name, value: a.name }))}
              placeholder={t('agent.eval.selectAgent')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Flexbox>
  );
});

RunsTab.displayName = 'RunsTab';

// ── Run Detail ──

interface RunDetailProps {
  run: EvalRun;
  onBack: () => void;
}

const RunDetail = memo<RunDetailProps>(({ run, onBack }) => {
  const { t } = useTranslation('agent');
  const datasets = useEvaluationStore((s) => s.datasets);
  const dataset = datasets.find((d) => d.id === run.datasetId);

  const columns: ColumnsType<EvalRunResult> = useMemo(
    () => [
      {
        title: t('agent.eval.input'),
        key: 'input',
        width: '25%',
        ellipsis: true,
        render: (_, record) => {
          const item = dataset?.items.find((i) => i.id === record.itemId);
          return item?.input ?? record.itemId;
        },
      },
      {
        title: t('agent.eval.expected'),
        key: 'expected',
        width: '25%',
        ellipsis: true,
        render: (_, record) => {
          const item = dataset?.items.find((i) => i.id === record.itemId);
          return item?.expectedOutput ?? '-';
        },
      },
      {
        title: t('agent.eval.actual'),
        dataIndex: 'actualOutput',
        key: 'actual',
        width: '25%',
        ellipsis: true,
      },
      {
        title: t('agent.eval.result'),
        key: 'passed',
        width: 80,
        render: (_, record) => (
          <Tag color={record.passed ? 'green' : 'red'}>
            {record.passed ? t('agent.eval.passed') : t('agent.eval.failed')}
          </Tag>
        ),
      },
      {
        title: t('agent.eval.latency'),
        key: 'latency',
        width: 80,
        render: (_, record) => `${record.latencyMs}ms`,
      },
    ],
    [dataset, t],
  );

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" gap={12}>
        <Button onClick={onBack}>{t('agent.eval.back')}</Button>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t('agent.eval.runDetail')}
        </Typography.Title>
        <Tag color={run.status === 'completed' ? 'green' : run.status === 'running' ? 'blue' : 'red'}>
          {run.status}
        </Tag>
      </Flexbox>

      <Flexbox horizontal gap={24}>
        <Typography.Text>
          {t('agent.eval.accuracy')}: <strong>{(run.metrics.accuracy * 100).toFixed(1)}%</strong>
        </Typography.Text>
        <Typography.Text>
          {t('agent.eval.avgLatency')}: <strong>{run.metrics.avgLatency}ms</strong>
        </Typography.Text>
        <Typography.Text>
          {t('agent.eval.progress')}: {run.results.length}/{dataset?.items.length ?? '?'}
        </Typography.Text>
      </Flexbox>

      {run.status === 'running' && dataset && (
        <Progress percent={Math.round((run.results.length / dataset.items.length) * 100)} />
      )}

      <Table dataSource={run.results} columns={columns} rowKey="itemId" pagination={false} size="small" />
    </Flexbox>
  );
});

RunDetail.displayName = 'RunDetail';
