/**
 * ObjectsTab — operator surface for `oss_files`.
 *
 * Reads `GET /oss/objects` (paginated, default 50/page; server caps
 * at 200) with optional filters. From here an operator can:
 *
 *   - Inspect a row (full admin detail including expires_at /
 *     deleted_at / sha256 — fields the list omits to keep the table
 *     cheap).
 *   - Override visibility (admin PATCH, audited as
 *     `admin_visibility_override`). The station enforces the same
 *     visibility/chat-session invariants here as the user PATCH path
 *     so the row never lands in an invalid state.
 *   - Force-delete (admin DELETE, audited as `admin_delete`). This is
 *     a soft-delete; bucket usage / blob refcount reconciliation is
 *     deferred to the BucketReconciler / BlobGC workers per v3 plan.
 *
 * We deliberately do NOT expose bucket-move from here — quota
 * transfer is owner-scoped by design (see file_service.PatchFile);
 * if an operator needs to move a file across buckets, ask the owner
 * to PATCH it from the desktop client.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Card, DatePicker, Descriptions, Drawer, Form,
  Input as AntdInput, message, Pagination, Popconfirm, Segmented,
  Space, Table, Tag, Tooltip, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import {
  AlertTriangle, EyeOff, FileText, RefreshCw, ShieldAlert, Trash2,
} from 'lucide-react';
import type { Dayjs } from 'dayjs';
import * as ossApi from '../../api/oss';
import { log } from '../../utils/logger';
import { formatAbsolute, formatBytes, formatRelative, shortHash, VisibilityChip } from './shared';

const { Text, Paragraph } = Typography;

const PAGE_SIZE = 50;
type Visibility = 'public' | 'chat' | 'private';

interface PatchFormState {
  visibility: Visibility | 'leave';
  chat_session_id_mode: 'leave' | 'set' | 'clear';
  chat_session_id: string;
  expires_mode: 'leave' | 'set' | 'clear';
  expires_at: Dayjs | null;
}

const EMPTY_PATCH: PatchFormState = {
  visibility: 'leave',
  chat_session_id_mode: 'leave',
  chat_session_id: '',
  expires_mode: 'leave',
  expires_at: null,
};

export function ObjectsTab() {
  const [items, setItems] = useState<ossApi.OSSObjectSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [bucketFilter, setBucketFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [mimeFilter, setMimeFilter] = useState('');
  const [visibilityFilter, setVisibilityFilter] =
    useState<'all' | Visibility>('all');

  const [drawerTarget, setDrawerTarget] = useState<ossApi.OSSObjectAdminDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [busyID, setBusyID] = useState<string | null>(null);

  const [patchMode, setPatchMode] = useState(false);
  const [patchForm, setPatchForm] = useState<PatchFormState>(EMPTY_PATCH);
  const [patching, setPatching] = useState(false);

  const buildQuery = useCallback((): ossApi.OSSObjectListQuery => ({
    bucket_id: bucketFilter.trim() || undefined,
    owner_ptid: ownerFilter.trim() || undefined,
    mime: mimeFilter.trim() || undefined,
    visibility: visibilityFilter === 'all' ? undefined : visibilityFilter,
    page,
    page_size: PAGE_SIZE,
  }), [bucketFilter, ownerFilter, mimeFilter, visibilityFilter, page]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await ossApi.listObjects(buildQuery());
      setItems(resp.items ?? []);
      setTotal(resp.total ?? 0);
    } catch (err) {
      log.error('oss', 'Failed to list objects');
      message.error('Failed to list objects');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { load(); }, [load]);

  const openInspect = useCallback(async (id: string) => {
    setDrawerLoading(true);
    setDrawerTarget(null);
    try {
      const detail = await ossApi.getObject(id);
      setDrawerTarget(detail);
    } catch (err) {
      log.error('oss', 'Get object failed');
      message.error('Failed to load object detail');
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const startPatch = useCallback(() => {
    setPatchForm(EMPTY_PATCH);
    setPatchMode(true);
  }, []);

  const closePatch = useCallback(() => {
    setPatchMode(false);
  }, []);

  const onPatchSubmit = useCallback(async () => {
    if (!drawerTarget) return;
    const req: ossApi.OSSObjectAdminPatchRequest = {};
    if (patchForm.visibility !== 'leave') {
      req.visibility = patchForm.visibility;
    }
    if (patchForm.chat_session_id_mode === 'set') {
      const sid = patchForm.chat_session_id.trim();
      if (!sid) {
        message.warning('chat_session_id is required when set');
        return;
      }
      req.chat_session_id = sid;
    } else if (patchForm.chat_session_id_mode === 'clear') {
      req.chat_session_id = '';
    }
    if (patchForm.expires_mode === 'set') {
      if (!patchForm.expires_at) {
        message.warning('Pick a date for the new expiry');
        return;
      }
      req.expires_at = patchForm.expires_at.toISOString();
    } else if (patchForm.expires_mode === 'clear') {
      req.clear_expires_at = true;
    }
    if (
      req.visibility === undefined &&
      req.chat_session_id === undefined &&
      req.expires_at === undefined &&
      !req.clear_expires_at
    ) {
      message.info('No changes');
      return;
    }
    setPatching(true);
    try {
      await ossApi.adminPatchObject(drawerTarget.id, req);
      message.success('Object patched');
      setPatchMode(false);
      await load();
      const refreshed = await ossApi.getObject(drawerTarget.id);
      setDrawerTarget(refreshed);
    } catch (err: any) {
      log.error('oss', 'Admin patch failed');
      message.error(err?.response?.data?.message || err?.message || 'Patch failed');
    } finally {
      setPatching(false);
    }
  }, [drawerTarget, patchForm, load]);

  const onAdminDelete = useCallback(async (row: ossApi.OSSObjectSummary) => {
    setBusyID(row.id);
    try {
      await ossApi.adminDeleteObject(row.id);
      message.success('Object force-deleted (soft, GC pending)');
      await load();
      if (drawerTarget?.id === row.id) {
        const refreshed = await ossApi.getObject(row.id);
        setDrawerTarget(refreshed);
      }
    } catch (err: any) {
      log.error('oss', 'Admin delete failed');
      message.error(err?.response?.data?.message || err?.message || 'Delete failed');
    } finally {
      setBusyID(null);
    }
  }, [load, drawerTarget]);

  const filtersApplied = useMemo(() => (
    !!bucketFilter.trim() || !!ownerFilter.trim() || !!mimeFilter.trim() ||
    visibilityFilter !== 'all'
  ), [bucketFilter, ownerFilter, mimeFilter, visibilityFilter]);

  const columns: ColumnsType<ossApi.OSSObjectSummary> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      ellipsis: { showTitle: false },
      render: (v: string, r) => (
        <Flexbox>
          <Tooltip title={v}>
            <Text strong>{v || '(unnamed)'}</Text>
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
      render: (v: string) => <VisibilityChip value={v} />,
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
      title: 'Owner',
      dataIndex: 'owner_ptid',
      key: 'owner_ptid',
      width: 160,
      render: (v: string) => v ? <Text code>{shortHash(v, 12, 4)}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Bucket',
      dataIndex: 'bucket_id',
      key: 'bucket_id',
      width: 160,
      render: (v: string) => v ? <Text code>{shortHash(v, 12, 4)}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Backend',
      dataIndex: 'backend',
      key: 'backend',
      width: 110,
      render: (v: string) => <Tag>{v || 'unknown'}</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
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
      width: 220,
      align: 'right',
      render: (_, r) => {
        const busy = busyID === r.id;
        return (
          <Space size={4}>
            <Button size="small" icon={<FileText size={14} />} onClick={() => openInspect(r.id)}>
              Inspect
            </Button>
            <Popconfirm
              title="Force-delete this object?"
              description={
                <Flexbox gap={4} style={{ maxWidth: 320 }}>
                  <Text>Soft-deletes the row (admin override; bypasses owner check).</Text>
                  <Text type="secondary">
                    Bucket usage and blob refcount are reconciled by background
                    workers, not synchronously here.
                  </Text>
                </Flexbox>
              }
              okText="Force delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => onAdminDelete(r)}
              disabled={busy}
            >
              <Button size="small" danger icon={<Trash2 size={14} />} disabled={busy}>
                Delete
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <Flexbox gap={16}>
      <Card>
        <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
          <Flexbox gap={4} style={{ minWidth: 200 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Bucket id</Text>
            <AntdInput
              value={bucketFilter}
              placeholder="(any)"
              onChange={(e) => { setPage(1); setBucketFilter(e.target.value); }}
              allowClear
            />
          </Flexbox>
          <Flexbox gap={4} style={{ minWidth: 200 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Owner actor id</Text>
            <AntdInput
              value={ownerFilter}
              placeholder="(any)"
              onChange={(e) => { setPage(1); setOwnerFilter(e.target.value); }}
              allowClear
            />
          </Flexbox>
          <Flexbox gap={4} style={{ minWidth: 200 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>MIME</Text>
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
        </Flexbox>
      </Card>

      <Card
        title={
          <Flexbox horizontal gap={12} align="center">
            <ShieldAlert size={16} />
            <Text strong>Objects</Text>
            <Tag color="default">{total.toLocaleString()} total</Tag>
            {filtersApplied ? <Tag color="blue">filtered</Tag> : null}
          </Flexbox>
        }
        extra={
          <Button icon={<RefreshCw size={14} />} onClick={load} loading={loading} size="small">
            Refresh
          </Button>
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
          locale={{ emptyText: loading ? 'Loading…' : 'No objects match these filters' }}
        />
        {total > PAGE_SIZE ? (
          <Flexbox horizontal justify="flex-end" style={{ padding: 12 }}>
            <Pagination
              size="small"
              current={page}
              pageSize={PAGE_SIZE}
              total={total}
              showSizeChanger={false}
              onChange={setPage}
            />
          </Flexbox>
        ) : null}
      </Card>

      <Drawer
        title={drawerTarget ? `Object · ${drawerTarget.name || drawerTarget.id}` : 'Object detail'}
        open={!!drawerTarget || drawerLoading}
        onClose={() => { setDrawerTarget(null); setPatchMode(false); }}
        width={520}
        loading={drawerLoading}
        extra={
          drawerTarget && !drawerTarget.deleted_at && !patchMode ? (
            <Space>
              <Button
                size="small"
                icon={<EyeOff size={14} />}
                onClick={startPatch}
              >
                Patch
              </Button>
              <Popconfirm
                title="Force-delete this object?"
                okText="Force delete"
                okButtonProps={{ danger: true }}
                onConfirm={() => onAdminDelete(drawerTarget)}
              >
                <Button size="small" danger icon={<Trash2 size={14} />}>
                  Delete
                </Button>
              </Popconfirm>
            </Space>
          ) : null
        }
      >
        {drawerTarget ? (
          patchMode ? (
            <Form layout="vertical" disabled={patching}>
              <Alert
                type="info"
                showIcon
                message="Admin override — bypasses owner permission, audited as admin_visibility_override."
                style={{ marginBottom: 16 }}
              />
              <Form.Item label="Visibility">
                <Segmented
                  value={patchForm.visibility}
                  onChange={(v) => setPatchForm({ ...patchForm, visibility: v as PatchFormState['visibility'] })}
                  options={[
                    { label: 'Leave', value: 'leave' },
                    { label: 'public', value: 'public' },
                    { label: 'chat', value: 'chat' },
                    { label: 'private', value: 'private' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="Chat session id">
                <Flexbox gap={6}>
                  <Segmented
                    value={patchForm.chat_session_id_mode}
                    onChange={(v) => setPatchForm({ ...patchForm, chat_session_id_mode: v as PatchFormState['chat_session_id_mode'] })}
                    options={[
                      { label: 'Leave', value: 'leave' },
                      { label: 'Set', value: 'set' },
                      { label: 'Clear', value: 'clear' },
                    ]}
                  />
                  {patchForm.chat_session_id_mode === 'set' ? (
                    <AntdInput
                      value={patchForm.chat_session_id}
                      onChange={(e) => setPatchForm({ ...patchForm, chat_session_id: e.target.value })}
                      placeholder="session ULID — required when visibility=chat"
                    />
                  ) : null}
                  {patchForm.visibility === 'chat' && patchForm.chat_session_id_mode === 'clear' ? (
                    <Text type="warning">Setting visibility=chat without a session id will be rejected.</Text>
                  ) : null}
                </Flexbox>
              </Form.Item>
              <Form.Item label="Expiry">
                <Flexbox gap={6}>
                  <Segmented
                    value={patchForm.expires_mode}
                    onChange={(v) => setPatchForm({ ...patchForm, expires_mode: v as PatchFormState['expires_mode'] })}
                    options={[
                      { label: 'Leave', value: 'leave' },
                      { label: 'Set', value: 'set' },
                      { label: 'Clear', value: 'clear' },
                    ]}
                  />
                  {patchForm.expires_mode === 'set' ? (
                    <DatePicker
                      showTime
                      value={patchForm.expires_at}
                      onChange={(d) => setPatchForm({ ...patchForm, expires_at: d })}
                      style={{ width: '100%' }}
                    />
                  ) : null}
                  {patchForm.expires_mode === 'clear' ? (
                    <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      Will null out the existing expiry — file becomes permanent.
                    </Paragraph>
                  ) : null}
                </Flexbox>
              </Form.Item>
              <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button onClick={closePatch} disabled={patching}>Cancel</Button>
                <Button type="primary" onClick={onPatchSubmit} loading={patching}>Apply</Button>
              </Space>
            </Form>
          ) : (
          <Flexbox gap={12}>
            {drawerTarget.deleted_at ? (
              <Alert
                type="warning"
                showIcon
                icon={<AlertTriangle size={14} />}
                message="Soft-deleted"
                description={`Deleted at ${formatAbsolute(drawerTarget.deleted_at)}; bytes are eligible for GC after the grace window.`}
              />
            ) : null}
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="ID">
                <Text code copyable={{ text: drawerTarget.id }}>{drawerTarget.id}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Key">
                <Text code copyable={{ text: drawerTarget.key }}>{drawerTarget.key}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Name">{drawerTarget.name || '(unnamed)'}</Descriptions.Item>
              <Descriptions.Item label="MIME">
                {drawerTarget.mime || 'application/octet-stream'}
              </Descriptions.Item>
              <Descriptions.Item label="Size">{formatBytes(drawerTarget.size)}</Descriptions.Item>
              <Descriptions.Item label="Visibility">
                <VisibilityChip value={drawerTarget.visibility} />
              </Descriptions.Item>
              <Descriptions.Item label="Chat session">
                {drawerTarget.chat_session_id
                  ? <Text code>{drawerTarget.chat_session_id}</Text>
                  : <Text type="secondary">—</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Owner actor">
                <Text code>{drawerTarget.owner_ptid || '—'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Bucket">
                <Text code>{drawerTarget.bucket_id || '—'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Backend">
                <Tag>{drawerTarget.backend || 'unknown'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="SHA256">
                {drawerTarget.sha256
                  ? <Tooltip title={drawerTarget.sha256}>
                      <Text code copyable={{ text: drawerTarget.sha256}}>
                        {shortHash(drawerTarget.sha256, 16, 8)}
                      </Text>
                    </Tooltip>
                  : <Text type="secondary">—</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Expires at">
                {drawerTarget.expires_at
                  ? formatAbsolute(drawerTarget.expires_at)
                  : <Text type="secondary">never</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Created">{formatAbsolute(drawerTarget.created_at)}</Descriptions.Item>
              <Descriptions.Item label="Updated">{formatAbsolute(drawerTarget.updated_at)}</Descriptions.Item>
              <Descriptions.Item label="Deleted">
                {drawerTarget.deleted_at
                  ? <Badge status="error" text={formatAbsolute(drawerTarget.deleted_at)} />
                  : <Badge status="success" text="live" />}
              </Descriptions.Item>
            </Descriptions>
          </Flexbox>
          )
        ) : null}
      </Drawer>
    </Flexbox>
  );
}

export default ObjectsTab;
