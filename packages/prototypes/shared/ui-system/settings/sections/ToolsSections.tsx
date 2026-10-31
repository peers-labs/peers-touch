/**
 * Increment 9 sections — tools (cron jobs, command palette opener, tool
 * approval table), channels (Lark-style provisioning wizard + connected
 * channel management; bots intentionally absent), and applets with a
 * settings drill-in. All state is local and every control is functional.
 */
import { useMemo, useState } from 'react';
import {
  ArrowLeft, Check, Clock3, Command as CommandIcon, Link2, Plus,
  Puzzle, Radio, RefreshCw, Search, Trash2, Wrench, Zap,
} from 'lucide-react';
import {
  Alert, Button, Dialog, Empty, IconButton, Switch, Tag, TextField,
} from '@peers-touch/ui';
import { useT, type StringKey } from '../../prefs';
import { SettingsRow, SettingsSection } from '../SettingsPrimitives';
import '../settings.css';

/* ── Cron jobs ─────────────────────────────────────────── */

interface CronJob { id: string; name: string; prompt: string; schedule: string; enabled: boolean; lastRun: string }
const INITIAL_JOBS: CronJob[] = [
  { id: 'cron-1', name: '早安邻里播报', prompt: '汇总昨夜站内互助与活动', schedule: '0 8 * * *', enabled: true, lastRun: '今天 08:00 · 成功' },
  { id: 'cron-2', name: '书架流转周报', prompt: '生成本周共享书架流转清单', schedule: '0 18 * * 5', enabled: true, lastRun: '周五 18:00 · 成功' },
  // 'cron.paused' is a locale-independent sentinel rendered via t();
  // authored success stamps stay as seed content.
  { id: 'cron-3', name: '种子库存提醒', prompt: '检查可交换种子库存', schedule: '0 9 * * 1', enabled: false, lastRun: 'cron.paused' },
];
const CRON_PATTERN = /^(\S+\s+){4}\S+$/;

function CronSection() {
  const { t } = useT();
  const [jobs, setJobs] = useState(INITIAL_JOBS);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('');
  const [running, setRunning] = useState<string | null>(null);

  const active = jobs.filter(job => job.enabled).length;
  const paused = jobs.length - active;
  const patch = (id: string, patch: Partial<CronJob>) =>
    setJobs(list => list.map(job => job.id === id ? { ...job, ...patch } : job));
  const runNow = (id: string) => {
    setRunning(id);
    window.setTimeout(() => {
      patch(id, { lastRun: t('cron.lastJustNow') });
      setRunning(null);
    }, 700);
  };
  const create = () => {
    if (!name.trim() || !CRON_PATTERN.test(schedule.trim())) return;
    setJobs(list => [...list, {
      id: `local-${Date.now()}`, name: name.trim(), prompt: '', schedule: schedule.trim(),
      enabled: true, lastRun: t('cron.lastNever'),
    }]);
    setOpen(false);
    setName('');
    setSchedule('');
  };

  return (
    <SettingsSection icon={Clock3} title={t('cron.title')} subtitle={t('cron.subtitle')}
      extra={<div className="sk-cron-counts">
        <Tag tone="info">{t('cron.active', { n: active })}</Tag>
        {paused > 0 && <Tag>{t('cron.paused', { n: paused })}</Tag>}
        <IconButton iconId="refresh-ccw" iconSize={14} label={t('common.refresh')} actionId="cron.refresh" emphasis="quiet" density="compact" />
        <Button actionId="cron.create-open" emphasis="primary" density="compact" leading={<Plus size={13} />}
          label={t('cron.create')} onActivate={() => setOpen(true)} />
      </div>}>
      <div className="sk-cron-list">
        {jobs.map(job => (
          <div className="sk-cron-row" key={job.id} data-cron-id={job.id}>
            <div className="sk-cron-id">
              <strong>{job.name}</strong>
              <code>{job.schedule}</code>
              <span className={job.enabled ? 'is-ok' : 'is-muted'}>
                {job.lastRun === 'cron.paused' ? t('cron.pausedTag') : job.lastRun}
              </span>
            </div>
            <div className="sk-cron-ops">
              <Button actionId={`cron.run-${job.id}`} emphasis="quiet" density="compact" leading={<Zap size={13} />}
                label={t('cron.runNow')} execution={running === job.id ? 'pending' : 'idle'}
                availability={!job.enabled ? { kind: 'disabled', reason: t('cron.pausedReason') } : undefined}
                onActivate={() => runNow(job.id)} />
              <Switch checked={job.enabled} aria-label={t('cron.enable', { name: job.name })}
                onCheckedChange={checked => patch(job.id, { enabled: checked, lastRun: checked ? job.lastRun : t('cron.pausedTag') })} />
              <IconButton iconId="delete" iconSize={14} label={t('cron.delete', { name: job.name })} actionId={`cron.delete-${job.id}`}
                emphasis="quiet" density="compact"
                onActivate={() => setJobs(list => list.filter(entry => entry.id !== job.id))} />
            </div>
          </div>
        ))}
        {jobs.length === 0 && <Empty description={t('cron.empty')} />}
      </div>

      <Dialog open={open} onDismiss={() => setOpen(false)} title={t('cron.dialogTitle')} width={440} closeLabel={t('common.close')}
        footer={
          <>
            <Button actionId="cron.create-cancel" emphasis="quiet" label={t('common.cancel')} onActivate={() => setOpen(false)} />
            <Button actionId="cron.create-submit" emphasis="primary" label={t('common.create')}
              availability={!name.trim() || !CRON_PATTERN.test(schedule.trim())
                ? { kind: 'disabled', reason: t('cron.needFields') } : undefined}
              onActivate={create} />
          </>
        }>
        <div className="sk-cron-form">
          <TextField aria-label={t('cron.nameAria')} placeholder={t('cron.namePlaceholder')} value={name} onValueChange={setName} />
          <TextField aria-label={t('cron.exprAria')} placeholder={t('cron.exprPlaceholder')} value={schedule}
            onValueChange={setSchedule} data-cron-expr={schedule} />
          <p className="sk-field-hint">{t('cron.hintBefore')}<code>0 9 * * 1</code>{t('cron.hintAfter')}</p>
        </div>
      </Dialog>
    </SettingsSection>
  );
}

/* ── Command palette ───────────────────────────────────── */

const PALETTE_COMMANDS: { id: string; titleKey: StringKey; detailKey: StringKey }[] = [
  { id: 'new-chat', titleKey: 'palette.cmd.newChat.title', detailKey: 'palette.cmd.newChat.detail' },
  { id: 'new-moment', titleKey: 'palette.cmd.newMoment.title', detailKey: 'palette.cmd.newMoment.detail' },
  { id: 'open-settings', titleKey: 'palette.cmd.openSettings.title', detailKey: 'palette.cmd.openSettings.detail' },
  { id: 'search-messages', titleKey: 'palette.cmd.searchMessages.title', detailKey: 'palette.cmd.searchMessages.detail' },
  { id: 'screenshot', titleKey: 'palette.cmd.screenshot.title', detailKey: 'palette.cmd.screenshot.detail' },
];

function CommandPaletteSection() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const commands = useMemo(() => PALETTE_COMMANDS
    .map(command => ({ ...command, title: t(command.titleKey), detail: t(command.detailKey) })),
  // t changes only with the locale; command ids are static.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [t]);
  const results = useMemo(() => commands
    .filter(command => !query.trim() || `${command.title} ${command.detail}`.includes(query.trim())), [commands, query]);

  return (
    <SettingsSection icon={CommandIcon} title={t('palette.title')} subtitle={t('palette.subtitle')}
      extra={<Button actionId="command-palette.open" emphasis="primary" leading={<CommandIcon size={14} />}
        label={t('palette.open')} onActivate={() => { setQuery(''); setOpen(true); }} />}>
      <p className="sk-field-hint">{t('palette.hint')}</p>
      <Dialog open={open} onDismiss={() => setOpen(false)} title={t('palette.dialogTitle')} width={480} closeLabel={t('common.close')}>
        <div className="sk-palette" data-command-palette>
          <TextField className="sk-palette-input" aria-label={t('palette.searchAria')} placeholder={t('palette.placeholder')}
            value={query} onValueChange={setQuery} leading={<Search size={14} />} data-palette-query={query} />
          <div className="sk-palette-list">
            {results.length === 0
              ? <Empty description={t('palette.empty')} />
              : results.map(command => (
                <button key={command.id} type="button" className="sk-palette-item"
                  data-command-id={command.id} onClick={() => setOpen(false)}>
                  <strong>{command.title}</strong>
                  <span>{command.detail}</span>
                </button>
              ))}
          </div>
        </div>
      </Dialog>
    </SettingsSection>
  );
}

/* ── Tools approval table ──────────────────────────────── */

const TOOLS = [
  { id: 'fs-read', nameKey: 'tools.tool.fsRead' as StringKey, category: 'filesystem', approval: false },
  { id: 'shell', nameKey: 'tools.tool.shell' as StringKey, category: 'shell', approval: true },
  { id: 'web-fetch', nameKey: 'tools.tool.web' as StringKey, category: 'web', approval: false },
  { id: 'memory-write', nameKey: 'tools.tool.memory' as StringKey, category: 'memory', approval: true },
  { id: 'mcp-call', nameKey: 'tools.tool.mcp' as StringKey, category: 'mcp', approval: true },
];
const CATEGORY_KEY: Record<string, StringKey> = {
  filesystem: 'tools.cat.filesystem', shell: 'tools.cat.shell', web: 'tools.cat.web',
  memory: 'tools.cat.memory', mcp: 'tools.cat.mcp',
};

function ToolsTableSection() {
  const { t } = useT();
  const [rescanning, setRescanning] = useState(false);
  const [scannedJustNow, setScannedJustNow] = useState(false);
  const rescan = () => {
    setRescanning(true);
    window.setTimeout(() => { setRescanning(false); setScannedJustNow(true); }, 700);
  };
  return (
    <SettingsSection icon={Wrench} title={t('tools.title', { n: TOOLS.length })}
      subtitle={t('tools.subtitle', { time: t(scannedJustNow ? 'tools.scannedJustNow' : 'tools.scanned2min') })}
      extra={<Button actionId="tools.rescan" emphasis="secondary" density="compact" leading={<RefreshCw size={13} />}
        label={t('tools.rescan')} execution={rescanning ? 'pending' : 'idle'} onActivate={rescan} />}>
      <div className="sk-tools-table">
        <div className="sk-tools-row is-head"><span>{t('tools.colName')}</span><span>{t('tools.colCategory')}</span><span>{t('tools.colApproval')}</span></div>
        {TOOLS.map(tool => (
          <div className="sk-tools-row" key={tool.id} data-tool-id={tool.id}>
            <strong>{t(tool.nameKey)}</strong>
            <Tag tone="neutral">{t(CATEGORY_KEY[tool.category])}</Tag>
            {tool.approval
              ? <Tag tone="warning">{t('tools.approvalRequired')}</Tag>
              : <Tag tone="success">{t('tools.approvalAuto')}</Tag>}
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

export function ToolsSection({ section }: { section: 'cron' | 'command-menu' | 'tools' }) {
  if (section === 'command-menu') return <CommandPaletteSection />;
  if (section === 'tools') return <ToolsTableSection />;
  return <CronSection />;
}

/* ── Channels ──────────────────────────────────────────── */

interface Channel { id: string; name: string; domain: string; connected: boolean; delivery: boolean; inbound: boolean }
const INITIAL_CHANNELS: Channel[] = [
  { id: 'ch-lark-1', name: '飞书 · 松绿物业', domain: 'songlutf.feishu.cn', connected: true, delivery: true, inbound: false },
];

export function ChannelsSection() {
  const { t } = useT();
  const [channels, setChannels] = useState(INITIAL_CHANNELS);
  const [wizard, setWizard] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [domain, setDomain] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const patch = (id: string, patch: Partial<Channel>) =>
    setChannels(list => list.map(channel => channel.id === id ? { ...channel, ...patch } : channel));

  const openWizard = () => { setDomain(''); setStep(1); setWizard(true); };
  const authorize = () => {
    setStep(2);
    window.setTimeout(() => setStep(3), 900);
    window.setTimeout(() => {
      setStep(1);
      setWizard(false);
      setChannels(list => [...list, {
        id: `local-${Date.now()}`,
        name: t('channels.nameNew', { tenant: domain.split('.')[0] || t('channels.tenantFallback') }),
        domain: domain || 'new.feishu.cn', connected: true, delivery: true, inbound: false,
      }]);
    }, 1900);
  };

  return (
    <SettingsSection icon={Radio} title={t('channels.title')} subtitle={t('channels.subtitle')}>
      <div className="sk-channel-list">
        {channels.map(channel => (
          <div className="sk-channel-card" key={channel.id} data-channel-id={channel.id}>
            <div className="sk-channel-id">
              <div className="sk-channel-title">
                <strong>{channel.name}</strong>
                <Tag tone={channel.connected ? 'success' : 'neutral'}>{channel.connected ? t('channels.connected') : t('channels.disconnected')}</Tag>
              </div>
              <span className="sk-channel-domain"><Link2 size={12} /> {channel.domain}</span>
            </div>
            <div className="sk-channel-switches">
              <Switch checked={channel.delivery} aria-label={t('channels.deliveryAria')}
                onCheckedChange={checked => patch(channel.id, { delivery: checked })} label={t('channels.delivery')} />
              <Switch checked={channel.inbound} aria-label={t('channels.inboundAria')}
                onCheckedChange={checked => patch(channel.id, { inbound: checked })} label={t('channels.inbound')} />
              <Button actionId={`channel.remove-${channel.id}`} emphasis="quiet" density="compact" tone="danger"
                leading={<Trash2 size={13} />} label={t('common.remove')} onActivate={() => setRemoving(channel.id)} />
            </div>
          </div>
        ))}
      </div>
      <Button actionId="channel.add-open" emphasis="primary" leading={<Plus size={14} />}
        label={t('channels.add')} onActivate={openWizard} />
      <Alert tone="info" title={t('channels.botsTitle')} description={t('channels.botsDesc')} />

      <Dialog open={wizard} onDismiss={() => setWizard(false)} title={t('channels.dialogTitle')} width={460} closeLabel={t('common.cancel')}
        footer={step === 1
          ? <Button actionId="channel.authorize" emphasis="primary" leading={<Check size={14} />}
              label={t('channels.authorize')}
              availability={!domain.trim() ? { kind: 'disabled', reason: t('channels.domainReason') } : undefined}
              onActivate={authorize} />
          : undefined}>
        <div className="sk-wizard" data-wizard-step={step}>
          {step === 1 && (
            <div className="sk-wizard-step">
              <strong>{t('channels.step1Title')}</strong>
              <TextField aria-label={t('channels.domainAria')} placeholder="your-tenant.feishu.cn"
                value={domain} onValueChange={setDomain} data-channel-domain={domain} />
              <p className="sk-field-hint">{t('channels.step1Hint')}</p>
            </div>
          )}
          {step === 2 && (
            <div className="sk-wizard-step is-center">
              <strong>{t('channels.step2Title')}</strong>
              <p className="sk-field-hint">{t('channels.step2Hint')}</p>
            </div>
          )}
          {step === 3 && (
            <div className="sk-wizard-step is-center">
              <strong>{t('channels.step3Title')}</strong>
              <p className="sk-field-hint">{t('channels.step3Hint')}</p>
            </div>
          )}
        </div>
      </Dialog>

      <Dialog open={!!removing} onDismiss={() => setRemoving(null)} title={t('channels.removeDialogTitle')} width={420} closeLabel={t('common.cancel')}
        footer={
          <>
            <Button actionId="channel.remove-cancel" emphasis="quiet" label={t('common.cancel')} onActivate={() => setRemoving(null)} />
            <Button actionId="channel.remove-confirm" emphasis="primary" tone="danger" label={t('channels.removeConfirm')}
              onActivate={() => {
                setChannels(list => list.filter(channel => channel.id !== removing));
                setRemoving(null);
              }} />
          </>
        }>
        <p className="sk-field-hint">{t('channels.removeBody')}</p>
      </Dialog>
    </SettingsSection>
  );
}

/* ── Applets ───────────────────────────────────────────── */

interface Applet { id: string; name: string; description: string; hasSettings: boolean }
const APPLETS: Applet[] = [
  { id: 'ap-shelf', name: '共享书架', description: '邻里流转书登记与寻书', hasSettings: true },
  { id: 'ap-seeds', name: '种子交换', description: '可交换种子库存与约定', hasSettings: true },
  { id: 'ap-kite', name: '操场风筝', description: '查看天气与场地占用（只读）', hasSettings: false },
];

export function AppletsSection() {
  const { t } = useT();
  const [selected, setSelected] = useState<Applet | null>(null);
  const [notify, setNotify] = useState(true);
  const [location, setLocation] = useState(true);

  if (selected) {
    return (
      <SettingsSection icon={Puzzle} title={selected.name} subtitle={selected.description}
        extra={<Button actionId="applets.back" emphasis="quiet" density="compact" leading={<ArrowLeft size={14} />}
          label={t('applets.back')} onActivate={() => setSelected(null)} />}>
        <SettingsRow label={t('applets.notify')} description={t('applets.notifyDesc')}>
          <Switch checked={notify} aria-label={t('applets.notify')} onCheckedChange={setNotify} />
        </SettingsRow>
        <SettingsRow label={t('applets.location')} description={t('applets.locationDesc')}>
          <Switch checked={location} aria-label={t('applets.location')} onCheckedChange={setLocation} />
        </SettingsRow>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection icon={Puzzle} title={t('applets.title')} subtitle={t('applets.subtitle')}>
      <div className="sk-applet-list">
        {APPLETS.map(applet => (
          <button key={applet.id} type="button"
            className={`sk-applet-row${applet.hasSettings ? '' : ' is-static'}`}
            data-applet-id={applet.id}
            onClick={() => applet.hasSettings && setSelected(applet)}>
            <span className="sk-applet-icon"><Puzzle size={16} /></span>
            <span className="sk-applet-id">
              <strong>{applet.name}</strong>
              <span>{applet.description}</span>
            </span>
            {applet.hasSettings
              ? <Tag tone="info">{t('applets.configurable')}</Tag>
              : <Tag>{t('applets.readonly')}</Tag>}
          </button>
        ))}
      </div>
    </SettingsSection>
  );
}
