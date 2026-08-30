/**
 * AuditTab — operator-facing browser for `oss_audit`.
 *
 * Audit rows are append-only (the AuditTrim worker soft-deletes
 * older entries on a configurable schedule). We expose the full set
 * of filters the station accepts:
 *
 *   - action     (e.g. `upload`, `read`, `admin_delete`, `worker_run`,
 *                 `peer_get`, `key_rotate`, `bucket_create`, …)
 *   - actor_ptid (owner / dashboard / peer station — the audit row's
 *                 stamped attribution)
 *   - bucket_id
 *   - file_key
 *   - outcome    (`ok` / `denied` / `error`)
 *   - since / until (RFC3339; the station treats unparseable values
 *                    as "no bound" so a malformed picker value will
 *                    not break the listing)
 *
 * Pagination is server-side; we cap the page size at 200 to mirror
 * the handler.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, DatePicker, Input as AntdInput, message, Pagination, Select,
  Space, Table, Tag, Tooltip, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import { ListChecks, RefreshCw } from 'lucide-react';
import dayjs, { type Dayjs } from 'dayjs';
import * as ossApi from '../../api/oss';
import { log } from '../../utils/logger';
import { formatAbsolute, formatBytes, formatRelative, shortHash } from './shared';

const { Text } = Typography;
const PAGE_SIZE = 50;

/**
 * The full enumeration of `action` strings the OSS subserver
 * currently emits. Listed here for the dashboard so an operator
 * does not have to memorise the codes — adding a new action means
 * appending a row here and on the server's enum at the same time.
 */
const ACTION_OPTIONS = [
  // user-side
  { value: 'upload', label: 'upload' },
  { value: 'read', label: 'read' },
  { value: 'patch', label: 'patch' },
  { value: 'delete', label: 'delete' },
  { value: 'restore', label: 'restore' },
  // peer / federation
  { value: 'peer_get', label: 'peer_get' },
  { value: 'peer_token_mint', label: 'peer_token_mint' },
  { value: 'peer_forget', label: 'peer_forget' },
  { value: 'key_rotate', label: 'key_rotate' },
  // dashboard / admin
  { value: 'bucket_create', label: 'bucket_create' },
  { value: 'bucket_update', label: 'bucket_update' },
  { value: 'bucket_delete', label: 'bucket_delete' },
  { value: 'admin_delete', label: 'admin_delete' },
  { value: 'admin_visibility_override', label: 'admin_visibility_override' },
  // workers
  { value: 'worker_run', label: 'worker_run' },
  { value: 'blob_gc', label: 'blob_gc' },
  { value: 'healthz_check', label: 'healthz_check' },
];

const OUTCOME_OPTIONS = [
  { value: 'ok', label: 'ok' },
  { value: 'denied', label: 'denied' },
  { value: 'error', label: 'error' },
];

function outcomeColor(o: string): string {
  switch (o) {
    case 'ok':     return 'green';
    case 'denied': return 'orange';
    case 'error':  return 'red';
    default:       return 'default';
  }
}

export function AuditTab() {
  const [items, setItems] = useState<ossApi.OSSAuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);
  const [actorFilter, setActorFilter] = useState('');
  const [bucketFilter, setBucketFilter] = useState('');
  const [fileKeyFilter, setFileKeyFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const buildQuery = useCallback((): ossApi.OSSAuditListQuery => ({
    action: actionFilter || undefined,
    actor_ptid: actorFilter.trim() || undefined,
    bucket_id: bucketFilter.trim() || undefined,
    file_key: fileKeyFilter.trim() || undefined,
    outcome: outcomeFilter || undefined,
    since: range?.[0]?.toISOString(),
    until: range?.[1]?.toISOString(),
    page,
    page_size: PAGE_SIZE,
  }), [actionFilter, actorFilter, bucketFilter, fileKeyFilter, outcomeFilter, range, page]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await ossApi.listAudit(buildQuery());
      setItems(resp.items ?? []);
      setTotal(resp.total ?? 0);
    } catch (err) {
      log.error('oss', 'Failed to list audit');
      message.error('Failed to list audit events');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { load(); }, [load]);

  const filtersApplied = useMemo(() => (
    !!actionFilter || !!actorFilter.trim() || !!bucketFilter.trim() ||
    !!fileKeyFilter.trim() || !!outcomeFilter || !!range?.[0] || !!range?.[1]
  ), [actionFilter, actorFilter, bucketFilter, fileKeyFilter, outcomeFilter, range]);

  const reset = useCallback(() => {
    setActionFilter(undefined);
    setActorFilter('');
    setBucketFilter('');
    setFileKeyFilter('');
    setOutcomeFilter(undefined);
    setRange(null);
    setPage(1);
  }, []);

  const columns: ColumnsType<ossApi.OSSAuditEvent> = [
    {
      title: 'Time',
      dataIndex: 'ts',
      key: 'ts',
      width: 170,
      render: (v: string) => (
        <Tooltip title={formatAbsolute(v)}>
          <Text>{formatRelative(v)}</Text>
        </Tooltip>
      ),
      sorter: (a, b) => dayjs(a.ts).valueOf() - dayjs(b.ts).valueOf(),
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      width: 200,
      render: (v: string) => <Text code>{v || '—'}</Text>,
    },
    {
      title: 'Outcome',
      dataIndex: 'outcome',
      key: 'outcome',
      width: 110,
      render: (v: string) => v ? <Tag color={outcomeColor(v)}>{v}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Actor',
      dataIndex: 'actor_ptid',
      key: 'actor_ptid',
      width: 160,
      render: (v: string) => v ? <Tooltip title={v}><Text code>{shortHash(v, 12, 4)}</Text></Tooltip> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Peer',
      dataIndex: 'peer_station_id',
      key: 'peer_station_id',
      width: 160,
      render: (v: string) => v ? <Tooltip title={v}><Text code>{shortHash(v, 12, 4)}</Text></Tooltip> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Bucket',
      dataIndex: 'bucket_id',
      key: 'bucket_id',
      width: 160,
      render: (v: string) => v ? <Tooltip title={v}><Text code>{shortHash(v, 12, 4)}</Text></Tooltip> : <Text type="secondary">—</Text>,
    },
    {
      title: 'File key',
      dataIndex: 'file_key',
      key: 'file_key',
      ellipsis: { showTitle: false },
      render: (v: string) => v ? <Tooltip title={v}><Text code>{shortHash(v, 14, 6)}</Text></Tooltip> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Size',
      dataIndex: 'size_bytes',
      key: 'size_bytes',
      width: 90,
      align: 'right',
      render: (v: number) => v > 0 ? <Text>{formatBytes(v)}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Reason',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: { showTitle: false },
      render: (v: string) => v
        ? <Tooltip title={v}><Text code>{v}</Text></Tooltip>
        : <Text type="secondary">—</Text>,
    },
  ];

  return (
    <Flexbox gap={16}>
      <Card>
        <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
          <Flexbox gap={4} style={{ minWidth: 220 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Action</Text>
            <Select
              value={actionFilter}
              onChange={(v) => { setPage(1); setActionFilter(v); }}
              placeholder="(any)"
              allowClear
              showSearch
              options={ACTION_OPTIONS}
              style={{ minWidth: 220 }}
            />
          </Flexbox>
          <Flexbox gap={4} style={{ minWidth: 160 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Outcome</Text>
            <Select
              value={outcomeFilter}
              onChange={(v) => { setPage(1); setOutcomeFilter(v); }}
              placeholder="(any)"
              allowClear
              options={OUTCOME_OPTIONS}
              style={{ minWidth: 160 }}
            />
          </Flexbox>
          <Flexbox gap={4} style={{ minWidth: 200 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Actor id</Text>
            <AntdInput
              value={actorFilter}
              placeholder="(any)"
              onChange={(e) => { setPage(1); setActorFilter(e.target.value); }}
              allowClear
            />
          </Flexbox>
          <Flexbox gap={4} style={{ minWidth: 200 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Bucket id</Text>
            <AntdInput
              value={bucketFilter}
              placeholder="(any)"
              onChange={(e) => { setPage(1); setBucketFilter(e.target.value); }}
              allowClear
            />
          </Flexbox>
          <Flexbox gap={4} style={{ minWidth: 220 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>File key</Text>
            <AntdInput
              value={fileKeyFilter}
              placeholder="(any)"
              onChange={(e) => { setPage(1); setFileKeyFilter(e.target.value); }}
              allowClear
            />
          </Flexbox>
          <Flexbox gap={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>Range</Text>
            <DatePicker.RangePicker
              showTime
              value={range as any}
              onChange={(v) => { setPage(1); setRange(v as any); }}
            />
          </Flexbox>
        </Flexbox>
      </Card>

      <Card
        title={
          <Flexbox horizontal gap={12} align="center">
            <ListChecks size={16} />
            <Text strong>Audit events</Text>
            <Tag color="default">{total.toLocaleString()} total</Tag>
            {filtersApplied ? <Tag color="blue">filtered</Tag> : null}
          </Flexbox>
        }
        extra={
          <Space>
            <Button size="small" onClick={reset} disabled={!filtersApplied}>
              Reset filters
            </Button>
            <Button
              size="small"
              icon={<RefreshCw size={14} />}
              onClick={load}
              loading={loading}
            >
              Refresh
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
          locale={{ emptyText: loading ? 'Loading…' : 'No audit rows match these filters' }}
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
    </Flexbox>
  );
}

export default AuditTab;
