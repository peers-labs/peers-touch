/**
 * DataSection — prototype counterpart of desktop ChatStorageSettings +
 * MyFilesSettings + LogsTab. Local state only: usage breakdown, retention
 * preset with saved feedback, two-step cache clear, conversation table with
 * batch delete + per-row delete + progress, local file manager with upload
 * dialog, and a level-filterable log viewer.
 */
import { useRef, useState } from 'react';
import {
  Clock3, HardDrive, RefreshCw, Search, Trash2, Upload,
} from 'lucide-react';
import {
  Alert, Button, Checkbox, Dialog, Empty, IconButton, Progress, Segmented,
  Tag, TextField,
} from '@peers-touch/ui';
import { SettingsItemCard, SettingsRow, SettingsSection } from '../SettingsPrimitives';
import { useT } from '../../prefs';
import '../settings.css';

type Retention = 'forever' | '365' | '90' | '30';

interface StorageConversation {
  id: string;
  name: string;
  kind: 'direct' | 'group';
  messagesMb: number;
  mediaMb: number;
  totalMb: number;
  updatedDaysAgo: number;
}

interface StoredFile {
  id: string;
  name: string;
  key: string;
  sizeKb: number;
  visibility: 'public' | 'private';
  updatedAt: string;
}

interface LogEntry { id: string; level: 'trace' | 'debug' | 'info' | 'warn' | 'error'; target: string; text: string }

const INITIAL_CONVERSATIONS: StorageConversation[] = [
  { id: 's-qun', name: '小区生活群', kind: 'group', messagesMb: 18.4, mediaMb: 142.0, totalMb: 160.4, updatedDaysAgo: 0 },
  { id: 's-zhongzi', name: '种子交换', kind: 'group', messagesMb: 6.1, mediaMb: 58.7, totalMb: 64.8, updatedDaysAgo: 0 },
  { id: 's-linwan', name: '林晚', kind: 'direct', messagesMb: 12.8, mediaMb: 31.2, totalMb: 44.0, updatedDaysAgo: 0 },
  { id: 's-zhouhe', name: '周禾', kind: 'direct', messagesMb: 9.6, mediaMb: 22.4, totalMb: 32.0, updatedDaysAgo: 1 },
  { id: 's-ayan', name: '阿砚', kind: 'direct', messagesMb: 2.1, mediaMb: 14.0, totalMb: 16.1, updatedDaysAgo: 2 },
  { id: 's-lian', name: 'lin · 连南', kind: 'direct', messagesMb: 0.8, mediaMb: 4.2, totalMb: 5.0, updatedDaysAgo: 6 },
];

const INITIAL_FILES: StoredFile[] = [
  { id: 'f-1', name: '书架清单-10月.pdf', key: 'shelf/2026-10.pdf', sizeKb: 248, visibility: 'public', updatedAt: '2026-10-28' },
  { id: 'f-2', name: '种子交换安排.xlsx', key: 'seeds/plan.xlsx', sizeKb: 64, visibility: 'private', updatedAt: '2026-10-25' },
  { id: 'f-3', name: '操场风筝夜.jpg', key: 'kite-night.jpg', sizeKb: 1840, visibility: 'public', updatedAt: '2026-10-20' },
];

const LOG_FIXTURE: LogEntry[] = [
  { id: 'l-1', level: 'info', target: 'socialRuntime', text: 'projection hydrated: 8 conversations' },
  { id: 'l-2', level: 'info', target: 'momentsRuntime', text: 'feed projection ready in 42ms' },
  { id: 'l-3', level: 'debug', target: 'storage', text: 'cache index 312 entries / 48.2MB' },
  { id: 'l-4', level: 'warn', target: 'relay', text: 'SSE reconnect after 3s backoff' },
  { id: 'l-5', level: 'error', target: 'oss', text: 'upload failed: quota check timeout, retry scheduled' },
  { id: 'l-6', level: 'trace', target: 'uiSystem', text: 'overlay host register: dialog moments.compose' },
  { id: 'l-7', level: 'info', target: 'deviceLink', text: 'offer local-909 expired' },
  { id: 'l-8', level: 'warn', target: 'chat', text: 'direct open intent superseded by generation 4' },
];

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
const RETENTION_VALUES: Retention[] = ['forever', '365', '90', '30'];
const RETENTION_LABEL_KEYS = {
  forever: 'retention.forever', '365': 'retention.year', '90': 'retention.days90', '30': 'retention.days30',
} as const;

function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function StoragePanel() {
  const { t } = useT();
  const retentionOptions = RETENTION_VALUES.map(value => ({ value, label: t(RETENTION_LABEL_KEYS[value]) }));
  const [retention, setRetention] = useState<Retention>('forever');
  const [savedAt, setSavedAt] = useState<Retention | null>(null);
  const [confirmingCache, setConfirmingCache] = useState(false);
  const [cacheMb, setCacheMb] = useState(184);
  const [releasedMb, setReleasedMb] = useState(0);
  const [conversations, setConversations] = useState(INITIAL_CONVERSATIONS);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'size' | 'recent'>('size');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingBatch, setConfirmingBatch] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchDone, setBatchDone] = useState<string | null>(null);
  const [failedRow, setFailedRow] = useState<string | null>(null);

  const visible = conversations
    .filter(entry => entry.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => sort === 'size' ? b.totalMb - a.totalMb : a.updatedDaysAgo - b.updatedDaysAgo);
  const allVisibleSelected = visible.length > 0 && visible.every(entry => selected.has(entry.id));
  const totalBytes = 326 + 842 + cacheMb + 64;

  const changeRetention = (value: Retention) => {
    setRetention(value);
    setSavedAt(null);
    window.setTimeout(() => setSavedAt(value), 450);
  };
  const clearCache = () => {
    setReleasedMb(cacheMb);
    setCacheMb(0);
    setConfirmingCache(false);
  };
  const toggleRow = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(() => {
    if (allVisibleSelected) return new Set();
    return new Set(visible.map(entry => entry.id));
  });
  const runBatch = () => {
    const ids = [...selected];
    setProgress({ done: 0, total: ids.length });
    setConfirmingBatch(false);
    ids.forEach((id, index) => {
      window.setTimeout(() => {
        setConversations(list => list.filter(entry => entry.id !== id));
        setProgress(current => current ? { done: index + 1, total: ids.length } : current);
        if (index === ids.length - 1) {
          setBatchDone(t('batch.done', { n: ids.length }));
          setSelected(new Set());
          window.setTimeout(() => setProgress(null), 500);
        }
      }, (index + 1) * 320);
    });
  };
  const deleteRow = (id: string) => {
    // Simulate one transient failure before success.
    if (failedRow !== id) {
      setFailedRow(id);
      return;
    }
    setConversations(list => list.filter(entry => entry.id !== id));
    setFailedRow(null);
  };

  return (
    <>
      <SettingsSection icon={HardDrive} title={t('storage.title')} subtitle={t('storage.subtitle')}>
        <SettingsItemCard>
          <div className="sk-usage-grid">
            <div className="sk-usage-cell"><span>{t('storage.messages')}</span><strong>{formatMb(326)}</strong></div>
            <div className="sk-usage-cell"><span>{t('storage.media')}</span><strong>{formatMb(842)}</strong></div>
            <div className="sk-usage-cell"><span>{t('storage.cache')}</span><strong data-cache-mb={cacheMb}>{formatMb(cacheMb)}</strong></div>
            <div className="sk-usage-cell is-total"><span>{t('storage.total')}</span><strong>{formatMb(totalBytes)}</strong></div>
          </div>
        </SettingsItemCard>
      </SettingsSection>

      <SettingsSection icon={Clock3} title={t('retention.title')} subtitle={t('retention.subtitle')}>
        <Segmented<Retention> label={t('retention.title')} options={retentionOptions} value={retention} onValueChange={value => changeRetention(value ?? 'forever')} />
        {savedAt && <span className="sk-inline-status is-ok" role="status" data-retention-result="succeeded">{t('retention.saved', { label: retentionOptions.find(o => o.value === savedAt)?.label ?? '' })}</span>}
      </SettingsSection>

      <SettingsSection title={t('cache.title')} subtitle={t('cache.subtitle')}>
        {confirmingCache ? (
          <SettingsItemCard>
            <div className="sk-inline-confirm" data-clear-confirm>
              <span>{t('cache.confirm', { size: formatMb(cacheMb) })}</span>
              <div className="sk-inline-actions">
                <Button actionId="storage.clear-cancel" emphasis="quiet" label={t('common.cancel')} onActivate={() => setConfirmingCache(false)} />
                <Button actionId="storage.clear-apply" emphasis="primary" tone="danger" leading={<Trash2 size={14} />}
                  label={t('cache.confirmBtn')} onActivate={clearCache} />
              </div>
            </div>
          </SettingsItemCard>
        ) : (
          <>
            <Button actionId="storage.clear-open" emphasis="secondary" leading={<Trash2 size={14} />}
              label={t('cache.open', { size: formatMb(cacheMb) })}
              availability={cacheMb === 0 ? { kind: 'disabled', reason: t('cache.emptyReason') } : undefined}
              onActivate={() => setConfirmingCache(true)} />
            {releasedMb > 0 && <Alert tone="success" title={t('cache.released', { size: formatMb(releasedMb) })} />}
          </>
        )}
      </SettingsSection>

      <SettingsSection title={t('sec.storage')} subtitle={t('convStorage.title', { n: conversations.length })}>
        <div className="sk-storage-toolbar">
          <TextField aria-label={t('convStorage.search')} placeholder={t('convStorage.search')} clearable onClear={() => setQuery('')}
            value={query} onValueChange={setQuery} leading={<Search size={14} />} />
          <Segmented label={t('sort.aria')} density="compact"
            options={[{ value: 'size', label: t('sort.size') }, { value: 'recent', label: t('sort.recent') }]}
            value={sort} onValueChange={value => setSort((value === 'recent' ? 'recent' : 'size'))} />
        </div>

        {selected.size > 0 && !progress && !confirmingBatch && (
          <div className="sk-batch-bar" data-batch-manage>
            <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAll} label={t('batch.selectAllPage', { n: selected.size })} />
            <Button actionId="storage.batch-open" emphasis="primary" tone="danger" density="compact"
              label={t('batch.clear', { n: selected.size })} onActivate={() => setConfirmingBatch(true)} />
          </div>
        )}

        {confirmingBatch && (
          <SettingsItemCard>
            <div className="sk-inline-confirm" data-batch-confirm>
              <span>{t('batch.confirm', { n: selected.size })}</span>
              <div className="sk-inline-actions">
                <Button actionId="storage.batch-cancel" emphasis="quiet" label={t('common.cancel')}
                  onActivate={() => setConfirmingBatch(false)} />
                <Button actionId="storage.batch-confirm" emphasis="primary" tone="danger"
                  label={t('cache.confirmBtn')} onActivate={runBatch} />
              </div>
            </div>
          </SettingsItemCard>
        )}

        {progress && (
          <div className="sk-batch-progress" data-batch-completed={progress.done} data-batch-total={progress.total}>
            <Progress value={progress.done} maximum={progress.total} label={t('batch.progressLabel')} />
            <span>{t('batch.progressing', { done: progress.done, total: progress.total })}</span>
          </div>
        )}
        {batchDone && <Alert tone="success" title={batchDone} />}

        {visible.length === 0
          ? <Empty description={t('storage.empty')} />
          : (
            <div className="sk-storage-table">
              <div className="sk-storage-row is-head">
                <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAll} aria-label={t('storage.selectAll')} />
                <span>{t('storage.colConversation')}</span><span>{t('storage.colType')}</span>
                <span>{t('storage.colMessages')}</span><span>{t('storage.colMedia')}</span>
                <span>{t('storage.colTotal')}</span><span />
              </div>
              {visible.map(entry => (
                <div className="sk-storage-row" key={entry.id} data-conversation-id={entry.id}>
                  <Checkbox checked={selected.has(entry.id)} onCheckedChange={() => toggleRow(entry.id)}
                    aria-label={t('storage.selectRow', { name: entry.name })} />
                  <span className="sk-storage-name">{entry.name}</span>
                  <Tag tone="neutral">{entry.kind === 'group' ? t('storage.typeGroup') : t('storage.typeDirect')}</Tag>
                  <span>{formatMb(entry.messagesMb)}</span>
                  <span>{formatMb(entry.mediaMb)}</span>
                  <strong>{formatMb(entry.totalMb)}</strong>
                  <span className="sk-storage-op">
                    {failedRow === entry.id && (
                      <Button actionId={`storage.retry-${entry.id}`} emphasis="quiet" density="compact"
                        tone="danger" label={t('storage.retryDelete')} onActivate={() => deleteRow(entry.id)} />
                    )}
                    <IconButton iconId="delete" iconSize={15} label={t('storage.deleteRow', { name: entry.name })}
                      actionId={`storage.delete-${entry.id}`} emphasis="quiet" density="compact"
                      onActivate={() => deleteRow(entry.id)} />
                  </span>
                </div>
              ))}
            </div>
          )}
      </SettingsSection>
    </>
  );
}

function FilesPanel() {
  const { t } = useT();
  const [files, setFiles] = useState(INITIAL_FILES);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pickName, setPickName] = useState('');
  const [bucket, setBucket] = useState('shelf');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [toast, setToast] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 1800);
  };
  const totalKb = files.reduce((sum, file) => sum + file.sizeKb, 0);
  const submit = () => {
    if (!pickName) return;
    setFiles(list => [{
      id: `local-${Date.now()}`, name: pickName, key: `${bucket}/${pickName}`,
      sizeKb: 12 + (pickName.length % 40), visibility, updatedAt: new Date().toISOString().slice(0, 10),
    }, ...list]);
    setUploadOpen(false);
    setPickName('');
    flash(t('files.uploaded'));
  };

  return (
    <SettingsSection title={t('sec.files')}
      subtitle={t('files.title', { n: files.length, size: `${(totalKb / 1024).toFixed(1)} MB` })}>
      <div className="sk-files-toolbar">
        <Button actionId="files.upload-open" emphasis="primary" leading={<Upload size={14} />}
          label={t('files.upload')} onActivate={() => setUploadOpen(true)} />
        <Button actionId="files.refresh" emphasis="quiet" leading={<RefreshCw size={14} />} label={t('common.refresh')} />
      </div>
      {toast && <Alert tone="success" title={toast} />}
      <div className="sk-storage-table">
        <div className="sk-storage-row is-head"><span>{t('files.colFile')}</span><span>{t('files.colVisibility')}</span><span>{t('files.colSize')}</span><span>{t('files.colDate')}</span><span /></div>
        {files.map(file => (
          <div className="sk-storage-row" key={file.id} data-file-id={file.id}>
            <span className="sk-storage-name" title={file.key}>{file.name}</span>
            <Tag tone={file.visibility === 'public' ? 'info' : 'neutral'}>{file.visibility === 'public' ? t('files.public') : t('files.private')}</Tag>
            <span>{file.sizeKb >= 1024 ? `${(file.sizeKb / 1024).toFixed(1)} MB` : `${file.sizeKb} KB`}</span>
            <span>{file.updatedAt}</span>
            <span className="sk-storage-op">
              <IconButton iconId="copy" iconSize={14} label={t('files.copyKey')} actionId={`files.copy-${file.id}`}
                emphasis="quiet" density="compact"
                onActivate={() => { void navigator.clipboard?.writeText(file.key); flash(t('files.keyCopied')); }} />
              <IconButton iconId="download" iconSize={14} label={t('files.download')} actionId={`files.download-${file.id}`}
                emphasis="quiet" density="compact"
                onActivate={() => flash(t('files.downloadStart', { name: file.name }))} />
              <IconButton iconId="delete" iconSize={14} label={t('files.delete')} actionId={`files.delete-${file.id}`}
                emphasis="quiet" density="compact"
                onActivate={() => setFiles(list => list.filter(entry => entry.id !== file.id))} />
            </span>
          </div>
        ))}
      </div>

      <input ref={fileInputRef} type="file" hidden onChange={event => {
        setPickName(event.target.files?.[0]?.name ?? '');
        event.target.value = '';
      }} />
      <Dialog open={uploadOpen} onDismiss={() => setUploadOpen(false)} title={t('files.dialogTitle')} width={440} closeLabel={t('common.close')}
        footer={
          <>
            <Button actionId="files.upload-cancel" emphasis="quiet" label={t('common.cancel')} onActivate={() => setUploadOpen(false)} />
            <Button actionId="files.upload-submit" emphasis="primary" label={t('files.submit')}
              availability={!pickName ? { kind: 'disabled', reason: t('files.needFile') } : undefined}
              onActivate={submit} />
          </>
        }>
        <div className="sk-upload-dialog">
          <div className="sk-upload-pick">
            <Button actionId="files.pick" emphasis="secondary" leading={<Upload size={14} />}
              label={t('files.browse')} onActivate={() => fileInputRef.current?.click()} />
            <TextField className="sk-upload-name" aria-label={t('files.nameAria')} placeholder={t('files.namePlaceholder')}
              value={pickName} onValueChange={setPickName} />
          </div>
          <TextField aria-label={t('files.bucketAria')} value={bucket} onValueChange={setBucket} />
          <Segmented<'public' | 'private'> label={t('files.visibilityAria')}
            options={[{ value: 'private', label: t('files.privateOption') }, { value: 'public', label: t('files.publicOption') }]}
            value={visibility} onValueChange={value => setVisibility(value ?? 'private')} />
        </div>
      </Dialog>
    </SettingsSection>
  );
}

function LogsPanel() {
  const { t } = useT();
  const [levels, setLevels] = useState<Record<string, boolean>>({
    trace: false, debug: false, info: true, warn: true, error: true,
  });
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const toggleLevel = (level: typeof LEVELS[number]) =>
    setLevels(prev => ({ ...prev, [level]: !prev[level] }));
  const visible = LOG_FIXTURE.filter(entry => levels[entry.level])
    .filter(entry => !query.trim() || `${entry.target} ${entry.text}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <SettingsSection icon={HardDrive} title={t('sec.logs')} subtitle={t('logs.subtitle')}>
      <div className="sk-log-toolbar">
        {LEVELS.map(level => (
          <button key={level} type="button"
            className={`sk-log-filter${levels[level] ? ' is-on' : ''} is-${level}`}
            aria-pressed={levels[level]} onClick={() => toggleLevel(level)}>
            {level.toUpperCase()}
          </button>
        ))}
        <IconButton iconId="refresh-ccw" iconSize={14} label={t('logs.refresh')} actionId="logs.refresh"
          emphasis="quiet" density="compact" onActivate={() => setRevision(value => value + 1)} />
      </div>
      <TextField className="sk-log-filter-input" aria-label={t('logs.filterAria')} placeholder={t('logs.filterPlaceholder')} clearable onClear={() => setQuery('')}
        value={query} onValueChange={setQuery} leading={<Search size={14} />} />
      <div className="sk-log-list" data-revision={revision}>
        {visible.length === 0
          ? <Empty description={t('logs.empty')} />
          : visible.map(entry => (
            <div key={entry.id} className={`sk-log-line is-${entry.level}`}>
              <Tag tone={entry.level === 'error' ? 'danger' : entry.level === 'warn' ? 'warning' : 'neutral'}>
                {entry.level.toUpperCase()}
              </Tag>
              <code>[{entry.target}]</code>
              <span>{entry.text}</span>
            </div>
          ))}
      </div>
    </SettingsSection>
  );
}

export function DataSection({ section }: { section: 'storage' | 'files' | 'logs' }) {
  if (section === 'files') return <FilesPanel />;
  if (section === 'logs') return <LogsPanel />;
  return <StoragePanel />;
}
