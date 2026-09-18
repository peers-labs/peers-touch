import { memo, useCallback, useMemo, useState } from 'react';
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
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ColumnsType } from 'antd/es/table';

import type {
  EvaluationBenchmark,
  EvaluationDataset,
  EvaluationTestCase,
} from '../../gen/proto/domain/agent/evaluation_pb';
import { useEvaluationStore } from '../../store/evaluation';
import { isFormValidationFailure, mutationPending } from './shared';

type DefinitionEditor =
  | { kind: 'benchmark'; value?: EvaluationBenchmark }
  | { kind: 'dataset'; benchmark: EvaluationBenchmark; value?: EvaluationDataset }
  | { kind: 'case'; dataset: EvaluationDataset; value?: EvaluationTestCase }
  | null;

interface DefinitionFormValues {
  name: string;
  description: string;
  rubric: string;
  input: string;
  expected: string;
  rubricOverride: string;
  tags: string;
}

function editorMutationPrefix(editor: DefinitionEditor): string {
  if (!editor) return 'evaluation:';
  if (editor.kind === 'benchmark') {
    return editor.value
      ? `evaluation:benchmark:update:${editor.value.benchmarkId}:`
      : 'evaluation:create:benchmark:';
  }
  if (editor.kind === 'dataset') {
    return editor.value
      ? `evaluation:dataset:update:${editor.value.datasetId}:`
      : `evaluation:create:dataset:${editor.benchmark.benchmarkId}:`;
  }
  return editor.value
    ? `evaluation:case:update:${editor.value.caseId}:`
    : `evaluation:create:case:${editor.dataset.datasetId}:`;
}

export const EvaluationDefinitionsPanel = memo(() => {
  const { t } = useTranslation('agent');
  const { message } = App.useApp();
  const benchmarks = useEvaluationStore((state) => state.benchmarks);
  const datasets = useEvaluationStore((state) => state.datasets);
  const testCasesByDatasetId = useEvaluationStore(
    (state) => state.testCasesByDatasetId,
  );
  const pendingMutations = useEvaluationStore((state) => state.pendingMutations);
  const createBenchmark = useEvaluationStore((state) => state.createBenchmark);
  const updateBenchmark = useEvaluationStore((state) => state.updateBenchmark);
  const deleteBenchmark = useEvaluationStore((state) => state.deleteBenchmark);
  const createDataset = useEvaluationStore((state) => state.createDataset);
  const updateDataset = useEvaluationStore((state) => state.updateDataset);
  const deleteDataset = useEvaluationStore((state) => state.deleteDataset);
  const createTestCase = useEvaluationStore((state) => state.createTestCase);
  const updateTestCase = useEvaluationStore((state) => state.updateTestCase);
  const deleteTestCase = useEvaluationStore((state) => state.deleteTestCase);

  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [editor, setEditor] = useState<DefinitionEditor>(null);
  const [form] = Form.useForm<DefinitionFormValues>();
  const performAction = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch {
      message.error(t('agent.eval.actionFailed'));
    }
  }, [message, t]);

  const selectedBenchmark = (
    benchmarks.find((item) => item.benchmarkId === selectedBenchmarkId)
    ?? benchmarks[0]
  );
  const scopedDatasets = datasets.filter(
    (item) => item.benchmarkId === selectedBenchmark?.benchmarkId,
  );
  const selectedDataset = (
    scopedDatasets.find((item) => item.datasetId === selectedDatasetId)
    ?? scopedDatasets[0]
  );
  const testCases = selectedDataset
    ? testCasesByDatasetId[selectedDataset.datasetId] ?? []
    : [];

  const openEditor = useCallback((next: Exclude<DefinitionEditor, null>) => {
    setEditor(next);
    if (next.kind === 'benchmark') {
      form.setFieldsValue({
        name: next.value?.name ?? '',
        rubric: next.value?.rubric ?? 'exact_match',
      });
    } else if (next.kind === 'dataset') {
      form.setFieldsValue({
        name: next.value?.name ?? '',
        description: next.value?.description ?? '',
      });
    } else {
      form.setFieldsValue({
        input: next.value?.input ?? '',
        expected: next.value?.expected ?? '',
        rubricOverride: next.value?.rubricOverride ?? '',
        tags: next.value?.tags.join(', ') ?? '',
      });
    }
  }, [form]);

  const submitEditor = async () => {
    if (!editor) return;
    try {
      const values = await form.validateFields();
      if (editor.kind === 'benchmark') {
        if (editor.value) {
          await updateBenchmark(editor.value, {
            name: values.name,
            rubric: values.rubric,
          });
        } else {
          await createBenchmark(values.name, values.rubric);
        }
      } else if (editor.kind === 'dataset') {
        if (editor.value) {
          await updateDataset(editor.value, {
            name: values.name,
            description: values.description ?? '',
          });
        } else {
          await createDataset(
            editor.benchmark,
            values.name,
            values.description ?? '',
          );
        }
      } else {
        const caseValues = {
          input: values.input,
          expected: values.expected,
          rubricOverride: values.rubricOverride || undefined,
          tags: (values.tags ?? '')
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        };
        if (editor.value) {
          await updateTestCase(editor.value, caseValues);
        } else {
          await createTestCase(editor.dataset, caseValues);
        }
      }
      setEditor(null);
      form.resetFields();
      message.success(t('agent.eval.saved'));
    } catch (error) {
      if (!isFormValidationFailure(error)) {
        message.error(t('agent.eval.actionFailed'));
      }
    }
  };

  const caseColumns = useMemo<ColumnsType<EvaluationTestCase>>(
    () => [
      {
        title: t('agent.eval.input'),
        dataIndex: 'input',
        key: 'input',
        ellipsis: true,
      },
      {
        title: t('agent.eval.expected'),
        dataIndex: 'expected',
        key: 'expected',
        ellipsis: true,
      },
      {
        title: t('agent.eval.tags'),
        key: 'tags',
        render: (_, record) => (
          <Space size={[4, 4]} wrap>
            {record.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
          </Space>
        ),
      },
      {
        title: t('agent.eval.actions'),
        key: 'actions',
        width: 110,
        render: (_, record) => (
          <Space>
            <Button
              aria-label={t('agent.eval.editCase')}
              data-pt-evaluation-edit-case={record.caseId}
              icon={<Pencil size={13} />}
              size="small"
              onClick={() => openEditor({
                kind: 'case',
                dataset: selectedDataset!,
                value: record,
              })}
            />
            <Popconfirm
              title={t('agent.eval.deleteConfirm')}
              onConfirm={() => performAction(() => deleteTestCase(record))}
            >
              <Button
                aria-label={t('agent.eval.deleteCase')}
                data-pt-evaluation-delete-case={record.caseId}
                danger
                icon={<Trash2 size={13} />}
                size="small"
              />
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [deleteTestCase, openEditor, performAction, selectedDataset, t],
  );

  return (
    <Flexbox data-pt-evaluation-definitions gap={16}>
      <Flexbox horizontal align="end" gap={12} wrap="wrap">
        <Flexbox gap={4} style={{ minWidth: 240 }}>
          <Typography.Text type="secondary">
            {t('agent.eval.benchmark')}
          </Typography.Text>
          <Select
            data-pt-evaluation-benchmark-select
            value={selectedBenchmark?.benchmarkId}
            options={benchmarks.map((benchmark) => ({
              label: benchmark.name,
              value: benchmark.benchmarkId,
            }))}
            placeholder={t('agent.eval.selectBenchmark')}
            onChange={(value) => {
              setSelectedBenchmarkId(value);
              setSelectedDatasetId('');
            }}
          />
        </Flexbox>
        <Button
          data-pt-evaluation-create-benchmark
          icon={<Plus size={14} />}
          onClick={() => openEditor({ kind: 'benchmark' })}
        >
          {t('agent.eval.createBenchmark')}
        </Button>
        {selectedBenchmark && (
          <>
            <Button
              data-pt-evaluation-edit-benchmark={selectedBenchmark.benchmarkId}
              icon={<Pencil size={14} />}
              onClick={() => openEditor({
                kind: 'benchmark',
                value: selectedBenchmark,
              })}
            >
              {t('agent.eval.edit')}
            </Button>
            <Popconfirm
              title={t('agent.eval.deleteConfirm')}
              onConfirm={() => performAction(
                () => deleteBenchmark(selectedBenchmark),
              )}
            >
              <Button
                data-pt-evaluation-delete-benchmark={selectedBenchmark.benchmarkId}
                danger
                icon={<Trash2 size={14} />}
              >
                {t('agent.eval.delete')}
              </Button>
            </Popconfirm>
          </>
        )}
      </Flexbox>

      {!selectedBenchmark ? (
        <Empty
          data-pt-evaluation-empty="benchmarks"
          description={t('agent.eval.noBenchmarks')}
        />
      ) : (
        <>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {selectedBenchmark.rubric || t('agent.eval.noRubric')}
          </Typography.Paragraph>
          <Flexbox horizontal align="end" gap={12} wrap="wrap">
            <Flexbox gap={4} style={{ minWidth: 240 }}>
              <Typography.Text type="secondary">
                {t('agent.eval.dataset')}
              </Typography.Text>
              <Select
                data-pt-evaluation-dataset-select
                value={selectedDataset?.datasetId}
                options={scopedDatasets.map((dataset) => ({
                  label: dataset.name,
                  value: dataset.datasetId,
                }))}
                placeholder={t('agent.eval.selectDataset')}
                onChange={setSelectedDatasetId}
              />
            </Flexbox>
            <Button
              data-pt-evaluation-create-dataset
              icon={<Plus size={14} />}
              onClick={() => openEditor({
                kind: 'dataset',
                benchmark: selectedBenchmark,
              })}
            >
              {t('agent.eval.createDataset')}
            </Button>
            {selectedDataset && (
              <>
                <Button
                  data-pt-evaluation-edit-dataset={selectedDataset.datasetId}
                  icon={<Pencil size={14} />}
                  onClick={() => openEditor({
                    kind: 'dataset',
                    benchmark: selectedBenchmark,
                    value: selectedDataset,
                  })}
                >
                  {t('agent.eval.edit')}
                </Button>
                <Popconfirm
                  title={t('agent.eval.deleteConfirm')}
                  onConfirm={() => performAction(
                    () => deleteDataset(selectedDataset),
                  )}
                >
                  <Button
                    data-pt-evaluation-delete-dataset={selectedDataset.datasetId}
                    danger
                    icon={<Trash2 size={14} />}
                  >
                    {t('agent.eval.delete')}
                  </Button>
                </Popconfirm>
              </>
            )}
          </Flexbox>
          {!selectedDataset ? (
            <Empty
              data-pt-evaluation-empty="datasets"
              description={t('agent.eval.noDatasets')}
            />
          ) : (
            <Flexbox gap={12}>
              <Flexbox horizontal align="center" justify="space-between">
                <Typography.Text type="secondary">
                  {t('agent.eval.caseCount', { count: testCases.length })}
                </Typography.Text>
                <Button
                  data-pt-evaluation-create-case
                  icon={<Plus size={14} />}
                  onClick={() => openEditor({
                    kind: 'case',
                    dataset: selectedDataset,
                  })}
                >
                  {t('agent.eval.addItem')}
                </Button>
              </Flexbox>
              {testCases.length === 0 ? (
                <Empty
                  data-pt-evaluation-empty="cases"
                  description={t('agent.eval.noCases')}
                />
              ) : (
                <Table
                  data-pt-evaluation-cases
                  columns={caseColumns}
                  dataSource={testCases}
                  pagination={false}
                  rowKey="caseId"
                  size="small"
                />
              )}
            </Flexbox>
          )}
        </>
      )}

      <Modal
        open={editor !== null}
        confirmLoading={mutationPending(
          pendingMutations,
          editorMutationPrefix(editor),
        )}
        title={editor ? t(`agent.eval.editor.${editor.kind}`) : ''}
        onCancel={() => {
          setEditor(null);
          form.resetFields();
        }}
        onOk={() => void submitEditor()}
      >
        <Form form={form} layout="vertical">
          {(editor?.kind === 'benchmark' || editor?.kind === 'dataset') && (
            <Form.Item
              name="name"
              label={t('agent.eval.datasetName')}
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
          )}
          {editor?.kind === 'benchmark' && (
            <Form.Item
              name="rubric"
              label={t('agent.eval.rubric')}
              rules={[{ required: true }]}
            >
              <Select
                options={[
                  {
                    label: t('agent.eval.rubric.exactMatch'),
                    value: 'exact_match',
                  },
                  {
                    label: t('agent.eval.rubric.caseInsensitiveContains'),
                    value: 'case_insensitive_contains',
                  },
                ]}
              />
            </Form.Item>
          )}
          {editor?.kind === 'dataset' && (
            <Form.Item name="description" label={t('agent.eval.description')}>
              <Input.TextArea rows={3} />
            </Form.Item>
          )}
          {editor?.kind === 'case' && (
            <>
              <Form.Item
                name="input"
                label={t('agent.eval.input')}
                rules={[{ required: true }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item
                name="expected"
                label={t('agent.eval.expected')}
                rules={[{ required: true }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item
                name="rubricOverride"
                label={t('agent.eval.rubricOverride')}
              >
                <Select
                  allowClear
                  placeholder={t('agent.eval.rubric.inherit')}
                  options={[
                    {
                      label: t('agent.eval.rubric.exactMatch'),
                      value: 'exact_match',
                    },
                    {
                      label: t('agent.eval.rubric.caseInsensitiveContains'),
                      value: 'case_insensitive_contains',
                    },
                  ]}
                />
              </Form.Item>
              <Form.Item name="tags" label={t('agent.eval.tags')}>
                <Input placeholder={t('agent.eval.tagsPlaceholder')} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Flexbox>
  );
});

EvaluationDefinitionsPanel.displayName = 'EvaluationDefinitionsPanel';
