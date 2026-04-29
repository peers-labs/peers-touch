/**
 * OSSPage — Operator surface for the OSS subserver's federation
 * trust state and background-worker health.
 *
 * Two tabs:
 *
 *   - **Workers**: per-worker heartbeats projected from the durable
 *     `oss_audit` table. The traffic-light reflects "did this
 *     worker emit a successful run recently?" — the threshold for
 *     "recently" is 2× the worker's nominal interval, derived from
 *     the lookback window the operator picks.
 *
 *   - **Federation**: this station's federation identity, the list
 *     of known remote peers, and the destructive operations the
 *     operator can perform (rotate local key, pin / unpin / forget
 *     a peer). Each destructive action wears its own confirmation
 *     modal — these are not buttons you want to misclick.
 *
 * The page intentionally does NOT yet expose bucket / object /
 * audit listings — those are richer surfaces with their own design
 * iteration; this slice ships the operator-critical control plane.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Card, Descriptions, Modal, Popconfirm, Segmented,
  Space, Statistic, Table, Tabs, Tag, Tooltip, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import {
  Activity, AlertTriangle, CheckCircle2, KeyRound, Network,
  RefreshCw, ShieldCheck, ShieldOff, Trash2, XCircle,
} from 'lucide-react';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader';
import * as ossApi from '../api/oss';
import { log } from '../utils/logger';
// `formatRelativeTime` / `formatTime` extend dayjs with the
// relativeTime plugin as a side-effect of being imported. Pulling
// them in here (even if we re-derive the formatted string with the
// extra zero-time handling below) keeps the plugin wiring on a
// single static-import path so Vite produces one chunk per plugin.
import { formatRelativeTime, formatTime } from '../utils/format';
import { BucketsTab } from './oss/BucketsTab';
import { ObjectsTab } from './oss/ObjectsTab';
import { AuditTab } from './oss/AuditTab';
import { UsageTab } from './oss/UsageTab';

const { Text, Paragraph } = Typography;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Detects the Go zero-time sentinel that the JSON encoder emits
 * when a `time.Time` field has not been set. We render those rows
 * as "never" so the operator does not see a 1-AD timestamp.
 */
function isZeroTime(ts: string | undefined): boolean {
  if (!ts) return true;
  return ts.startsWith('0001-01-01');
}

function formatRelative(ts: string | undefined): string {
  if (isZeroTime(ts)) return 'never';
  return formatRelativeTime(ts!);
}

function formatAbsolute(ts: string | undefined): string {
  if (isZeroTime(ts)) return '—';
  return formatTime(ts!);
}

/** Truncate a long opaque string (KID / PEM) to a fingerprint. */
function shortHash(s: string, head = 10, tail = 6): string {
  if (!s) return '';
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

// ---------------------------------------------------------------------------
// Workers tab
// ---------------------------------------------------------------------------

type WorkerSeverity = 'ok' | 'warn' | 'error';

/**
 * Decide the alert light for a worker row.
 *
 * - **error**: most recent run failed, OR the worker has any
 *   errors in the window AND its last run is older than half the
 *   lookback window (i.e. errors are sticking, not transient).
 * - **warn**: no run in the lookback window at all (the worker
 *   may be wedged or simply paused — either way the operator
 *   should look).
 * - **ok**: most recent run was a success.
 */
function workerSeverity(
  hb: ossApi.OSSWorkerHeartbeat,
  lookbackHours: number,
): WorkerSeverity {
  if (isZeroTime(hb.last_run_at)) return 'warn';
  if (hb.last_outcome === 'error') return 'error';
  if (hb.error_count > 0) {
    const ageHours = dayjs().diff(dayjs(hb.last_run_at), 'hour', true);
    if (ageHours > lookbackHours / 2) return 'error';
  }
  return 'ok';
}

function severityColor(s: WorkerSeverity): string {
  switch (s) {
    case 'ok':    return '#52c41a';
    case 'warn':  return '#faad14';
    case 'error': return '#ff4d4f';
  }
}

function SeverityIcon({ severity }: { severity: WorkerSeverity }) {
  const size = 16;
  switch (severity) {
    case 'ok':    return <CheckCircle2 size={size} color={severityColor(severity)} />;
    case 'warn':  return <AlertTriangle size={size} color={severityColor(severity)} />;
    case 'error': return <XCircle size={size} color={severityColor(severity)} />;
  }
}

const LOOKBACK_OPTIONS = [
  { label: '24 hours', value: 24 },
  { label: '7 days',   value: 24 * 7 },
  { label: '30 days',  value: 24 * 30 },
];

function WorkersTab() {
  const [hours, setHours] = useState<number>(24);
  const [data, setData] = useState<ossApi.OSSWorkersSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await ossApi.listWorkers(hours);
      setData(resp);
    } catch (err) {
      log.error('oss', 'Failed to load workers');
      message.error('Failed to load workers');
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => { load(); }, [load]);

  const items = data?.items ?? [];
  const errorCount = useMemo(
    () => items.filter((w) => workerSeverity(w, hours) === 'error').length,
    [items, hours],
  );
  const warnCount = useMemo(
    () => items.filter((w) => workerSeverity(w, hours) === 'warn').length,
    [items, hours],
  );

  const columns: ColumnsType<ossApi.OSSWorkerHeartbeat> = [
    {
      title: '',
      key: 'severity',
      width: 40,
      align: 'center',
      render: (_, w) => <SeverityIcon severity={workerSeverity(w, hours)} />,
    },
    {
      title: 'Worker',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: 'Last run',
      dataIndex: 'last_run_at',
      key: 'last_run_at',
      width: 200,
      render: (v: string) => (
        <Tooltip title={formatAbsolute(v)}>
          <Text>{formatRelative(v)}</Text>
        </Tooltip>
      ),
      sorter: (a, b) => {
        if (isZeroTime(a.last_run_at)) return -1;
        if (isZeroTime(b.last_run_at)) return 1;
        return dayjs(a.last_run_at).valueOf() - dayjs(b.last_run_at).valueOf();
      },
    },
    {
      title: 'Outcome',
      dataIndex: 'last_outcome',
      key: 'last_outcome',
      width: 110,
      render: (v: string) => {
        if (!v) return <Text type="secondary">—</Text>;
        const color = v === 'ok' ? 'green' : v === 'error' ? 'red' : 'default';
        return <Tag color={color}>{v}</Tag>;
      },
    },
    {
      title: 'Runs',
      dataIndex: 'run_count',
      key: 'run_count',
      width: 90,
      align: 'right',
      sorter: (a, b) => a.run_count - b.run_count,
      render: (v: number) => <Text>{v.toLocaleString()}</Text>,
    },
    {
      title: 'Errors',
      dataIndex: 'error_count',
      key: 'error_count',
      width: 90,
      align: 'right',
      sorter: (a, b) => a.error_count - b.error_count,
      render: (v: number) => (
        v > 0
          ? <Text style={{ color: severityColor('error') }}>{v.toLocaleString()}</Text>
          : <Text type="secondary">0</Text>
      ),
    },
    {
      title: 'Last error',
      dataIndex: 'last_error',
      key: 'last_error',
      ellipsis: { showTitle: false },
      render: (v: string) => v
        ? <Tooltip title={v}><Text type="danger">{v}</Text></Tooltip>
        : <Text type="secondary">—</Text>,
    },
  ];

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
        <Card style={{ flex: 1, minWidth: 200 }} loading={loading}>
          <Statistic
            title="Workers tracked"
            value={items.length}
            prefix={<Activity size={16} style={{ marginRight: 4 }} />}
          />
        </Card>
        <Card style={{ flex: 1, minWidth: 200 }} loading={loading}>
          <Statistic
            title="In error"
            value={errorCount}
            valueStyle={{ color: errorCount > 0 ? severityColor('error') : undefined }}
            prefix={<XCircle size={16} style={{ marginRight: 4 }} />}
          />
        </Card>
        <Card style={{ flex: 1, minWidth: 200 }} loading={loading}>
          <Statistic
            title="Idle / no heartbeat"
            value={warnCount}
            valueStyle={{ color: warnCount > 0 ? severityColor('warn') : undefined }}
            prefix={<AlertTriangle size={16} style={{ marginRight: 4 }} />}
          />
        </Card>
      </Flexbox>

      {errorCount > 0 ? (
        <Alert
          type="error"
          showIcon
          message={`${errorCount} worker${errorCount === 1 ? '' : 's'} reporting errors in the last ${hours}h`}
          description="Inspect the Last error column below. Persistent failures usually indicate a misconfigured backend (S3 unreachable) or a database lock contention; check /sub-oss/healthz for the underlying probe state."
        />
      ) : null}

      <Card
        title={
          <Flexbox horizontal align="center" gap={12}>
            <Text strong>Background workers</Text>
            <Tag color="default">heartbeat from oss_audit</Tag>
          </Flexbox>
        }
        extra={
          <Space>
            <Segmented
              value={hours}
              onChange={(v) => setHours(Number(v))}
              options={LOOKBACK_OPTIONS}
              size="small"
            />
            <Button
              icon={<RefreshCw size={14} />}
              onClick={load}
              loading={loading}
              size="small"
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
          rowKey="name"
          size="small"
          loading={loading}
          pagination={false}
          locale={{
            emptyText: loading ? 'Loading…' : 'No worker heartbeats in this window',
          }}
        />
      </Card>
    </Flexbox>
  );
}

// ---------------------------------------------------------------------------
// Federation tab
// ---------------------------------------------------------------------------

function FederationTab() {
  const [localKey, setLocalKey] = useState<ossApi.OSSFederationLocalKey | null>(null);
  const [peers, setPeers] = useState<ossApi.OSSFederationPeer[]>([]);
  const [loading, setLoading] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [busyPeer, setBusyPeer] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [me, peerResp] = await Promise.all([
        ossApi.getFederationLocalKey(),
        ossApi.listFederationPeers(),
      ]);
      setLocalKey(me);
      setPeers(peerResp.items ?? []);
    } catch (err) {
      log.error('oss', 'Failed to load federation state');
      message.error('Failed to load federation state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRotate = useCallback(() => {
    Modal.confirm({
      title: 'Rotate the local federation key?',
      icon: <KeyRound size={18} />,
      content: (
        <Space direction="vertical" size={8}>
          <Paragraph style={{ marginBottom: 0 }}>
            A fresh Ed25519 keypair will be generated. The current key is
            kept in a secondary slot for a 24-hour dual-sign window so
            in-flight tokens still verify.
          </Paragraph>
          <Paragraph type="warning" style={{ marginBottom: 0 }}>
            Pinned remote peers will see <Text code>peer_pinned_mismatch</Text>{' '}
            on their next request — operators on the remote side must re-pin.
            This is the correct behaviour for true pinning.
          </Paragraph>
        </Space>
      ),
      okText: 'Rotate now',
      okButtonProps: { danger: true },
      onOk: async () => {
        setRotating(true);
        try {
          const resp = await ossApi.rotateFederationLocalKey();
          message.success(`Rotated to ${shortHash(resp.new_kid)}`);
          await load();
        } catch (err) {
          log.error('oss', 'Federation rotate failed');
          message.error('Federation rotate failed');
        } finally {
          setRotating(false);
        }
      },
    });
  }, [load]);

  const onPin = useCallback(async (peerStationID: string) => {
    setBusyPeer(peerStationID);
    try {
      await ossApi.pinPeer(peerStationID);
      message.success('Peer pinned');
      await load();
    } catch (err) {
      log.error('oss', 'Pin failed');
      message.error('Pin failed');
    } finally {
      setBusyPeer(null);
    }
  }, [load]);

  const onUnpin = useCallback(async (peerStationID: string) => {
    setBusyPeer(peerStationID);
    try {
      await ossApi.unpinPeer(peerStationID);
      message.success('Peer unpinned');
      await load();
    } catch (err) {
      log.error('oss', 'Unpin failed');
      message.error('Unpin failed');
    } finally {
      setBusyPeer(null);
    }
  }, [load]);

  const onForget = useCallback(async (peerStationID: string) => {
    setBusyPeer(peerStationID);
    try {
      await ossApi.forgetPeer(peerStationID);
      message.success('Peer forgotten — next request re-TOFUs');
      await load();
    } catch (err) {
      log.error('oss', 'Forget failed');
      message.error('Forget failed');
    } finally {
      setBusyPeer(null);
    }
  }, [load]);

  const peerColumns: ColumnsType<ossApi.OSSFederationPeer> = [
    {
      title: 'Peer station',
      dataIndex: 'peer_station_id',
      key: 'peer_station_id',
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: 'KID',
      dataIndex: 'kid',
      key: 'kid',
      width: 220,
      render: (v: string) => (
        <Tooltip title={v}>
          <Text code>{shortHash(v, 12, 6)}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Trust',
      dataIndex: 'pinned',
      key: 'pinned',
      width: 110,
      align: 'center',
      filters: [
        { text: 'Pinned', value: true },
        { text: 'TOFU', value: false },
      ],
      onFilter: (value, record) => record.pinned === value,
      render: (pinned: boolean) => pinned
        ? <Badge status="success" text="pinned" />
        : <Badge status="default" text="TOFU" />,
    },
    {
      title: 'Last seen',
      dataIndex: 'last_seen_at',
      key: 'last_seen_at',
      width: 180,
      render: (v: string) => (
        <Tooltip title={formatAbsolute(v)}>
          <Text>{formatRelative(v)}</Text>
        </Tooltip>
      ),
      sorter: (a, b) => dayjs(a.last_seen_at).valueOf() - dayjs(b.last_seen_at).valueOf(),
    },
    {
      title: 'First seen',
      dataIndex: 'first_seen_at',
      key: 'first_seen_at',
      width: 160,
      render: (v: string) => (
        <Tooltip title={formatAbsolute(v)}>
          <Text type="secondary">{formatRelative(v)}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 240,
      align: 'right',
      render: (_, peer) => {
        const busy = busyPeer === peer.peer_station_id;
        return (
          <Space size={4}>
            {peer.pinned ? (
              <Button
                size="small"
                icon={<ShieldOff size={14} />}
                disabled={busy}
                onClick={() => onUnpin(peer.peer_station_id)}
              >
                Unpin
              </Button>
            ) : (
              <Button
                size="small"
                type="primary"
                icon={<ShieldCheck size={14} />}
                disabled={busy}
                onClick={() => onPin(peer.peer_station_id)}
              >
                Pin
              </Button>
            )}
            <Popconfirm
              title="Forget this peer?"
              description={
                <span>
                  The TOFU row is hard-deleted. The next inbound request from{' '}
                  <Text code>{peer.peer_station_id}</Text> will re-pair from
                  scratch — even if the peer rotated their key.
                </span>
              }
              okText="Forget"
              okButtonProps={{ danger: true }}
              onConfirm={() => onForget(peer.peer_station_id)}
            >
              <Button
                size="small"
                danger
                icon={<Trash2 size={14} />}
                disabled={busy}
              >
                Forget
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <Flexbox gap={16}>
      <Card
        title={
          <Flexbox horizontal align="center" gap={12}>
            <Text strong>This station's federation identity</Text>
            {localKey?.generated ? (
              <Tag color="blue">just generated</Tag>
            ) : null}
          </Flexbox>
        }
        loading={loading}
        extra={
          <Button
            danger
            icon={<KeyRound size={14} />}
            onClick={onRotate}
            loading={rotating}
            size="small"
          >
            Rotate local key
          </Button>
        }
      >
        {localKey ? (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="KID">
              <Text code copyable={{ text: localKey.kid }}>{localKey.kid}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Public key (PEM)">
              <Paragraph
                copyable={{ text: localKey.public_key_pem }}
                style={{ marginBottom: 0, fontFamily: 'monospace', fontSize: 12 }}
              >
                {shortHash(localKey.public_key_pem.replace(/\s+/g, ' '), 60, 30)}
              </Paragraph>
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Text type="secondary">No local federation key wired.</Text>
        )}
      </Card>

      <Card
        title={
          <Flexbox horizontal align="center" gap={12}>
            <Text strong>Known peers</Text>
            <Tag color="default">{peers.length} total</Tag>
          </Flexbox>
        }
        loading={loading}
        extra={
          <Button
            icon={<RefreshCw size={14} />}
            onClick={load}
            loading={loading}
            size="small"
          >
            Refresh
          </Button>
        }
        styles={{ body: { padding: 0 } }}
      >
        <Table
          dataSource={peers}
          columns={peerColumns}
          rowKey="peer_station_id"
          size="small"
          loading={loading}
          pagination={false}
          locale={{
            emptyText: loading ? 'Loading…' : 'No federated peers yet',
          }}
        />
      </Card>
    </Flexbox>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

type OSSTabKey = 'buckets' | 'objects' | 'audit' | 'usage' | 'workers' | 'federation';

const OSS_TAB_KEYS: OSSTabKey[] = ['buckets', 'objects', 'audit', 'usage', 'workers', 'federation'];

/**
 * Read the OSS sub-tab from the URL hash.
 *
 * The dashboard router (`useHashRouter`) consumes only the first
 * segment after `#/`, so we are free to claim the rest of the path
 * for in-page state. `#/oss/audit` therefore selects the Audit tab
 * without disturbing the top-level routing.
 *
 * Unknown / missing tabs collapse to `buckets` — the default
 * landing surface — instead of throwing, so a stale bookmark from
 * a previous build does not 404 the user.
 */
function readTabFromHash(): OSSTabKey {
  const hash = window.location.hash || '';
  const segments = hash.replace(/^#\/?/, '').split('/');
  const candidate = segments[1] as OSSTabKey | undefined;
  if (candidate && OSS_TAB_KEYS.includes(candidate)) {
    return candidate;
  }
  return 'buckets';
}

export default function OSSPage() {
  // Buckets is the most operator-natural landing surface (it's where
  // any "let me look at the OSS state" workflow starts), so it's the
  // default tab. Workers / Federation stay in the panel for the
  // health-monitoring flow that originally shipped first.
  const [tab, setTab] = useState<OSSTabKey>(() => readTabFromHash());

  // Keep state in sync when the user uses browser back/forward, or
  // pastes a deep-link into a new tab. The popstate / hashchange
  // listeners installed by `useHashRouter` will already have updated
  // `window.location.hash` by the time these fire.
  useEffect(() => {
    const sync = () => setTab(readTabFromHash());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const handleTabChange = useCallback((next: string) => {
    const k = next as OSSTabKey;
    setTab(k);
    // Push the new tab into the URL so a refresh / share preserves
    // the active tab. We use `pushState` so back/forward walk the
    // operator's tab history.
    const target = `#/oss/${k}`;
    if (window.location.hash !== target) {
      window.history.pushState(null, '', target);
    }
  }, []);

  return (
    <Flexbox gap={0}>
      <PageHeader
        title="OSS"
        subtitle="File subserver — buckets, objects, audit, usage, federation trust, and background-worker health"
        extra={
          <Flexbox horizontal gap={6} align="center">
            <Network size={14} />
            <Text type="secondary" style={{ fontSize: 12 }}>v3</Text>
          </Flexbox>
        }
      />

      <Flexbox style={{ padding: '0 24px 24px' }}>
        <Tabs
          activeKey={tab}
          onChange={handleTabChange}
          items={[
            { key: 'buckets',    label: 'Buckets',    children: <BucketsTab /> },
            { key: 'objects',    label: 'Objects',    children: <ObjectsTab /> },
            { key: 'audit',      label: 'Audit',      children: <AuditTab /> },
            { key: 'usage',      label: 'Usage',      children: <UsageTab /> },
            { key: 'workers',    label: 'Workers',    children: <WorkersTab /> },
            { key: 'federation', label: 'Federation', children: <FederationTab /> },
          ]}
          destroyOnHidden
        />
      </Flexbox>
    </Flexbox>
  );
}
