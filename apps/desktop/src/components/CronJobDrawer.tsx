import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Form,
  Select,
  InputNumber,
  Typography,
  message,
  Checkbox,
  Switch,
  Collapse,
  Drawer,
} from 'antd';
import { Input, Tag, Button, TextArea } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { Sparkles, Bot, ChevronDown } from 'lucide-react';
import { ModelSelect } from './ModelSelect';
import { findUniqueAvailableModelById } from '../utils/modelIdentity';
import type { ModelRef, CronJob, CronJobCreate } from '../services/desktop_api';
import { parseSchedulePhrase } from '../services/scheduled-task-parser';
import {
  api,
  type Agent,
  type AvailableModel,
} from '../services/desktop_api';
import { useTranslation } from 'react-i18next';
import { AgentIconTile } from './agent/AgentIconTile';

const { Text } = Typography;


function parseCronFields(expr: string) {
  const parts = expr.trim().split(/\s+/);
  return {
    minute: parts[0] || '*',
    hour: parts[1] || '*',
    dom: parts[2] || '*',
    month: parts[3] || '*',
    dow: parts[4] || '*',
  };
}

function parseFieldValues(field: string, min: number, max: number): number[] | 'all' {
  if (field === '*') return 'all';
  const values: number[] = [];
  for (const part of field.split(',')) {
    if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      for (let i = lo; i <= hi; i++) values.push(i);
    } else if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2));
      for (let i = min; i <= max; i += step) values.push(i);
    } else {
      values.push(parseInt(part));
    }
  }
  return values.filter((v) => !Number.isNaN(v));
}

function buildFieldFromValues(values: number[] | 'all', min: number, max: number): string {
  if (values === 'all') return '*';
  if (values.length === 0) return '*';
  const total = max - min + 1;
  if (values.length === total) return '*';
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.join(',');
}

interface CronScheduleSelectorProps {
  cronExpr: string;
  onChange: (expr: string) => void;
}

function CronScheduleSelector({ cronExpr, onChange }: CronScheduleSelectorProps) {
  const { t } = useTranslation('cron');
  const fields = parseCronFields(cronExpr || '0 9 * * *');

  const DAYS_OF_WEEK = [
    { label: t('cron.drawer.cron.dayMon'), value: 1 },
    { label: t('cron.drawer.cron.dayTue'), value: 2 },
    { label: t('cron.drawer.cron.dayWed'), value: 3 },
    { label: t('cron.drawer.cron.dayThu'), value: 4 },
    { label: t('cron.drawer.cron.dayFri'), value: 5 },
    { label: t('cron.drawer.cron.daySat'), value: 6 },
    { label: t('cron.drawer.cron.daySun'), value: 0 },
  ];

  const MONTHS = [
    { label: 'Jan', value: 1 }, { label: 'Feb', value: 2 }, { label: 'Mar', value: 3 },
    { label: 'Apr', value: 4 }, { label: 'May', value: 5 }, { label: 'Jun', value: 6 },
    { label: 'Jul', value: 7 }, { label: 'Aug', value: 8 }, { label: 'Sep', value: 9 },
    { label: 'Oct', value: 10 }, { label: 'Nov', value: 11 }, { label: 'Dec', value: 12 },
  ];

  const CRON_TEMPLATES = [
    { label: t('cron.drawer.cron.templateEveryHour'), expr: '0 * * * *' },
    { label: t('cron.drawer.cron.templateDailyAt9'), expr: '0 9 * * *' },
    { label: t('cron.drawer.cron.templateWeekdays9'), expr: '0 9 * * 1-5' },
    { label: t('cron.drawer.cron.templateEveryMonday'), expr: '0 9 * * 1' },
    { label: t('cron.drawer.cron.templateMonthly1st'), expr: '0 9 1 * *' },
  ];

  const updateField = (key: keyof typeof fields, value: string) => {
    onChange([
      key === 'minute' ? value : fields.minute,
      key === 'hour' ? value : fields.hour,
      key === 'dom' ? value : fields.dom,
      key === 'month' ? value : fields.month,
      key === 'dow' ? value : fields.dow,
    ].join(' '));
  };

  const hourValues = parseFieldValues(fields.hour, 0, 23);
  const minuteValues = parseFieldValues(fields.minute, 0, 59);
  const dowValues = parseFieldValues(fields.dow, 0, 6);
  const monthValues = parseFieldValues(fields.month, 1, 12);

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal gap={4} style={{ flexWrap: 'wrap' }}>
        {CRON_TEMPLATES.map((template) => (
          <Tag
            key={template.expr}
            style={{ cursor: 'pointer', margin: 0 }}
            color={cronExpr === template.expr ? 'blue' : undefined}
            onClick={() => onChange(template.expr)}
          >
            {template.label}
          </Tag>
        ))}
      </Flexbox>

      <Flexbox horizontal gap={12} align="center">
        <Text style={{ width: 60, fontSize: 12, flexShrink: 0 }}>{t('cron.drawer.cron.fieldTime')}</Text>
        <Select
          mode="multiple"
          maxTagCount={3}
          style={{ flex: 1 }}
          placeholder={t('cron.drawer.cron.fieldHourPlaceholder')}
          value={hourValues === 'all' ? [] : hourValues}
          onChange={(vals: number[]) => updateField('hour', buildFieldFromValues(vals.length ? vals : 'all', 0, 23))}
          options={Array.from({ length: 24 }, (_, i) => ({
            label: String(i).padStart(2, '0'),
            value: i,
          }))}
          allowClear
          size="small"
        />
        <Text style={{ fontSize: 12 }}>:</Text>
        <Select
          mode="multiple"
          maxTagCount={2}
          style={{ flex: 1 }}
          placeholder={t('cron.drawer.cron.fieldMinutePlaceholder')}
          value={minuteValues === 'all' ? [] : minuteValues}
          onChange={(vals: number[]) => updateField('minute', buildFieldFromValues(vals.length ? vals : 'all', 0, 59))}
          options={[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => ({
            label: String(m).padStart(2, '0'),
            value: m,
          }))}
          allowClear
          size="small"
        />
      </Flexbox>

      <Flexbox horizontal gap={12} align="center">
        <Text style={{ width: 60, fontSize: 12, flexShrink: 0 }}>{t('cron.drawer.cron.fieldDays')}</Text>
        <Checkbox.Group
          value={dowValues === 'all' ? DAYS_OF_WEEK.map((d) => d.value) : dowValues}
          onChange={(vals) => {
            const numVals = vals as number[];
            updateField('dow', buildFieldFromValues(
              numVals.length === 7 ? 'all' : numVals, 0, 6,
            ));
          }}
          options={DAYS_OF_WEEK}
          style={{ fontSize: 12 }}
        />
      </Flexbox>

      <Flexbox horizontal gap={12} align="center">
        <Text style={{ width: 60, fontSize: 12, flexShrink: 0 }}>{t('cron.drawer.cron.fieldMonths')}</Text>
        <Select
          mode="multiple"
          maxTagCount={3}
          style={{ flex: 1 }}
          placeholder={t('cron.drawer.cron.fieldMonthsPlaceholder')}
          value={monthValues === 'all' ? [] : monthValues}
          onChange={(vals: number[]) => updateField('month', buildFieldFromValues(vals.length ? vals : 'all', 1, 12))}
          options={MONTHS}
          allowClear
          size="small"
        />
      </Flexbox>

      <Flexbox horizontal gap={12} align="center">
        <Text style={{ width: 60, fontSize: 12, flexShrink: 0 }}>{t('cron.drawer.cron.fieldExpr')}</Text>
        <Input
          size="small"
          value={cronExpr}
          onChange={(e) => onChange(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
          placeholder={t('cron.drawer.cron.fieldExprPlaceholder')}
        />
      </Flexbox>
    </Flexbox>
  );
}

function SectionCard({ title, description, children }: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div style={{
      border: '1px solid #f0f0f0',
      borderRadius: 8,
      padding: '16px 18px',
      marginBottom: 16,
    }}>
      <Text strong style={{ fontSize: 14 }}>{title}</Text>
      {description && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{description}</Text>
        </div>
      )}
      {!description && <div style={{ marginBottom: 8 }} />}
      {children}
    </div>
  );
}

/** Parse a compound "provider/model" string to ModelRef, or look up plain model ID. */
function parseModelOverride(raw: string, models: AvailableModel[]): ModelRef | undefined {
  if (!raw) return undefined;
  if (raw.includes('/')) {
    const sep = raw.indexOf('/');
    return { provider: raw.slice(0, sep), model: raw.slice(sep + 1) };
  }
  const found = findUniqueAvailableModelById(models, raw);
  return found ? { provider: found.provider_id, model: found.id } : undefined;
}

function inferIntervalUnit(sec: number): string {
  if (sec >= 86400 && sec % 86400 === 0) return 'days';
  if (sec >= 3600 && sec % 3600 === 0) return 'hours';
  return 'minutes';
}

function inferIntervalValue(sec: number): number {
  if (sec >= 86400 && sec % 86400 === 0) return sec / 86400;
  if (sec >= 3600 && sec % 3600 === 0) return sec / 3600;
  return sec / 60;
}

function toLocalDateTimeInput(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface CronJobDrawerProps {
  open: boolean;
  editingJob: CronJob | null;
  onClose: () => void;
  onSaved: () => void;
}

export function CronJobDrawer({ open, editingJob, onClose, onSaved }: CronJobDrawerProps) {
  const { t } = useTranslation('cron');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [parseError, setParseError] = useState('');
  const [scheduleKind, setScheduleKind] = useState<string>('interval');
  const [cronExpr, setCronExpr] = useState('0 9 * * *');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [cronDefaultRef, setCronDefaultRef] = useState<ModelRef | null>(null);
  const [modelOverride, setModelOverride] = useState<string>('');
  const advancedRef = useRef<HTMLDivElement>(null);

  const handleModelChange = useCallback((ref: ModelRef) => {
    setModelOverride(`${ref.provider}/${ref.model}`);
  }, []);

  const modelValue = parseModelOverride(modelOverride, availableModels) || cronDefaultRef || undefined;

  useEffect(() => {
    if (open) {
      api.listAgents().then(setAgents).catch(() => {});
      api.listAvailableModels().then((r) => setAvailableModels(r.models || [])).catch(() => {});
      api.getModelConfig('cronDefault').then((r) => {
        setCronDefaultRef(r.ref || r.resolved || null);
      }).catch(() => {});

      if (editingJob) {
        form.setFieldsValue({
          name: editingJob.name,
          description: editingJob.description,
          scheduleKind: editingJob.scheduleKind,
          cronExpr: editingJob.cronExpr,
          intervalUnit: inferIntervalUnit(editingJob.intervalSec),
          intervalValue: inferIntervalValue(editingJob.intervalSec),
          runAt: toLocalDateTimeInput(editingJob.runAt),
          timezone: editingJob.timezone || undefined,
          prompt: editingJob.agentPrompt,
          agentId: editingJob.agentId || 'assistant',
          effort: editingJob.effortOverride || 'medium',
          timeoutSec: editingJob.timeoutSec || 0,
          deleteAfterRun: editingJob.deleteAfterRun || false,
          enabled: editingJob.enabled,
        });
        setModelOverride(
          editingJob.modelOverride && editingJob.providerOverride
            ? `${editingJob.providerOverride}/${editingJob.modelOverride}`
            : editingJob.modelOverride || '',
        );
        setScheduleKind(editingJob.scheduleKind);
        setCronExpr(editingJob.cronExpr || '0 9 * * *');
      } else {
        form.resetFields();
        form.setFieldsValue({
          scheduleKind: 'interval',
          intervalUnit: 'hours',
          intervalValue: 1,
          agentId: 'assistant',
          effort: 'medium',
          enabled: true,
          deleteAfterRun: false,
          timeoutSec: 0,
        });
        setModelOverride('');
        setScheduleKind('interval');
        setCronExpr('0 9 * * *');
      }
      setAiInput('');
      setParseError('');
    }
  }, [open, editingJob, form]);

  const handleAiParse = () => {
    if (!aiInput.trim()) return;
    setAiParsing(true);
    setParseError('');
    try {
      const result = parseSchedulePhrase(aiInput);
      if (!result) {
        setParseError(t('cron.drawer.ai.unparsed'));
        return;
      }
      setScheduleKind(result.scheduleKind);
      form.setFieldsValue({ scheduleKind: result.scheduleKind });
      if (result.cronExpr) {
        setCronExpr(result.cronExpr);
        form.setFieldsValue({ cronExpr: result.cronExpr });
      }
      if (result.intervalSec) {
        form.setFieldsValue({
          intervalUnit: inferIntervalUnit(result.intervalSec),
          intervalValue: inferIntervalValue(result.intervalSec),
        });
      }
      if (result.runAt) {
        form.setFieldsValue({ runAt: toLocalDateTimeInput(result.runAt) });
      }
      if (result.timezone) form.setFieldsValue({ timezone: result.timezone });
      if (result.name && !editingJob) form.setFieldsValue({ name: result.name });
      if (result.prompt) form.setFieldsValue({ prompt: result.prompt });
      message.success(t('cron.drawer.ai.parseSuccess', { fields: 'schedule' }));
    } finally {
      setAiParsing(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      setSaving(true);

      let intervalSec = 0;
      if (values.scheduleKind === 'interval') {
        const multipliers: Record<string, number> = { minutes: 60, hours: 3600, days: 86400 };
        intervalSec = (values.intervalValue || 1) * (multipliers[values.intervalUnit] || 3600);
      }
      let runAt = '';
      if (values.scheduleKind === 'once' && values.runAt) {
        const instant = new Date(values.runAt);
        if (Number.isNaN(instant.getTime())) {
          message.error(t('cron.drawer.field.runAtInvalid'));
          return;
        }
        runAt = instant.toISOString();
      }
      const modelRef = parseModelOverride(modelOverride, availableModels);
      const data: CronJobCreate = {
        agentId: values.agentId || 'assistant',
        name: values.name,
        description: values.description || '',
        scheduleKind: values.scheduleKind,
        cronExpr: values.scheduleKind === 'cron' ? cronExpr : '',
        intervalSec: values.scheduleKind === 'interval' ? intervalSec : 0,
        runAt,
        timezone: values.timezone || '',
        prompt: values.prompt,
        runtimeOverride: {
          model: modelRef?.model || '',
          provider: modelRef?.provider || '',
          effort: values.effort && values.effort !== 'medium' ? values.effort : '',
          timeoutSec: values.timeoutSec || 0,
        },
        deleteAfterRun: values.deleteAfterRun || false,
        enabled: values.enabled ?? true,
      };

      if (editingJob) {
        await api.updateCronJob(editingJob.id, {
          ...data,
          expectedRevision: editingJob.revision,
        });
        message.success(t('cron.drawer.jobUpdated'));
      } else {
        await api.createCronJob(data);
        message.success(t('cron.drawer.jobCreated'));
      }
      onSaved();
    } catch (err: unknown) {
      const error = err as { errorFields?: unknown; message?: string };
      if (error.errorFields) return;
      message.error(error.message || 'failed to save scheduled job');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={editingJob ? t('cron.drawer.titleEdit') : t('cron.drawer.titleCreate')}
      open={open}
      onClose={onClose}
      size="default"
      extra={
        <Button type="primary" loading={saving} onClick={handleSubmit}>
          {editingJob ? t('cron.drawer.saveButton') : t('cron.drawer.addButton')}
        </Button>
      }
    >
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
        {editingJob ? t('cron.drawer.descriptionEdit') : t('cron.drawer.descriptionCreate')}
        {' '}{t('cron.drawer.required')}
      </Text>

      {/* Local deterministic schedule phrase parser */}
      <div
        style={{
          background: 'linear-gradient(135deg, #f0f5ff 0%, #f6f0ff 100%)',
          borderRadius: 8,
          padding: '12px 14px',
          marginBottom: 20,
        }}
      >
        <Flexbox horizontal gap={8} align="flex-start">
          <Sparkles size={16} style={{ marginTop: 4, color: '#7c3aed', flexShrink: 0 }} />
          <Flexbox gap={8} style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: 500 }}>{t('cron.drawer.ai.title')}</Text>
            <Flexbox horizontal gap={8}>
              <Input
                size="small"
                placeholder={t('cron.drawer.ai.placeholder')}
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onPressEnter={handleAiParse}
                style={{ flex: 1 }}
              />
              <Button
                size="small"
                type="primary"
                loading={aiParsing}
                onClick={handleAiParse}
                disabled={!aiInput.trim()}
              >
                {t('cron.drawer.ai.parseButton')}
              </Button>
            </Flexbox>
            {parseError && (
              <Text type="danger" style={{ fontSize: 11 }}>{parseError}</Text>
            )}
          </Flexbox>
        </Flexbox>
      </div>

      <Form form={form} layout="vertical" size="middle">
        <SectionCard title={t('cron.drawer.section.basics')} description={t('cron.drawer.section.basicsDesc')}>
          <Flexbox horizontal gap={12}>
            <Form.Item
              name="name"
              label={t('cron.drawer.field.name')}
              rules={[{ required: true, message: t('cron.drawer.field.nameRequired') }]}
              style={{ flex: 1, marginBottom: 12 }}
            >
              <Input placeholder={t('cron.drawer.field.namePlaceholder')} />
            </Form.Item>
            <Form.Item name="description" label={t('cron.drawer.field.description')} style={{ flex: 1, marginBottom: 12 }}>
              <Input placeholder={t('cron.drawer.field.descriptionPlaceholder')} />
            </Form.Item>
          </Flexbox>

          <Flexbox horizontal gap={12} align="flex-end">
            <Form.Item
              name="agentId"
              label={t('cron.drawer.field.agent')}
              style={{ flex: 1, marginBottom: 0 }}
              extra={<Text type="secondary" style={{ fontSize: 11 }}>{t('cron.drawer.field.agentHint')}</Text>}
            >
              <Select
                options={agents.map((agent) => ({
                  label: (
                    <Flexbox horizontal align="center" gap={8}>
                      <AgentIconTile agent={agent} size={20} subtle />
                      <span>{agent.title || agent.name}{agent.isDefault ? ` ${t('cron.drawer.field.defaultSuffix')}` : ''}</span>
                    </Flexbox>
                  ),
                  value: agent.id,
                }))}
                optionLabelProp="label"
              />
            </Form.Item>
            <Form.Item name="enabled" label="" valuePropName="checked" style={{ marginBottom: 0, paddingBottom: 22 }}>
              <Switch checkedChildren={t('cron.drawer.field.enabled')} unCheckedChildren={t('cron.drawer.field.disabled')} defaultChecked />
            </Form.Item>
          </Flexbox>
        </SectionCard>

        <SectionCard title={t('cron.drawer.section.schedule')} description={t('cron.drawer.section.scheduleDesc')}>
          <Form.Item name="scheduleKind" label={t('cron.drawer.field.scheduleKind')} style={{ marginBottom: 12 }}>
            <Select
              options={[
                { label: t('cron.drawer.field.scheduleInterval'), value: 'interval' },
                { label: t('cron.drawer.field.scheduleCron'), value: 'cron' },
                { label: t('cron.drawer.field.scheduleOnce'), value: 'once' },
              ]}
              onChange={(val) => setScheduleKind(val)}
            />
          </Form.Item>

          {scheduleKind === 'interval' && (
            <Flexbox horizontal gap={8} style={{ marginBottom: 12 }}>
              <Form.Item
                name="intervalValue"
                label={t('cron.drawer.field.every')}
                style={{ flex: 1, marginBottom: 0 }}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={999} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="intervalUnit" label={t('cron.drawer.field.unit')} style={{ width: 120, marginBottom: 0 }}>
                <Select
                  options={[
                    { label: t('cron.drawer.field.unitMinutes'), value: 'minutes' },
                    { label: t('cron.drawer.field.unitHours'), value: 'hours' },
                    { label: t('cron.drawer.field.unitDays'), value: 'days' },
                  ]}
                />
              </Form.Item>
            </Flexbox>
          )}

          {scheduleKind === 'cron' && (
            <div style={{ marginBottom: 12 }}>
              <CronScheduleSelector cronExpr={cronExpr} onChange={setCronExpr} />
            </div>
          )}

          {scheduleKind === 'once' && (
            <Form.Item
              name="runAt"
              label={t('cron.drawer.field.runAt')}
              rules={[{ required: true }]}
              style={{ marginBottom: 12 }}
            >
              <Input type="datetime-local" />
            </Form.Item>
          )}

          {scheduleKind !== 'interval' && (
            <Form.Item name="timezone" label={t('cron.drawer.field.timezone')} style={{ marginBottom: 0 }}>
              <Select
                allowClear
                showSearch
                placeholder={t('cron.drawer.field.timezonePlaceholder')}
                options={[
                  { label: 'UTC', value: '' },
                  { label: 'Asia/Shanghai', value: 'Asia/Shanghai' },
                  { label: 'Asia/Tokyo', value: 'Asia/Tokyo' },
                  { label: 'US/Eastern', value: 'US/Eastern' },
                  { label: 'US/Pacific', value: 'US/Pacific' },
                  { label: 'Europe/London', value: 'Europe/London' },
                  { label: 'Europe/Berlin', value: 'Europe/Berlin' },
                ]}
              />
            </Form.Item>
          )}
        </SectionCard>

        <SectionCard title={t('cron.drawer.section.execution')} description={t('cron.drawer.section.executionDesc')}>
          <Flexbox horizontal align="center" gap={6} style={{ marginBottom: 12 }}>
            <Bot size={14} style={{ color: '#7c3aed' }} />
            <Text style={{ fontSize: 12 }} type="secondary">{t('cron.drawer.field.execAgentOnly')}</Text>
          </Flexbox>

          <Form.Item
            name="prompt"
            label={t('cron.drawer.field.promptLabel')}
            rules={[{ required: true, message: t('cron.drawer.field.promptRequired') }]}
            extra={<Text type="secondary" style={{ fontSize: 11 }}>{t('cron.drawer.field.promptHint')}</Text>}
            style={{ marginBottom: 12 }}
          >
            <TextArea rows={4} placeholder={t('cron.drawer.field.promptPlaceholder')} />
          </Form.Item>

          <Flexbox horizontal gap={12}>
            <Form.Item
              name="timeoutSec"
              label={t('cron.drawer.field.timeoutLabel')}
              style={{ flex: 1, marginBottom: 0 }}
              extra={<Text type="secondary" style={{ fontSize: 11 }}>{t('cron.drawer.field.timeoutHint')}</Text>}
            >
              <InputNumber min={0} max={3600} style={{ width: '100%' }} placeholder="0" />
            </Form.Item>
            <Form.Item name="effort" label={t('cron.drawer.field.effortLabel')} style={{ flex: 1, marginBottom: 0 }}>
              <Select
                options={[
                  { label: t('cron.drawer.field.effortLow'), value: 'low' },
                  { label: t('cron.drawer.field.effortMedium'), value: 'medium' },
                  { label: t('cron.drawer.field.effortHigh'), value: 'high' },
                ]}
              />
            </Form.Item>
            <Form.Item
              label={t('cron.drawer.field.modelLabel')}
              style={{ flex: 1, marginBottom: 0 }}
              extra={<Text type="secondary" style={{ fontSize: 11 }}>{t('cron.drawer.field.modelHint')}</Text>}
            >
              <ModelSelect
                models={availableModels}
                value={modelValue}
                onChange={(next) => {
                  if (next) handleModelChange(next);
                  else setModelOverride('');
                }}
                placeholder={t('cron.drawer.field.modelPlaceholder')}
              />
            </Form.Item>
          </Flexbox>
        </SectionCard>

        <div ref={advancedRef}>
          <Collapse
            ghost
            expandIcon={({ isActive }) => <ChevronDown size={14} style={{ transform: isActive ? 'rotate(180deg)' : 'rotate(0deg)', transition: '0.2s' }} />}
            style={{ marginBottom: 16 }}
            onChange={(keys) => {
              if (Array.isArray(keys) && keys.includes('advanced')) {
                setTimeout(() => advancedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
              }
            }}
            items={[{
              key: 'advanced',
              label: <Text strong style={{ fontSize: 13 }}>{t('cron.drawer.section.advanced')}</Text>,
              children: (
                <Flexbox gap={4}>
                  <Text type="secondary" style={{ fontSize: 11, marginBottom: 8 }}>
                    {t('cron.drawer.advancedDesc')}
                  </Text>
                  <Form.Item name="deleteAfterRun" valuePropName="checked" style={{ marginBottom: 8 }}>
                    <Checkbox>
                      <Flexbox>
                        <Text style={{ fontSize: 13 }}>{t('cron.drawer.field.deleteAfterRun')}</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {t('cron.drawer.field.deleteAfterRunHint')}
                        </Text>
                      </Flexbox>
                    </Checkbox>
                  </Form.Item>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('cron.drawer.field.deliveryHidden')}
                  </Text>
                </Flexbox>
              ),
            }]}
          />
        </div>
      </Form>
    </Drawer>
  );
}
