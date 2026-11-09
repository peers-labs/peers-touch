/**
 * Advanced-group sections (desktop Settings.tsx parity):
 * Data & Storage, Statistics, Diagnostics & Logs, Scheduled Tasks,
 * Command Palette, About.
 *
 * Local prototype state; file management and data export that need Station
 * backing render honestly disabled with a reason instead of faking action.
 */
import { useState } from 'react';
import {
  ChevronDown, ChevronRight, Clock3, Command as CommandIcon,
  Cpu, Database, FileText, Flame, HelpCircle, Info, MessageSquare, RotateCcw,
  ScrollText, Send, Trash2, Upload,
} from 'lucide-react';
import { Button, Dialog, Empty, Segmented, Switch, Tag, TextField } from '@peers-touch/ui';
import { makeTranslate, usePrefs, type StringKey, type Translate } from '../../prefs';
import { SettingsRow, SettingsSection } from '../SettingsPrimitives';
import '../settings.css';

function useT(): { t: Translate } {
  const prefs = usePrefs();
  return { t: makeTranslate(prefs.locale) };
}

/* ── Data & Storage (desktop DataStorageSection) ─────────────────────── */

const BUCKETS = [
  { label: 'data.bucket.messages' as StringKey, value: '384 MB', pct: 62 },
  { label: 'data.bucket.memory' as StringKey, value: '128 MB', pct: 21 },
  { label: 'data.bucket.applets' as StringKey, value: '64 MB', pct: 11 },
  { label: 'data.bucket.cache' as StringKey, value: '40 MB', pct: 6 },
];

export function DataStorageSection() {
  const { t } = useT();
  const [cacheCleared, setCacheCleared] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <>
      <SettingsSection icon={Database} title={t('data.title')} subtitle={t('data.subtitle')}>
        {BUCKETS.map(bucket => (
          <div className="sk-storage-bar" key={bucket.label}>
            <div><span>{t(bucket.label)}</span><em>{bucket.value}</em></div>
            <div className="sk-storage-track"><i style={{ width: `${bucket.pct}%` }} /></div>
          </div>
        ))}
      </SettingsSection>

      <SettingsSection icon={Database} title={t('data.backup.title')}>
        <SettingsRow label={t('data.manageFiles')} description={t('data.manageFilesDesc')}>
          <Button actionId="storage.manage-files" emphasis="quiet" density="compact" label={t('data.manageFiles')}
            availability={{ kind: 'disabled', reason: t('data.pendingReason') }} />
        </SettingsRow>
        <SettingsRow label={t('data.export')} description={t('data.exportDesc')}>
          <Button actionId="storage.export" emphasis="quiet" density="compact" label={t('data.export')}
            availability={{ kind: 'disabled', reason: t('data.pendingReason') }} />
        </SettingsRow>
        <SettingsRow label={t('data.clearCache')}
          description={cacheCleared ? t('data.cleared') : undefined}>
          <Button actionId="storage.clear-cache" emphasis="secondary" density="compact"
            label={cacheCleared ? t('common.confirm') : t('data.clearCache')}
            onActivate={() => setCacheCleared(true)} />
        </SettingsRow>
      </SettingsSection>

      <section className="sk-settings-section sk-danger-zone">
        <header>
          <h3>{t('data.reset.title')}</h3>
          <p>{t('data.reset.desc')}</p>
        </header>
        {confirmReset ? (
          <div className="sk-inline-confirm" data-reset-confirm>
            <span>{t('data.reset.confirmText')}</span>
            <div className="sk-inline-actions">
              <Button actionId="reset-onboarding-cancel" emphasis="quiet" density="compact" label={t('common.cancel')}
                onActivate={() => setConfirmReset(false)} />
              <Button actionId="reset-onboarding-confirm" emphasis="primary" density="compact" tone="danger"
                label={t('data.reset.btn')} onActivate={() => setConfirmReset(false)} />
            </div>
          </div>
        ) : (
          <button type="button" className="sk-danger-button" data-reset-onboarding
            onClick={() => setConfirmReset(true)}>
            <Trash2 size={14} /> {t('data.reset.btn')}
          </button>
        )}
      </section>
    </>
  );
}

/* ── Statistics (desktop StatisticsSection, fixed demo series) ────────── */

const HEATMAP = [0.2, 0.5, 0.8, 0.6, 0.3, 0.1, 0.4, 0.7, 0.9, 0.5, 0.2, 0.3, 0.6, 0.8, 0.4, 0.2, 0.5, 0.7, 0.6, 0.3, 0.1, 0.4, 0.6, 0.8, 0.5, 0.3, 0.2, 0.4];

export function StatisticsSection() {
  const { t } = useT();
  const cards: { label: StringKey; value: string; icon: typeof MessageSquare }[] = [
    { label: 'stats.sessions', value: '1,842', icon: MessageSquare },
    { label: 'stats.messages', value: '24,391', icon: Send },
    { label: 'stats.words', value: '1.2M', icon: ScrollText },
    { label: 'stats.agents', value: '7', icon: Cpu },
  ];
  const ranks: { title: StringKey; data: { name: string; count: number }[] }[] = [
    { title: 'stats.rankModels', data: [
      { name: 'gpt-5.4', count: 8420 }, { name: 'claude-sonnet-4', count: 5210 },
      { name: 'qwen-max', count: 2130 }, { name: 'deepseek-v3', count: 890 }] },
    { title: 'stats.rankAgents', data: [
      { name: 'Research Assistant', count: 3240 }, { name: 'Writing Partner', count: 2810 },
      { name: 'Code Reviewer', count: 1950 }] },
    { title: 'stats.rankTopics', data: [
      { name: 'Architecture Design', count: 420 }, { name: 'Bug Fixing', count: 380 },
      { name: 'Documentation', count: 290 }, { name: 'Code Generation', count: 250 }] },
  ];
  return (
    <>
      <div className="sk-usage-grid sk-stat-cards" data-stat-cards>
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <div className="sk-stat-card" key={card.label}>
              <Icon size={20} />
              <strong>{card.value}</strong>
              <span>{t(card.label)}</span>
            </div>
          );
        })}
      </div>
      <SettingsSection icon={Flame} title={t('stats.heatmap')} subtitle={t('stats.heatmapDesc')}>
        <div className="sk-heatmap" data-heatmap>
          {HEATMAP.map((v, i) => (
            <i key={i} data-level={v > 0.7 ? 3 : v > 0.4 ? 2 : v > 0.15 ? 1 : 0} />
          ))}
        </div>
      </SettingsSection>
      <div className="sk-rank-grid">
        {ranks.map(rank => (
          <div className="sk-rank-card" key={rank.title}>
            <strong>{t(rank.title)}</strong>
            {rank.data.map((item, i) => (
              <div className="sk-rank-row" key={item.name}>
                <span>{i + 1}. {item.name}</span><em>{item.count}</em>
                <div className="sk-rank-track"><i style={{ width: `${(item.count / rank.data[0].count) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Diagnostics & Logs (desktop LogsSection) ─────────────────────────── */

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
interface LogEntry { id: string; level: Exclude<LogLevel, 'trace' | 'debug'>; target: string; text: string }

const LOG_FIXTURE: LogEntry[] = [
  { id: 'l-1', level: 'info', target: 'federation', text: 'Routing table refreshed. 24 peers active.' },
  { id: 'l-2', level: 'info', target: 'mcp', text: 'Server integrated_browser connected (6 tools).' },
  { id: 'l-3', level: 'warn', target: 'provider', text: 'Anthropic API rate limit approaching (80% quota).' },
  { id: 'l-4', level: 'error', target: 'federation', text: 'Station Delta unreachable after 3 retries.' },
  { id: 'l-5', level: 'info', target: 'memory', text: 'Memory index rebuilt. 12,480 embeddings indexed.' },
  { id: 'l-6', level: 'warn', target: 'extension', text: 'Whiteboard extension failed health check. Retrying.' },
  { id: 'l-7', level: 'info', target: 'kernel', text: 'Boot sequence complete. 5 runtimes initialized.' },
  { id: 'l-8', level: 'error', target: 'provider', text: 'Ollama connection refused at 127.0.0.1:11434.' },
];

export function LogsSection() {
  const { t } = useT();
  const [level, setLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [query, setQuery] = useState('');
  const visible = LOG_FIXTURE
    .filter(entry => level === 'all' || entry.level === level)
    .filter(entry => !query.trim() || `${entry.target} ${entry.text}`.toLowerCase().includes(query.trim().toLowerCase()));
  const filters: ('all' | 'info' | 'warn' | 'error')[] = ['all', 'info', 'warn', 'error'];
  return (
    <SettingsSection icon={ScrollText} title={t('logs.title')} subtitle={t('logs.subtitle')}>
      <div className="sk-log-toolbar" data-log-filters>
        {filters.map(f => (
          <button key={f} type="button"
            className={`sk-log-filter is-${f}${level === f ? ' is-on' : ''}`}
            aria-pressed={level === f} onClick={() => setLevel(f)}>
            {f === 'all' ? t('logs.all') : f.toUpperCase()}
          </button>
        ))}
        <TextField className="sk-log-filter-input" aria-label={t('logs.filterAria')}
          placeholder={t('logs.filterPlaceholder')} clearable onClear={() => setQuery('')}
          value={query} onValueChange={setQuery} />
      </div>
      <div className="sk-log-table">
        <div className="sk-log-head"><span>{t('logs.colTarget')}</span><span>{t('logs.colLevel')}</span><span>{t('logs.colMessage')}</span></div>
        {visible.map(entry => (
          <div className={`sk-log-line is-${entry.level}`} key={entry.id}>
            <code>{entry.target}</code>
            <Tag tone={entry.level === 'error' ? 'danger' : entry.level === 'warn' ? 'warning' : 'neutral'}>
              {entry.level.toUpperCase()}
            </Tag>
            <span>{entry.text}</span>
          </div>
        ))}
        {visible.length === 0 && <Empty description={t('logs.empty')} />}
      </div>
    </SettingsSection>
  );
}

/* ── Scheduled tasks — global read-only registry ───────────────────────
   Creation and editing live with the owning Agent; settings only shows what
   exists across all Agents. No toggles, no add button here. */

interface CronTaskSeed {
  id: string;
  titleKey: StringKey;
  scheduleKey: StringKey;
  ownerKey: StringKey;
  active: boolean;
}

const CRON_TASKS: CronTaskSeed[] = [
  { id: 'daily', titleKey: 'task.daily', scheduleKey: 'task.dailyDesc', ownerKey: 'task.owner.daily', active: true },
  { id: 'report', titleKey: 'task.report', scheduleKey: 'task.reportDesc', ownerKey: 'task.owner.report', active: true },
  { id: 'weekly', titleKey: 'task.weekly', scheduleKey: 'task.weeklyDesc', ownerKey: 'task.owner.weekly', active: false },
];

export function CronJobsSection() {
  const { t } = useT();
  return (
    <SettingsSection icon={Clock3} title={t('task.title')} subtitle={t('task.subtitle')}>
      <div className="sk-cron-registry">
        <div className="sk-cron-registry-head">
          <span>{t('task.columnOwner')}</span>
          <span>{t('task.columnSchedule')}</span>
          <span>{t('task.columnStatus')}</span>
        </div>
        {CRON_TASKS.map(task => (
          <div className="sk-cron-registry-row" key={task.id} data-task={task.id}
            data-task-state={task.active ? 'active' : 'paused'}>
            <span className="sk-cron-registry-id">
              <strong>{t(task.titleKey)}</strong>
              <span className="sk-cron-registry-owner">{t(task.ownerKey)}</span>
            </span>
            <span className="sk-cron-registry-schedule">{t(task.scheduleKey)}</span>
            <span className="sk-cron-registry-state">
              <i />
              {task.active ? t('task.active') : t('task.paused')}
            </span>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

/* ── Command palette ─────────────────────────────────────────────────── */

const PALETTE_COMMANDS: { id: string; titleKey: StringKey; detailKey: StringKey }[] = [
  { id: 'new-chat', titleKey: 'palette.cmd.newChat.title', detailKey: 'palette.cmd.newChat.detail' },
  { id: 'new-moment', titleKey: 'palette.cmd.newMoment.title', detailKey: 'palette.cmd.newMoment.detail' },
  { id: 'open-settings', titleKey: 'palette.cmd.openSettings.title', detailKey: 'palette.cmd.openSettings.detail' },
  { id: 'search-messages', titleKey: 'palette.cmd.searchMessages.title', detailKey: 'palette.cmd.searchMessages.detail' },
  { id: 'screenshot', titleKey: 'palette.cmd.screenshot.title', detailKey: 'palette.cmd.screenshot.detail' },
];

export function CommandPaletteSection() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const results = PALETTE_COMMANDS.filter(command =>
    !query.trim() || `${t(command.titleKey)} ${t(command.detailKey)}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <SettingsSection icon={CommandIcon} title={t('palette.sectionTitle')}
      extra={<Button actionId="command-palette.open" emphasis="primary" density="compact"
        leading={<CommandIcon size={14} />} label={t('palette.open')} onActivate={() => { setQuery(''); setOpen(true); }} />}>
      <Dialog open={open} onDismiss={() => setOpen(false)} title={t('palette.dialogTitle')}
        width={480} closeLabel={t('common.close')}>
        <div className="sk-palette" data-command-palette>
          <TextField className="sk-palette-input" aria-label={t('palette.searchAria')}
            placeholder={t('palette.placeholder')} leading={<CommandIcon size={14} />}
            value={query} onValueChange={setQuery} autoFocus />
          <div className="sk-palette-list">
            {results.map(command => (
              <button key={command.id} type="button" className="sk-palette-item"
                data-command-id={command.id} onClick={() => setOpen(false)}>
                <strong>{t(command.titleKey)}</strong>
                <span>{t(command.detailKey)}</span>
              </button>
            ))}
            {results.length === 0 && <Empty description={t('palette.empty')} />}
          </div>
        </div>
      </Dialog>
    </SettingsSection>
  );
}

/* ── About (desktop AboutSection) ─────────────────────────────────────── */

export function AboutSection() {
  const { t } = useT();
  const [expanded, setExpanded] = useState<string | null>(null);
  const meta: { label: StringKey; value: string }[] = [
    { label: 'about.version', value: 'v0.9.2-beta' },
    { label: 'about.build', value: '20261012.1012' },
    { label: 'about.platform', value: 'macOS arm64 · Tauri 2.x' },
    { label: 'about.runtime', value: 'WebKit + Rust' },
  ];
  const groups: { id: string; titleKey: StringKey; items: StringKey[] }[] = [
    { id: 'messaging', titleKey: 'about.g.messaging', items: ['about.i1', 'about.i2', 'about.i3', 'about.i4'] },
    { id: 'ai', titleKey: 'about.g.ai', items: ['about.i5', 'about.i6', 'about.i7', 'about.i8'] },
    { id: 'network', titleKey: 'about.g.network', items: ['about.i9', 'about.i10', 'about.i11', 'about.i12'] },
    { id: 'extensions', titleKey: 'about.g.applets', items: ['about.i13', 'about.i14', 'about.i15', 'about.i16'] },
  ];
  return (
    <>
      <SettingsSection icon={Info} title={t('about.title')} subtitle={t('about.subtitle')}>
        <div className="sk-about-grid">
          {meta.map(item => <SettingsRow key={item.label} label={t(item.label)} description={item.value} />)}
        </div>
      </SettingsSection>
      <SettingsSection icon={HelpCircle} title={t('about.inside')} subtitle={t('about.insideSubtitle')}>
        {groups.map(group => {
          const open = expanded === group.id;
          return (
            <div key={group.id}>
              <button type="button" className="sk-about-group" aria-expanded={open}
                onClick={() => setExpanded(open ? null : group.id)}>
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <strong>{t(group.titleKey)}</strong>
                <em>{group.items.length}</em>
              </button>
              {open && (
                <div className="sk-about-items">
                  {group.items.map(item => <span key={item}>{t(item)}</span>)}
                </div>
              )}
            </div>
          );
        })}
      </SettingsSection>
    </>
  );
}

/* ── Tool registry (desktop ToolsTab parity: read-only tools_list view) ─ */

type ToolCategory = 'filesystem' | 'shell' | 'web' | 'memory' | 'mcp' | 'agent';

type ToolFixture = { id: string; name: string; category: ToolCategory; needsApproval: boolean };

const TOOL_FIXTURES: ToolFixture[] = [
  { id: 'fs-read', name: 'fs.read_text_file', category: 'filesystem', needsApproval: false },
  { id: 'fs-write', name: 'fs.write_text_file', category: 'filesystem', needsApproval: true },
  { id: 'shell-exec', name: 'shell.exec_command', category: 'shell', needsApproval: true },
  { id: 'web-fetch', name: 'web.fetch_url', category: 'web', needsApproval: false },
  { id: 'memory-remember', name: 'memory.remember', category: 'memory', needsApproval: false },
  { id: 'mcp-call', name: 'mcp.invoke_tool', category: 'mcp', needsApproval: true },
  { id: 'agent-spawn', name: 'agent.spawn_subagent', category: 'agent', needsApproval: true },
];

const TOOL_CATEGORY_TONE: Record<ToolCategory, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  filesystem: 'neutral', shell: 'danger', web: 'info',
  memory: 'success', mcp: 'warning', agent: 'info',
};

export function ToolsSection() {
  const { t } = useT();
  return (
    <SettingsSection icon={Cpu} title={t('toolreg.title')} subtitle={t('toolreg.desc')}>
      <div className="sk-tool-registry" data-tool-registry>
        <div className="sk-tool-row sk-tool-head">
          <span>{t('toolreg.column.name')}</span>
          <span>{t('toolreg.column.category')}</span>
          <span>{t('toolreg.column.approval')}</span>
        </div>
        {TOOL_FIXTURES.map(tool => (
          <div key={tool.id} className="sk-tool-row" data-tool-id={tool.id}
            data-tool-category={tool.category} data-tool-approval={tool.needsApproval ? 'required' : 'auto'}>
            <span className="sk-tool-name"><code>{tool.name}</code></span>
            <span><Tag tone={TOOL_CATEGORY_TONE[tool.category]}>{t(`toolreg.cat.${tool.category}` as StringKey)}</Tag></span>
            <span>
              <Tag tone={tool.needsApproval ? 'warning' : 'neutral'}>
                {tool.needsApproval ? t('toolreg.approval.required') : t('toolreg.approval.auto')}
              </Tag>
            </span>
          </div>
        ))}
      </div>
      <p className="sk-settings-note">{t('toolreg.note')}</p>
    </SettingsSection>
  );
}

/* ── My Files (desktop oss MyFilesSettings parity: object storage inventory) */

type FileVisibility = 'public' | 'chat' | 'private';
type FileFixture = {
  id: string; name: string; bucket: string; mime: string;
  visibility: FileVisibility; sizeLabel: string; updatedAt: string; deleted: boolean;
};

const INITIAL_FILES: FileFixture[] = [
  { id: 'f1', name: '番茄育苗手册.pdf', bucket: 'attachments', mime: 'application/pdf',
    visibility: 'chat', sizeLabel: '2.4 MB', updatedAt: '2026-11-02', deleted: false },
  { id: 'f2', name: '罗勒苗交换清单.xlsx', bucket: 'attachments', mime: 'application/vnd.ms-excel',
    visibility: 'private', sizeLabel: '86 KB', updatedAt: '2026-10-28', deleted: false },
  { id: 'f3', name: '书架值班排期.png', bucket: 'media', mime: 'image/png',
    visibility: 'public', sizeLabel: '1.1 MB', updatedAt: '2026-10-21', deleted: false },
  { id: 'f4', name: '旧协议草稿.md', bucket: 'exports', mime: 'text/markdown',
    visibility: 'private', sizeLabel: '12 KB', updatedAt: '2026-09-14', deleted: true },
];

type VisibilityFilter = 'all' | FileVisibility;

export function FilesSection() {
  const { t } = useT();
  const [files, setFiles] = useState<FileFixture[]>(INITIAL_FILES);
  const [bucketQuery, setBucketQuery] = useState('');
  const [mimeQuery, setMimeQuery] = useState('');
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const visible = files.filter(file => {
    if (file.deleted && !includeDeleted) return false;
    if (visibility !== 'all' && file.visibility !== visibility) return false;
    if (bucketQuery.trim() && !file.bucket.toLowerCase().includes(bucketQuery.trim().toLowerCase())) return false;
    if (mimeQuery.trim() && !file.mime.toLowerCase().includes(mimeQuery.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <SettingsSection icon={Database} title={t('myfiles.title')} subtitle={t('myfiles.desc')}>
      <div className="sk-files-filters" data-files-filters>
        <TextField density="compact" className="sk-files-filter" placeholder={t('myfiles.filterBucket')} aria-label={t('myfiles.filterBucket')}
          value={bucketQuery} onValueChange={setBucketQuery} data-files-bucket-filter />
        <TextField density="compact" className="sk-files-filter" placeholder={t('myfiles.filterMime')} aria-label={t('myfiles.filterMime')}
          value={mimeQuery} onValueChange={setMimeQuery} data-files-mime-filter />
        <Segmented<VisibilityFilter> density="compact"
          aria-label={t('myfiles.visibility')}
          options={[
            { value: 'all', label: t('myfiles.visibility.all') },
            { value: 'public', label: t('myfiles.visibility.public') },
            { value: 'chat', label: t('myfiles.visibility.chat') },
            { value: 'private', label: t('myfiles.visibility.private') },
          ]}
          value={visibility}
          onValueChange={value => setVisibility(value ?? 'all')} />
        <label className="sk-files-include">
          <Switch checked={includeDeleted} aria-label={t('myfiles.includeDeleted')}
            data-files-include-deleted onCheckedChange={setIncludeDeleted} />
          <span>{t('myfiles.includeDeleted')}</span>
        </label>
      </div>

      <div className="sk-files-list" data-files-list>
        {visible.length === 0 && <Empty description={t('myfiles.empty')} />}
        {visible.map(file => (
          <div key={file.id} className="sk-file-row" data-file-id={file.id}
            data-file-state={file.deleted ? 'deleted' : 'live'}
            data-file-visibility={file.visibility}>
            <span className="sk-file-id">
              <FileText size={15} />
              <span className="sk-file-name">{file.name}</span>
            </span>
            <Tag tone={file.visibility === 'public' ? 'success' : file.visibility === 'chat' ? 'info' : 'neutral'}>
              {t(`myfiles.visibility.${file.visibility}` as StringKey)}
            </Tag>
            <span className="sk-file-size">{file.sizeLabel}</span>
            <span className="sk-file-state">{file.deleted ? t('myfiles.state.deleted') : t('myfiles.state.live')}</span>
            <span className="sk-file-actions">
              {file.deleted
                ? <Button emphasis="quiet" density="compact" leading={<RotateCcw size={13} />}
                    actionId={`files.restore-${file.id}`} label={t('myfiles.restore')}
                    onActivate={() => setFiles(list => list.map(item =>
                      item.id === file.id ? { ...item, deleted: false } : item))} />
                : <Button emphasis="quiet" tone="danger" density="compact" leading={<Trash2 size={13} />}
                    actionId={`files.delete-${file.id}`} label={t('myfiles.delete')}
                    onActivate={() => setFiles(list => list.map(item =>
                      item.id === file.id ? { ...item, deleted: true } : item))} />}
            </span>
          </div>
        ))}
      </div>

      <div className="sk-files-footer">
        <Button emphasis="primary" density="compact" leading={<Upload size={14} />}
          actionId="files.upload" label={t('myfiles.upload')}
          availability={{ kind: 'disabled', reason: t('myfiles.uploadDisabled') }} />
        <p className="sk-settings-note">{t('myfiles.note')}</p>
      </div>
    </SettingsSection>
  );
}

