import {
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Button, Checkbox, Input, Typography } from 'antd';
import {
  CheckSquare2,
  Database,
  Download,
  FileImage,
  HardDrive,
  Pause,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  LogEntry,
  MobileSettingsState,
  StorageConversation,
  StoredFile,
} from '../../settingsState';
import { AccessibleClearIcon } from '../AccessibleClearIcon';
import {
  Capability,
  Choice,
  InlineStatus,
  SettingRow,
  SettingSection,
  SettingToggle,
} from './SettingPrimitives';

const { Text } = Typography;

type SettingsOwnerProps = {
  state: MobileSettingsState;
  setState: Dispatch<SetStateAction<MobileSettingsState>>;
};

function updateField<K extends keyof MobileSettingsState>(
  setState: SettingsOwnerProps['setState'],
  key: K,
  value: SetStateAction<MobileSettingsState[K]>,
) {
  setState((current) => ({
    ...current,
    [key]: typeof value === 'function'
      ? (value as (previous: MobileSettingsState[K]) => MobileSettingsState[K])(current[key])
      : value,
  }));
}

function formatMb(value: number) {
  if (value >= 1024) return `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} GB`;
  return `${Math.round(value)} MB`;
}

export function StorageSettingsSection({ state, setState }: SettingsOwnerProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'size' | 'recent'>('size');
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [cacheConfirm, setCacheConfirm] = useState(false);
  const [cacheResult, setCacheResult] = useState('');
  const [retentionResult, setRetentionResult] = useState('');
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchStatus, setBatchStatus] = useState<'idle' | 'running' | 'partial' | 'success'>('idle');
  const [batchProgress, setBatchProgress] = useState({ complete: 0, total: 0 });
  const [batchResult, setBatchResult] = useState('');
  const [refreshAttempts, setRefreshAttempts] = useState(0);
  const storage = state.storage;
  const totalMb = storage.messagesMb + storage.mediaMb + storage.cacheMb + storage.systemMb;

  const updateStorage = (change: Partial<MobileSettingsState['storage']>) => updateField(
    setState,
    'storage',
    (current) => ({ ...current, ...change }),
  );

  const conversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return storage.conversations
      .filter((conversation) => (
        !normalized || `${conversation.name} ${conversation.id}`.toLowerCase().includes(normalized)
      ))
      .slice()
      .sort((left, right) => {
        if (sort === 'recent') return left.lastActivity.localeCompare(right.lastActivity);
        return (right.messageMb + right.mediaMb) - (left.messageMb + left.mediaMb);
      });
  }, [query, sort, storage.conversations]);

  const selectedRows = storage.conversations.filter((conversation) => selected.has(conversation.id));
  const estimatedMb = selectedRows.reduce((total, conversation) => total + conversation.reclaimableMb, 0);
  const allVisibleSelected = conversations.length > 0
    && conversations.every((conversation) => selected.has(conversation.id));
  const someVisibleSelected = conversations.some((conversation) => selected.has(conversation.id));

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setBatchStatus('idle');
    setBatchResult('');
  };

  const applyBatchCleanup = async () => {
    const targetRows = storage.conversations.filter((conversation) => selected.has(conversation.id));
    if (targetRows.length === 0) return;
    setBatchConfirm(false);
    setBatchStatus('running');
    setBatchProgress({ complete: 0, total: targetRows.length });
    await new Promise((resolve) => window.setTimeout(resolve, 40));

    const failed = targetRows.filter((conversation) => conversation.failOnce);
    const succeeded = targetRows.filter((conversation) => !conversation.failOnce);
    const released = succeeded.reduce((total, conversation) => total + conversation.reclaimableMb, 0);
    updateStorage({
      messagesMb: Math.max(0, storage.messagesMb - succeeded.reduce((total, row) => total + row.messageMb, 0)),
      mediaMb: Math.max(0, storage.mediaMb - succeeded.reduce((total, row) => total + row.mediaMb, 0)),
      conversations: storage.conversations
        .filter((conversation) => !succeeded.some((row) => row.id === conversation.id))
        .map((conversation) => failed.some((row) => row.id === conversation.id)
          ? { ...conversation, failOnce: false }
          : conversation),
      measuredAt: 'Just now',
    });
    setBatchProgress({ complete: targetRows.length, total: targetRows.length });
    if (failed.length > 0) {
      setSelected(new Set(failed.map((conversation) => conversation.id)));
      setBatchStatus('partial');
      setBatchResult(`${succeeded.length} cleared · ${failed.length} failed · ${formatMb(released)} released`);
    } else {
      setSelected(new Set());
      setBatchMode(false);
      setBatchStatus('success');
      setBatchResult(`${targetRows.length} cleared · ${formatMb(released)} released`);
    }
  };

  return (
    <>
      <Capability id="storage.measure.refresh">
        <section className="mp-storage-overview">
          <span className="mp-storage-icon"><Database size={22} /></span>
          <span className="mp-storage-total">
            <strong>{formatMb(totalMb)} used</strong>
            <Text type="secondary">Measured {storage.measuredAt}</Text>
          </span>
          <Button
            type="text"
            aria-label="Refresh storage measurement"
            data-capability-action="storage.measure.refresh"
            icon={<RefreshCw size={15} />}
            loading={storage.status === 'measuring'}
            onClick={async () => {
              updateStorage({ status: 'measuring' });
              await Promise.resolve();
              if (refreshAttempts === 0) {
                setRefreshAttempts(1);
                updateStorage({ status: 'error', stale: true });
                return;
              }
              setRefreshAttempts((current) => current + 1);
              updateStorage({ status: 'ready', stale: false, measuredAt: 'Just now' });
            }}
          />
          <Capability id="storage.measure.stale">
            <span className={`mp-settings-state ${storage.stale ? 'invalid' : 'ready'}`}>
              {storage.stale ? 'Stale' : 'Current'}
            </span>
          </Capability>
        </section>
      </Capability>
      {storage.status === 'error' && (
        <InlineStatus tone="danger">
          <span>Measurement failed. Existing totals are retained.</span>
          <Button
            size="small"
            data-capability-action="storage.measure.refresh"
            onClick={async () => {
              updateStorage({ status: 'measuring' });
              await Promise.resolve();
              setRefreshAttempts((current) => current + 1);
              updateStorage({ status: 'ready', stale: false, measuredAt: 'Just now' });
            }}
          >
            Retry
          </Button>
        </InlineStatus>
      )}

      <Capability id="storage.categories.inspect">
        <div className="mp-storage-category-grid">
          {[
            ['Messages', storage.messagesMb, MessageSquareIcon],
            ['Media', storage.mediaMb, FileImage],
            ['Cache', storage.cacheMb, HardDrive],
            ['System', storage.systemMb, Database],
          ].map(([label, value, Icon]) => {
            const CategoryIcon = Icon as typeof Database;
            return (
              <span key={String(label)}>
                <CategoryIcon size={16} />
                <small>{String(label)}</small>
                <strong>{formatMb(Number(value))}</strong>
              </span>
            );
          })}
        </div>
      </Capability>

      <SettingSection title="Retention" description="Apply one policy to downloaded Chat content on this device.">
        <SettingRow capability="storage.retention.select" label="Keep messages and media">
          <Choice
            capability="storage.retention.select"
            label="Storage retention"
            value={storage.retention}
            onChange={(retention) => {
              updateStorage({ retention: retention as MobileSettingsState['storage']['retention'] });
              setRetentionResult(`Retention updated to ${retention === 'forever' ? 'Forever' : `${retention} days`}.`);
            }}
            options={[
              { value: 'forever', label: 'Forever' },
              { value: '365', label: '1 year' },
              { value: '90', label: '90 days' },
              { value: '30', label: '30 days' },
            ]}
          />
        </SettingRow>
        {retentionResult && <InlineStatus tone="success">{retentionResult}</InlineStatus>}
      </SettingSection>

      <SettingSection title="Cache" description="Clear temporary copies without deleting messages.">
        <Capability id="storage.cache.clear">
          {!cacheConfirm ? (
            <div className="mp-setting-section-action">
              <Button
                danger
                disabled={storage.cacheMb === 0}
                data-capability-action="storage.cache.clear"
                icon={<Trash2 size={14} />}
                onClick={() => setCacheConfirm(true)}
              >
                {storage.cacheMb === 0 ? 'Cache cleared' : `Clear cache · ${formatMb(storage.cacheMb)}`}
              </Button>
            </div>
          ) : (
            <Capability id="storage.cache.confirm">
              <div className="mp-setting-confirm">
                <Text>Clear {formatMb(storage.cacheMb)} of temporary files from this device?</Text>
                <div className="mp-setting-inline-actions">
                  <Button onClick={() => setCacheConfirm(false)}>Cancel</Button>
                  <Button
                    danger
                    type="primary"
                    data-capability-action="storage.cache.confirm"
                    onClick={() => {
                      const released = storage.cacheMb;
                      updateStorage({ cacheMb: 0, measuredAt: 'Just now' });
                      setCacheConfirm(false);
                      setCacheResult(`${formatMb(released)} released.`);
                    }}
                  >
                    Clear cache
                  </Button>
                </div>
              </div>
            </Capability>
          )}
        </Capability>
        <Capability id="storage.cache.result">
          {cacheResult ? (
            <InlineStatus tone="success">{cacheResult}</InlineStatus>
          ) : (
            <span className="mp-setting-passive-status">No cache cleanup has run in this session.</span>
          )}
        </Capability>
      </SettingSection>

      <SettingSection
        title="Conversations"
        description={`${conversations.length} matching conversations`}
        action={(
          <Button
            size="small"
            icon={batchMode ? <X size={13} /> : <CheckSquare2 size={13} />}
            onClick={() => {
              setBatchMode((current) => !current);
              setSelected(new Set());
              setBatchStatus('idle');
              setBatchResult('');
            }}
          >
            {batchMode ? 'Done' : 'Manage'}
          </Button>
        )}
      >
        <div className="mp-storage-filter-row">
          <Capability id="storage.conversations.search">
            <Input
              aria-label="Search conversations"
              placeholder="Search conversations"
              prefix={<Search size={13} />}
              allowClear={{ clearIcon: <AccessibleClearIcon label="Clear conversation search" /> }}
              data-capability-action="storage.conversations.search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </Capability>
          <Capability id="storage.conversations.sort">
            <div className="mp-setting-segmented compact" role="group" aria-label="Sort conversations">
              {(['size', 'recent'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={sort === value ? 'active' : ''}
                  aria-pressed={sort === value}
                  data-capability-action="storage.conversations.sort"
                  onClick={() => setSort(value)}
                >
                  {value === 'size' ? 'Size' : 'Recent'}
                </button>
              ))}
            </div>
          </Capability>
        </div>

        {batchMode && (
          <Capability id="storage.batch.select">
            <div className="mp-storage-batch-owner">
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={!allVisibleSelected && someVisibleSelected}
                data-capability-action="storage.batch.select"
                onChange={(event) => setSelected((current) => {
                  const next = new Set(current);
                  for (const conversation of conversations) {
                    if (event.target.checked) next.add(conversation.id);
                    else next.delete(conversation.id);
                  }
                  return next;
                })}
              >
                Select visible
              </Checkbox>
              <Capability id="storage.batch.estimate">
                <Text type="secondary">
                  {selectedRows.length} selected · about {formatMb(estimatedMb)} reclaimable
                </Text>
              </Capability>
              {!batchConfirm ? (
                <Button
                  danger
                  disabled={selectedRows.length === 0 || batchStatus === 'running'}
                  onClick={() => setBatchConfirm(true)}
                >
                  Clear selected
                </Button>
              ) : (
                <Capability id="storage.batch.confirm">
                  <div className="mp-setting-confirm">
                    <Text>Clear {selectedRows.length} conversations from this device and reclaim about {formatMb(estimatedMb)}?</Text>
                    <div className="mp-setting-inline-actions">
                      <Button onClick={() => setBatchConfirm(false)}>Cancel</Button>
                      <Button
                        danger
                        type="primary"
                        data-capability-action="storage.batch.confirm"
                        onClick={() => void applyBatchCleanup()}
                      >
                        Clear conversations
                      </Button>
                    </div>
                  </div>
                </Capability>
              )}
            </div>
          </Capability>
        )}

        <Capability id="storage.batch.progress">
          <span
            className="mp-setting-passive-status"
            role="status"
            data-batch-status={batchStatus}
          >
            {batchStatus === 'running'
              ? `Clearing ${batchProgress.complete} of ${batchProgress.total}`
              : batchStatus === 'idle'
                ? 'No conversation cleanup is running.'
                : batchResult}
          </span>
        </Capability>

        {batchStatus === 'partial' && (
          <Capability id="storage.batch.partial-retry">
            <div className="mp-setting-inline-status danger" role="alert">
              <span>{batchResult}</span>
              <Button
                size="small"
                data-capability-action="storage.batch.partial-retry"
                onClick={() => setBatchConfirm(true)}
              >
                Retry failed
              </Button>
            </div>
          </Capability>
        )}

        <div className="mp-storage-conversations" data-ui-rows>
          {conversations.map((conversation) => (
            <StorageConversationRow
              key={conversation.id}
              conversation={conversation}
              selected={selected.has(conversation.id)}
              selecting={batchMode}
              onSelect={(checked) => toggleSelected(conversation.id, checked)}
            />
          ))}
          {conversations.length === 0 && <div className="mp-setting-empty">No matching conversations</div>}
        </div>
      </SettingSection>
    </>
  );
}

function MessageSquareIcon({ size }: { size?: number }) {
  return <Database size={size} />;
}

function StorageConversationRow({
  conversation,
  selecting,
  selected,
  onSelect,
}: {
  conversation: StorageConversation;
  selecting: boolean;
  selected: boolean;
  onSelect: (checked: boolean) => void;
}) {
  return (
    <div className="mp-storage-conversation" data-ui-row data-conversation-id={conversation.id}>
      {selecting && (
        <Checkbox
          aria-label={`Select ${conversation.name}`}
          checked={selected}
          data-capability-action="storage.batch.select"
          onChange={(event) => onSelect(event.target.checked)}
        />
      )}
      <span data-ui-column="content" data-ui-column-align="start">
        <strong>{conversation.name}</strong>
        <small>{conversation.kind} · {conversation.lastActivity}</small>
      </span>
      <span data-ui-column="meta" data-ui-column-align="end">
        <strong>{formatMb(conversation.messageMb + conversation.mediaMb)}</strong>
        <small>{formatMb(conversation.messageMb)} messages · {formatMb(conversation.mediaMb)} media</small>
      </span>
    </div>
  );
}

export function FilesSettingsSection({ state, setState }: SettingsOwnerProps) {
  const [query, setQuery] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [editId, setEditId] = useState('');
  const [refreshStatus, setRefreshStatus] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const rows = state.files.filter((file) => (
    (includeDeleted || !file.deleted)
    && `${file.name} ${file.bucket} ${file.mime}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  const editing = state.files.find((file) => file.id === editId);

  const updateFile = (fileId: string, change: (file: StoredFile) => StoredFile) => updateField(
    setState,
    'files',
    (files) => files.map((file) => file.id === fileId ? change(file) : file),
  );

  const downloadFile = (file: StoredFile) => {
    const url = URL.createObjectURL(new Blob([`Prototype content for ${file.name}`], { type: file.mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <SettingSection
        title="My Files"
        description="Files stored through the account object service."
        action={(
          <span className="mp-account-edit-actions">
            <Capability id="files.refresh">
              <Button
                size="small"
                aria-label="Refresh files"
                icon={<RefreshCw size={13} />}
                data-capability-action="files.refresh"
                onClick={() => setRefreshStatus('File list refreshed.')}
              />
            </Capability>
            <Capability id="files.upload">
              <Button
                size="small"
                type="primary"
                icon={<Upload size={13} />}
                data-capability-action="files.upload"
                onClick={() => uploadRef.current?.click()}
              >
                Upload
              </Button>
              <input
                ref={uploadRef}
                hidden
                type="file"
                aria-label="Choose file to upload"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const item: StoredFile = {
                    id: `file-${Date.now()}`,
                    name: file.name,
                    bucket: 'uploads',
                    mime: file.type || 'application/octet-stream',
                    sizeMb: Math.max(0.1, file.size / 1024 / 1024),
                    visibility: 'private',
                    deleted: false,
                  };
                  updateField(setState, 'files', (current) => [item, ...current]);
                  setUploadStatus(`${file.name} uploaded.`);
                  event.target.value = '';
                }}
              />
            </Capability>
          </span>
        )}
      >
        <Capability id="files.filter">
          <Input
            aria-label="Filter files"
            placeholder="Filter files"
            prefix={<Search size={13} />}
            data-capability-action="files.filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Capability>
        <SettingRow capability="files.deleted.include" label="Include deleted files">
          <SettingToggle
            label="Include deleted files"
            checked={includeDeleted}
            capability="files.deleted.include"
            onChange={setIncludeDeleted}
          />
        </SettingRow>
        {(uploadStatus || refreshStatus) && (
          <InlineStatus tone="success">{uploadStatus || refreshStatus}</InlineStatus>
        )}
        <div className="mp-files-list" data-ui-rows>
          {rows.map((file) => (
            <div key={file.id} className="mp-file-row" data-ui-row>
              <span data-ui-column="content" data-ui-column-align="start">
                <strong>{file.name}</strong>
                <small>{file.bucket} · {file.mime} · {formatMb(file.sizeMb)}</small>
              </span>
              <span className="mp-file-actions" data-ui-controls-align="end">
                <Capability id="files.visibility.edit">
                  <Button
                    size="small"
                    data-capability-action="files.visibility.edit"
                    onClick={() => setEditId(file.id)}
                  >
                    {file.visibility}
                  </Button>
                </Capability>
                {!file.deleted && (
                  <Capability id="files.download">
                    <Button
                      type="text"
                      size="small"
                      aria-label={`Download ${file.name}`}
                      data-capability-action="files.download"
                      icon={<Download size={14} />}
                      onClick={() => downloadFile(file)}
                    />
                  </Capability>
                )}
                {file.deleted ? (
                  <Capability id="files.restore">
                    <Button
                      type="text"
                      size="small"
                      data-capability-action="files.restore"
                      onClick={() => updateFile(file.id, (current) => ({ ...current, deleted: false }))}
                    >
                      Restore
                    </Button>
                  </Capability>
                ) : (
                  <Capability id="files.delete">
                    <Button
                      type="text"
                      size="small"
                      danger
                      aria-label={`Delete ${file.name}`}
                      data-capability-action="files.delete"
                      icon={<Trash2 size={14} />}
                      onClick={() => updateFile(file.id, (current) => ({ ...current, deleted: true }))}
                    />
                  </Capability>
                )}
              </span>
            </div>
          ))}
          {rows.length === 0 && <div className="mp-setting-empty">No matching files</div>}
        </div>
      </SettingSection>

      {editing && (
        <SettingSection title={`Visibility for ${editing.name}`}>
          <Choice
            capability="files.visibility.edit"
            label="File visibility"
            value={editing.visibility}
            onChange={(visibility) => {
              updateFile(editing.id, (file) => ({
                ...file,
                visibility: visibility as StoredFile['visibility'],
              }));
              setEditId('');
            }}
            options={[
              { value: 'private', label: 'Private' },
              { value: 'chat', label: 'Conversation' },
              { value: 'public', label: 'Public' },
            ]}
          />
        </SettingSection>
      )}
    </>
  );
}

export function LogsSettingsSection({ state, setState }: SettingsOwnerProps) {
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [levels, setLevels] = useState<Set<LogEntry['level']>>(
    () => new Set(['debug', 'info', 'warn', 'error']),
  );
  const filtered = state.logs.filter((entry) => (
    levels.has(entry.level)
    && `${entry.subsystem} ${entry.message}`.toLowerCase().includes(query.trim().toLowerCase())
  ));

  const exportLogs = () => {
    const content = filtered.map((entry) => (
      `${entry.time} ${entry.level.toUpperCase()} ${entry.subsystem}: ${entry.message}`
    )).join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'peers-touch-visible-logs.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const appendRefreshLog = () => updateField(setState, 'logs', (current) => [
    ...current,
    {
      id: `log-${Date.now()}`,
      level: 'info',
      subsystem: 'diagnostics',
      message: 'Manual refresh completed',
      time: 'Now',
    },
  ]);

  return (
    <SettingSection title="Runtime logs" description="Selected-only diagnostic surface.">
      <div className="mp-logs-toolbar">
        <Capability id="logs.filter" className="mp-logs-search-capability">
          <Input
            aria-label="Filter logs"
            placeholder="Filter logs"
            prefix={<Search size={13} />}
            data-capability-action="logs.filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Capability>
        <Capability id="logs.pause">
          <Button
            aria-label={paused ? 'Resume logs' : 'Pause logs'}
            data-capability-action="logs.pause"
            icon={paused ? <Play size={14} /> : <Pause size={14} />}
            onClick={() => setPaused((current) => !current)}
          />
        </Capability>
        <Capability id="logs.refresh">
          <Button
            aria-label="Refresh logs"
            data-capability-action="logs.refresh"
            icon={<RefreshCw size={14} />}
            disabled={paused}
            onClick={appendRefreshLog}
          />
        </Capability>
        <Capability id="logs.export">
          <Button
            aria-label="Export visible logs"
            data-capability-action="logs.export"
            icon={<Download size={14} />}
            onClick={exportLogs}
          />
        </Capability>
        <Capability id="logs.clear">
          <Button
            danger
            aria-label="Clear visible logs"
            data-capability-action="logs.clear"
            icon={<Trash2 size={14} />}
            onClick={() => updateField(setState, 'logs', [])}
          />
        </Capability>
      </div>

      <Capability id="logs.levels">
        <div className="mp-log-levels" role="group" aria-label="Log levels">
          {(['debug', 'info', 'warn', 'error'] as const).map((level) => (
            <Checkbox
              key={level}
              checked={levels.has(level)}
              data-capability-action="logs.levels"
              onChange={(event) => setLevels((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(level);
                else next.delete(level);
                return next;
              })}
            >
              {level}
            </Checkbox>
          ))}
        </div>
      </Capability>
      <SettingRow capability="logs.auto-follow" label="Follow new entries">
        <SettingToggle
          label="Follow new log entries"
          checked={state.toggles.logAutoFollow}
          capability="logs.auto-follow"
          onChange={(logAutoFollow) => updateField(setState, 'toggles', (current) => ({
            ...current,
            logAutoFollow,
          }))}
        />
      </SettingRow>

      <div className="mp-log-list" aria-live="polite">
        {filtered.map((entry) => (
          <div key={entry.id} className={`mp-log-row ${entry.level}`}>
            <span>{entry.time}</span>
            <strong>{entry.level}</strong>
            <span>{entry.subsystem}</span>
            <code>{entry.message}</code>
          </div>
        ))}
        {filtered.length === 0 && <div className="mp-setting-empty">No visible logs</div>}
      </div>
    </SettingSection>
  );
}
