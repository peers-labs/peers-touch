/**
 * OSSPage — Object storage admin: usage, buckets/objects, audit, federation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Flex,
  Input,
  message,
  Progress,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  theme,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import {
  ArrowLeft,
  Cloud,
  Copy,
  Pin,
  PinOff,
  RefreshCw,
} from 'lucide-react';

import PageHeader from '../components/PageHeader';
import * as ossApi from '../api/oss';
import type {
  OSSAuditEvent,
  OSSBucketSummary,
  OSSFederationLocalKey,
  OSSFederationPeer,
  OSSObjectSummary,
  OSSOwnerUsage,
  OSSUsageSummary,
  OSSVisibilityCount,
} from '../types/oss';
import { formatBytes, formatTime } from '../utils/format';
import { log } from '../utils/logger';

const { Text, Paragraph } = Typography;

const PAGE_SIZE = 20;

const OUTCOME_FILTER_OPTIONS = [
  { value: 'ok', label: 'ok' },
  { value: 'denied', label: 'denied' },
];

const VISIBILITY_FILTER_OPTIONS = [
  { value: 'public', label: 'public' },
  { value: 'private', label: 'private' },
  { value: 'chat', label: 'chat' },
];

function maxBytes(owners: OSSOwnerUsage[] | undefined): number {
  if (!owners?.length) return 0;
  return Math.max(...owners.map((o) => o.bytes), 0);
}

function maxVisBytes(vis: OSSVisibilityCount[] | undefined): number {
  if (!vis?.length) return 0;
  return Math.max(...vis.map((v) => v.bytes), 0);
}

export default function OSSPage() {
  const { token } = theme.useToken();
  const [activeTab, setActiveTab] = useState('overview');

  const [usage, setUsage] = useState<OSSUsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const [buckets, setBuckets] = useState<OSSBucketSummary[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);
  const [detailBucket, setDetailBucket] = useState<OSSBucketSummary | null>(null);
  const [objects, setObjects] = useState<OSSObjectSummary[]>([]);
  const [objectsTotal, setObjectsTotal] = useState(0);
  const [objectsPage, setObjectsPage] = useState(1);
  const [objOwner, setObjOwner] = useState('');
  const [objVisibility, setObjVisibility] = useState<string | undefined>(undefined);
  const [objMime, setObjMime] = useState('');
  const [objectsLoading, setObjectsLoading] = useState(false);

  const [audit, setAudit] = useState<OSSAuditEvent[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditAction, setAuditAction] = useState('');
  const [auditActorId, setAuditActorId] = useState('');
  const [auditFileKey, setAuditFileKey] = useState('');
  const [auditOutcome, setAuditOutcome] = useState<string | undefined>(undefined);
  const [auditLoading, setAuditLoading] = useState(false);

  const [federationKey, setFederationKey] = useState<OSSFederationLocalKey | null>(null);
  const [federationPeers, setFederationPeers] = useState<OSSFederationPeer[]>([]);
  const [federationLoading, setFederationLoading] = useState(false);
  const [peerActionId, setPeerActionId] = useState<string | null>(null);

  const objectFiltersRef = useRef({ objOwner, objVisibility, objMime });
  objectFiltersRef.current = { objOwner, objVisibility, objMime };
  const auditFiltersRef = useRef({
    auditAction,
    auditActorId,
    auditFileKey,
    auditOutcome,
  });
  auditFiltersRef.current = {
    auditAction,
    auditActorId,
    auditFileKey,
    auditOutcome,
  };

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const data = await ossApi.getOSSUsage();
      setUsage(data);
    } catch (err) {
      log.error('oss', 'Failed to load usage');
      message.error('Failed to load OSS usage');
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const loadBuckets = useCallback(async () => {
    setBucketsLoading(true);
    try {
      const { items } = await ossApi.listBuckets();
      setBuckets(items || []);
    } catch (err) {
      log.error('oss', 'Failed to load buckets');
      message.error('Failed to load buckets');
    } finally {
      setBucketsLoading(false);
    }
  }, []);

  const fetchObjects = useCallback(async (page: number) => {
    if (!detailBucket) return;
    const f = objectFiltersRef.current;
    setObjectsLoading(true);
    try {
      const r = await ossApi.listBucketObjects(detailBucket.id, {
        page,
        page_size: PAGE_SIZE,
        owner_actor_id: f.objOwner || undefined,
        visibility: f.objVisibility,
        mime: f.objMime || undefined,
      });
      setObjects(r.items || []);
      setObjectsTotal(Number(r.total));
      setObjectsPage(page);
    } catch (err) {
      log.error('oss', 'Failed to load objects');
      message.error('Failed to load objects');
    } finally {
      setObjectsLoading(false);
    }
  }, [detailBucket]);

  const fetchAudit = useCallback(async (page: number) => {
    setAuditLoading(true);
    const f = auditFiltersRef.current;
    try {
      const r = await ossApi.getOSSAudit({
        page,
        page_size: PAGE_SIZE,
        action: f.auditAction || undefined,
        actor_id: f.auditActorId || undefined,
        file_key: f.auditFileKey || undefined,
        outcome: f.auditOutcome,
      });
      setAudit(r.items || []);
      setAuditTotal(Number(r.total));
      setAuditPage(page);
    } catch (err) {
      log.error('oss', 'Failed to load OSS audit');
      message.error('Failed to load audit log');
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const loadFederation = useCallback(async () => {
    setFederationLoading(true);
    try {
      const [me, peers] = await Promise.all([ossApi.getFederationMe(), ossApi.getFederationPeers()]);
      setFederationKey(me);
      setFederationPeers(peers.items || []);
    } catch (err) {
      log.error('oss', 'Failed to load federation');
      message.error('Failed to load federation');
    } finally {
      setFederationLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'overview') loadUsage();
  }, [activeTab, loadUsage]);

  useEffect(() => {
    if (activeTab === 'buckets' && !detailBucket) loadBuckets();
  }, [activeTab, detailBucket, loadBuckets]);

  useEffect(() => {
    if (activeTab === 'buckets' && detailBucket) void fetchObjects(objectsPage);
  }, [activeTab, detailBucket, objectsPage, fetchObjects]);

  useEffect(() => {
    if (activeTab === 'audit') void fetchAudit(auditPage);
  }, [activeTab, auditPage, fetchAudit]);

  useEffect(() => {
    if (activeTab === 'federation') loadFederation();
  }, [activeTab, loadFederation]);

  const topOwnerMax = useMemo(() => maxBytes(usage?.top_owners), [usage]);
  const visMax = useMemo(() => maxVisBytes(usage?.visibility_mix), [usage]);

  const refresh = () => {
    if (activeTab === 'overview') loadUsage();
    if (activeTab === 'buckets' && !detailBucket) loadBuckets();
    if (activeTab === 'buckets' && detailBucket) void fetchObjects(objectsPage);
    if (activeTab === 'audit') void fetchAudit(auditPage);
    if (activeTab === 'federation') loadFederation();
  };

  const onCopyPem = async (pem: string) => {
    try {
      await navigator.clipboard.writeText(pem);
      message.success('Copied');
    } catch {
      message.error('Copy failed');
    }
  };

  const onPin = async (id: string) => {
    setPeerActionId(id);
    try {
      await ossApi.pinFederationPeer(id);
      message.success('Peer pinned');
      await loadFederation();
    } catch {
      message.error('Failed to pin peer');
    } finally {
      setPeerActionId(null);
    }
  };

  const onUnpin = async (id: string) => {
    setPeerActionId(id);
    try {
      await ossApi.unpinFederationPeer(id);
      message.success('Peer unpinned');
      await loadFederation();
    } catch {
      message.error('Failed to unpin peer');
    } finally {
      setPeerActionId(null);
    }
  };

  const bucketColumns: ColumnsType<OSSBucketSummary> = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v: string) => <Text strong>{v}</Text> },
    { title: 'Owner', dataIndex: 'owner_actor_id', key: 'owner', width: 200, render: (v: string) => <Text code>{v}</Text> },
    { title: 'Kind', dataIndex: 'kind', key: 'kind', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: 'System key',
      dataIndex: 'system_key',
      key: 'system_key',
      width: 120,
      ellipsis: true,
      render: (v: string) => (v ? <Text code copyable>{v}</Text> : <Text type="secondary">—</Text>),
    },
    { title: 'Default vis.', dataIndex: 'default_visibility', key: 'defvis', width: 110, render: (v: string) => <Tag color="blue">{v}</Tag> },
    {
      title: 'Quota / used',
      key: 'quota',
      width: 200,
      render: (_, b) => {
        const q = b.quota_bytes;
        const u = b.used_bytes;
        const pct = q > 0 ? Math.min(100, Math.round((u / q) * 100)) : u > 0 ? 100 : 0;
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatBytes(u)} / {q > 0 ? formatBytes(q) : '—'}
            </Text>
            <Progress percent={pct} size="small" showInfo={false} />
          </Space>
        );
      },
    },
    { title: 'Files', dataIndex: 'file_count', key: 'files', width: 90, align: 'right' },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created',
      width: 170,
      render: (v: string) => formatTime(v),
    },
  ];

  const objectColumns: ColumnsType<OSSObjectSummary> = [
    { title: 'Key', dataIndex: 'key', key: 'key', ellipsis: true, render: (v: string) => <Text code>{v}</Text> },
    { title: 'Name', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: 'Size', dataIndex: 'size', key: 'size', width: 100, render: (n: number) => formatBytes(n) },
    { title: 'MIME', dataIndex: 'mime', key: 'mime', width: 160, ellipsis: true },
    { title: 'Visibility', dataIndex: 'visibility', key: 'vis', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Owner', dataIndex: 'owner_actor_id', key: 'owner', width: 180, ellipsis: true, render: (v: string) => <Text code>{v}</Text> },
    { title: 'Created', dataIndex: 'created_at', key: 'created', width: 170, render: (v: string) => formatTime(v) },
  ];

  const ownerUsageColumns: ColumnsType<OSSOwnerUsage> = [
    { title: 'Owner (actor id)', dataIndex: 'owner_actor_id', key: 'oid', render: (v: string) => <Text code>{v}</Text> },
    { title: 'Files', dataIndex: 'files', key: 'files', width: 100, align: 'right' },
    { title: 'Bytes', dataIndex: 'bytes', key: 'bytes', width: 120, render: (n: number) => formatBytes(n) },
    {
      title: 'Share of top list',
      key: 'bar',
      width: 200,
      render: (_, o) => (
        <Progress
          percent={topOwnerMax > 0 ? Math.round((o.bytes / topOwnerMax) * 100) : 0}
          size="small"
        />
      ),
    },
  ];

  const visColumns: ColumnsType<OSSVisibilityCount> = [
    { title: 'Visibility', dataIndex: 'visibility', key: 'v', width: 120, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
    { title: 'Files', dataIndex: 'files', key: 'files', width: 100, align: 'right' },
    { title: 'Bytes', dataIndex: 'bytes', key: 'bytes', width: 120, render: (n: number) => formatBytes(n) },
    {
      title: 'Bytes (max in mix)',
      key: 'bbar',
      width: 200,
      render: (_, r) => (
        <Progress
          percent={visMax > 0 ? Math.round((r.bytes / visMax) * 100) : 0}
          size="small"
        />
      ),
    },
  ];

  const auditColumns: ColumnsType<OSSAuditEvent> = [
    {
      title: 'Time',
      dataIndex: 'ts',
      key: 'ts',
      width: 170,
      render: (v: string) => formatTime(v),
    },
    { title: 'Action', dataIndex: 'action', key: 'action', width: 120, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: 'Outcome',
      dataIndex: 'outcome',
      key: 'outcome',
      width: 90,
      render: (v: string) => (
        <Tag color={v === 'denied' ? 'red' : v === 'ok' ? 'green' : 'default'}>{v}</Tag>
      ),
    },
    {
      title: 'Reason',
      dataIndex: 'reason',
      key: 'reason',
      width: 200,
      ellipsis: true,
      render: (v: string, r) => (
        <Text
          type={r.outcome === 'denied' ? 'danger' : r.outcome === 'ok' ? 'success' : 'secondary'}
        >
          {v || '—'}
        </Text>
      ),
    },
    {
      title: 'File key',
      dataIndex: 'file_key',
      key: 'file_key',
      ellipsis: true,
      render: (v: string) => <Text code>{v}</Text>,
    },
    { title: 'Bucket', dataIndex: 'bucket_id', key: 'bid', width: 160, ellipsis: true, render: (v: string) => <Text code>{v}</Text> },
    { title: 'Actor', dataIndex: 'actor_id', key: 'aid', width: 160, ellipsis: true, render: (v: string) => <Text code>{v}</Text> },
    { title: 'Peer station', dataIndex: 'peer_station_id', key: 'peer', width: 160, ellipsis: true, render: (v: string) => (v ? <Text code>{v}</Text> : '—') },
    { title: 'Size', dataIndex: 'size_bytes', key: 'sz', width: 100, align: 'right', render: (n: number) => (n > 0 ? formatBytes(n) : '0 B') },
  ];

  const peerColumns: ColumnsType<OSSFederationPeer> = [
    { title: 'Peer station', dataIndex: 'peer_station_id', key: 'ps', render: (v: string) => <Text code>{v}</Text> },
    { title: 'KID', dataIndex: 'kid', key: 'kid', ellipsis: true, render: (v: string) => <Text code>{v}</Text> },
    { title: 'First seen', dataIndex: 'first_seen_at', key: 'fs', width: 170, render: (v: string) => formatTime(v) },
    { title: 'Last seen', dataIndex: 'last_seen_at', key: 'ls', width: 170, render: (v: string) => formatTime(v) },
    { title: 'Pinned', dataIndex: 'pinned', key: 'pin', width: 80, render: (p: boolean) => (p ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>) },
    {
      title: 'Actions',
      key: 'act',
      width: 120,
      render: (_, p) => (
        p.pinned ? (
          <Button
            type="link"
            size="small"
            icon={<PinOff size={14} />}
            loading={peerActionId === p.peer_station_id}
            onClick={() => onUnpin(p.peer_station_id)}
          >
            Unpin
          </Button>
        ) : (
          <Button
            type="link"
            size="small"
            icon={<Pin size={14} />}
            loading={peerActionId === p.peer_station_id}
            onClick={() => onPin(p.peer_station_id)}
          >
            Pin
          </Button>
        )
      ),
    },
  ];

  const overview = (
    <Flexbox gap={16}>
      <Flex gap={16} wrap="wrap" style={{ width: '100%' }}>
        <Card style={{ flex: 1, minWidth: 200 }} loading={usageLoading}>
          <Statistic title="Total storage" value={usage ? formatBytes(usage.total_bytes) : '—'} />
        </Card>
        <Card style={{ flex: 1, minWidth: 200 }} loading={usageLoading}>
          <Statistic title="Total files" value={usage?.total_files ?? 0} />
        </Card>
        <Card style={{ flex: 1, minWidth: 200 }} loading={usageLoading}>
          <Statistic title="Buckets" value={usage?.bucket_count ?? 0} />
        </Card>
      </Flex>
      <Card title="Top owners" loading={usageLoading} styles={{ body: { padding: 0 } }}>
        <Table
          dataSource={usage?.top_owners || []}
          columns={ownerUsageColumns}
          rowKey="owner_actor_id"
          size="small"
          pagination={false}
        />
      </Card>
      <Card title="Visibility mix" loading={usageLoading} styles={{ body: { padding: 0 } }}>
        <Table
          dataSource={usage?.visibility_mix || []}
          columns={visColumns}
          rowKey="visibility"
          size="small"
          pagination={false}
        />
      </Card>
    </Flexbox>
  );

  const bucketsView = !detailBucket ? (
    <Card loading={bucketsLoading} styles={{ body: { padding: 0 } }} title="All buckets">
      <Table
        dataSource={buckets}
        columns={bucketColumns}
        rowKey="id"
        size="small"
        pagination={false}
        onRow={(row) => ({
          onClick: () => {
            setDetailBucket(row);
            setObjectsPage(1);
            setObjOwner('');
            setObjVisibility(undefined);
            setObjMime('');
          },
          style: { cursor: 'pointer' },
        })}
      />
    </Card>
  ) : (
    <Flexbox gap={16}>
      <Space>
        <Button type="text" icon={<ArrowLeft size={16} />} onClick={() => { setDetailBucket(null); setObjectsPage(1); loadBuckets(); }}>
          Back to buckets
        </Button>
        <Text strong>{detailBucket.name}</Text>
        <Text type="secondary" code>
          {detailBucket.id}
        </Text>
      </Space>
      <Space wrap>
        <Input
          allowClear
          placeholder="Owner actor id"
          value={objOwner}
          onChange={(e) => setObjOwner(e.target.value)}
          onPressEnter={() => { void fetchObjects(1); }}
          style={{ width: 220 }}
        />
        <Select
          allowClear
          placeholder="Visibility"
          value={objVisibility}
          onChange={(v) => { setObjVisibility(v); }}
          options={VISIBILITY_FILTER_OPTIONS}
          style={{ width: 140 }}
        />
        <Input
          allowClear
          placeholder="MIME contains"
          value={objMime}
          onChange={(e) => setObjMime(e.target.value)}
          onPressEnter={() => { void fetchObjects(1); }}
          style={{ width: 200 }}
        />
        <Button
          type="primary"
          onClick={() => { void fetchObjects(1); }}
        >
          Apply filters
        </Button>
      </Space>
      <Card styles={{ body: { padding: 0 } }} title="Objects">
        <Table
          dataSource={objects}
          columns={objectColumns}
          rowKey="id"
          size="small"
          loading={objectsLoading}
          pagination={{
            current: objectsPage,
            pageSize: PAGE_SIZE,
            total: objectsTotal,
            showSizeChanger: false,
            onChange: (p) => setObjectsPage(p),
          }}
        />
      </Card>
    </Flexbox>
  );

  const auditPanel = (
    <Flexbox gap={12}>
      <Space wrap>
        <Input
          allowClear
          placeholder="Action"
          value={auditAction}
          onChange={(e) => setAuditAction(e.target.value)}
          style={{ width: 160 }}
        />
        <Input
          allowClear
          placeholder="Actor id"
          value={auditActorId}
          onChange={(e) => setAuditActorId(e.target.value)}
          style={{ width: 200 }}
        />
        <Input
          allowClear
          placeholder="File key"
          value={auditFileKey}
          onChange={(e) => setAuditFileKey(e.target.value)}
          style={{ width: 220 }}
        />
        <Select
          allowClear
          placeholder="Outcome"
          value={auditOutcome}
          onChange={(v) => setAuditOutcome(v)}
          options={OUTCOME_FILTER_OPTIONS}
          style={{ width: 120 }}
        />
        <Button
          type="primary"
          onClick={() => { void fetchAudit(1); }}
        >
          Search
        </Button>
      </Space>
      <Card styles={{ body: { padding: 0 } }} title="OSS audit">
        <Table
          dataSource={audit}
          columns={auditColumns}
          rowKey="id"
          size="small"
          loading={auditLoading}
          scroll={{ x: 1400 }}
          pagination={{
            current: auditPage,
            pageSize: PAGE_SIZE,
            total: auditTotal,
            showSizeChanger: false,
            onChange: (p) => setAuditPage(p),
          }}
        />
      </Card>
    </Flexbox>
  );

  const federationPanel = (
    <Flexbox gap={16}>
      <Card title="Local federation key" loading={federationLoading}>
        {federationKey ? (
          <Flexbox gap={8}>
            <Space>
              <Text type="secondary">KID</Text>
              <Text code copyable>
                {federationKey.kid}
              </Text>
              {federationKey.generated ? <Tag>generated</Tag> : null}
            </Space>
            <Space align="start">
              <Button size="small" icon={<Copy size={14} />} onClick={() => onCopyPem(federationKey.public_key_pem)}>
                Copy public PEM
              </Button>
            </Space>
            <pre
              style={{
                maxHeight: 200,
                overflow: 'auto',
                fontSize: 12,
                padding: 12,
                margin: 0,
                background: token.colorFillQuaternary,
                borderRadius: token.borderRadius,
              }}
            >
              {federationKey.public_key_pem}
            </pre>
            <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
              Private key is not exposed via the dashboard.
            </Paragraph>
          </Flexbox>
        ) : null}
      </Card>
      <Card title="Federation peers" loading={federationLoading} styles={{ body: { padding: 0 } }}>
        <Table
          dataSource={federationPeers}
          columns={peerColumns}
          rowKey="peer_station_id"
          size="small"
        />
      </Card>
    </Flexbox>
  );

  return (
    <Flexbox gap={0}>
      <PageHeader
        title="Object storage (OSS)"
        subtitle="Usage, buckets, access audit, and federation"
        extra={
          <RefreshCw
            size={16}
            style={{ cursor: 'pointer' }}
            onClick={refresh}
          />
        }
      />
      <div style={{ padding: 24 }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'overview', label: 'Overview', children: overview },
            { key: 'buckets', label: 'Buckets', children: bucketsView },
            { key: 'audit', label: 'Audit', children: auditPanel },
            {
              key: 'federation',
              label: (
                <span>
                  <Cloud size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Federation
                </span>
              ),
              children: federationPanel,
            },
          ]}
        />
      </div>
    </Flexbox>
  );
}
