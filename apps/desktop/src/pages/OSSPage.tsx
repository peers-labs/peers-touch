/**
 * OSSPage — the user's own files surface.
 *
 * Lists the actor's `oss_files` rows from the bound Station, with
 * filters for visibility / bucket / mime prefix / show-deleted, and
 * inline owner-side mutations:
 *
 *   - DELETE  → soft-delete; the row goes into the restore window.
 *   - RESTORE → reverses a soft-delete inside the grace window. The
 *                grace window is enforced server-side; the UI only
 *                surfaces the action when `deleted_at` is non-null.
 *   - PATCH   → edit visibility / chat-session / TTL / filename.
 *                The dialog distinguishes "no change", "set value",
 *                and "clear value" for `expires_at`, which the
 *                station treats as three different intents.
 *
 * The Rust adapter invalidates the on-disk attachment cache after
 * every successful mutation, so the renderer doesn't have to.
 *
 * We intentionally do NOT expose blob-level concepts (sha256 / blob
 * refcount / backend) in the table. Those belong on the dashboard
 * admin surface; the user's MyFiles view is about *their* files,
 * not the storage primitives that back them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Card, DatePicker, Empty, Form, Input as AntdInput,
  message, Modal, Pagination, Popconfirm, Segmented, Select, Space,
  Switch, Table, Tag, Tooltip, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import {
  AlertTriangle, Eye, FolderOpen, Globe, Lock, MessageSquare, Pencil,
  RefreshCw, RotateCcw, Trash2, Upload as UploadIcon,
} from 'lucide-react';
import dayjs, { type Dayjs } from 'dayjs';
import { PageHeader } from '../components/PageHeader';
import {
  api, type OssFileMeta, type OssListMyFilesQuery, type OssMyFilesResponse,
  type OssPatchFileBody, type OssVisibility,
} from '../services/desktop_api';
import { log } from '../utils/logger';

const { Text } = Typography;

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

function visibilityIcon(v: string) {
  switch (v) {
    case 'public':  return <Globe size={12} />;
    case 'chat':    return <MessageSquare size={12} />;
    case 'private': return <Lock size={12} />;
    default:        return <Eye size={12} />;
  }
}

function visibilityColor(v: string): string {
  switch (v) {
    case 'public':  return 'blue';
    case 'chat':    return 'cyan';
    case 'private': return 'default';
    default:        return 'orange';
  }
}

const VISIBILITY_OPTIONS: { label: string; value: OssVisibility }[] = [
  { label: 'public',  value: 'public' },
  { label: 'chat',    value: 'chat' },
  { label: 'private', value: 'private' },
];

const PAGE_SIZE = 25;

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
  /**
   * Three-state:
   *   - `'leave'` → omit from PATCH (server keeps current).
   *   - `'set'`   → send `expires_at` from the picker.
   *   - `'clear'` → send `clear_expires_at: true` (NULL the column).
   */
  expires_mode: 'leave' | 'set' | 'clear';
  expires_at: Dayjs | null;
}

function defaultPatchState(file: OssFileMeta | null): PatchFormState {
  return {
    visibility: '',
    chat_session_id: file?.chat_session_id ?? '',
    bucket: '',
    filename: file?.name ?? '',
    expires_mode: 'leave',
    expires_at: file?.expires_at ? dayjs(file.expires_at) : null,
  };
}

function PatchDialog({ file, open, onClose, onSubmitted }: PatchDialogProps) {
  const [form, setForm] = useState<PatchFormState>(() => defaultPatchState(file));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(defaultPatchState(file));
    }
  }, [open, file]);

  if (!file) return null;

  // Build the body the server sees. Empty strings collapse to
  // "no change" rather than "clear" — we don't ship the empty
  // string sentinel to the server because the column types are
  // not nullable for filename / chat_session_id.
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
      body.expires_at = form.expires_at.toISOString();
    } else if (form.expires_mode === 'clear') {
      body.clear_expires_at = true;
    }
    return Object.keys(body).length === 0 ? null : body;
  };

  const onSubmit = useCallback(async () => {
    const body = buildBody();
    if (!body) {
      message.info('No changes to apply');
      return;
    }
    setSubmitting(true);
    try {
      const resp = await api.ossPatchFile(file.key, body);
      const changed = resp.fields_changed?.length ?? 0;
      if (resp.capability_version) {
        message.warning(
          `Updated ${changed} field${changed === 1 ? '' : 's'}. Visibility tightened — peers will refresh capabilities.`,
        );
      } else {
        message.success(`Updated ${changed} field${changed === 1 ? '' : 's'}.`);
      }
      onSubmitted();
      onClose();
    } catch (err) {
      log.error('oss', 'Patch failed', err);
      message.error((err as Error)?.message || 'Patch failed');
    } finally {
      setSubmitting(false);
    }
    // buildBody is intentionally invoked inside the closure; lint
    // exemption because PatchFormState is captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, form, onClose, onSubmitted]);

  return (
    <Modal
      open={open}
      title={
        <Flexbox horizontal gap={8} align="center">
          <Pencil size={16} />
          <span>Edit file</span>
        </Flexbox>
      }
      onCancel={onClose}
      onOk={onSubmit}
      okButtonProps={{ loading: submitting }}
      okText="Apply"
      destroyOnHidden
    >
      <Form layout="vertical" component="div" size="middle">
        <Form.Item label="Filename">
          <AntdInput
            value={form.filename}
            placeholder={file.name}
            onChange={(e) => setForm({ ...form, filename: e.target.value })}
          />
        </Form.Item>

        <Form.Item label="Visibility" extra="Tightening visibility forces peers to refresh capabilities.">
          <Select
            value={form.visibility || file.visibility}
            options={[
              { label: `keep (${file.visibility})`, value: file.visibility },
              ...VISIBILITY_OPTIONS,
            ]}
            onChange={(v) => setForm({ ...form, visibility: v as OssVisibility })}
          />
        </Form.Item>

        {(form.visibility === 'chat' || (!form.visibility && file.visibility === 'chat')) && (
          <Form.Item
            label="Chat session ID"
            extra="Required when visibility is chat. Members of this session can fetch the bytes."
          >
            <AntdInput
              value={form.chat_session_id}
              placeholder={file.chat_session_id ?? 'session ULID'}
              onChange={(e) => setForm({ ...form, chat_session_id: e.target.value })}
            />
          </Form.Item>
        )}

        <Form.Item label="Move to bucket" extra="Leave empty to keep the current bucket. Use the bucket name (e.g. `attachments`).">
          <AntdInput
            value={form.bucket}
            placeholder="(unchanged)"
            onChange={(e) => setForm({ ...form, bucket: e.target.value })}
          />
        </Form.Item>

        <Form.Item label="Expiry">
          <Flexbox gap={8}>
            <Segmented
              value={form.expires_mode}
              onChange={(v) => setForm({ ...form, expires_mode: v as PatchFormState['expires_mode'] })}
              options={[
                { label: 'Keep', value: 'leave' },
                { label: 'Set', value: 'set' },
                { label: 'Clear', value: 'clear' },
              ]}
            />
            {form.expires_mode === 'set' && (
              <DatePicker
                showTime
                value={form.expires_at}
                onChange={(d) => setForm({ ...form, expires_at: d })}
                style={{ width: '100%' }}
              />
            )}
            {form.expires_mode === 'clear' && (
              <Text type="secondary">Will null out the current `expires_at`.</Text>
            )}
            {form.expires_mode === 'leave' && file.expires_at && (
              <Text type="secondary">Current: {formatTime(file.expires_at)}</Text>
            )}
          </Flexbox>
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Upload dialog
// ---------------------------------------------------------------------------

/**
 * UploadDialog — picks a file via the native dialog (Tauri side
 * already exposes `pick_chat_attachment`, which returns the absolute
 * path on success or rejects on cancel) and pushes it through the
 * shared `chat_upload_attachment` command. We re-use that command
 * because the Station endpoint (`/sub-oss/upload`) is identical for
 * "uploaded from chat" and "uploaded standalone" — the only thing
 * that changes is how we tell it to scope the file:
 *
 *   - `visibility = 'private'` (default) → only the owner can fetch.
 *   - `visibility = 'public'`            → discoverable by any peer.
 *   - `visibility = 'chat'`              → REQUIRES `chat_session_id`;
 *                                          the Station validates
 *                                          membership at fetch time.
 *
 * The Rust adapter already tags the upload with the right metadata
 * and bumps `oss_blobs.ref_count`, so all this dialog has to do is
 * collect the form, invoke, and refresh the listing on success.
 */
interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
  defaultBucket?: string;
}

function UploadDialog({ open, onClose, onUploaded, defaultBucket }: UploadDialogProps) {
  // The parent gates this component's mount on `open`, so the
  // `useState` defaults below double as the per-session reset
  // (each "Upload" click yields a fresh component instance). This
  // avoids a `useEffect`-based reset and the "setState in effect"
  // lint that comes with it.
  const [filePath, setFilePath] = useState<string>('');
  const [bucket, setBucket] = useState<string>(defaultBucket ?? 'attachments');
  const [visibility, setVisibility] = useState<OssVisibility>('private');
  const [chatSessionID, setChatSessionID] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const onPick = useCallback(async () => {
    try {
      const path = await api.pickChatAttachment();
      if (path) {
        setFilePath(path);
      }
    } catch {
      // User cancelled the native dialog — silent abort.
    }
  }, []);

  const fileLabel = useMemo(() => {
    if (!filePath) return '(no file chosen)';
    const sep = filePath.includes('/') ? '/' : '\\';
    return filePath.split(sep).pop() || filePath;
  }, [filePath]);

  const onSubmit = useCallback(async () => {
    if (!filePath) {
      message.warning('Pick a file first');
      return;
    }
    if (!bucket.trim()) {
      message.warning('Bucket name is required');
      return;
    }
    if (visibility === 'chat' && !chatSessionID.trim()) {
      message.warning('chat_session_id is required when visibility is chat');
      return;
    }
    setSubmitting(true);
    try {
      const resp = await api.chatUploadAttachment({
        file_path: filePath,
        bucket: bucket.trim(),
        visibility,
        chat_session_id: visibility === 'chat' ? chatSessionID.trim() : null,
      });
      if (!resp) {
        message.error('Upload failed');
        return;
      }
      message.success(`Uploaded "${resp.filename}" (${(resp.size / 1024).toFixed(1)} KB)`);
      onUploaded();
      onClose();
    } catch (err) {
      log.error('oss', 'Upload failed', err);
      message.error((err as Error)?.message || 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  }, [filePath, bucket, visibility, chatSessionID, onUploaded, onClose]);

  return (
    <Modal
      open={open}
      title={
        <Flexbox horizontal gap={8} align="center">
          <UploadIcon size={16} />
          <span>Upload to OSS</span>
        </Flexbox>
      }
      onCancel={onClose}
      onOk={onSubmit}
      okButtonProps={{ loading: submitting, disabled: !filePath || !bucket.trim() }}
      okText="Upload"
      destroyOnHidden
    >
      <Form layout="vertical" component="div" size="middle">
        <Form.Item label="File">
          <Flexbox horizontal gap={8} align="center">
            <Button icon={<UploadIcon size={14} />} onClick={onPick}>
              Choose file
            </Button>
            <Tooltip title={filePath || ''}>
              <Text
                type={filePath ? undefined : 'secondary'}
                style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {fileLabel}
              </Text>
            </Tooltip>
          </Flexbox>
        </Form.Item>

        <Form.Item
          label="Bucket"
          extra="The Station auto-creates user-kind buckets the first time you upload to them."
        >
          <AntdInput
            value={bucket}
            onChange={(e) => setBucket(e.target.value)}
            placeholder="e.g. attachments, photos, archive"
          />
        </Form.Item>

        <Form.Item
          label="Visibility"
          extra="`chat` scopes the file to a single chat session. `public` makes it readable by any peer."
        >
          <Segmented
            value={visibility}
            onChange={(v) => setVisibility(v as OssVisibility)}
            options={[
              { label: 'Private', value: 'private' },
              { label: 'Chat',    value: 'chat' },
              { label: 'Public',  value: 'public' },
            ]}
          />
        </Form.Item>

        {visibility === 'chat' && (
          <Form.Item
            label="Chat session ID"
            extra="ULID of the conversation the file belongs to. Members of that session can fetch the bytes; non-members cannot."
          >
            <AntdInput
              value={chatSessionID}
              onChange={(e) => setChatSessionID(e.target.value)}
              placeholder="session ULID"
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export function OSSPage() {
  const [data, setData] = useState<OssMyFilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [bucketFilter, setBucketFilter] = useState('');
  const [mimeFilter, setMimeFilter] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | OssVisibility>('all');
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
      message.error((err as Error)?.message || 'Failed to list files');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { load(); }, [load]);

  const onDelete = useCallback(async (file: OssFileMeta) => {
    setBusyKey(file.key);
    try {
      await api.ossDeleteFile(file.key);
      message.success('Deleted (within restore window)');
      await load();
    } catch (err) {
      log.error('oss', 'Delete failed', err);
      message.error((err as Error)?.message || 'Delete failed');
    } finally {
      setBusyKey(null);
    }
  }, [load]);

  const onRestore = useCallback(async (file: OssFileMeta) => {
    setBusyKey(file.key);
    try {
      await api.ossRestoreFile(file.key);
      message.success('Restored');
      await load();
    } catch (err) {
      log.error('oss', 'Restore failed', err);
      message.error((err as Error)?.message || 'Restore failed (window expired?)');
    } finally {
      setBusyKey(null);
    }
  }, [load]);

  const items = data?.files ?? [];
  const total = data?.total ?? 0;
  const tombstoneCount = useMemo(
    () => items.filter((f) => !!f.deleted_at).length,
    [items],
  );

  const columns: ColumnsType<OssFileMeta> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      ellipsis: { showTitle: false },
      render: (v: string, r) => (
        <Flexbox>
          <Tooltip title={v}>
            <Text strong style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {v || '(unnamed)'}
            </Text>
          </Tooltip>
          <Tooltip title={`key: ${r.key}`}>
            <Text type="secondary" style={{ fontSize: 12 }}>{r.mime || 'application/octet-stream'}</Text>
          </Tooltip>
        </Flexbox>
      ),
    },
    {
      title: 'Visibility',
      dataIndex: 'visibility',
      key: 'visibility',
      width: 110,
      render: (v: string) => (
        <Tag color={visibilityColor(v)} icon={visibilityIcon(v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {v}
        </Tag>
      ),
    },
    {
      title: 'Size',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      align: 'right',
      sorter: (a, b) => a.size - b.size,
      render: (v: number) => <Text>{formatBytes(v)}</Text>,
    },
    {
      title: 'Expires',
      dataIndex: 'expires_at',
      key: 'expires_at',
      width: 160,
      render: (v: string | null | undefined) => v
        ? <Text type={dayjs(v).isBefore(dayjs()) ? 'danger' : undefined}>{formatTime(v)}</Text>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Updated',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 160,
      render: (v: string) => <Text type="secondary">{formatTime(v)}</Text>,
      sorter: (a, b) => dayjs(a.updated_at).valueOf() - dayjs(b.updated_at).valueOf(),
    },
    {
      title: 'State',
      key: 'state',
      width: 110,
      render: (_, r) => r.deleted_at
        ? <Badge status="error" text="deleted" />
        : <Badge status="success" text="live" />,
      filters: [
        { text: 'Live', value: 'live' },
        { text: 'Deleted', value: 'deleted' },
      ],
      onFilter: (value, record) => (value === 'deleted' ? !!record.deleted_at : !record.deleted_at),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 220,
      align: 'right',
      render: (_, file) => {
        const busy = busyKey === file.key;
        return (
          <Space size={4}>
            {file.deleted_at ? (
              <Button
                size="small"
                icon={<RotateCcw size={14} />}
                disabled={busy}
                onClick={() => onRestore(file)}
              >
                Restore
              </Button>
            ) : (
              <>
                <Button
                  size="small"
                  icon={<Pencil size={14} />}
                  disabled={busy}
                  onClick={() => setEditTarget(file)}
                >
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this file?"
                  description="Soft-deleted; can be restored within the grace window. After the window expires, the bytes are GC'd."
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => onDelete(file)}
                >
                  <Button
                    size="small"
                    danger
                    icon={<Trash2 size={14} />}
                    disabled={busy}
                  >
                    Delete
                  </Button>
                </Popconfirm>
              </>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
      <PageHeader
        title="My files"
        subtitle="Files you have uploaded to your station's OSS"
        icon={<FolderOpen size={20} />}
        extra={
          <Space>
            <Button
              type="primary"
              icon={<UploadIcon size={14} />}
              onClick={() => setUploadOpen(true)}
              size="small"
            >
              Upload
            </Button>
            <Button icon={<RefreshCw size={14} />} onClick={load} loading={loading} size="small">
              Refresh
            </Button>
          </Space>
        }
      />

      <Flexbox gap={12} style={{ padding: 16, overflow: 'auto', flex: 1 }}>
        <Card>
          <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
            <Flexbox gap={4} style={{ minWidth: 180 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>Bucket name</Text>
              <AntdInput
                value={bucketFilter}
                placeholder="(any)"
                onChange={(e) => { setPage(1); setBucketFilter(e.target.value); }}
                allowClear
              />
            </Flexbox>
            <Flexbox gap={4} style={{ minWidth: 200 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>MIME prefix</Text>
              <AntdInput
                value={mimeFilter}
                placeholder="image/  •  application/pdf"
                onChange={(e) => { setPage(1); setMimeFilter(e.target.value); }}
                allowClear
              />
            </Flexbox>
            <Flexbox gap={4}>
              <Text type="secondary" style={{ fontSize: 12 }}>Visibility</Text>
              <Segmented
                value={visibilityFilter}
                onChange={(v) => { setPage(1); setVisibilityFilter(v as typeof visibilityFilter); }}
                options={[
                  { label: 'All', value: 'all' },
                  { label: 'Public', value: 'public' },
                  { label: 'Chat', value: 'chat' },
                  { label: 'Private', value: 'private' },
                ]}
              />
            </Flexbox>
            <Flexbox gap={4}>
              <Text type="secondary" style={{ fontSize: 12 }}>Include deleted</Text>
              <Switch
                checked={includeDeleted}
                onChange={(v) => { setPage(1); setIncludeDeleted(v); }}
              />
            </Flexbox>
          </Flexbox>
        </Card>

        {includeDeleted && tombstoneCount > 0 ? (
          <Alert
            type="warning"
            showIcon
            icon={<AlertTriangle size={14} />}
            message={`${tombstoneCount} tombstone${tombstoneCount === 1 ? '' : 's'} on this page`}
            description="Tombstones can be restored until the grace window expires. After that the bytes are eligible for GC."
          />
        ) : null}

        <Card styles={{ body: { padding: 0 } }}>
          <Table
            dataSource={items}
            columns={columns}
            rowKey="id"
            size="small"
            loading={loading}
            pagination={false}
            locale={{
              emptyText: loading
                ? 'Loading…'
                : <Empty description="No files match these filters" />,
            }}
          />
          {total > PAGE_SIZE && (
            <Flexbox horizontal justify="flex-end" style={{ padding: 12 }}>
              <Pagination
                size="small"
                current={page}
                pageSize={PAGE_SIZE}
                total={total}
                showSizeChanger={false}
                onChange={(p) => setPage(p)}
              />
            </Flexbox>
          )}
        </Card>
      </Flexbox>

      <PatchDialog
        file={editTarget}
        open={!!editTarget}
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
    </Flexbox>
  );
}

export default OSSPage;
