import { useEffect, useState, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import {
  Card, Statistic, Progress, Table, Tag, Badge, Button,
  Empty, Spin, Typography, Space, Switch, message, theme,
  InputNumber,
} from 'antd';
import {
  TrendingUp, TrendingDown, Minus, Brain, BookOpen,
  RefreshCw, ThumbsUp, ThumbsDown, Eye, Zap, Activity,
  Clock, Play, Square,
} from 'lucide-react';
import {
  getAgentGrowthSnapshot,
  getAgentMemories,
  getAgentSkills,
  getAgentSchedulerStatus,
  startAgentScheduler,
  stopAgentScheduler,
  type GrowthSnapshot,
  type MemoryItem,
  type SkillItem,
  type SchedulerStatusResponse,
} from '../../services/desktop_api';

const { Title, Text } = Typography;

interface AgentGrowthTabProps {
  agentId?: string;
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const config: Record<string, { color: string; icon: React.ReactNode }> = {
    improving: { color: 'green', icon: <TrendingUp size={12} /> },
    stable: { color: 'blue', icon: <Minus size={12} /> },
    declining: { color: 'red', icon: <TrendingDown size={12} /> },
  };
  const c = config[verdict] || config.stable;
  return (
    <Tag color={c.color} icon={c.icon}>
      {verdict.toUpperCase()}
    </Tag>
  );
}

function TrustBar({ score }: { score: number }) {
  const percent = Math.round(score * 100);
  const color = percent >= 70 ? '#52c41a' : percent >= 40 ? '#faad14' : '#ff4d4f';
  return <Progress percent={percent} size="small" strokeColor={color} showInfo={false} />;
}

export function AgentGrowthTab({ agentId }: AgentGrowthTabProps) {
  theme.useToken();
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<GrowthSnapshot | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatusResponse | null>(null);
  const [reviewInterval, setReviewInterval] = useState(120);
  const [dogfoodInterval, setDogfoodInterval] = useState(360);
  const [schedulerLoading, setSchedulerLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const [snap, mems, skls, sched] = await Promise.all([
        getAgentGrowthSnapshot(agentId).catch(() => null),
        getAgentMemories(agentId).catch(() => []),
        getAgentSkills(agentId).catch(() => []),
        getAgentSchedulerStatus().catch(() => null),
      ]);
      setSnapshot(snap);
      setMemories(mems);
      setSkills(skls);
      setSchedulerStatus(sched);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const handleSchedulerToggle = useCallback(async () => {
    if (!agentId) return;
    setSchedulerLoading(true);
    try {
      if (schedulerStatus?.running) {
        await stopAgentScheduler();
        message.success('Scheduler stopped');
      } else {
        await startAgentScheduler(agentId, reviewInterval, dogfoodInterval);
        message.success('Scheduler started');
      }
      const status = await getAgentSchedulerStatus().catch(() => null);
      setSchedulerStatus(status);
    } catch {
      message.error('Failed to toggle scheduler');
    } finally {
      setSchedulerLoading(false);
    }
  }, [agentId, schedulerStatus, reviewInterval, dogfoodInterval]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!agentId) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 48 }}>
        <Empty description="Select an agent to view growth data" />
      </Flexbox>
    );
  }

  if (loading && !snapshot) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 48 }}>
        <Spin tip="Loading growth data..." />
      </Flexbox>
    );
  }

  const memoryColumns = [
    {
      title: 'Content',
      dataIndex: 'content',
      key: 'content',
      ellipsis: true,
      width: '40%',
    },
    {
      title: 'Target',
      dataIndex: 'target',
      key: 'target',
      width: 80,
      render: (t: string) => <Tag>{t}</Tag>,
    },
    {
      title: 'Trust',
      dataIndex: 'trust_score',
      key: 'trust_score',
      width: 120,
      render: (score: number) => <TrustBar score={score} />,
      sorter: (a: MemoryItem, b: MemoryItem) => a.trust_score - b.trust_score,
    },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 80,
      render: (s: string) => <Tag color={s === 'review' ? 'purple' : 'default'}>{s}</Tag>,
    },
    {
      title: <ThumbsUp size={12} />,
      dataIndex: 'helpful_count',
      key: 'helpful_count',
      width: 50,
      align: 'center' as const,
    },
    {
      title: <ThumbsDown size={12} />,
      dataIndex: 'harmful_count',
      key: 'harmful_count',
      width: 50,
      align: 'center' as const,
    },
    {
      title: 'Frozen',
      dataIndex: 'is_frozen',
      key: 'is_frozen',
      width: 70,
      render: (frozen: boolean) => frozen ? <Badge status="processing" text="Yes" /> : null,
    },
  ];

  const skillColumns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: '25%',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      width: '35%',
    },
    {
      title: 'Trust',
      dataIndex: 'trust_level',
      key: 'trust_level',
      width: 90,
      render: (level: string) => {
        const color = level === 'builtin' ? 'green' : level === 'trusted' ? 'blue' : 'default';
        return <Tag color={color}>{level}</Tag>;
      },
    },
    {
      title: <Eye size={12} />,
      dataIndex: 'view_count',
      key: 'view_count',
      width: 50,
      align: 'center' as const,
    },
    {
      title: <Zap size={12} />,
      dataIndex: 'apply_count',
      key: 'apply_count',
      width: 50,
      align: 'center' as const,
    },
    {
      title: 'Enabled',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 70,
      render: (enabled: boolean) => <Switch size="small" checked={enabled} disabled />,
    },
  ];

  return (
    <Flexbox gap={16} style={{ padding: '0 4px', overflow: 'auto', maxHeight: '100%' }}>
      <Flexbox horizontal justify="space-between" align="center">
        <Title level={5} style={{ margin: 0 }}>
          <Activity size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
          Agent Growth Dashboard
        </Title>
        <Button icon={<RefreshCw size={14} />} onClick={loadData} loading={loading} size="small">
          Refresh
        </Button>
      </Flexbox>

      {snapshot && (
        <Flexbox horizontal gap={12} wrap="wrap">
          <Card size="small" style={{ flex: 1, minWidth: 180 }}>
            <Statistic
              title="Growth Score"
              value={snapshot.growth_score}
              precision={3}
              prefix={<VerdictBadge verdict={snapshot.growth_verdict} />}
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 140 }}>
            <Statistic title="Total Turns" value={snapshot.total_turns} prefix={<Zap size={14} />} />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 140 }}>
            <Statistic
              title="Feedback Ratio"
              value={snapshot.feedback_ratio}
              precision={2}
              suffix={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  ({snapshot.positive_feedback}+ / {snapshot.negative_feedback}-)
                </Text>
              }
            />
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 140 }}>
            <Statistic title="Error Rate" value={snapshot.error_rate} precision={3} />
          </Card>
        </Flexbox>
      )}

      <Card
        size="small"
        title={
          <Space>
            <Clock size={14} />
            <span>Autonomous Learning Scheduler</span>
            <Badge
              status={schedulerStatus?.running ? 'processing' : 'default'}
              text={schedulerStatus?.running ? 'Running' : 'Stopped'}
            />
          </Space>
        }
        extra={
          <Button
            type={schedulerStatus?.running ? 'default' : 'primary'}
            danger={schedulerStatus?.running}
            icon={schedulerStatus?.running ? <Square size={12} /> : <Play size={12} />}
            size="small"
            loading={schedulerLoading}
            onClick={handleSchedulerToggle}
          >
            {schedulerStatus?.running ? 'Stop' : 'Start'}
          </Button>
        }
      >
        {!schedulerStatus?.running && (
          <Flexbox horizontal gap={16} align="center" style={{ marginBottom: 8 }}>
            <Space>
              <Typography.Text type="secondary">Review interval:</Typography.Text>
              <InputNumber
                min={1}
                max={1440}
                value={reviewInterval}
                onChange={(v) => v && setReviewInterval(v)}
                size="small"
                addonAfter="min"
                style={{ width: 120 }}
              />
            </Space>
            <Space>
              <Typography.Text type="secondary">Dogfood interval:</Typography.Text>
              <InputNumber
                min={1}
                max={1440}
                value={dogfoodInterval}
                onChange={(v) => v && setDogfoodInterval(v)}
                size="small"
                addonAfter="min"
                style={{ width: 120 }}
              />
            </Space>
          </Flexbox>
        )}
        {schedulerStatus?.running && schedulerStatus.jobs?.length > 0 && (
          <Table
            dataSource={schedulerStatus.jobs}
            rowKey={(r) => `${r.kind}-${r.agent_id}`}
            size="small"
            pagination={false}
            columns={[
              { title: 'Job', dataIndex: 'kind', key: 'kind', render: (k: string) => <Tag>{k}</Tag> },
              { title: 'Interval', dataIndex: 'interval', key: 'interval', width: 100 },
              { title: 'Runs', dataIndex: 'run_count', key: 'run_count', width: 60, align: 'center' as const },
              {
                title: 'Last Run',
                dataIndex: 'last_run_at',
                key: 'last_run_at',
                width: 180,
                render: (v: string | null) => v ? new Date(v).toLocaleString() : '-',
              },
              {
                title: 'Status',
                dataIndex: 'last_status',
                key: 'last_status',
                width: 100,
                render: (s: string | null) => {
                  if (!s) return <Tag>pending</Tag>;
                  return <Tag color={s === 'ok' ? 'green' : 'red'}>{s}</Tag>;
                },
              },
            ]}
          />
        )}
      </Card>

      <Card
        size="small"
        title={
          <Space>
            <Brain size={14} />
            <span>Memories ({memories.length})</span>
          </Space>
        }
      >
        <Table
          dataSource={memories}
          columns={memoryColumns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="No memories yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </Card>

      <Card
        size="small"
        title={
          <Space>
            <BookOpen size={14} />
            <span>Skills ({skills.length})</span>
          </Space>
        }
      >
        <Table
          dataSource={skills}
          columns={skillColumns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="No skills yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </Card>
    </Flexbox>
  );
}
