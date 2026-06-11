import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  Empty,
  Popconfirm,
  message,
  Spin,
  Typography,
  Badge,
  Collapse,
  Drawer,
} from 'antd';
import { Button, Tag, Tooltip, Input } from '@lobehub/ui';
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Clock,
  Terminal,
  Bot,
  Edit2,
  RefreshCw,
  ChevronRight,
  Timer,
  CalendarClock,
  Zap,
  History,
} from 'lucide-react';
import { api, type CronJob, type CronRun } from '../services/desktop_api';
import { CronJobDrawer } from '../components/CronJobDrawer';
import { PageHeader } from '../components/PageHeader';

const { Text, Paragraph } = Typography;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatRelativeTime(isoStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!isoStr) return '—';
  const diff = new Date(isoStr).getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const past = diff < 0;

  if (absDiff < 60000) return past ? t('cron.schedule.justNow') : t('cron.schedule.inLessThan1m');
  if (absDiff < 3600000) {
    const m = Math.floor(absDiff / 60000);
    return past ? t('cron.schedule.minutesAgo', { count: m }) : t('cron.schedule.inMinutes', { count: m });
  }
  if (absDiff < 86400000) {
    const h = Math.floor(absDiff / 3600000);
    return past ? t('cron.schedule.hoursAgo', { count: h }) : t('cron.schedule.inHours', { count: h });
  }
  const d = Math.floor(absDiff / 86400000);
  return past ? t('cron.schedule.daysAgo', { count: d }) : t('cron.schedule.inDays', { count: d });
}

function formatNextRunLabel(isoStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!isoStr) return '—';
  const diff = new Date(isoStr).getTime() - Date.now();
  const formatted = formatRelativeTime(isoStr, t);
  return diff < 0 ? t('cron.schedule.duePrefix', { time: formatted }) : t('cron.schedule.nextPrefix', { time: formatted });
}

function scheduleLabel(job: CronJob, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (job.scheduleKind === 'interval') {
    const sec = job.intervalSec;
    if (sec < 3600) return t('cron.schedule.everyMinutes', { count: sec / 60 });
    if (sec < 86400) return t('cron.schedule.everyHours', { count: sec / 3600 });
    return t('cron.schedule.everyDays', { count: sec / 86400 });
  }
  if (job.scheduleKind === 'cron') return job.cronExpr;
  if (job.scheduleKind === 'once') return t('cron.schedule.once');
  return job.scheduleKind;
}

function ScheduleIcon({ kind }: { kind: string }) {
  if (kind === 'interval') return <Timer size={14} />;
  if (kind === 'cron') return <CalendarClock size={14} />;
  return <Zap size={14} />;
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('cron');
  if (status === 'ok') return <Badge status="success" text={t('cron.status.ok')} />;
  if (status === 'error') return <Badge status="error" text={t('cron.status.error')} />;
  if (status === 'running') return <Badge status="processing" text={t('cron.status.running')} />;
  return <Badge status="default" text="—" />;
}

export function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [search, setSearch] = useState('');
  const [runsDrawer, setRunsDrawer] = useState<{ job: CronJob; runs: CronRun[] } | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const { t } = useTranslation('cron');

  const loadJobs = useCallback(async () => {
    try {
      const data = await api.listCronJobs();
      setJobs(data);
    } catch (err: any) {
      message.error(t('cron.list.loadFailed', { message: err.message }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 15000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleToggle = async (job: CronJob) => {
    try {
      await api.toggleCronJob(job.id, !job.enabled);
      loadJobs();
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteCronJob(id);
      message.success(t('cron.job.deleteSuccess'));
      loadJobs();
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleRun = async (id: string) => {
    try {
      await api.runCronJob(id);
      message.success(t('cron.job.triggerSuccess'));
      setTimeout(loadJobs, 2000);
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleShowRuns = async (job: CronJob) => {
    setRunsLoading(true);
    setRunsDrawer({ job, runs: [] });
    try {
      const runs = await api.listCronRuns(job.id);
      setRunsDrawer({ job, runs });
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setRunsLoading(false);
    }
  };

  const handleSave = () => {
    setDrawerOpen(false);
    setEditingJob(null);
    loadJobs();
  };

  const filteredJobs = jobs.filter(
    (j) =>
      !search ||
      (j.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (j.description || '').toLowerCase().includes(search.toLowerCase()),
  );

  const activeCount = jobs.filter((j) => j.enabled).length;
  const pausedCount = jobs.length - activeCount;

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
      <PageHeader
        title={t('cron.header.title')}
        icon={<Clock size={20} />}
        extra={<>
          <Tag color="blue">{t('cron.header.activeCount', { count: activeCount })}</Tag>
          {pausedCount > 0 && <Tag>{t('cron.header.pausedCount', { count: pausedCount })}</Tag>}
        </>}
        actions={<>
          <Button icon={<RefreshCw size={14} />} onClick={loadJobs}>
            {t('cron.header.refresh')}
          </Button>
          <Button
            type="primary"
            icon={<Plus size={14} />}
            onClick={() => {
              setEditingJob(null);
              setDrawerOpen(true);
            }}
          >
            {t('cron.header.newJob')}
          </Button>
        </>}
      />

      <Flexbox style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
      {/* Search */}
      <Input
        placeholder={t('cron.search.placeholder')}
        prefix={<ChevronRight size={14} />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        allowClear
        style={{ marginBottom: 16, maxWidth: 360 }}
      />

      {/* Job List */}
      {loading ? (
        <Flexbox align="center" justify="center" style={{ padding: 60 }}>
          <Spin />
        </Flexbox>
      ) : filteredJobs.length === 0 ? (
        <Empty description={search ? t('cron.list.noMatchingJobs') : t('cron.list.noJobsYet')}>
          {!search && (
            <Button type="primary" onClick={() => setDrawerOpen(true)}>
              {t('cron.list.createFirst')}
            </Button>
          )}
        </Empty>
      ) : (
        <Flexbox gap={8}>
          {filteredJobs.map((job) => (
            <div
              key={job.id}
              style={{
                border: '1px solid var(--ant-color-border)',
                borderRadius: 8,
                padding: '14px 18px',
                background: job.enabled ? undefined : 'var(--ant-color-bg-text-hover)',
                opacity: job.enabled ? 1 : 0.7,
                transition: 'all 0.2s',
              }}
            >
              <Flexbox horizontal justify="space-between" align="flex-start">
                <Flexbox gap={6} style={{ flex: 1, minWidth: 0 }}>
                  {/* Row 1: Icon + Name + Tags */}
                  <Flexbox horizontal align="center" gap={8}>
                    {job.execKind === 'agent' ? (
                      <Bot size={16} style={{ color: '#7c3aed', flexShrink: 0 }} />
                    ) : (
                      <Terminal size={16} style={{ color: '#059669', flexShrink: 0 }} />
                    )}
                    <Text
                      strong
                      style={{
                        fontSize: 14,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {job.name}
                    </Text>
                    <Tag
                      style={{ fontSize: 11, lineHeight: '18px', marginLeft: 4 }}
                      bordered={false}
                    >
                      <Flexbox horizontal align="center" gap={4}>
                        <ScheduleIcon kind={job.scheduleKind} />
                        {scheduleLabel(job, t)}
                      </Flexbox>
                    </Tag>
                    {job.execKind === 'agent' && job.agentName && job.agentName !== 'assistant' && (
                      <Tag color="purple" style={{ fontSize: 11, lineHeight: '18px' }} bordered={false}>
                        {job.agentName}
                      </Tag>
                    )}
                  </Flexbox>

                  {/* Row 2: Status info */}
                  <Flexbox horizontal align="center" gap={16} style={{ fontSize: 12, color: '#888' }}>
                    <StatusBadge status={job.lastStatus} />
                    {job.lastDurationMs > 0 && (
                      <span>{formatDuration(job.lastDurationMs)}</span>
                    )}
                    {job.nextRunAt && (
                      <Tooltip title={new Date(job.nextRunAt).toLocaleString()}>
                        <span>{formatNextRunLabel(job.nextRunAt, t)}</span>
                      </Tooltip>
                    )}
                    {job.lastError && (
                      <Tooltip title={job.lastError}>
                        <Text type="danger" style={{ fontSize: 12, maxWidth: 200 }} ellipsis>
                          {job.lastError}
                        </Text>
                      </Tooltip>
                    )}
                  </Flexbox>
                </Flexbox>

                {/* Actions */}
                <Flexbox horizontal gap={4} style={{ flexShrink: 0, marginLeft: 12 }}>
                  <Tooltip title={t('cron.action.runNow')}>
                    <Button
                      size="small"
                      type="text"
                      icon={<Play size={14} />}
                      onClick={() => handleRun(job.id)}
                    />
                  </Tooltip>
                  <Tooltip title={t('cron.action.runHistory')}>
                    <Button
                      size="small"
                      type="text"
                      icon={<History size={14} />}
                      onClick={() => handleShowRuns(job)}
                    />
                  </Tooltip>
                  <Tooltip title={job.enabled ? t('cron.action.pause') : t('cron.action.resume')}>
                    <Button
                      size="small"
                      type="text"
                      icon={job.enabled ? <Pause size={14} /> : <Play size={14} />}
                      onClick={() => handleToggle(job)}
                    />
                  </Tooltip>
                  <Tooltip title={t('cron.action.edit')}>
                    <Button
                      size="small"
                      type="text"
                      icon={<Edit2 size={14} />}
                      onClick={() => {
                        setEditingJob(job);
                        setDrawerOpen(true);
                      }}
                    />
                  </Tooltip>
                  <Popconfirm
                    title={t('cron.job.deleteConfirm')}
                    onConfirm={() => handleDelete(job.id)}
                    okText={t('cron.job.deleteOk')}
                    cancelText={t('cron.job.deleteCancel')}
                  >
                    <Tooltip title={t('cron.action.delete')}>
                      <Button size="small" type="text" danger icon={<Trash2 size={14} />} />
                    </Tooltip>
                  </Popconfirm>
                </Flexbox>
              </Flexbox>
            </div>
          ))}
        </Flexbox>
      )}
      </Flexbox>

      {/* Create / Edit Drawer */}
      <CronJobDrawer
        open={drawerOpen}
        editingJob={editingJob}
        onClose={() => {
          setDrawerOpen(false);
          setEditingJob(null);
        }}
        onSaved={handleSave}
      />

      {/* Runs History Drawer */}
      <Drawer
        title={t('cron.runs.title', { name: runsDrawer?.job.name || '' })}
        open={!!runsDrawer}
        onClose={() => setRunsDrawer(null)}
        size="default"
      >
        {runsLoading ? (
          <Flexbox align="center" justify="center" style={{ padding: 40 }}>
            <Spin />
          </Flexbox>
        ) : runsDrawer?.runs.length === 0 ? (
          <Empty description={t('cron.runs.noRuns')} />
        ) : (
          <Collapse
            items={(runsDrawer?.runs || []).map((run) => ({
              key: run.id,
              label: (
                <Flexbox horizontal align="center" gap={12}>
                  <StatusBadge status={run.status} />
                  <Text style={{ fontSize: 12 }}>
                    {new Date(run.startedAt).toLocaleString()}
                  </Text>
                  {run.durationMs > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDuration(run.durationMs)}
                    </Text>
                  )}
                </Flexbox>
              ),
              children: (
                <Flexbox gap={8}>
                  {run.error && (
                    <Paragraph type="danger" style={{ fontSize: 12, margin: 0 }}>
                      {run.error}
                    </Paragraph>
                  )}
                  {run.output && (
                    <pre
                      style={{
                        fontSize: 12,
                        background: '#f5f5f5',
                        padding: 8,
                        borderRadius: 4,
                        maxHeight: 200,
                        overflow: 'auto',
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {run.output}
                    </pre>
                  )}
                </Flexbox>
              ),
            }))}
          />
        )}
      </Drawer>
    </Flexbox>
  );
}
