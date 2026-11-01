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
  Cpu, Database, Flame, HelpCircle, Info, MessageSquare, ScrollText, Send, Trash2,
} from 'lucide-react';
import { Button, Dialog, Empty, Switch, Tag, TextField } from '@peers-touch/ui';
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

/* ── Scheduled tasks (desktop CronJobsSection) ───────────────────────── */

export function CronJobsSection() {
  const { t } = useT();
  const [daily, setDaily] = useState(true);
  const [weekly, setWeekly] = useState(false);
  return (
    <SettingsSection icon={Clock3} title={t('task.title')}>
      <SettingsRow label={t('task.daily')} description={t('task.dailyDesc')}>
        <Switch2 checked={daily} label={t('task.active')} onChange={setDaily} data-task="daily" />
      </SettingsRow>
      <SettingsRow label={t('task.weekly')} description={t('task.weeklyDesc')}>
        <Switch2 checked={weekly} label={t('task.weekly')} onChange={setWeekly} data-task="weekly" />
      </SettingsRow>
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

/* ── atoms ───────────────────────────────────────────────────────────── */

function Switch2({ checked, label, onChange, ...rest }: {
  checked: boolean; label: string; onChange: (v: boolean) => void;
} & Record<string, unknown>) {
  return <Switch checked={checked} aria-label={label} onCheckedChange={onChange} {...rest} />;
}
