/**
 * Cron section — scheduled Agent jobs.
 *
 * Parity with production CronJobsSettings: each job carries a schedule kind
 * (cron expression / interval / once), timezone, prompt, next/last run and a
 * status with consecutive-error surfacing. The registry is a library
 * DataTable; enable and remove are local mutations and the add form exposes
 * all three schedule kinds without fabricating a real scheduler.
 */
import { useState } from 'react';
import type { IconId } from '@peers-touch/ui-assets';
import {
  Button, DataTable, Empty, Flex, Icon, IconButton, Segmented, Switch, Tag, Text, TextArea, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs, type StringKey } from '../../../prefs';
import { SEED_CRON_JOBS } from '../ai-settings-data';
import { SettingsSection } from '../SettingsPrimitives';
import type { CronJobRecord, CronRunStatus, CronScheduleKind } from '../types';

const STATUS_LABEL_KEY: Record<CronRunStatus, StringKey> = {
  ok: 'agent.ai.cron.status.ok',
  error: 'agent.ai.cron.status.error',
  running: 'agent.ai.cron.status.running',
  never: 'agent.ai.cron.status.never',
};

const SCHEDULE_GLYPH: Record<CronScheduleKind, IconId> = {
  interval: 'timer',
  cron: 'calendar-clock',
  once: 'zap',
};

const STATUS_TONE: Record<CronRunStatus, 'success' | 'danger' | 'info' | 'neutral'> = {
  ok: 'success',
  error: 'danger',
  running: 'info',
  never: 'neutral',
};

export function CronSection() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [jobs, setJobs] = useState<CronJobRecord[]>([...SEED_CRON_JOBS]);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<CronScheduleKind>('cron');
  const [cronExpr, setCronExpr] = useState('0 9 * * *');
  const [intervalMin, setIntervalMin] = useState('60');

  const toggle = (id: string, enabled: boolean) => {
    setJobs(list => list.map(job => (job.id === id ? { ...job, enabled } : job)));
  };

  const remove = (id: string) => {
    setJobs(list => list.filter(job => job.id !== id));
  };

  const addJob = () => {
    if (!name.trim() || !prompt.trim()) return;
    const intervalSec = Math.max(1, Number(intervalMin) || 60) * 60;
    setJobs(list => [{
      id: `cron-${Date.now()}`,
      name: name.trim(),
      description: '',
      enabled: true,
      scheduleKind: kind,
      cronExpr: kind === 'cron' ? cronExpr.trim() : '',
      intervalSec: kind === 'interval' ? intervalSec : 0,
      timezone: 'Asia/Shanghai',
      prompt: prompt.trim(),
      nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
      lastRunAt: null,
      lastStatus: 'never',
      lastError: '',
      consecErrors: 0,
    }, ...list]);
    setName('');
    setPrompt('');
    setFormOpen(false);
  };

  const scheduleLabel = (job: CronJobRecord): string => {
    if (job.scheduleKind === 'cron') return job.cronExpr;
    if (job.scheduleKind === 'once') return t('agent.ai.cron.once');
    return t('agent.ai.cron.everyMinutes', { count: job.intervalSec / 60 });
  };

  const columns = [
    {
      id: 'name',
      label: t('agent.ai.cron.columnJob'),
      renderCell: (job: CronJobRecord) => (
        <span className="pa-cron__job">
          <Text strong className="pa-cron__name">{job.name}</Text>
          <Text tone="muted" className="pa-cron__prompt">{job.prompt}</Text>
        </span>
      ),
    },
    {
      id: 'schedule',
      label: t('agent.ai.cron.columnSchedule'),
      renderCell: (job: CronJobRecord) => (
        <Flex direction="row" align="center" gap={6}>
          <Icon iconId={SCHEDULE_GLYPH[job.scheduleKind]} size={14} />
          <Text className="pa-cron__schedule">{scheduleLabel(job)}</Text>
        </Flex>
      ),
    },
    {
      id: 'status',
      label: t('agent.ai.cron.columnStatus'),
      renderCell: (job: CronJobRecord) => (
        <Flex direction="column" gap={2}>
          <Tag tone={STATUS_TONE[job.lastStatus]}>{t(STATUS_LABEL_KEY[job.lastStatus])}</Tag>
          {job.consecErrors > 0 && (
            <Text tone="danger" className="pa-cron__errors">
              {t('agent.ai.cron.consecErrors', { count: job.consecErrors })}
            </Text>
          )}
        </Flex>
      ),
    },
    {
      id: 'next',
      label: t('agent.ai.cron.columnNextRun'),
      renderCell: (job: CronJobRecord) => (
        <Text tone="secondary" className="pa-cron__next">{formatClock(job.nextRunAt)}</Text>
      ),
    },
    {
      id: 'enabled',
      label: t('agent.ai.cron.columnEnabled'),
      align: 'center' as const,
      renderCell: (job: CronJobRecord) => (
        <Switch checked={job.enabled} label={`${job.name} enabled`}
          data-pt-cron-switch={job.id}
          onCheckedChange={checked => toggle(job.id, checked)} />
      ),
    },
    {
      id: 'actions',
      label: t('common.delete'),
      align: 'center' as const,
      renderCell: (job: CronJobRecord) => (
        <IconButton actionId={`ai.cron.${job.id}.delete`} iconId="delete" iconSize={14}
          label={t('common.delete')} emphasis="quiet" tone="danger"
          data-pt-cron-delete={job.id} onActivate={() => remove(job.id)} />
      ),
    },
  ];

  return (
    <SettingsSection iconId="clock" title={t('agent.ai.cron.title')}
      subtitle={t('agent.ai.cron.subtitle')} testId="cron"
      actions={(
        <Button actionId="ai.cron.add-open" emphasis="primary" density="compact"
          leading={<Icon iconId="plus" size={13} />}
          label={t('agent.ai.cron.add')} onActivate={() => setFormOpen(open => !open)} />
      )}>
      {formOpen && (
        <Flex direction="column" gap={8} className="pa-cron__form" data-pt-cron-form>
          <TextField aria-label={t('agent.ai.cron.name')} placeholder={t('agent.ai.cron.name')}
            value={name} onValueChange={setName} />
          <Segmented<CronScheduleKind>
            value={kind}
            options={[
              { value: 'cron', label: t('agent.ai.cron.kindCron') },
              { value: 'interval', label: t('agent.ai.cron.kindInterval') },
              { value: 'once', label: t('agent.ai.cron.kindOnce') },
            ]}
            onValueChange={value => setKind(value ?? 'cron')}
          />
          {kind === 'cron' && (
            <TextField aria-label={t('agent.ai.cron.cronExpr')} placeholder="0 9 * * *"
              value={cronExpr} onValueChange={setCronExpr} />
          )}
          {kind === 'interval' && (
            <TextField aria-label={t('agent.ai.cron.intervalMinutes')} type="number"
              value={intervalMin} onValueChange={setIntervalMin} />
          )}
          <TextArea
            aria-label={t('agent.ai.cron.promptPlaceholder')}
            placeholder={t('agent.ai.cron.promptPlaceholder')}
            minimumRows={3}
            value={prompt}
            onValueChange={setPrompt}
          />
          <Flex direction="row" justify="flex-end">
            <Button actionId="ai.cron.add-confirm" emphasis="primary" density="compact"
              label={t('common.confirm')}
              availability={name.trim() && prompt.trim()
                ? undefined
                : { kind: 'disabled', reason: t('agent.ai.cron.name') }}
              onActivate={addJob} />
          </Flex>
        </Flex>
      )}
      {jobs.length === 0 ? (
        <Empty description={t('agent.ai.cron.empty')} />
      ) : (
        <DataTable<CronJobRecord>
          rows={jobs}
          columns={columns}
          rowKey="id"
          data-pt-cron-table
          emptyLabel={t('agent.ai.cron.empty')}
        />
      )}
    </SettingsSection>
  );
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
