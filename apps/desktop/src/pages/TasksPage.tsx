// Tasks page — lists, creates, and manages agent tasks with filtering.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  Button,
  Card,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Empty,
  Popconfirm,
  Progress,
  Segmented,
  theme,
  Checkbox,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  StopOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';

import { useTaskStore, type AgentTask, type TaskStatus, type TaskPriority } from '../store/tasks';
import { useAgentStore } from '../store/agent';

type FilterTab = 'all' | 'active' | 'completed';

interface CreateFormValues {
  title: string;
  description: string;
  agentId: string;
  priority: TaskPriority;
}

const STATUS_ICON_MAP: Record<TaskStatus, React.ReactNode> = {
  pending: <ClockCircleOutlined />,
  running: <PlayCircleOutlined />,
  paused: <PauseCircleOutlined />,
  completed: <CheckCircleOutlined />,
  failed: <ExclamationCircleOutlined />,
  cancelled: <MinusCircleOutlined />,
};

function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation('agent');
  const colorMap: Record<TaskStatus, string> = {
    pending: 'default',
    running: 'processing',
    paused: 'warning',
    completed: 'success',
    failed: 'error',
    cancelled: 'default',
  };
  return (
    <Tag icon={STATUS_ICON_MAP[status]} color={colorMap[status]}>
      {t(`agent.tasks.status.${status}`)}
    </Tag>
  );
}

function PriorityIndicator({ priority }: { priority: TaskPriority }) {
  const { t } = useTranslation('agent');
  const colorMap: Record<TaskPriority, string> = {
    low: 'green',
    medium: 'orange',
    high: 'red',
  };
  return (
    <Tag color={colorMap[priority]}>
      {t(`agent.tasks.priority.${priority}`)}
    </Tag>
  );
}

function TaskCard({ task }: { task: AgentTask }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const agents = useAgentStore((s) => s.agents);
  const startTask = useTaskStore((s) => s.startTask);
  const pauseTask = useTaskStore((s) => s.pauseTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const addSubtask = useTaskStore((s) => s.addSubtask);
  const completeSubtask = useTaskStore((s) => s.completeSubtask);

  const [expanded, setExpanded] = useState(false);
  const [subtaskInput, setSubtaskInput] = useState('');

  const agent = agents.find((a) => a.id === task.agentId);
  const agentName = agent?.title || agent?.name || task.agentId;

  const canStart = task.status === 'pending' || task.status === 'paused';
  const canPause = task.status === 'running';
  const canCancel = task.status === 'pending' || task.status === 'running' || task.status === 'paused';

  const handleAddSubtask = useCallback(() => {
    const trimmed = subtaskInput.trim();
    if (!trimmed) return;
    addSubtask(task.id, trimmed);
    setSubtaskInput('');
  }, [subtaskInput, addSubtask, task.id]);

  return (
    <Card
      hoverable
      onClick={() => setExpanded(!expanded)}
      style={{ marginBottom: 12 }}
      styles={{ body: { padding: '16px 20px' } }}
    >
      <Flexbox gap={12}>
        {/* Header row */}
        <Flexbox horizontal align="center" distribution="space-between">
          <Flexbox horizontal align="center" gap={12} style={{ flex: 1, minWidth: 0 }}>
            <Flexbox style={{ minWidth: 0, flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {task.title}
              </span>
              <span style={{ fontSize: 12, opacity: 0.6 }}>{agentName}</span>
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8} style={{ flexShrink: 0 }}>
            <PriorityIndicator priority={task.priority} />
            <StatusBadge status={task.status} />
          </Flexbox>
        </Flexbox>

        {/* Progress bar */}
        {(task.status === 'running' || task.subtasks.length > 0) && (
          <Progress
            percent={task.progress}
            size="small"
            status={task.status === 'failed' ? 'exception' : task.status === 'completed' ? 'success' : 'active'}
          />
        )}

        {/* Expanded details */}
        {expanded && (
          <Flexbox gap={12} style={{ marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
            {/* Description */}
            {task.description && (
              <Flexbox style={{ padding: '8px 12px', borderRadius: 6, background: token.colorFillQuaternary }}>
                <span style={{ fontSize: 13, lineHeight: 1.6 }}>{task.description}</span>
              </Flexbox>
            )}

            {/* Linked topic */}
            {task.topicKey && (
              <Flexbox horizontal align="center" gap={8}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{t('agent.tasks.linkedTopic')}:</span>
                <Tag>{task.topicKey}</Tag>
              </Flexbox>
            )}

            {/* Result */}
            {task.result && (
              <Flexbox style={{ padding: '8px 12px', borderRadius: 6, background: token.colorSuccessBg }}>
                <span style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{t('agent.tasks.result')}:</span>
                <span style={{ fontSize: 13 }}>{task.result}</span>
              </Flexbox>
            )}

            {/* Error */}
            {task.error && (
              <Flexbox style={{ padding: '8px 12px', borderRadius: 6, background: token.colorErrorBg }}>
                <span style={{ fontSize: 13, color: token.colorError }}>{task.error}</span>
              </Flexbox>
            )}

            {/* Subtasks */}
            {task.subtasks.length > 0 && (
              <Flexbox gap={6}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{t('agent.tasks.subtasks')}:</span>
                {task.subtasks.map((sub) => (
                  <Flexbox key={sub.id} horizontal align="center" gap={8} style={{ paddingLeft: 8 }}>
                    <Checkbox
                      checked={sub.status === 'completed'}
                      onChange={() => {
                        if (sub.status !== 'completed') {
                          completeSubtask(task.id, sub.id);
                        }
                      }}
                    />
                    <span style={{ fontSize: 13, textDecoration: sub.status === 'completed' ? 'line-through' : undefined, opacity: sub.status === 'completed' ? 0.6 : 1 }}>
                      {sub.title}
                    </span>
                  </Flexbox>
                ))}
              </Flexbox>
            )}

            {/* Add subtask */}
            <Flexbox horizontal align="center" gap={8}>
              <Input
                size="small"
                placeholder={t('agent.tasks.addSubtask')}
                value={subtaskInput}
                onChange={(e) => setSubtaskInput(e.target.value)}
                onPressEnter={handleAddSubtask}
                style={{ flex: 1 }}
              />
              <Button size="small" onClick={handleAddSubtask} disabled={!subtaskInput.trim()}>
                {t('agent.tasks.addSubtask')}
              </Button>
            </Flexbox>

            {/* Actions */}
            <Flexbox horizontal align="center" gap={8} style={{ marginTop: 4 }}>
              {canStart && (
                <Button size="small" icon={<PlayCircleOutlined />} onClick={() => startTask(task.id)}>
                  {t('agent.tasks.start')}
                </Button>
              )}
              {canPause && (
                <Button size="small" icon={<PauseCircleOutlined />} onClick={() => pauseTask(task.id)}>
                  {t('agent.tasks.pause')}
                </Button>
              )}
              {canCancel && (
                <Button size="small" icon={<StopOutlined />} onClick={() => cancelTask(task.id)}>
                  {t('agent.tasks.cancel')}
                </Button>
              )}
              <Popconfirm
                title={t('agent.tasks.deleteConfirm')}
                onConfirm={() => deleteTask(task.id)}
              >
                <Button size="small" danger icon={<DeleteOutlined />}>
                  {t('agent.tasks.delete')}
                </Button>
              </Popconfirm>
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>
    </Card>
  );
}

export function TasksPage() {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const tasks = useTaskStore((s) => s.tasks);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const createTask = useTaskStore((s) => s.createTask);
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);

  const [filter, setFilter] = useState<FilterTab>('all');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form] = Form.useForm<CreateFormValues>();

  useEffect(() => {
    loadTasks();
    loadAgents();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredTasks = useMemo(() => {
    switch (filter) {
      case 'active':
        return tasks.filter((t) => t.status === 'pending' || t.status === 'running' || t.status === 'paused');
      case 'completed':
        return tasks.filter((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled');
      default:
        return tasks;
    }
  }, [tasks, filter]);

  const handleCreate = useCallback(() => {
    form.validateFields().then((values) => {
      createTask({
        title: values.title,
        description: values.description || '',
        agentId: values.agentId,
        priority: values.priority,
      });
      form.resetFields();
      setCreateModalOpen(false);
    });
  }, [form, createTask]);

  const filterOptions = useMemo(() => [
    { label: t('agent.tasks.all'), value: 'all' },
    { label: t('agent.tasks.active'), value: 'active' },
    { label: t('agent.tasks.completed'), value: 'completed' },
  ], [t]);

  const emptyDescription = filter === 'active' ? t('agent.tasks.noActive') : t('agent.tasks.empty');

  return (
    <Flexbox
      style={{
        height: '100%',
        padding: 24,
        overflow: 'auto',
        background: token.colorBgLayout,
      }}
    >
      {/* Page header */}
      <Flexbox horizontal align="center" distribution="space-between" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
          {t('agent.tasks.title')}
        </h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
          {t('agent.tasks.create')}
        </Button>
      </Flexbox>

      {/* Filter tabs */}
      <Flexbox style={{ marginBottom: 16 }}>
        <Segmented
          options={filterOptions}
          value={filter}
          onChange={(val) => setFilter(val as FilterTab)}
        />
      </Flexbox>

      {/* Task list */}
      {filteredTasks.length === 0 ? (
        <Empty description={emptyDescription} style={{ marginTop: 60 }} />
      ) : (
        filteredTasks
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((task) => <TaskCard key={task.id} task={task} />)
      )}

      {/* Create modal */}
      <Modal
        title={t('agent.tasks.create')}
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => {
          form.resetFields();
          setCreateModalOpen(false);
        }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ priority: 'medium' }}>
          <Form.Item
            name="title"
            label={t('agent.tasks.title')}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('agent.tasks.description')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="agentId"
            label={t('agent.tasks.agent')}
            rules={[{ required: true }]}
          >
            <Select
              options={agents.map((a) => ({
                value: a.id,
                label: a.title || a.name,
              }))}
              placeholder={t('agent.tasks.selectAgent')}
            />
          </Form.Item>
          <Form.Item name="priority" label={t('agent.tasks.priorityLabel')}>
            <Select
              options={[
                { value: 'low', label: t('agent.tasks.priority.low') },
                { value: 'medium', label: t('agent.tasks.priority.medium') },
                { value: 'high', label: t('agent.tasks.priority.high') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Flexbox>
  );
}
