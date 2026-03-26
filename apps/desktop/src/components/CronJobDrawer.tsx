import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Drawer,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Segmented,
  Typography,
  message,
  Checkbox,
  Tag,
  Switch,
  Collapse,
} from 'antd';
import { Flexbox } from 'react-layout-kit';
import { Sparkles, Terminal, Bot, ChevronDown } from 'lucide-react';
import { ModelSelect } from './ModelSelect';
import type { ModelRef } from '../services/desktop_api';
import { api, type CronJob, type CronJobCreate, type Agent, type Channel, type AvailableModel, type ChatTarget } from '../services/desktop_api';

const { TextArea } = Input;
const { Text } = Typography;

/* ──────────────────────────────────────────────────────────────────
   Cron-adapted schedule selector
   Provides visual selectors for minute, hour, day-of-week, month
   plus quick templates and raw expression editing.
   ────────────────────────────────────────────────────────────────── */

const DAYS_OF_WEEK = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

const MONTHS = [
  { label: 'Jan', value: 1 }, { label: 'Feb', value: 2 }, { label: 'Mar', value: 3 },
  { label: 'Apr', value: 4 }, { label: 'May', value: 5 }, { label: 'Jun', value: 6 },
  { label: 'Jul', value: 7 }, { label: 'Aug', value: 8 }, { label: 'Sep', value: 9 },
  { label: 'Oct', value: 10 }, { label: 'Nov', value: 11 }, { label: 'Dec', value: 12 },
];

const CRON_TEMPLATES = [
  { label: 'Every hour', expr: '0 * * * *' },
  { label: 'Every day 9:00', expr: '0 9 * * *' },
  { label: 'Weekdays 9:00', expr: '0 9 * * 1-5' },
  { label: 'Every Monday', expr: '0 9 * * 1' },
  { label: 'Every month 1st', expr: '0 9 1 * *' },
];


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

function buildCronExpr(fields: { minute: string; hour: string; dom: string; month: string; dow: string }) {
  return `${fields.minute} ${fields.hour} ${fields.dom} ${fields.month} ${fields.dow}`;
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
  return values.filter((v) => !isNaN(v));
}

function buildFieldFromValues(values: number[] | 'all', _min: number, max: number): string {
  if (values === 'all') return '*';
  if (values.length === 0) return '*';
  const total = max - _min + 1;
  if (values.length === total) return '*';
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.join(',');
}

interface CronScheduleSelectorProps {
  cronExpr: string;
  onChange: (expr: string) => void;
}

function CronScheduleSelector({ cronExpr, onChange }: CronScheduleSelectorProps) {
  const fields = parseCronFields(cronExpr || '0 * * * *');

  const updateField = (key: keyof typeof fields, value: string) => {
    onChange(buildCronExpr({ ...fields, [key]: value }));
  };

  const hourValues = parseFieldValues(fields.hour, 0, 23);
  const minuteValues = parseFieldValues(fields.minute, 0, 59);
  const dowValues = parseFieldValues(fields.dow, 0, 6);
  const monthValues = parseFieldValues(fields.month, 1, 12);

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal gap={4} style={{ flexWrap: 'wrap' }}>
        {CRON_TEMPLATES.map((t) => (
          <Tag
            key={t.expr}
            style={{ cursor: 'pointer', margin: 0 }}
            color={cronExpr === t.expr ? 'blue' : undefined}
            onClick={() => onChange(t.expr)}
          >
            {t.label}
          </Tag>
        ))}
      </Flexbox>

      <Flexbox horizontal gap={12} align="center">
        <Text style={{ width: 60, fontSize: 12, flexShrink: 0 }}>Time</Text>
        <Select
          mode="multiple"
          maxTagCount={3}
          style={{ flex: 1 }}
          placeholder="Hour (*)"
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
          placeholder="Minute (*)"
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
        <Text style={{ width: 60, fontSize: 12, flexShrink: 0 }}>Days</Text>
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
        <Text style={{ width: 60, fontSize: 12, flexShrink: 0 }}>Months</Text>
        <Select
          mode="multiple"
          maxTagCount={3}
          style={{ flex: 1 }}
          placeholder="All months"
          value={monthValues === 'all' ? [] : monthValues}
          onChange={(vals: number[]) => updateField('month', buildFieldFromValues(vals.length ? vals : 'all', 1, 12))}
          options={MONTHS}
          allowClear
          size="small"
        />
      </Flexbox>

      <Flexbox horizontal gap={12} align="center">
        <Text style={{ width: 60, fontSize: 12, flexShrink: 0 }}>Expr</Text>
        <Input
          size="small"
          value={cronExpr}
          onChange={(e) => onChange(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
          placeholder="* * * * *"
        />
      </Flexbox>
    </Flexbox>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Section card wrapper for visual grouping (mirrors OpenClaw's fieldsets)
   ────────────────────────────────────────────────────────────────── */

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
  const found = models.find((m) => m.id === raw);
  return found ? { provider: found.provider_id, model: found.id } : undefined;
}

/* ──────────────────────────────────────────────────────────────────
   Main Drawer component
   Sections mirror OpenClaw's form structure:
   1. Basics     — name, description, agent, enabled
   2. Schedule   — when to run (interval / cron / once)
   3. Execution  — what to run (shell / agent), prompt, timeout
   4. Advanced   — delete after run, model override

   Hidden OpenClaw concepts (kept in backend, not exposed in UI):
   - Session target (main/isolated): always "isolated", no heartbeat system
   - Wake mode: always "now", no heartbeat
   - Delivery (mode/channel/to): no messaging channels
   - Account ID: no multi-account
   - Session key: auto-generated as "cron:<jobId>"
   - Light context: OpenClaw-specific
   - Failure alerts: deferred
   - Thinking level: not yet supported by orchestrator
   ────────────────────────────────────────────────────────────────── */

interface CronJobDrawerProps {
  open: boolean;
  editingJob: CronJob | null;
  onClose: () => void;
  onSaved: () => void;
}

export function CronJobDrawer({ open, editingJob, onClose, onSaved }: CronJobDrawerProps) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [scheduleKind, setScheduleKind] = useState<string>('interval');
  const [execKind, setExecKind] = useState<string>('agent');
  const [cronExpr, setCronExpr] = useState('0 9 * * *');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [cronDefaultRef, setCronDefaultRef] = useState<ModelRef | null>(null);
  const [modelOverride, setModelOverride] = useState<string>('');
  const [deliveryTargets, setDeliveryTargets] = useState<ChatTarget[]>([]);
  const [deliveryTargetId, setDeliveryTargetId] = useState<string>('');
  const [deliveryTargetType, setDeliveryTargetType] = useState<string>('');
  const [loadingTargets, setLoadingTargets] = useState(false);
  const advancedRef = useRef<HTMLDivElement>(null);

  const handleModelChange = useCallback((ref: ModelRef) => {
    setModelOverride(`${ref.provider}/${ref.model}`);
  }, []);

  const loadDeliveryTargets = useCallback(async (channelId: string) => {
    if (!channelId) {
      setDeliveryTargets([]);
      return;
    }
    setLoadingTargets(true);
    try {
      const res = await api.listChannelChats(channelId);
      setDeliveryTargets(res.chats || []);
    } catch {
      setDeliveryTargets([]);
    } finally {
      setLoadingTargets(false);
    }
  }, []);

  const modelValue = parseModelOverride(modelOverride, availableModels) || cronDefaultRef || undefined;

  useEffect(() => {
    if (open) {
      api.listAgents().then(setAgents).catch(() => {});
      api.listChannels().then(setChannels).catch(() => {});
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
          runAt: editingJob.runAt,
          timezone: editingJob.timezone,
          execKind: editingJob.execKind,
          shellCmd: editingJob.shellCmd,
          agentPrompt: editingJob.agentPrompt,
          agentName: editingJob.agentName || 'assistant',
          timeoutSec: editingJob.timeoutSec || 0,
          deleteAfterRun: editingJob.deleteAfterRun || false,
          deliveryMode: editingJob.deliveryMode || 'none',
          deliveryChannelId: editingJob.deliveryChannelId || '',
          failureChannelId: editingJob.failureChannelId || '',
          enabled: editingJob.enabled,
        });
        setModelOverride(editingJob.modelOverride || '');
        setDeliveryTargetId(editingJob.deliveryTargetId || '');
        setDeliveryTargetType(editingJob.deliveryTargetType || '');
        setScheduleKind(editingJob.scheduleKind);
        setExecKind(editingJob.execKind);
        setCronExpr(editingJob.cronExpr || '0 9 * * *');
        if (editingJob.deliveryChannelId) {
          loadDeliveryTargets(editingJob.deliveryChannelId);
        }
      } else {
        form.resetFields();
        form.setFieldsValue({
          scheduleKind: 'interval',
          execKind: 'agent',
          intervalUnit: 'hours',
          intervalValue: 1,
          agentName: 'assistant',
          enabled: true,
          deleteAfterRun: false,
          deliveryMode: 'none',
          deliveryChannelId: '',
          failureChannelId: '',
          timeoutSec: 0,
        });
        setModelOverride('');
        setDeliveryTargetId('');
        setDeliveryTargetType('');
        setDeliveryTargets([]);
        setScheduleKind('interval');
        setExecKind('agent');
        setCronExpr('0 9 * * *');
      }
      setAiInput('');
    }
  }, [open, editingJob, form]);

  const handleAiParse = async () => {
    if (!aiInput.trim()) return;
    setAiParsing(true);
    try {
      const result = await api.parseCronSchedule(aiInput);
      if (result.scheduleKind) {
        setScheduleKind(result.scheduleKind);
        form.setFieldsValue({ scheduleKind: result.scheduleKind });
      }
      if (result.cronExpr) {
        setCronExpr(result.cronExpr);
        form.setFieldsValue({ cronExpr: result.cronExpr });
      }
      if (result.intervalSec) {
        const unit = inferIntervalUnit(result.intervalSec);
        const value = inferIntervalValue(result.intervalSec);
        form.setFieldsValue({ intervalUnit: unit, intervalValue: value });
      }
      if (result.runAt) {
        form.setFieldsValue({ runAt: result.runAt });
      }
      if (result.timezone) {
        form.setFieldsValue({ timezone: result.timezone });
      }
      if (result.name && !editingJob) {
        form.setFieldsValue({ name: result.name });
      }
      if (result.description) {
        form.setFieldsValue({ description: result.description });
      }
      if (result.execKind) {
        form.setFieldsValue({ execKind: result.execKind });
      }
      if (result.agentPrompt) {
        form.setFieldsValue({ agentPrompt: result.agentPrompt });
      }
      const parsed: string[] = [];
      if (result.scheduleKind) parsed.push('schedule');
      if (result.name) parsed.push('name');
      if (result.agentPrompt) parsed.push('task');
      message.success(`Parsed: ${parsed.join(', ') || 'schedule'}`);
    } catch (err: any) {
      message.error('Parse failed: ' + err.message);
    } finally {
      setAiParsing(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      if (values.deliveryMode === 'channel' && values.deliveryChannelId && !deliveryTargetId) {
        message.error('Please select a delivery target (group or user).');
        return;
      }

      setSaving(true);

      let intervalSec = 0;
      if (values.scheduleKind === 'interval') {
        const unit = values.intervalUnit || 'hours';
        const val = values.intervalValue || 1;
        const multipliers: Record<string, number> = { minutes: 60, hours: 3600, days: 86400 };
        intervalSec = val * (multipliers[unit] || 3600);
      }

      const data: CronJobCreate = {
        name: values.name,
        description: values.description || '',
        scheduleKind: values.scheduleKind,
        cronExpr: values.scheduleKind === 'cron' ? cronExpr : '',
        intervalSec: values.scheduleKind === 'interval' ? intervalSec : 0,
        runAt: values.scheduleKind === 'once' ? values.runAt : '',
        timezone: values.timezone || '',
        execKind: values.execKind,
        shellCmd: values.execKind === 'shell' ? values.shellCmd : '',
        agentPrompt: values.execKind === 'agent' ? values.agentPrompt : '',
        agentName: values.execKind === 'agent' ? (values.agentName || 'assistant') : '',
        modelOverride: modelOverride,
        timeoutSec: values.timeoutSec || 0,
        deleteAfterRun: values.deleteAfterRun || false,
        deliveryMode: values.deliveryMode || 'none',
        deliveryChannelId: values.deliveryChannelId || '',
        deliveryTargetId: values.deliveryMode === 'channel' ? deliveryTargetId : '',
        deliveryTargetType: values.deliveryMode === 'channel' ? deliveryTargetType : '',
        failureChannelId: values.failureChannelId || '',
      };

      if (editingJob) {
        await api.updateCronJob(editingJob.id, data);
        message.success('Job updated');
      } else {
        await api.createCronJob(data);
        message.success('Job created');
      }
      onSaved();
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={editingJob ? 'Edit Job' : 'New Job'}
      open={open}
      onClose={onClose}
      size="default"
      extra={
        <Button type="primary" loading={saving} onClick={handleSubmit}>
          {editingJob ? 'Save' : 'Add job'}
        </Button>
      }
    >
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
        {editingJob ? 'Edit a scheduled wakeup or agent run.' : 'Create a scheduled wakeup or agent run.'}
        {' '}* Required
      </Text>

      {/* AI Schedule Parser */}
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
            <Text style={{ fontSize: 12, fontWeight: 500 }}>
              Describe your schedule in natural language
            </Text>
            <Flexbox horizontal gap={8}>
              <Input
                size="small"
                placeholder='e.g. "every weekday at 9am" or "每天下午3点"'
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
                Parse
              </Button>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </div>

      <Form form={form} layout="vertical" size="middle">
        {/* ── Section 1: Basics ── */}
        <SectionCard title="Basics" description="Name it, choose the assistant, and set enabled state.">
          <Flexbox horizontal gap={12}>
            <Form.Item
              name="name"
              label="Name"
              rules={[{ required: true, message: 'Name is required' }]}
              style={{ flex: 1, marginBottom: 12 }}
            >
              <Input placeholder="Morning brief" />
            </Form.Item>
            <Form.Item name="description" label="Description" style={{ flex: 1, marginBottom: 12 }}>
              <Input placeholder="Optional context for this job" />
            </Form.Item>
          </Flexbox>

          <Flexbox horizontal gap={12} align="flex-end">
            <Form.Item
              name="agentName"
              label="Agent"
              style={{ flex: 1, marginBottom: 0 }}
              extra={<Text type="secondary" style={{ fontSize: 11 }}>Which assistant personality runs this job.</Text>}
            >
              <Select
                options={agents.map((a) => ({
                  label: (
                    <Flexbox horizontal align="center" gap={8}>
                      <span style={{ fontSize: 16 }}>{a.avatar || '🤖'}</span>
                      <span>{a.title || a.name}{a.isDefault ? ' (default)' : ''}</span>
                    </Flexbox>
                  ),
                  value: a.name,
                }))}
                optionLabelProp="label"
              />
            </Form.Item>
            <Form.Item name="enabled" label="" valuePropName="checked" style={{ marginBottom: 0, paddingBottom: 22 }}>
              <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" defaultChecked />
            </Form.Item>
          </Flexbox>
        </SectionCard>

        {/* ── Section 2: Schedule ── */}
        <SectionCard title="Schedule" description="Control when this job runs.">
          <Form.Item name="scheduleKind" label="Schedule" style={{ marginBottom: 12 }}>
            <Select
              options={[
                { label: 'Every (interval)', value: 'interval' },
                { label: 'Cron expression', value: 'cron' },
                { label: 'At (one-time)', value: 'once' },
              ]}
              onChange={(val) => setScheduleKind(val)}
            />
          </Form.Item>

          {scheduleKind === 'interval' && (
            <Flexbox horizontal gap={8} style={{ marginBottom: 12 }}>
              <Form.Item
                name="intervalValue"
                label="Every"
                style={{ flex: 1, marginBottom: 0 }}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={999} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="intervalUnit" label="Unit" style={{ width: 120, marginBottom: 0 }}>
                <Select
                  options={[
                    { label: 'Minutes', value: 'minutes' },
                    { label: 'Hours', value: 'hours' },
                    { label: 'Days', value: 'days' },
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
            <Form.Item name="runAt" label="Run at (ISO 8601)" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
              <Input placeholder="2025-12-31T09:00:00Z" />
            </Form.Item>
          )}

          {scheduleKind !== 'interval' && (
            <Form.Item name="timezone" label="Timezone" style={{ marginBottom: 0 }}>
              <Select
                allowClear
                showSearch
                placeholder="UTC (default)"
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

        {/* ── Section 3: Execution ── */}
        <SectionCard title="Execution" description="Choose what this job should do.">
          <Form.Item name="execKind" label="What should run" style={{ marginBottom: 12 }}>
            <Segmented
              block
              options={[
                {
                  label: (
                    <Flexbox horizontal align="center" gap={6} style={{ padding: '2px 0' }}>
                      <Bot size={14} /> Run agent task
                    </Flexbox>
                  ),
                  value: 'agent',
                },
                {
                  label: (
                    <Flexbox horizontal align="center" gap={6} style={{ padding: '2px 0' }}>
                      <Terminal size={14} /> Shell command
                    </Flexbox>
                  ),
                  value: 'shell',
                },
              ]}
              onChange={(val) => setExecKind(val as string)}
            />
          </Form.Item>

          {execKind === 'agent' && (
            <>
              <Form.Item
                name="agentPrompt"
                label="Assistant task prompt"
                rules={[{ required: true, message: 'Prompt is required' }]}
                extra={<Text type="secondary" style={{ fontSize: 11 }}>The agent will execute this prompt with full tool access.</Text>}
                style={{ marginBottom: 12 }}
              >
                <TextArea
                  rows={4}
                  placeholder="Check my GitHub repos for new issues and summarize them"
                />
              </Form.Item>

              <Flexbox horizontal gap={12}>
                <Form.Item
                  name="timeoutSec"
                  label="Timeout (seconds)"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={<Text type="secondary" style={{ fontSize: 11 }}>Optional. Leave 0 for default (10 min).</Text>}
                >
                  <InputNumber min={0} max={3600} style={{ width: '100%' }} placeholder="0" />
                </Form.Item>
                <Form.Item
                  label="Model"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={<Text type="secondary" style={{ fontSize: 11 }}>Override the Model Service default for this job.</Text>}
                >
                  <ModelSelect
                    models={availableModels}
                    value={modelValue?.model}
                    onChange={(modelId) => {
                      const m = availableModels.find((m) => m.id === modelId);
                      if (m) handleModelChange({ provider: m.provider_id, model: m.id });
                    }}
                    placeholder="Use Model Service default"
                  />
                </Form.Item>
              </Flexbox>
            </>
          )}

          {execKind === 'shell' && (
            <Form.Item
              name="shellCmd"
              label="Command"
              rules={[{ required: true, message: 'Command is required' }]}
              style={{ marginBottom: 0 }}
            >
              <TextArea
                rows={3}
                placeholder="find /tmp -mtime +7 -delete"
                style={{ fontFamily: 'monospace', fontSize: 13 }}
              />
            </Form.Item>
          )}
        </SectionCard>

        {/* ── Section 4: Advanced (collapsible) ── */}
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
            label: <Text strong style={{ fontSize: 13 }}>Advanced</Text>,
            children: (
              <Flexbox gap={4}>
                <Text type="secondary" style={{ fontSize: 11, marginBottom: 8 }}>
                  Optional overrides for auto-cleanup and scheduling behavior.
                </Text>

                <Form.Item name="deleteAfterRun" valuePropName="checked" style={{ marginBottom: 8 }}>
                  <Checkbox>
                    <Flexbox>
                      <Text style={{ fontSize: 13 }}>Delete after run</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        Best for one-shot reminders that should auto-clean up.
                      </Text>
                    </Flexbox>
                  </Checkbox>
                </Form.Item>

                <Flexbox style={{ marginTop: 8 }}>
                  <Text strong style={{ fontSize: 13, marginBottom: 4 }}>Delivery</Text>
                  <Text type="secondary" style={{ fontSize: 11, marginBottom: 8 }}>
                    Send job results or failure alerts to a channel (Telegram, Lark, Slack, Webhook).
                  </Text>
                </Flexbox>

                <Form.Item name="deliveryMode" label="Result Delivery" style={{ marginBottom: 8 }}>
                  <Select>
                    <Select.Option value="none">None (store in run history only)</Select.Option>
                    <Select.Option value="channel">Send to channel</Select.Option>
                  </Select>
                </Form.Item>

                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.deliveryMode !== cur.deliveryMode}>
                  {({ getFieldValue }) =>
                    getFieldValue('deliveryMode') === 'channel' ? (
                      <>
                        <Form.Item name="deliveryChannelId" label="Delivery Channel" style={{ marginBottom: 8 }}>
                          <Select
                            placeholder="Select a channel"
                            allowClear
                            options={channels.filter((c) => c.enabled).map((c) => ({
                              value: c.id,
                              label: `${c.name} (${c.type})`,
                            }))}
                            onChange={(val) => {
                              setDeliveryTargetId('');
                              setDeliveryTargetType('');
                              if (val) loadDeliveryTargets(val);
                              else setDeliveryTargets([]);
                            }}
                          />
                        </Form.Item>

                        <Form.Item
                          label="Delivery Target"
                          style={{ marginBottom: 8 }}
                          required
                          help={
                            !deliveryTargetId && !loadingTargets
                              ? 'Required — select a specific group or user to deliver to.'
                              : undefined
                          }
                          validateStatus={!deliveryTargetId && !loadingTargets ? 'error' : undefined}
                        >
                          <Select
                            placeholder={loadingTargets ? 'Loading targets...' : 'Select a group or user'}
                            loading={loadingTargets}
                            value={deliveryTargetId || undefined}
                            onChange={(val) => {
                              setDeliveryTargetId(val || '');
                              const target = deliveryTargets.find((t) => t.id === val);
                              setDeliveryTargetType(target?.type || '');
                            }}
                            options={deliveryTargets.map((t) => ({
                              value: t.id,
                              label: t.type === 'p2p' ? `DM: ${t.name}` : t.name,
                            }))}
                          />
                        </Form.Item>

                        <Form.Item name="failureChannelId" label="Failure Alert Channel (optional)" style={{ marginBottom: 8 }}>
                          <Select
                            placeholder="Same as delivery channel if empty"
                            allowClear
                            options={channels.filter((c) => c.enabled).map((c) => ({
                              value: c.id,
                              label: `${c.name} (${c.type})`,
                            }))}
                          />
                        </Form.Item>
                      </>
                    ) : null
                  }
                </Form.Item>
              </Flexbox>
            ),
          }]}
        />
        </div>
      </Form>
    </Drawer>
  );
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
