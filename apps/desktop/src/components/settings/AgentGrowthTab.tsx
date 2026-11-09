import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  DataTable,
  Empty,
  Icon,
  IconButton,
  Progress,
  Select,
  Spin,
  Statistic,
  Switch,
  Tag,
  Text,
  Tooltip,
  type IconId,
  type TableColumn,
  type Tone,
} from '@peers-touch/ui';

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
import { notifyError, notifySuccess } from '../../ui/feedback';

interface AgentGrowthTabProps {
  agentId?: string;
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const config: Record<string, { tone: Tone; icon: IconId }> = {
    improving: { tone: 'success', icon: 'trending-up' },
    stable: { tone: 'info', icon: 'minus' },
    declining: { tone: 'danger', icon: 'trending-down' },
  };
  const resolved = config[verdict] ?? config.stable;
  return (
    <Tag tone={resolved.tone} leading={<Icon iconId={resolved.icon} size={12} />}>
      {verdict.toUpperCase()}
    </Tag>
  );
}

function TrustBar({ score }: { score: number }) {
  const percent = Math.round(score * 100);
  const tone: Tone = percent >= 70 ? 'success' : percent >= 40 ? 'warning' : 'danger';
  return <Progress value={percent} tone={tone} showValue={false} className="sc-growth-trust" />;
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
      notifySuccess(t('settings.agentGrowth.jobUpdated'));
    } catch (error) {
      notifyError((error as Error)?.message || 'toggle scheduled job failed');
    }
  };

  const runJob = async (job: CronJob) => {
    try {
      await api.runCronJob(job.id);
      notifySuccess(t('settings.agentGrowth.jobTriggered'));
      await loadData(agentId);
    } catch (error) {
      notifyError((error as Error)?.message || 'run scheduled job failed');
    }
  };

  const memoryColumns = useMemo<TableColumn<MemoryItem>[]>(() => [
    {
      id: 'content',
      label: t('settings.agentGrowth.colContent'),
      width: '40%',
      renderCell: (item) => (
        <span className="sc-growth-ellipsis">{item.content}</span>
      ),
    },
    {
      id: 'target',
      label: t('settings.agentGrowth.colTarget'),
      width: 80,
      renderCell: (item) => <Tag>{item.target}</Tag>,
    },
    {
      id: 'trust_score',
      label: t('settings.agentGrowth.colTrust'),
      width: 120,
      compare: (a, b) => a.trust_score - b.trust_score,
      renderCell: (item) => <TrustBar score={item.trust_score} />,
    },
    {
      id: 'source',
      label: t('settings.agentGrowth.colSource'),
      width: 90,
      renderCell: (item) => (
        <Tag tone={item.source === 'review' ? 'info' : 'neutral'}>{item.source}</Tag>
      ),
    },
    {
      id: 'helpful_count',
      label: <Icon iconId="thumbs-up" size={12} />,
      width: 50,
      align: 'center',
      renderCell: (item) => item.helpful_count,
    },
    {
      id: 'harmful_count',
      label: <Icon iconId="thumbs-down" size={12} />,
      width: 50,
      align: 'center',
      renderCell: (item) => item.harmful_count,
    },
  ], [t]);

  const skillColumns = useMemo<TableColumn<SkillItem>[]>(() => [
    {
      id: 'name',
      label: t('settings.agentGrowth.colName'),
      width: '25%',
      renderCell: (item) => <Text strong>{item.name}</Text>,
    },
    {
      id: 'description',
      label: t('settings.agentGrowth.colDescription'),
      width: '35%',
      renderCell: (item) => (
        <span className="sc-growth-ellipsis">{item.description}</span>
      ),
    },
    {
      id: 'trust_level',
      label: t('settings.agentGrowth.colSkillTrust'),
      width: 100,
      renderCell: (item) => (
        <Tag tone={item.trust_level === 'builtin' ? 'success' : item.trust_level === 'trusted' ? 'info' : 'neutral'}>
          {item.trust_level}
        </Tag>
      ),
    },
    {
      id: 'view_count',
      label: <Icon iconId="eye" size={12} />,
      width: 50,
      align: 'center',
      renderCell: (item) => item.view_count,
    },
    {
      id: 'apply_count',
      label: <Icon iconId="zap" size={12} />,
      width: 50,
      align: 'center',
      renderCell: (item) => item.apply_count,
    },
    {
      id: 'enabled',
      label: t('settings.agentGrowth.colEnabled'),
      width: 70,
      renderCell: (item) => <Switch checked={item.enabled} disabled />,
    },
  ], [t]);

  const jobColumns = useMemo<TableColumn<CronJob>[]>(() => [
    {
      id: 'name',
      label: t('settings.agentGrowth.colJob'),
      renderCell: (job) => (
        <span className="sc-growth-stack">
          <Text strong>{job.name}</Text>
          <Text tone="muted" className="sc-growth-sub">
            {scheduleSummary(job)}
          </Text>
        </span>
      ),
    },
    {
      id: 'lastRun',
      label: t('settings.agentGrowth.colLastRun'),
      width: 200,
      renderCell: (job) => (
        <span className="sc-growth-stack">
          <span>{job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : '—'}</span>
          {job.lastError ? (
            <Text tone="danger" truncate className="sc-growth-sub">
              {job.lastError}
            </Text>
          ) : null}
        </span>
      ),
    },
    {
      id: 'lastStatus',
      label: t('settings.agentGrowth.colLastStatus'),
      width: 100,
      renderCell: (job) =>
        job.lastStatus ? (
          <Tag tone={job.lastStatus === 'ok' ? 'success' : job.lastStatus === 'error' ? 'danger' : 'neutral'}>
            {job.lastStatus}
          </Tag>
        ) : null,
    },
    {
      id: 'enabled',
      label: t('settings.agentGrowth.colEnabled'),
      width: 80,
      renderCell: (job) => (
        <Switch
          checked={job.enabled}
          onCheckedChange={(value) => void toggleJob(job, value)}
        />
      ),
    },
    {
      id: 'actions',
      label: '',
      width: 56,
      renderCell: (job) => (
        <Tooltip label={t('settings.agentGrowth.runNow')}>
          <IconButton
            actionId={`agent-growth-run-${job.id}`}
            iconId="play"
            iconSize={14}
            density="compact"
            emphasis="quiet"
            label={t('settings.agentGrowth.runNow')}
            onActivate={() => void runJob(job)}
          />
        </Tooltip>
      ),
    },
  // toggleJob/runJob are stable enough for this settings surface; deps are intentionally minimal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, agentId]);

  const schedulerRunning = jobs.some((job) => job.enabled);

  return (
    <div className="sc-growth">
      <div className="sc-growth__header">
        <h5 className="sc-growth__title">
          <Icon iconId="activity" size={16} />
          {t('settings.agentGrowth.title')}
        </h5>
        <div className="sc-growth__controls">
          <Select
            searchable
            style={{ width: 240 }}
            value={agentId || undefined}
            placeholder={t('settings.agentGrowth.selectAgent')}
            options={agents.map((agent) => ({
              label: agent.title || agent.name || agent.id,
              value: agent.id,
            }))}
            onValueChange={(value) => {
              if (typeof value === 'string') setAgentId(value);
            }}
          />
          <Button
            actionId="agent-growth-refresh"
            leading={<Icon iconId="refresh-cw" size={14} />}
            execution={loading ? 'pending' : 'idle'}
            label={t('settings.agentGrowth.refresh')}
            onActivate={() => void loadData(agentId)}
          />
        </div>
      </div>

      {!agentId ? (
        <div className="sc-growth__empty">
          <Empty
            icon={<Icon iconId="trending-up" size={40} />}
            description={t('settings.agentGrowth.empty')}
          />
        </div>
      ) : (
        <>
          {snapshot ? (
            <div className="sc-growth__stats">
              <Card className="sc-growth__stat">
                <Statistic
                  label={t('settings.agentGrowth.growthScore')}
                  value={snapshot.growth_score}
                  precision={3}
                  prefix={<VerdictBadge verdict={snapshot.growth_verdict} />}
                />
              </Card>
              <Card className="sc-growth__stat">
                <Statistic
                  label={t('settings.agentGrowth.totalTurns')}
                  value={snapshot.total_turns}
                  prefix={<Icon iconId="zap" size={14} />}
                />
              </Card>
              <Card className="sc-growth__stat">
                <Statistic
                  label={t('settings.agentGrowth.feedbackRatio')}
                  value={snapshot.feedback_ratio}
                  precision={2}
                  suffix={
                    <Text tone="secondary" style={{ fontSize: 12 }}>
                      ({snapshot.positive_feedback}+ / {snapshot.negative_feedback}-)
                    </Text>
                  }
                />
              </Card>
              <Card className="sc-growth__stat">
                <Statistic label={t('settings.agentGrowth.errorRate')} value={snapshot.error_rate} precision={3} />
              </Card>
            </div>
          ) : null}

          <Card
            className="sc-growth__card"
            data-growth-card="jobs"
            heading={
              <span className="sc-growth__card-title">
                <Icon iconId="clock-3" size={14} />
                <span>{t('settings.agentGrowth.scheduledJobs')}</span>
                <Tag tone={schedulerRunning ? 'info' : 'neutral'}>
                  {schedulerRunning
                    ? t('settings.agentGrowth.schedulerRunning')
                    : t('settings.agentGrowth.schedulerStopped')}
                </Tag>
              </span>
            }
          >
            <Text tone="secondary" style={{ fontSize: 12 }}>
              {t('settings.agentGrowth.schedulerNote')}
            </Text>
            <DataTable
              rows={jobs}
              columns={jobColumns}
              rowKey="id"
              emptyLabel={t('settings.agentGrowth.jobsEmpty')}
            />
          </Card>

          <Card
            className="sc-growth__card"
            data-growth-card="memories"
            heading={
              <span className="sc-growth__card-title">
                <Icon iconId="brain" size={14} />
                <span>{t('settings.agentGrowth.memories', { count: memories.length })}</span>
              </span>
            }
          >
            <DataTable
              rows={memories}
              columns={memoryColumns}
              rowKey="id"
              pageSize={10}
              emptyLabel={t('settings.agentGrowth.noMemories')}
            />
          </Card>

          <Card
            className="sc-growth__card"
            data-growth-card="skills"
            heading={
              <span className="sc-growth__card-title">
                <Icon iconId="book-open" size={14} />
                <span>{t('settings.agentGrowth.skills', { count: skills.length })}</span>
              </span>
            }
          >
            <DataTable
              rows={skills}
              columns={skillColumns}
              rowKey="id"
              pageSize={10}
              emptyLabel={t('settings.agentGrowth.noSkills')}
            />
          </Card>
        </>
      )}
      {loading && !snapshot && memories.length === 0 ? (
        <div className="sc-growth__loading"><Spin /></div>
      ) : null}
    </div>
  );
}
