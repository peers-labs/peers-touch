import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ConfirmAction,
  Drawer,
  Empty,
  Icon,
  IconButton,
  Spin,
  Tag,
  Text,
  TextField,
  Tooltip,
  type Tone,
} from '@peers-touch/ui';
import { api, type CronJob, type CronRun } from '../../services/desktop_api';
import { CronJobDrawer } from '../CronJobDrawer';
import { SettingsContainer, SettingsPanelHeader } from './SettingsLayout';
import { notifyError, notifySuccess } from '../../ui/feedback';

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

function ScheduleGlyph({ kind }: { kind: string }) {
  const iconId = kind === 'interval' ? 'timer' : kind === 'cron' ? 'calendar-clock' : 'zap';
  return <Icon iconId={iconId} size={14} />;
}

function StatusTag({ status }: { status: string }) {
  const { t } = useTranslation('cron');
  let tone: Tone = 'neutral';
  let label = '—';
  if (status === 'ok') { tone = 'success'; label = t('cron.status.ok'); }
  else if (status === 'error') { tone = 'danger'; label = t('cron.status.error'); }
  else if (status === 'running') { tone = 'info'; label = t('cron.status.running'); }
  return <Tag tone={tone}>{label}</Tag>;
}

export function CronJobsSettings() {
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
    } catch (err) {
      notifyError(t('cron.list.loadFailed', { message: (err as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadJobs();
    const interval = setInterval(() => void loadJobs(), 15000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleToggle = async (job: CronJob) => {
    try {
      await api.toggleCronJob(job.id, !job.enabled);
      void loadJobs();
    } catch (err) {
      notifyError((err as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteCronJob(id);
      notifySuccess(t('cron.job.deleteSuccess'));
      void loadJobs();
    } catch (err) {
      notifyError((err as Error).message);
    }
  };

  const handleRun = async (id: string) => {
    try {
      await api.runCronJob(id);
      notifySuccess(t('cron.job.triggerSuccess'));
      setTimeout(() => void loadJobs(), 2000);
    } catch (err) {
      notifyError((err as Error).message);
    }
  };

  const handleShowRuns = async (job: CronJob) => {
    setRunsLoading(true);
    setRunsDrawer({ job, runs: [] });
    try {
      const runs = await api.listCronRuns(job.id);
      setRunsDrawer({ job, runs });
    } catch (err) {
      notifyError((err as Error).message);
    } finally {
      setRunsLoading(false);
    }
  };

  const handleSave = () => {
    setDrawerOpen(false);
    setEditingJob(null);
    void loadJobs();
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
    <SettingsContainer tier="standard">
      <SettingsPanelHeader
        title={t('cron.header.title')}
        icon={<Icon iconId="clock" size={20} />}
        extra={(
          <>
            <Tag tone="info">{t('cron.header.activeCount', { count: activeCount })}</Tag>
            {pausedCount > 0 && <Tag>{t('cron.header.pausedCount', { count: pausedCount })}</Tag>}
          </>
        )}
        actions={(
          <>
            <Button
              actionId="cron-refresh"
              leading={<Icon iconId="refresh-cw" size={14} />}
              label={t('cron.header.refresh')}
              onActivate={() => void loadJobs()}
            />
            <Button
              actionId="cron-new"
              emphasis="primary"
              leading={<Icon iconId="plus" size={14} />}
              label={t('cron.header.newJob')}
              onActivate={() => {
                setEditingJob(null);
                setDrawerOpen(true);
              }}
            />
          </>
        )}
      />

      <div className="sc-cron-body">
        <TextField
          className="sc-cron-search"
          clearable
          leading={<Icon iconId="search" size={14} />}
          placeholder={t('cron.search.placeholder')}
          value={search}
          onValueChange={setSearch}
        />

        {loading ? (
          <div className="sc-cron-loading"><Spin /></div>
        ) : filteredJobs.length === 0 ? (
          <div className="sc-cron-empty">
            <Empty
              icon={<Icon iconId="calendar-clock" size={40} />}
              description={search ? t('cron.list.noMatchingJobs') : t('cron.list.noJobsYet')}
              action={search ? undefined : (
                <Button
                  actionId="cron-create-first"
                  emphasis="primary"
                  label={t('cron.list.createFirst')}
                  onActivate={() => setDrawerOpen(true)}
                />
              )}
            />
          </div>
        ) : (
          <div className="sc-cron-list">
            {filteredJobs.map((job) => (
              <div
                key={job.id}
                className={`sc-cron-job${job.enabled ? '' : ' is-paused'}`}
              >
                <div className="sc-cron-job__main">
                  <div className="sc-cron-job__title-row">
                    <Icon iconId="bot" size={16} className="sc-cron-job__bot" />
                    <Text strong className="sc-cron-job__name">{job.name}</Text>
                    <Tag className="sc-cron-job__schedule">
                      <span className="sc-cron-job__schedule-inner">
                        <ScheduleGlyph kind={job.scheduleKind} />
                        {scheduleLabel(job, t)}
                      </span>
                    </Tag>
                    {job.agentId && job.agentId !== 'assistant' && (
                      <Tag tone="info" className="sc-cron-job__agent">
                        {job.agentId}
                      </Tag>
                    )}
                  </div>

                  <div className="sc-cron-job__status-row">
                    <StatusTag status={job.lastStatus} />
                    {job.lastDurationMs > 0 && (
                      <span>{formatDuration(job.lastDurationMs)}</span>
                    )}
                    {job.nextRunAt && (
                      <Tooltip label={new Date(job.nextRunAt).toLocaleString()}>
                        <span>{formatNextRunLabel(job.nextRunAt, t)}</span>
                      </Tooltip>
                    )}
                    {job.lastError && (
                      <Tooltip label={job.lastError}>
                        <Text tone="danger" truncate className="sc-cron-job__error">
                          {job.lastError}
                        </Text>
                      </Tooltip>
                    )}
                  </div>
                </div>

                <div className="sc-cron-job__actions">
                  <Tooltip label={t('cron.action.runNow')}>
                    <IconButton
                      actionId={`cron-run-${job.id}`}
                      iconId="play"
                      iconSize={14}
                      density="compact"
                      emphasis="quiet"
                      label={t('cron.action.runNow')}
                      onActivate={() => void handleRun(job.id)}
                    />
                  </Tooltip>
                  <Tooltip label={t('cron.action.runHistory')}>
                    <IconButton
                      actionId={`cron-history-${job.id}`}
                      iconId="history"
                      iconSize={14}
                      density="compact"
                      emphasis="quiet"
                      label={t('cron.action.runHistory')}
                      onActivate={() => void handleShowRuns(job)}
                    />
                  </Tooltip>
                  <Tooltip label={job.enabled ? t('cron.action.pause') : t('cron.action.resume')}>
                    <IconButton
                      actionId={`cron-toggle-${job.id}`}
                      iconId={job.enabled ? 'pause' : 'play'}
                      iconSize={14}
                      density="compact"
                      emphasis="quiet"
                      label={job.enabled ? t('cron.action.pause') : t('cron.action.resume')}
                      onActivate={() => void handleToggle(job)}
                    />
                  </Tooltip>
                  <Tooltip label={t('cron.action.edit')}>
                    <IconButton
                      actionId={`cron-edit-${job.id}`}
                      iconId="pencil-line"
                      iconSize={14}
                      density="compact"
                      emphasis="quiet"
                      label={t('cron.action.edit')}
                      onActivate={() => {
                        setEditingJob(job);
                        setDrawerOpen(true);
                      }}
                    />
                  </Tooltip>
                  <ConfirmAction
                    actionId={`cron-delete-${job.id}`}
                    title={t('cron.job.deleteConfirm')}
                    confirmLabel={t('cron.job.deleteOk')}
                    cancelLabel={t('cron.job.deleteCancel')}
                    onConfirm={() => handleDelete(job.id)}
                  >
                    <Tooltip label={t('cron.action.delete')}>
                      <IconButton
                        actionId={`cron-delete-trigger-${job.id}`}
                        iconId="delete"
                        iconSize={14}
                        density="compact"
                        emphasis="quiet"
                        className="sc-cron-job__delete"
                        label={t('cron.action.delete')}
                      />
                    </Tooltip>
                  </ConfirmAction>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
        onDismiss={() => setRunsDrawer(null)}
      >
        {runsLoading ? (
          <div className="sc-cron-loading"><Spin /></div>
        ) : runsDrawer?.runs.length === 0 ? (
          <div className="sc-cron-empty">
            <Empty
              icon={<Icon iconId="history" size={40} />}
              description={t('cron.runs.noRuns')}
            />
          </div>
        ) : (
          <div className="sc-cron-runs">
            {(runsDrawer?.runs || []).map((run) => (
              <details key={run.id} className="sc-cron-run">
                <summary className="sc-cron-run__summary">
                  <StatusTag status={run.status} />
                  <Text style={{ fontSize: 12 }}>
                    {new Date(run.startedAt).toLocaleString()}
                  </Text>
                  {run.durationMs > 0 && (
                    <Text tone="secondary" style={{ fontSize: 12 }}>
                      {formatDuration(run.durationMs)}
                    </Text>
                  )}
                </summary>
                <div className="sc-cron-run__body">
                  {run.error && (
                    <Text tone="danger" className="sc-cron-run__error">
                      {run.error}
                    </Text>
                  )}
                  {run.output && (
                    <pre className="sc-cron-run__output">{run.output}</pre>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </Drawer>
    </SettingsContainer>
  );
}
