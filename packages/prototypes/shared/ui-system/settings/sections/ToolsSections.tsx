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
import { SettingsRow, SettingsSection } from '../SettingsPrimitives';
import '../settings.css';

/* ── Cron jobs ─────────────────────────────────────────── */

interface CronJob { id: string; name: string; prompt: string; schedule: string; enabled: boolean; lastRun: string }
const INITIAL_JOBS: CronJob[] = [
  { id: 'cron-1', name: '早安邻里播报', prompt: '汇总昨夜站内互助与活动', schedule: '0 8 * * *', enabled: true, lastRun: '今天 08:00 · 成功' },
  { id: 'cron-2', name: '书架流转周报', prompt: '生成本周共享书架流转清单', schedule: '0 18 * * 5', enabled: true, lastRun: '周五 18:00 · 成功' },
  { id: 'cron-3', name: '种子库存提醒', prompt: '检查可交换种子库存', schedule: '0 9 * * 1', enabled: false, lastRun: '已暂停' },
];
const CRON_PATTERN = /^(\S+\s+){4}\S+$/;

function CronSection() {
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
      patch(id, { lastRun: '刚刚 · 成功' });
      setRunning(null);
    }, 700);
  };
  const create = () => {
    if (!name.trim() || !CRON_PATTERN.test(schedule.trim())) return;
    setJobs(list => [...list, {
      id: `local-${Date.now()}`, name: name.trim(), prompt: '', schedule: schedule.trim(),
      enabled: true, lastRun: '尚未运行',
    }]);
    setOpen(false);
    setName('');
    setSchedule('');
  };

  return (
    <SettingsSection icon={Clock3} title="定时任务" subtitle="按计划自动运行的任务（本地示例）"
      extra={<div className="sk-cron-counts">
        <Tag tone="info">运行中 {active}</Tag>
        {paused > 0 && <Tag>已暂停 {paused}</Tag>}
        <IconButton iconId="refresh-ccw" iconSize={14} label="刷新" actionId="cron.refresh" emphasis="quiet" density="compact" />
        <Button actionId="cron.create-open" emphasis="primary" density="compact" leading={<Plus size={13} />}
          label="新建任务" onActivate={() => setOpen(true)} />
      </div>}>
      <div className="sk-cron-list">
        {jobs.map(job => (
          <div className="sk-cron-row" key={job.id} data-cron-id={job.id}>
            <div className="sk-cron-id">
              <strong>{job.name}</strong>
              <code>{job.schedule}</code>
              <span className={job.enabled ? 'is-ok' : 'is-muted'}>{job.lastRun}</span>
            </div>
            <div className="sk-cron-ops">
              <Button actionId={`cron.run-${job.id}`} emphasis="quiet" density="compact" leading={<Zap size={13} />}
                label="立即运行" execution={running === job.id ? 'pending' : 'idle'}
                availability={!job.enabled ? { kind: 'disabled', reason: '任务已暂停' } : undefined}
                onActivate={() => runNow(job.id)} />
              <Switch checked={job.enabled} aria-label={`启用 ${job.name}`}
                onCheckedChange={checked => patch(job.id, { enabled: checked, lastRun: checked ? job.lastRun : '已暂停' })} />
              <IconButton iconId="delete" iconSize={14} label={`删除 ${job.name}`} actionId={`cron.delete-${job.id}`}
                emphasis="quiet" density="compact"
                onActivate={() => setJobs(list => list.filter(entry => entry.id !== job.id))} />
            </div>
          </div>
        ))}
        {jobs.length === 0 && <Empty description="还没有定时任务" />}
      </div>

      <Dialog open={open} onDismiss={() => setOpen(false)} title="新建定时任务" width={440} closeLabel="关闭"
        footer={
          <>
            <Button actionId="cron.create-cancel" emphasis="quiet" label="取消" onActivate={() => setOpen(false)} />
            <Button actionId="cron.create-submit" emphasis="primary" label="创建"
              availability={!name.trim() || !CRON_PATTERN.test(schedule.trim())
                ? { kind: 'disabled', reason: '需要名称与 5 段 cron 表达式' } : undefined}
              onActivate={create} />
          </>
        }>
        <div className="sk-cron-form">
          <TextField aria-label="任务名称" placeholder="任务名称，如：晚间天气提醒" value={name} onValueChange={setName} />
          <TextField aria-label="cron 表达式" placeholder="cron 表达式，如：0 8 * * *" value={schedule}
            onValueChange={setSchedule} data-cron-expr={schedule} />
          <p className="sk-field-hint">5 段：分 时 日 月 周；例：<code>0 9 * * 1</code> 每周一 9 点</p>
        </div>
      </Dialog>
    </SettingsSection>
  );
}

/* ── Command palette ───────────────────────────────────── */

const PALETTE_COMMANDS = [
  { id: 'new-chat', title: '新建会话', detail: '打开联系人选择器' },
  { id: 'new-moment', title: '发动态', detail: '在朋友圈发布一条动态' },
  { id: 'open-settings', title: '打开设置', detail: '跳转到通用设置' },
  { id: 'search-messages', title: '搜索消息', detail: '在当前会话中查找' },
  { id: 'screenshot', title: '聊天截图', detail: '截取屏幕作为附件' },
];

function CommandPaletteSection() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const results = useMemo(() => PALETTE_COMMANDS
    .filter(command => !query.trim() || `${command.title} ${command.detail}`.includes(query.trim())), [query]);

  return (
    <SettingsSection icon={CommandIcon} title="命令面板" subtitle="⌘/Ctrl + K 随时唤起，键盘选择，Esc 关闭"
      extra={<Button actionId="command-palette.open" emphasis="primary" leading={<CommandIcon size={14} />}
        label="打开命令面板" onActivate={() => { setQuery(''); setOpen(true); }} />}>
      <p className="sk-field-hint">面板聚合所有可搜索入口，当前为内置命令示例（小程序命令在其注册后出现）。</p>
      <Dialog open={open} onDismiss={() => setOpen(false)} title="命令面板" width={480} closeLabel="关闭">
        <div className="sk-palette" data-command-palette>
          <TextField className="sk-palette-input" aria-label="搜索命令" placeholder="输入命令名称…"
            value={query} onValueChange={setQuery} leading={<Search size={14} />} data-palette-query={query} />
          <div className="sk-palette-list">
            {results.length === 0
              ? <Empty description="没有匹配的命令" />
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
  { id: 'fs-read', name: '文件读取', category: 'filesystem', approval: false },
  { id: 'shell', name: 'Shell 执行', category: 'shell', approval: true },
  { id: 'web-fetch', name: '网页抓取', category: 'web', approval: false },
  { id: 'memory-write', name: '记忆写入', category: 'memory', approval: true },
  { id: 'mcp-call', name: 'MCP 调用', category: 'mcp', approval: true },
];
const CATEGORY_LABEL: Record<string, string> = {
  filesystem: '文件', shell: 'Shell', web: '网页', memory: '记忆', mcp: 'MCP', agent: 'Agent',
};

function ToolsTableSection() {
  const [rescanning, setRescanning] = useState(false);
  const [scannedAt, setScannedAt] = useState('2 分钟前');
  const rescan = () => {
    setRescanning(true);
    window.setTimeout(() => { setRescanning(false); setScannedAt('刚刚'); }, 700);
  };
  return (
    <SettingsSection icon={Wrench} title={`工具（${TOOLS.length}）`} subtitle={`最近扫描：${scannedAt}`}
      extra={<Button actionId="tools.rescan" emphasis="secondary" density="compact" leading={<RefreshCw size={13} />}
        label="重新扫描" execution={rescanning ? 'pending' : 'idle'} onActivate={rescan} />}>
      <div className="sk-tools-table">
        <div className="sk-tools-row is-head"><span>名称</span><span>分类</span><span>审批</span></div>
        {TOOLS.map(tool => (
          <div className="sk-tools-row" key={tool.id} data-tool-id={tool.id}>
            <strong>{tool.name}</strong>
            <Tag tone="neutral">{CATEGORY_LABEL[tool.category] ?? tool.category}</Tag>
            {tool.approval
              ? <Tag tone="warning">需要审批</Tag>
              : <Tag tone="success">自动放行</Tag>}
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
        id: `local-${Date.now()}`, name: `飞书 · ${domain.split('.')[0] || '新租户'}`,
        domain: domain || 'new.feishu.cn', connected: true, delivery: true, inbound: false,
      }]);
    }, 1900);
  };

  return (
    <SettingsSection icon={Radio} title="消息通道" subtitle="把外部消息平台接入 Peers Touch；Bots 通道按决策暂不提供">
      <div className="sk-channel-list">
        {channels.map(channel => (
          <div className="sk-channel-card" key={channel.id} data-channel-id={channel.id}>
            <div className="sk-channel-id">
              <div className="sk-channel-title">
                <strong>{channel.name}</strong>
                <Tag tone={channel.connected ? 'success' : 'neutral'}>{channel.connected ? '已连接' : '未连接'}</Tag>
              </div>
              <span className="sk-channel-domain"><Link2 size={12} /> {channel.domain}</span>
            </div>
            <div className="sk-channel-switches">
              <Switch checked={channel.delivery} aria-label="启用消息投递"
                onCheckedChange={checked => patch(channel.id, { delivery: checked })} label="投递" />
              <Switch checked={channel.inbound} aria-label="入站通知"
                onCheckedChange={checked => patch(channel.id, { inbound: checked })} label="入站" />
              <Button actionId={`channel.remove-${channel.id}`} emphasis="quiet" density="compact" tone="danger"
                leading={<Trash2 size={13} />} label="移除" onActivate={() => setRemoving(channel.id)} />
            </div>
          </div>
        ))}
      </div>
      <Button actionId="channel.add-open" emphasis="primary" leading={<Plus size={14} />}
        label="添加飞书通道" onActivate={openWizard} />
      <Alert tone="info" title="暂不支持 Bots 通道" description="Bots 设置的产品归属仍在决策中，本原型不提供该项。" />

      <Dialog open={wizard} onDismiss={() => setWizard(false)} title="添加飞书通道" width={460} closeLabel="取消"
        footer={step === 1
          ? <Button actionId="channel.authorize" emphasis="primary" leading={<Check size={14} />}
              label="授权并开通"
              availability={!domain.trim() ? { kind: 'disabled', reason: '请输入企业域名' } : undefined}
              onActivate={authorize} />
          : undefined}>
        <div className="sk-wizard" data-wizard-step={step}>
          {step === 1 && (
            <div className="sk-wizard-step">
              <strong>第 1 步 · 企业域名</strong>
              <TextField aria-label="飞书企业域名" placeholder="your-tenant.feishu.cn"
                value={domain} onValueChange={setDomain} data-channel-domain={domain} />
              <p className="sk-field-hint">授权只用于申请开通，不会读取你的密码。</p>
            </div>
          )}
          {step === 2 && (
            <div className="sk-wizard-step is-center">
              <strong>第 2 步 · 等待授权…</strong>
              <p className="sk-field-hint">正在跳转到飞书授权页并校验租户。</p>
            </div>
          )}
          {step === 3 && (
            <div className="sk-wizard-step is-center">
              <strong>第 3 步 · 开通中</strong>
              <p className="sk-field-hint">正在配置 webhook 与消息路由。</p>
            </div>
          )}
        </div>
      </Dialog>

      <Dialog open={!!removing} onDismiss={() => setRemoving(null)} title="移除通道" width={420} closeLabel="取消"
        footer={
          <>
            <Button actionId="channel.remove-cancel" emphasis="quiet" label="取消" onActivate={() => setRemoving(null)} />
            <Button actionId="channel.remove-confirm" emphasis="primary" tone="danger" label="确认移除"
              onActivate={() => {
                setChannels(list => list.filter(channel => channel.id !== removing));
                setRemoving(null);
              }} />
          </>
        }>
        <p className="sk-field-hint">移除后该租户的消息投递与入站通知都会停止，可随时重新开通。</p>
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
  const [selected, setSelected] = useState<Applet | null>(null);
  const [notify, setNotify] = useState(true);
  const [location, setLocation] = useState(true);

  if (selected) {
    return (
      <SettingsSection icon={Puzzle} title={selected.name} subtitle={selected.description}
        extra={<Button actionId="applets.back" emphasis="quiet" density="compact" leading={<ArrowLeft size={14} />}
          label="返回小程序" onActivate={() => setSelected(null)} />}>
        <SettingsRow label="活动通知" description="有新的借阅/交换请求时通知你">
          <Switch checked={notify} aria-label="活动通知" onCheckedChange={setNotify} />
        </SettingsRow>
        <SettingsRow label="位置授权" description="在场地信息中使用你的大致位置">
          <Switch checked={location} aria-label="位置授权" onCheckedChange={setLocation} />
        </SettingsRow>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection icon={Puzzle} title="小程序" subtitle="已安装的本地小程序；带设置面板的可点入配置">
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
              ? <Tag tone="info">可配置</Tag>
              : <Tag>只读</Tag>}
          </button>
        ))}
      </div>
    </SettingsSection>
  );
}
