/**
 * BucketsTab — operator surface for `oss_buckets`.
 *
 * Reads `GET /oss/buckets` (flat list — bucket count per station is
 * small enough to render unpaginated) and lets an operator:
 *
 *   - Create a `user`-kind bucket (the station hardcodes `kind = user`
 *     here; system buckets are auto-provisioned by the OSS subserver
 *     on first use, so we deliberately do NOT expose a "kind" knob).
 *   - PATCH default-visibility / quota / TTL / description.
 *   - Soft-delete (gorm.DeletedAt). The station rejects non-empty
 *     buckets unless `?force=true`; we surface that as an explicit
 *     "Force delete" toggle inside the confirm modal so the operator
 *     has to consciously opt in.
 *
 * `system`-kind buckets are listed for visibility but their action
 * column shows only "view" — destructive actions are gated server-
 * side too, but disabling the buttons keeps the UI from offering
 * something it cannot deliver.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Form, Input as AntdInput, InputNumber, message, Modal,
  Popconfirm, Progress, Segmented, Space, Switch, Table, Tag, Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import {
  AlertTriangle, FolderTree, PencilLine, Plus, RefreshCw, Trash2, Upload as UploadIcon,
} from 'lucide-react';
import * as ossApi from '../../api/oss';
import { log } from '../../utils/logger';
import { formatAbsolute, formatBytes, formatRelative, VisibilityChip } from './shared';

const { Text } = Typography;

type Visibility = 'public' | 'chat' | 'private';

interface BucketFormState {
  name: string;
  owner_ptid: string;
  default_visibility: Visibility;
  quota_bytes: number;
  ttl_days: number;
  description: string;
}

const EMPTY_FORM: BucketFormState = {
  name: '',
  owner_ptid: '',
  default_visibility: 'private',
  quota_bytes: 0,
  ttl_days: 0,
  description: '',
};

/**
 * "Used / Quota" cell. When the bucket has no quota (`quota_bytes = 0`,
 * the canonical "unlimited" sentinel) we show only the absolute usage,
 * because rendering 0% on an unlimited bucket is misleading.
 */
function UsageCell({ used, quota }: { used: number; quota: number }) {
  if (quota <= 0) {
    return <Text>{formatBytes(used)} / unlimited</Text>;
  }
  const pct = Math.min(100, Math.round((used / quota) * 100));
  const status = pct >= 95 ? 'exception' : pct >= 80 ? 'active' : 'normal';
  return (
    <Tooltip title={`${formatBytes(used)} of ${formatBytes(quota)}`}>
      <Flexbox gap={2} style={{ minWidth: 140 }}>
        <Progress percent={pct} size="small" status={status as any} showInfo={false} />
        <Text type="secondary" style={{ fontSize: 11 }}>
          {formatBytes(used)} / {formatBytes(quota)}
        </Text>
      </Flexbox>
    </Tooltip>
  );
}

export function BucketsTab() {
  const [items, setItems] = useState<ossApi.OSSBucketSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<BucketFormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<ossApi.OSSBucketSummary | null>(null);
  const [editForm, setEditForm] = useState<BucketFormState>(EMPTY_FORM);
  const [busyID, setBusyID] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);
  const [uploadFor, setUploadFor] = useState<ossApi.OSSBucketSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await ossApi.listBuckets();
      setItems(resp.items ?? []);
    } catch (err) {
      log.error('oss', 'Failed to list buckets');
      message.error('Failed to list buckets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onCreate = useCallback(async () => {
    const name = createForm.name.trim();
    const owner = createForm.owner_ptid.trim();
    if (!name) {
      message.warning('Name is required');
      return;
    }
    if (!owner) {
      message.warning('Owner actor id is required');
      return;
    }
    setCreating(true);
    try {
      await ossApi.createBucket({
        owner_ptid: owner,
        name,
        default_visibility: createForm.default_visibility,
        quota_bytes: createForm.quota_bytes,
        ttl_days: createForm.ttl_days,
        description: createForm.description.trim() || undefined,
      });
      message.success('Bucket created');
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      await load();
    } catch (err: any) {
      log.error('oss', 'Create bucket failed');
      message.error(err?.response?.data?.message || err?.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  }, [createForm, load]);

  const openEdit = useCallback((b: ossApi.OSSBucketSummary) => {
    setEditing(b);
    setEditForm({
      name: b.name,
      owner_ptid: b.owner_ptid,
      default_visibility: (b.default_visibility as Visibility) ?? 'private',
      quota_bytes: b.quota_bytes ?? 0,
      ttl_days: b.ttl_days ?? 0,
      description: b.description ?? '',
    });
    setEditOpen(true);
  }, []);

  const onEditSubmit = useCallback(async () => {
    if (!editing) return;
    const patch: ossApi.OSSBucketUpdateRequest = {};
    if (editForm.default_visibility !== editing.default_visibility) {
      patch.default_visibility = editForm.default_visibility;
    }
    if (editForm.quota_bytes !== editing.quota_bytes) {
      patch.quota_bytes = editForm.quota_bytes;
    }
    if (editForm.ttl_days !== editing.ttl_days) {
      patch.ttl_days = editForm.ttl_days;
    }
    const trimmedDesc = editForm.description ?? '';
    if (trimmedDesc !== (editing.description ?? '')) {
      patch.description = trimmedDesc;
    }
    if (Object.keys(patch).length === 0) {
      message.info('No changes');
      return;
    }
    setBusyID(editing.id);
    try {
      await ossApi.updateBucket(editing.id, patch);
      message.success('Bucket updated');
      setEditOpen(false);
      setEditing(null);
      await load();
    } catch (err: any) {
      log.error('oss', 'Update bucket failed');
      message.error(err?.response?.data?.message || err?.message || 'Update failed');
    } finally {
      setBusyID(null);
    }
  }, [editing, editForm, load]);

  const onDelete = useCallback(async (b: ossApi.OSSBucketSummary, force: boolean) => {
    setBusyID(b.id);
    try {
      await ossApi.deleteBucket(b.id, force);
      message.success(force ? 'Bucket force-deleted' : 'Bucket deleted');
      await load();
    } catch (err: any) {
      log.error('oss', 'Delete bucket failed');
      message.error(err?.response?.data?.message || err?.message || 'Delete failed');
    } finally {
      setBusyID(null);
      setForceDelete(false);
    }
  }, [load]);

  const userBuckets = useMemo(() => items.filter((b) => b.kind === 'user').length, [items]);
  const systemBuckets = useMemo(() => items.filter((b) => b.kind === 'system').length, [items]);

  const columns: ColumnsType<ossApi.OSSBucketSummary> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, r) => (
        <Flexbox>
          <Text strong>{v}</Text>
          <Flexbox horizontal gap={6}>
            <Tag color={r.kind === 'system' ? 'purple' : 'blue'} style={{ marginRight: 0 }}>
              {r.kind}
            </Tag>
            {r.system_key ? <Tag color="default">{r.system_key}</Tag> : null}
          </Flexbox>
        </Flexbox>
      ),
    },
    {
      title: 'Owner',
      dataIndex: 'owner_ptid',
      key: 'owner_ptid',
      width: 180,
      render: (v: string) => v ? <Text code>{v}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Default visibility',
      dataIndex: 'default_visibility',
      key: 'default_visibility',
      width: 140,
      render: (v: string) => <VisibilityChip value={v} />,
    },
    {
      title: 'Used / Quota',
      key: 'usage',
      width: 200,
      render: (_, r) => <UsageCell used={r.used_bytes} quota={r.quota_bytes} />,
    },
    {
      title: 'Files',
      dataIndex: 'file_count',
      key: 'file_count',
      width: 80,
      align: 'right',
      sorter: (a, b) => a.file_count - b.file_count,
      render: (v: number) => <Text>{v.toLocaleString()}</Text>,
    },
    {
      title: 'TTL (days)',
      dataIndex: 'ttl_days',
      key: 'ttl_days',
      width: 100,
      align: 'right',
      render: (v: number) => v > 0 ? <Text>{v}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Updated',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 140,
      render: (v: string) => (
        <Tooltip title={formatAbsolute(v)}>
          <Text type="secondary">{formatRelative(v)}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 280,
      align: 'right',
      render: (_, b) => {
        const isSystem = b.kind === 'system';
        const busy = busyID === b.id;
        return (
          <Space size={4}>
            <Tooltip title={isSystem ? 'system buckets have no owner_ptid; admin upload is rejected server-side' : 'Upload a file on behalf of the bucket owner'}>
              <Button
                size="small"
                icon={<UploadIcon size={14} />}
                disabled={isSystem || busy}
                onClick={() => setUploadFor(b)}
              >
                Upload
              </Button>
            </Tooltip>
            <Tooltip title={isSystem ? 'system buckets cannot be edited' : ''}>
              <Button
                size="small"
                icon={<PencilLine size={14} />}
                disabled={isSystem || busy}
                onClick={() => openEdit(b)}
              >
                Edit
              </Button>
            </Tooltip>
            <Popconfirm
              key={`del-${b.id}-${forceDelete}`}
              title="Delete this bucket?"
              description={
                <Flexbox gap={6} style={{ maxWidth: 320 }}>
                  <Text>
                    Soft-delete via <Text code>gorm.DeletedAt</Text>. Existing
                    files in the bucket are preserved unless force is enabled.
                  </Text>
                  <Flexbox horizontal gap={8} align="center">
                    <Switch
                      size="small"
                      checked={forceDelete}
                      onChange={setForceDelete}
                    />
                    <Text>Force (drop the bucket even if non-empty)</Text>
                  </Flexbox>
                </Flexbox>
              }
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => onDelete(b, forceDelete)}
              onCancel={() => setForceDelete(false)}
              disabled={isSystem || busy}
            >
              <Tooltip title={isSystem ? 'system buckets cannot be deleted' : ''}>
                <Button
                  size="small"
                  danger
                  icon={<Trash2 size={14} />}
                  disabled={isSystem || busy}
                >
                  Delete
                </Button>
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
        <Card style={{ flex: 1, minWidth: 200 }} loading={loading}>
          <Flexbox gap={4}>
            <Text type="secondary">User buckets</Text>
            <Text strong style={{ fontSize: 24 }}>{userBuckets}</Text>
          </Flexbox>
        </Card>
        <Card style={{ flex: 1, minWidth: 200 }} loading={loading}>
          <Flexbox gap={4}>
            <Text type="secondary">System buckets</Text>
            <Text strong style={{ fontSize: 24 }}>{systemBuckets}</Text>
          </Flexbox>
        </Card>
        <Card style={{ flex: 1, minWidth: 200 }} loading={loading}>
          <Flexbox gap={4}>
            <Text type="secondary">Total buckets</Text>
            <Text strong style={{ fontSize: 24 }}>{items.length}</Text>
          </Flexbox>
        </Card>
      </Flexbox>

      <Card
        title={
          <Flexbox horizontal gap={12} align="center">
            <FolderTree size={16} />
            <Text strong>Buckets</Text>
          </Flexbox>
        }
        extra={
          <Space>
            <Button icon={<RefreshCw size={14} />} onClick={load} loading={loading} size="small">
              Refresh
            </Button>
            <Button
              type="primary"
              icon={<Plus size={14} />}
              onClick={() => { setCreateForm(EMPTY_FORM); setCreateOpen(true); }}
              size="small"
            >
              New bucket
            </Button>
          </Space>
        }
        styles={{ body: { padding: 0 } }}
      >
        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={false}
          locale={{ emptyText: loading ? 'Loading…' : 'No buckets defined' }}
        />
      </Card>

      {/* Create modal */}
      <Modal
        title="Create user bucket"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={onCreate}
        confirmLoading={creating}
        okText="Create"
        destroyOnHidden
      >
        <Form layout="vertical" disabled={creating}>
          <Form.Item label="Owner actor id" required>
            <AntdInput
              value={createForm.owner_ptid}
              onChange={(e) => setCreateForm({ ...createForm, owner_ptid: e.target.value })}
              placeholder="actor ULID — the bucket's per-actor scope"
            />
          </Form.Item>
          <Form.Item label="Name" required extra="Unique within (owner, name).">
            <AntdInput
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              placeholder="e.g. attachments"
            />
          </Form.Item>
          <Form.Item label="Default visibility">
            <Segmented
              value={createForm.default_visibility}
              onChange={(v) => setCreateForm({ ...createForm, default_visibility: v as Visibility })}
              options={[
                { label: 'private', value: 'private' },
                { label: 'chat', value: 'chat' },
                { label: 'public', value: 'public' },
              ]}
            />
          </Form.Item>
          <Flexbox horizontal gap={12}>
            <Form.Item label="Quota (bytes)" extra="0 = unlimited" style={{ flex: 1 }}>
              <InputNumber
                min={0}
                step={1024 * 1024}
                value={createForm.quota_bytes}
                onChange={(v) => setCreateForm({ ...createForm, quota_bytes: Number(v) || 0 })}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item label="TTL (days)" extra="0 = no auto-TTL" style={{ flex: 1 }}>
              <InputNumber
                min={0}
                step={1}
                value={createForm.ttl_days}
                onChange={(v) => setCreateForm({ ...createForm, ttl_days: Number(v) || 0 })}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Flexbox>
          <Form.Item label="Description">
            <AntdInput.TextArea
              rows={2}
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit modal */}
      <Modal
        title={editing ? `Edit bucket "${editing.name}"` : 'Edit bucket'}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={onEditSubmit}
        confirmLoading={!!busyID}
        okText="Save"
        destroyOnHidden
      >
        {editing ? (
          <Form layout="vertical" disabled={!!busyID}>
            <Alert
              type="info"
              showIcon
              message="Name and owner are immutable — recreate the bucket to change either."
              style={{ marginBottom: 16 }}
            />
            <Form.Item label="Default visibility">
              <Segmented
                value={editForm.default_visibility}
                onChange={(v) => setEditForm({ ...editForm, default_visibility: v as Visibility })}
                options={[
                  { label: 'private', value: 'private' },
                  { label: 'chat', value: 'chat' },
                  { label: 'public', value: 'public' },
                ]}
              />
            </Form.Item>
            <Flexbox horizontal gap={12}>
              <Form.Item label="Quota (bytes)" extra="0 = unlimited" style={{ flex: 1 }}>
                <InputNumber
                  min={0}
                  step={1024 * 1024}
                  value={editForm.quota_bytes}
                  onChange={(v) => setEditForm({ ...editForm, quota_bytes: Number(v) || 0 })}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item label="TTL (days)" extra="0 = no auto-TTL" style={{ flex: 1 }}>
                <InputNumber
                  min={0}
                  step={1}
                  value={editForm.ttl_days}
                  onChange={(v) => setEditForm({ ...editForm, ttl_days: Number(v) || 0 })}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Flexbox>
            <Form.Item label="Description">
              <AntdInput.TextArea
                rows={2}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </Form.Item>
            {editForm.default_visibility !== editing.default_visibility &&
             editForm.default_visibility !== 'public' &&
             editing.default_visibility === 'public' ? (
              <Alert
                type="warning"
                showIcon
                icon={<AlertTriangle size={14} />}
                message="Tightening default visibility from public bumps capability_version — federated peers will refresh on their next call."
              />
            ) : null}
          </Form>
        ) : null}
      </Modal>

      {uploadFor ? (
        <AdminUploadModal
          bucket={uploadFor}
          onClose={(uploaded) => {
            setUploadFor(null);
            if (uploaded) {
              load();
            }
          }}
        />
      ) : null}
    </Flexbox>
  );
}

// ---------------------------------------------------------------------------
// AdminUploadModal — operator uploads on behalf of the bucket's
// owner. The server stamps `owner_ptid = bucket.owner_ptid`
// regardless of what the operator picks; we surface that in the
// modal's helper text so the operator is not surprised when the
// resulting `oss_files` row does not show their admin id.
// ---------------------------------------------------------------------------

interface AdminUploadModalProps {
  bucket: ossApi.OSSBucketSummary;
  /** Called when the modal closes; `uploaded=true` means the
   *  parent should refresh its bucket list (the row's used_bytes
   *  / file_count just changed). */
  onClose: (uploaded: boolean) => void;
}

function AdminUploadModal({ bucket, onClose }: AdminUploadModalProps) {
  type UploadVis = '' | 'public' | 'chat' | 'private';

  const [file, setFile] = useState<File | null>(null);
  const [filename, setFilename] = useState('');
  const [visibility, setVisibility] = useState<UploadVis>('');
  const [chatSessionID, setChatSessionID] = useState('');
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const effectiveVisibility = (visibility || bucket.default_visibility) as 'public' | 'chat' | 'private';

  const onSubmit = useCallback(async () => {
    if (!file) {
      message.warning('Pick a file first');
      return;
    }
    if (effectiveVisibility === 'chat' && !chatSessionID.trim()) {
      message.warning('chat_session_id is required when visibility is chat');
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      await ossApi.adminUploadObject(bucket.id, file, {
        visibility: visibility ? (visibility as 'public' | 'chat' | 'private') : undefined,
        chat_session_id: chatSessionID.trim() || undefined,
        filename: filename.trim() || undefined,
        onProgress: (loaded, total) => {
          if (total && total > 0) {
            setProgress(Math.round((loaded / total) * 100));
          }
        },
      });
      message.success('Uploaded');
      onClose(true);
    } catch (err: any) {
      log.error('oss', 'Admin upload failed');
      const code = err?.response?.data?.code;
      const text = err?.response?.data?.error || err?.message || 'Upload failed';
      message.error(code ? `${code}: ${text}` : text);
    } finally {
      setUploading(false);
    }
  }, [bucket, file, filename, visibility, chatSessionID, effectiveVisibility, onClose]);

  return (
    <Modal
      title={`Upload to "${bucket.name}"`}
      open
      onCancel={() => uploading ? null : onClose(false)}
      onOk={onSubmit}
      confirmLoading={uploading}
      okText={uploading ? 'Uploading…' : 'Upload'}
      okButtonProps={{ disabled: !file }}
      destroyOnHidden
      width={520}
    >
      <Form layout="vertical" disabled={uploading}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <Text>
              The file is stored under{' '}
              <Text code>owner_ptid={bucket.owner_ptid}</Text> — the
              bucket owner — and audited as <Text code>admin_upload</Text> with
              your dashboard identity.
            </Text>
          }
        />
        <Form.Item label="File" required>
          <input
            type="file"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !filename) {
                setFilename(f.name);
              }
            }}
          />
          {file ? (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              {file.name} — {formatBytes(file.size)}
            </Text>
          ) : null}
        </Form.Item>
        <Form.Item label="Display name" extra="Defaults to the picked file's name. Storage key is derived by CAS regardless.">
          <AntdInput
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder={file?.name ?? 'pick a file first'}
          />
        </Form.Item>
        <Form.Item
          label="Visibility"
          extra={
            visibility
              ? null
              : <Text type="secondary">Defaults to bucket's <Text code>{bucket.default_visibility}</Text>.</Text>
          }
        >
          <Segmented
            value={visibility || ''}
            onChange={(v) => setVisibility(v as UploadVis)}
            options={[
              { label: 'inherit', value: '' },
              { label: 'private', value: 'private' },
              { label: 'chat', value: 'chat' },
              { label: 'public', value: 'public' },
            ]}
          />
        </Form.Item>
        {effectiveVisibility === 'chat' ? (
          <Form.Item label="Chat session id" required>
            <AntdInput
              value={chatSessionID}
              onChange={(e) => setChatSessionID(e.target.value)}
              placeholder="ULID of the friend chat session that grants visibility"
            />
          </Form.Item>
        ) : null}
        {uploading ? (
          <Progress percent={progress} status={progress >= 100 ? 'success' : 'active'} />
        ) : null}
      </Form>
    </Modal>
  );
}

export default BucketsTab;
