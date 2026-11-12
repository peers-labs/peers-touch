/**
 * MyFilesSettings — owner-side file lifecycle inside Settings.
 *
 * Lists the actor's `oss_files` rows from the bound Station, with filters for
 * visibility / bucket / mime prefix / show-deleted, and inline owner-side
 * mutations (soft delete, restore inside the grace window, and a PATCH dialog
 * distinguishing leave / set / clear for the optional expiry).
 *
 * The Rust adapter invalidates the on-disk attachment cache after every
 * successful mutation, so the renderer doesn't have to. Blob-level concepts
 * (sha256 / refcount / backend) stay on the dashboard admin surface.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  ConfirmAction,
  DataTable,
  Dialog,
  Field,
  Icon,
  IconButton,
  Pagination,
  Segmented,
  Select,
  Switch,
  Tag,
  Text,
  TextField,
  Tooltip,
  type IconId,
  type TableColumn,
  type Tone,
} from '@peers-touch/ui';
import dayjs from 'dayjs';
import {
  api,
  type OssFileMeta,
  type OssListMyFilesQuery,
  type OssMyFilesResponse,
  type OssPatchFileBody,
  type OssVisibility,
} from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { SettingsContainer, SettingsPanelHeader } from './SettingsLayout';
import {
  notifyError,
  notifyInfo,
  notifySuccess,
  notifyWarning,
} from '../../ui/feedback';

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  if (!d.isValid()) return '—';
  return d.format('YYYY-MM-DD HH:mm');
}

function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = dayjs(iso);
  return d.isValid() ? d.format('YYYY-MM-DDTHH:mm:ss') : '';
}

function visibilityIconId(v: string): IconId {
  switch (v) {
    case 'public': return 'globe';
    case 'chat': return 'message-square';
    case 'private': return 'lock';
    default: return 'eye';
  }
}

function visibilityTone(v: string): Tone {
  switch (v) {
    case 'public': return 'info';
    case 'chat': return 'success';
    case 'private': return 'neutral';
    default: return 'warning';
  }
}

// ---------------------------------------------------------------------------
// Patch dialog
// ---------------------------------------------------------------------------

interface PatchDialogProps {
  file: OssFileMeta | null;
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

interface PatchFormState {
  visibility: OssVisibility | '';
  chat_session_id: string;
  bucket: string;
  filename: string;
  expires_mode: 'leave' | 'set' | 'clear';
  expires_at: string;
}

function defaultPatchState(file: OssFileMeta | null): PatchFormState {
  return {
    visibility: '',
    chat_session_id: file?.chat_session_id ?? '',
    bucket: '',
    filename: file?.name ?? '',
    expires_mode: 'leave',
    expires_at: toDateTimeLocal(file?.expires_at),
  };
}

function PatchDialog({ file, open, onClose, onSubmitted }: PatchDialogProps) {
  const { t } = useTranslation('settings');
  const [form, setForm] = useState<PatchFormState>(() => defaultPatchState(file));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(defaultPatchState(file));
    }
  }, [open, file]);

  if (!file) return null;

  const buildBody = (): OssPatchFileBody | null => {
    const body: OssPatchFileBody = {};
    if (form.visibility && form.visibility !== file.visibility) {
      body.visibility = form.visibility;
    }
    const chatSid = form.chat_session_id.trim();
    if (chatSid && chatSid !== (file.chat_session_id ?? '')) {
      body.chat_session_id = chatSid;
    }
    const bucketName = form.bucket.trim();
    if (bucketName) {
      body.bucket = bucketName;
    }
    const filename = form.filename.trim();
    if (filename && filename !== file.name) {
      body.filename = filename;
    }
    if (form.expires_mode === 'set' && form.expires_at) {
      body.expires_at = new Date(form.expires_at).toISOString();
    } else if (form.expires_mode === 'clear') {
      body.clear_expires_at = true;
    }
    return Object.keys(body).length === 0 ? null : body;
  };

  const onSubmit = useCallback(async () => {
    const body = buildBody();
    if (!body) {
      notifyInfo(t('settings.myFiles.message.noChanges'));
      return;
    }
    setSubmitting(true);
    try {
      const resp = await api.ossPatchFile(file.key, body);
      const changed = resp.fields_changed?.length ?? 0;
      if (resp.capability_version) {
        notifyWarning(t('settings.myFiles.message.updatedVisibility', { count: changed }));
      } else {
        notifySuccess(t('settings.myFiles.message.updated', { count: changed }));
      }
      onSubmitted();
      onClose();
    } catch (err) {
      log.error('oss', 'Patch failed', err);
      notifyError((err as Error)?.message || t('settings.myFiles.message.patchFailed'));
    } finally {
      setSubmitting(false);
    }
    // buildBody is intentionally invoked inside the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, form, onClose, onSubmitted, t]);

  const visibilityOptions = [
    {
      label: t('settings.myFiles.edit.keepVisibility', {
        value: t(`settings.myFiles.visibility.${file.visibility}`),
      }),
      value: file.visibility,
    },
    ...(['public', 'chat', 'private'] as const).map((value) => ({
      label: t(`settings.myFiles.visibility.${value}`),
      value,
    })),
  ];

  const showChatField = form.visibility === 'chat'
    || (!form.visibility && file.visibility === 'chat');

  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      title={(
        <span className="sc-myfiles-dialog-title">
          <Icon iconId="pencil-line" size={16} />
          <span>{t('settings.myFiles.edit.title')}</span>
        </span>
      )}
      width={520}
      footer={(
        <Button
          actionId="myfiles-patch-apply"
          emphasis="primary"
          execution={submitting ? 'pending' : 'idle'}
          label={t('settings.myFiles.action.apply')}
          onActivate={() => void onSubmit()}
        />
      )}
    >
      <div className="sc-myfiles-form">
        <Field label={t('settings.myFiles.field.filename')}>
          <TextField
            value={form.filename}
            placeholder={file.name}
            onValueChange={(value) => setForm({ ...form, filename: value })}
          />
        </Field>

        <Field
          label={t('settings.myFiles.field.visibility')}
          description={t('settings.myFiles.edit.visibilityHint')}
        >
          <Select
            value={form.visibility || file.visibility}
            options={visibilityOptions}
            onValueChange={(value) => {
              if (typeof value === 'string') {
                setForm({ ...form, visibility: value as OssVisibility });
              }
            }}
          />
        </Field>

        {showChatField && (
          <Field
            label={t('settings.myFiles.field.chatSessionId')}
            description={t('settings.myFiles.edit.chatSessionHint')}
          >
            <TextField
              value={form.chat_session_id}
              placeholder={file.chat_session_id ?? t('settings.myFiles.placeholder.sessionId')}
              onValueChange={(value) => setForm({ ...form, chat_session_id: value })}
            />
          </Field>
        )}

        <Field
          label={t('settings.myFiles.edit.moveBucket')}
          description={t('settings.myFiles.edit.moveBucketHint')}
        >
          <TextField
            value={form.bucket}
            placeholder={t('settings.myFiles.placeholder.unchanged')}
            onValueChange={(value) => setForm({ ...form, bucket: value })}
          />
        </Field>

        <Field label={t('settings.myFiles.field.expiry')}>
          <div className="sc-myfiles-expiry">
            <Segmented<PatchFormState['expires_mode']>
              density="compact"
              value={form.expires_mode}
              onValueChange={(value) => {
                if (value === 'leave' || value === 'set' || value === 'clear') {
                  setForm({ ...form, expires_mode: value });
                }
              }}
              options={[
                { label: t('settings.myFiles.edit.expiryKeep'), value: 'leave' },
                { label: t('settings.myFiles.edit.expirySet'), value: 'set' },
                { label: t('settings.myFiles.edit.expiryClear'), value: 'clear' },
              ]}
            />
            {form.expires_mode === 'set' && (
              <TextField
                type="datetime-local"
                value={form.expires_at}
                onValueChange={(value) => setForm({ ...form, expires_at: value })}
              />
            )}
            {form.expires_mode === 'clear' && (
              <p className="sk-field-hint">
                {t('settings.myFiles.edit.expiryClearHint')}
              </p>
            )}
            {form.expires_mode === 'leave' && file.expires_at && (
              <p className="sk-field-hint">
                {t('settings.myFiles.edit.expiryCurrent', {
                  value: formatTime(file.expires_at),
                })}
              </p>
            )}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Upload dialog
// ---------------------------------------------------------------------------

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
  defaultBucket?: string;
}

function UploadDialog({ open, onClose, onUploaded, defaultBucket }: UploadDialogProps) {
  const { t } = useTranslation('settings');
  const [filePath, setFilePath] = useState<string>('');
  const [bucket, setBucket] = useState<string>(defaultBucket ?? 'attachments');
  const [visibility, setVisibility] = useState<OssVisibility>('private');
  const [chatSessionID, setChatSessionID] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const onPick = useCallback(async () => {
    try {
      const path = await api.ossPickLocalFile();
      if (path) {
        setFilePath(path);
      }
    } catch {
      // User cancelled the native dialog — silent abort.
    }
  }, []);

  const fileLabel = useMemo(() => {
    if (!filePath) return t('settings.myFiles.upload.noFileChosen');
    const sep = filePath.includes('/') ? '/' : '\\';
    return filePath.split(sep).pop() || filePath;
  }, [filePath, t]);

  const onSubmit = useCallback(async () => {
    if (!filePath) {
      notifyWarning(t('settings.myFiles.message.pickFileFirst'));
      return;
    }
    if (!bucket.trim()) {
      notifyWarning(t('settings.myFiles.message.bucketRequired'));
      return;
    }
    if (visibility === 'chat' && !chatSessionID.trim()) {
      notifyWarning(t('settings.myFiles.message.chatSessionRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const resp = await api.ossUploadLocalFile({
        file_path: filePath,
        bucket: bucket.trim(),
        visibility,
        chat_session_id: visibility === 'chat' ? chatSessionID.trim() : null,
      });
      if (!resp) {
        notifyError(t('settings.myFiles.message.uploadFailed'));
        return;
      }
      notifySuccess(t('settings.myFiles.message.uploaded', {
        filename: resp.filename,
        size: (resp.size / 1024).toFixed(1),
      }));
      onUploaded();
      onClose();
    } catch (err) {
      log.error('oss', 'Upload failed', err);
      notifyError((err as Error)?.message || t('settings.myFiles.message.uploadFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [filePath, bucket, visibility, chatSessionID, onUploaded, onClose, t]);

  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      title={(
        <span className="sc-myfiles-dialog-title">
          <Icon iconId="upload" size={16} />
          <span>{t('settings.myFiles.upload.title')}</span>
        </span>
      )}
      width={520}
      footer={(
        <Button
          actionId="myfiles-upload-submit"
          emphasis="primary"
          execution={submitting ? 'pending' : 'idle'}
          label={t('settings.myFiles.action.upload')}
          availability={(!filePath || !bucket.trim())
            ? { kind: 'disabled', reason: t('settings.myFiles.action.upload') }
            : undefined}
          onActivate={() => void onSubmit()}
        />
      )}
    >
      <div className="sc-myfiles-form">
        <Field label={t('settings.myFiles.field.file')}>
          <div className="sc-myfiles-pick">
            <Button
              actionId="myfiles-choose-file"
              leading={<Icon iconId="upload" size={14} />}
              label={t('settings.myFiles.action.chooseFile')}
              onActivate={() => void onPick()}
            />
            <Tooltip label={filePath}>
              <Text tone={filePath ? 'primary' : 'secondary'} truncate className="sc-myfiles-pick__label">
                {fileLabel}
              </Text>
            </Tooltip>
          </div>
        </Field>

        <Field
          label={t('settings.myFiles.field.bucket')}
          description={t('settings.myFiles.upload.bucketHint')}
        >
          <TextField
            value={bucket}
            placeholder={t('settings.myFiles.placeholder.bucketExamples')}
            onValueChange={setBucket}
          />
        </Field>

        <Field
          label={t('settings.myFiles.field.visibility')}
          description={t('settings.myFiles.upload.visibilityHint')}
        >
          <Segmented<OssVisibility>
            value={visibility}
            onValueChange={(value) => {
              if (value === 'private' || value === 'chat' || value === 'public') {
                setVisibility(value);
              }
            }}
            options={[
              { label: t('settings.myFiles.visibility.private'), value: 'private' },
              { label: t('settings.myFiles.visibility.chat'), value: 'chat' },
              { label: t('settings.myFiles.visibility.public'), value: 'public' },
            ]}
          />
        </Field>

        {visibility === 'chat' && (
          <Field
            label={t('settings.myFiles.field.chatSessionId')}
            description={t('settings.myFiles.upload.chatSessionHint')}
          >
            <TextField
              value={chatSessionID}
              placeholder={t('settings.myFiles.placeholder.sessionId')}
              onValueChange={setChatSessionID}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

type VisibilityFilter = 'all' | OssVisibility;

export function MyFilesSettings() {
  const { t } = useTranslation('settings');
  const [data, setData] = useState<OssMyFilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [bucketFilter, setBucketFilter] = useState('');
  const [mimeFilter, setMimeFilter] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<OssFileMeta | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const buildQuery = useCallback((): OssListMyFilesQuery => ({
    bucket: bucketFilter.trim() || undefined,
    mime: mimeFilter.trim() || undefined,
    visibility: visibilityFilter === 'all' ? undefined : visibilityFilter,
    include_deleted: includeDeleted,
    page,
    page_size: PAGE_SIZE,
  }), [bucketFilter, mimeFilter, visibilityFilter, includeDeleted, page]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api.ossListMyFiles(buildQuery());
      setData(resp);
    } catch (err) {
      log.error('oss', 'Failed to list my files', err);
      notifyError((err as Error)?.message || t('settings.myFiles.message.listFailed'));
    } finally {
      setLoading(false);
    }
  }, [buildQuery, t]);

  useEffect(() => { void load(); }, [load]);

  const onDelete = useCallback(async (file: OssFileMeta) => {
    setBusyKey(file.key);
    try {
      await api.ossDeleteFile(file.key);
      notifySuccess(t('settings.myFiles.message.deleted'));
      await load();
    } catch (err) {
      log.error('oss', 'Delete failed', err);
      notifyError((err as Error)?.message || t('settings.myFiles.message.deleteFailed'));
    } finally {
      setBusyKey(null);
    }
  }, [load, t]);

  const onRestore = useCallback(async (file: OssFileMeta) => {
    setBusyKey(file.key);
    try {
      await api.ossRestoreFile(file.key);
      notifySuccess(t('settings.myFiles.message.restored'));
      await load();
    } catch (err) {
      log.error('oss', 'Restore failed', err);
      notifyError((err as Error)?.message || t('settings.myFiles.message.restoreFailed'));
    } finally {
      setBusyKey(null);
    }
  }, [load, t]);

  const items = data?.files ?? [];
  const total = data?.total ?? 0;
  const tombstoneCount = useMemo(
    () => items.filter((f) => Boolean(f.deleted_at)).length,
    [items],
  );

  const columns: TableColumn<OssFileMeta>[] = [
    {
      id: 'name',
      label: t('settings.myFiles.column.name'),
      renderCell: (row) => (
        <span className="sc-myfiles-name">
          <Tooltip label={row.name}>
            <Text strong truncate className="sc-myfiles-name__primary">
              {row.name || t('settings.myFiles.unnamed')}
            </Text>
          </Tooltip>
          <Tooltip label={t('settings.myFiles.key', { value: row.key })}>
            <Text tone="muted" className="sc-myfiles-name__detail">
              {row.mime || 'application/octet-stream'}
            </Text>
          </Tooltip>
        </span>
      ),
    },
    {
      id: 'visibility',
      label: t('settings.myFiles.column.visibility'),
      width: 120,
      renderCell: (row) => (
        <Tag tone={visibilityTone(row.visibility)} leading={<Icon iconId={visibilityIconId(row.visibility)} size={11} />}>
          {t(`settings.myFiles.visibility.${row.visibility}`, { defaultValue: row.visibility })}
        </Tag>
      ),
    },
    {
      id: 'size',
      label: t('settings.myFiles.column.size'),
      width: 100,
      align: 'right',
      compare: (a, b) => a.size - b.size,
      renderCell: (row) => <Text>{formatBytes(row.size)}</Text>,
    },
    {
      id: 'expires_at',
      label: t('settings.myFiles.column.expires'),
      width: 160,
      renderCell: (row) => row.expires_at ? (
        <Text tone={dayjs(row.expires_at).isBefore(dayjs()) ? 'danger' : 'primary'}>
          {formatTime(row.expires_at)}
        </Text>
      ) : (
        <Text tone="muted">—</Text>
      ),
    },
    {
      id: 'updated_at',
      label: t('settings.myFiles.column.updated'),
      width: 160,
      compare: (a, b) => dayjs(a.updated_at).valueOf() - dayjs(b.updated_at).valueOf(),
      renderCell: (row) => <Text tone="muted">{formatTime(row.updated_at)}</Text>,
    },
    {
      id: 'state',
      label: t('settings.myFiles.column.state'),
      width: 110,
      renderCell: (row) => (
        <Tag tone={row.deleted_at ? 'danger' : 'success'}>
          {row.deleted_at
            ? t('settings.myFiles.state.deleted')
            : t('settings.myFiles.state.live')}
        </Tag>
      ),
    },
    {
      id: 'actions',
      label: t('settings.myFiles.column.actions'),
      width: 220,
      align: 'right',
      renderCell: (file) => {
        const busy = busyKey === file.key;
        return (
          <span className="sc-myfiles-row-actions">
            {file.deleted_at ? (
              <IconButton
                actionId={`myfiles-restore-${file.key}`}
                iconId="rotate-ccw"
                iconSize={14}
                density="compact"
                label={t('settings.myFiles.action.restore')}
                availability={busy ? { kind: 'disabled', reason: '' } : undefined}
                onActivate={() => void onRestore(file)}
              />
            ) : (
              <>
                <IconButton
                  actionId={`myfiles-edit-${file.key}`}
                  iconId="pencil-line"
                  iconSize={14}
                  density="compact"
                  label={t('settings.myFiles.action.edit')}
                  availability={busy ? { kind: 'disabled', reason: '' } : undefined}
                  onActivate={() => setEditTarget(file)}
                />
                <ConfirmAction
                  actionId={`myfiles-delete-${file.key}`}
                  title={t('settings.myFiles.delete.confirmTitle')}
                  description={t('settings.myFiles.delete.confirmDescription')}
                  confirmLabel={t('settings.myFiles.action.delete')}
                  cancelLabel={t('settings.myFiles.action.cancel')}
                  onConfirm={() => onDelete(file)}
                >
                  <IconButton
                    actionId={`myfiles-delete-trigger-${file.key}`}
                    iconId="delete"
                    iconSize={14}
                    density="compact"
                    className="sc-myfiles-row-actions__danger"
                    label={t('settings.myFiles.action.delete')}
                    availability={busy ? { kind: 'disabled', reason: '' } : undefined}
                  />
                </ConfirmAction>
              </>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <SettingsContainer fullHeight tier="wide">
      <SettingsPanelHeader
        title={t('settings.myFiles.title')}
        icon={<Icon iconId="folder-open" size={20} />}
        actions={(
          <span className="sc-myfiles-header-actions">
            <Button
              actionId="myfiles-upload-open"
              emphasis="primary"
              density="compact"
              leading={<Icon iconId="upload" size={14} />}
              label={t('settings.myFiles.action.upload')}
              onActivate={() => setUploadOpen(true)}
            />
            <Button
              actionId="myfiles-refresh"
              density="compact"
              leading={<Icon iconId="refresh-cw" size={14} />}
              execution={loading ? 'pending' : 'idle'}
              label={t('settings.myFiles.action.refresh')}
              onActivate={() => void load()}
            />
          </span>
        )}
      />

      <div className="sc-myfiles-filters">
        <Field label={t('settings.myFiles.filter.bucket')}>
          <TextField
            clearable
            value={bucketFilter}
            placeholder={t('settings.myFiles.placeholder.any')}
            onValueChange={(value) => { setPage(1); setBucketFilter(value); }}
          />
        </Field>
        <Field label={t('settings.myFiles.filter.mimePrefix')}>
          <TextField
            clearable
            value={mimeFilter}
            placeholder={t('settings.myFiles.placeholder.mimePrefix')}
            onValueChange={(value) => { setPage(1); setMimeFilter(value); }}
          />
        </Field>
        <Field label={t('settings.myFiles.field.visibility')}>
          <Segmented<VisibilityFilter>
            density="compact"
            value={visibilityFilter}
            onValueChange={(value) => {
              if (typeof value === 'string') {
                setPage(1);
                setVisibilityFilter(value as VisibilityFilter);
              }
            }}
            options={[
              { label: t('settings.myFiles.visibility.all'), value: 'all' },
              { label: t('settings.myFiles.visibility.public'), value: 'public' },
              { label: t('settings.myFiles.visibility.chat'), value: 'chat' },
              { label: t('settings.myFiles.visibility.private'), value: 'private' },
            ]}
          />
        </Field>
        <Field label={t('settings.myFiles.filter.includeDeleted')}>
          <Switch
            checked={includeDeleted}
            onCheckedChange={(value) => { setPage(1); setIncludeDeleted(value); }}
          />
        </Field>
      </div>

      {includeDeleted && tombstoneCount > 0 ? (
        <Alert
          tone="warning"
          icon={<Icon iconId="warning" size={14} />}
          title={t('settings.myFiles.tombstonesOnPage', { count: tombstoneCount })}
          description={t('settings.myFiles.tombstonesDescription')}
        />
      ) : null}

      <div className="sc-myfiles-table">
        <DataTable
          rows={items}
          columns={columns}
          rowKey="id"
          loading={loading}
          emptyLabel={loading
            ? t('settings.myFiles.loading')
            : t('settings.myFiles.empty')}
        />
        {total > PAGE_SIZE ? (
          <div className="sc-myfiles-pagination">
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </div>
        ) : null}
      </div>

      <PatchDialog
        file={editTarget}
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        onSubmitted={load}
      />

      {uploadOpen && (
        <UploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUploaded={load}
          defaultBucket={bucketFilter.trim() || 'attachments'}
        />
      )}
    </SettingsContainer>
  );
}

export default MyFilesSettings;
