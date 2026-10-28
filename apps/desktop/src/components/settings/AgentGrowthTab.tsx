import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  Badge,
  Button,
  Card,
  Empty,
  Progress,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  Activity,
  BookOpen,
  Brain,
  Clock,
  Eye,
  Minus,
  Play,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';

import {
  api,
  type Agent,
  type CronJob,
  type GrowthSnapshot,
  type MemoryItem,
  type SkillItem,
  getAgentGrowthSnapshot,
  getAgentMemories,
  getAgentSkills,
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
  const resolved = config[verdict] ?? config.stable;
  return (
    <Tag color={resolved.color} icon={resolved.icon}>
      {verdict.toUpperCase()}
    </Tag>
  );
}

function TrustBar({ score }: { score: number }) {
  const percent = Math.round(score * 100);
  const color = percent >= 70 ? '#52c41a' : percent >= 40 ? '#faad14' : '#ff4d4f';
  return <Progress percent={percent} size="small" strokeColor={color} showInfo={false} />;
}

function scheduleSummary(job: CronJob): string {
  if (job.scheduleKind === 'interval' && job.intervalSec > 0) {
    return `interval ${job.intervalSec}s`;
  }
  if (job.scheduleKind === 'once') {
    return job.runAt || 'once';
  }
  return job.cronExpr || 'cron';
}

export function AgentGrowthTab({ agentId: initialAgentId }: AgentGrowthTabProps) {
  const { t } = useTranslation('settings');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState(initialAgentId ?? '');
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<GrowthSnapshot | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [jobs, setJobs] = useState<CronJob[]>([]);

  useEffect(() => {
    api.listAgents()
      .then((roster) => {
        setAgents(roster);
        setAgentId((current) => current || roster[0]?.id || '');
      })
      .catch(() => undefined);
  }, []);

  const loadData = useCallback(async (selectedAgentId: string) => {
    if (!selectedAgentId) {
      setSnapshot(null);
      setMemories([]);
      setSkills([]);
      setJobs([]);
      return;
    }
    setLoading(true);
    try {
      const [snap, mems, skls, jobPage] = await Promise.all([
        getAgentGrowthSnapshot(selectedAgentId).catch(() => null),
        getAgentMemories(selectedAgentId).catch(() => []),
        getAgentSkills(selectedAgentId).catch(() => []),
        api.listCronJobs(true, selectedAgentId).catch(() => []),
      ]);
      setSnapshot(snap);
      setMemories(mems);
      setSkills(skls);
      setJobs(jobPage);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(agentId);
  }, [agentId, loadData]);

  const toggleJob = async (job: CronJob, enabled: boolean) => {
    try {
      await api.toggleCronJob(job.id, enabled);
      setJobs((current) => current.map((item) =>
        item.id === job.id ? { ...item, enabled } : item,
      ));
      message.success(t('settings.agentGrowth.jobUpdated'));
    } catch (error) {
      message.error((error as Error)?.message || 'toggle scheduled job failed');
    }
  };

  const runJob = async (job: CronJob) => {
    try {
      await api.runCronJob(job.id);
      message.success(t('settings.agentGrowth.jobTriggered'));
      await loadData(agentId);
    } catch (error) {
      message.error((error as Error)?.message || 'run scheduled job failed');
    }
  };

  const memoryColumns = useMemo(() => [
    {
      title: t('settings.agentGrowth.colContent'),
      dataIndex: 'content',
      key: 'content',
      ellipsis: true,
      width: '40%',
    },
    {
      title: t('settings.agentGrowth.colTarget'),
      dataIndex: 'target',
      key: 'target',
      width: 80,
      render: (target: string) => <Tag>{target}</Tag>,
    },
    {
      title: t('settings.agentGrowth.colTrust'),
      dataIndex: 'trust_score',
      key: 'trust_score',
      width: 120,
      sorter: (a: MemoryItem, b: MemoryItem) => a.trust_score - b.trust_score,
      render: (score: number) => <TrustBar score={score} />,
    },
    {
      title: t('settings.agentGrowth.colSource'),
      dataIndex: 'source',
      key: 'source',
      width: 90,
      render: (source: string) => (
        <Tag color={source === 'review' ? 'purple' : 'default'}>{source}</Tag>
      ),
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
  ], [t]);

  const skillColumns = useMemo(() => [
    {
      title: t('settings.agentGrowth.colName'),
      dataIndex: 'name',
      key: 'name',
      width: '25%',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: t('settings.agentGrowth.colDescription'),
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      width: '35%',
    },
    {
      title: t('settings.agentGrowth.colSkillTrust'),
      dataIndex: 'trust_level',
      key: 'trust_level',
      width: 100,
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
      title: t('settings.agentGrowth.colEnabled'),
      dataIndex: 'enabled',
      key: 'enabled',
      width: 70,
      render: (enabled: boolean) => <Switch size="small" checked={enabled} disabled />,
    },
  ], [t]);

  const jobColumns = useMemo(() => [
    {
      title: t('settings.agentGrowth.colJob'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, job: CronJob) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {scheduleSummary(job)}
          </Text>
        </Space>
      ),
    },
    {
      title: t('settings.agentGrowth.colLastRun'),
      key: 'lastRun',
      width: 200,
      render: (_: unknown, job: CronJob) => (
        <Space direction="vertical" size={0}>
          <span>{job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : '—'}</span>
          {job.lastError ? (
            <Text type="danger" style={{ fontSize: 11 }} ellipsis>
              {job.lastError}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('settings.agentGrowth.colLastStatus'),
      dataIndex: 'lastStatus',
      key: 'lastStatus',
      width: 100,
      render: (status: string) =>
        status ? <Tag color={status === 'ok' ? 'green' : status === 'error' ? 'red' : 'default'}>{status}</Tag> : null,
    },
    {
      title: t('settings.agentGrowth.colEnabled'),
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (enabled: boolean, job: CronJob) => (
        <Switch
          size="small"
          checked={enabled}
          onChange={(value) => void toggleJob(job, value)}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 56,
      render: (_: unknown, job: CronJob) => (
        <Tooltip title={t('settings.agentGrowth.runNow')}>
          <Button size="small" type="text" icon={<Play size={14} />} onClick={() => void runJob(job)} />
        </Tooltip>
      ),
    },
  // toggleJob/runJob are stable enough for this settings surface; deps are intentionally minimal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, agentId]);

  return (
    <Flexbox gap={16} style={{ padding: '0 4px', overflow: 'auto', maxHeight: '100%' }}>
      <Flexbox horizontal justify="space-between" align="center">
        <Title level={5} style={{ margin: 0 }}>
          <Activity size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
          {t('settings.agentGrowth.title')}
        </Title>
        <Space>
          <Select
            showSearch
            style={{ width: 240 }}
            value={agentId || undefined}
            placeholder={t('settings.agentGrowth.selectAgent')}
            optionFilterProp="label"
            options={agents.map((agent) => ({
              label: agent.title || agent.name || agent.id,
              value: agent.id,
            }))}
            onChange={setAgentId}
          />
          <Button icon={<RefreshCw size={14} />} onClick={() => void loadData(agentId)} loading={loading}>
            {t('settings.agentGrowth.refresh')}
          </Button>
        </Space>
      </Flexbox>

      {!agentId ? (
        <Flexbox align="center" justify="center" style={{ padding: 48 }}>
          <Empty description={t('settings.agentGrowth.empty')} />
        </Flexbox>
      ) : (
        <>
          {snapshot ? (
            <Flexbox horizontal gap={12} wrap="wrap">
              <Card size="small" style={{ flex: 1, minWidth: 180 }}>
                <Statistic
                  title={t('settings.agentGrowth.growthScore')}
                  value={snapshot.growth_score}
                  precision={3}
                  prefix={<VerdictBadge verdict={snapshot.growth_verdict} />}
                />
              </Card>
              <Card size="small" style={{ flex: 1, minWidth: 140 }}>
                <Statistic
                  title={t('settings.agentGrowth.totalTurns')}
                  value={snapshot.total_turns}
                  prefix={<Zap size={14} />}
                />
              </Card>
              <Card size="small" style={{ flex: 1, minWidth: 140 }}>
                <Statistic
                  title={t('settings.agentGrowth.feedbackRatio')}
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
                <Statistic title={t('settings.agentGrowth.errorRate')} value={snapshot.error_rate} precision={3} />
              </Card>
            </Flexbox>
          ) : null}

          <Card
            size="small"
            title={
              <Space>
                <Clock size={14} />
                <span>{t('settings.agentGrowth.scheduledJobs')}</span>
                <Badge
                  status={jobs.some((job) => job.enabled) ? 'processing' : 'default'}
                  text={jobs.some((job) => job.enabled)
                    ? t('settings.agentGrowth.schedulerRunning')
                    : t('settings.agentGrowth.schedulerStopped')}
                />
              </Space>
            }
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('settings.agentGrowth.schedulerNote')}
            </Text>
            <Table
              dataSource={jobs}
              columns={jobColumns}
              rowKey="id"
              size="small"
              pagination={false}
              locale={{ emptyText: t('settings.agentGrowth.jobsEmpty') }}
            />
          </Card>

          <Card size="small" title={<Space><Brain size={14} /><span>{t('settings.agentGrowth.memories', { count: memories.length })}</span></Space>}>
            <Table
              dataSource={memories}
              columns={memoryColumns}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 10 }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('settings.agentGrowth.noMemories')} /> }}
            />
          </Card>

          <Card size="small" title={<Space><BookOpen size={14} /><span>{t('settings.agentGrowth.skills', { count: skills.length })}</span></Space>}>
            <Table
              dataSource={skills}
              columns={skillColumns}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 10 }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('settings.agentGrowth.noSkills')} /> }}
            />
          </Card>
        </>
      )}
      {loading && !snapshot && memories.length === 0 ? (
        <Flexbox align="center" justify="center" style={{ padding: 48 }}>
          <Spin />
        </Flexbox>
      ) : null}
    </Flexbox>
  );
}
