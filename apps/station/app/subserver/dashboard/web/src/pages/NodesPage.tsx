/**
 * NodesPage — P2P node overview.
 *
 * Two complementary lists are rendered:
 *  1. Persisted Peers — rows from touch_peer + touch_peer_address. These
 *     are peers the station has *seen* and persisted (history).
 *  2. Live Registrations — registry.Registry.Query() result. These are
 *     peers/components currently registered with this process (now).
 *
 * If the registry is not configured the second card simply shows an empty
 * table (NEVER mocked).
 */

import { useCallback, useEffect, useState } from 'react';
import { Card, Statistic, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import { Network, RefreshCw, Server } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import * as nodesApi from '../api/nodes';
import { formatTime, formatRelativeTime } from '../utils/format';
import { log } from '../utils/logger';

const { Text } = Typography;

const ADDR_TYPE_COLOR: Record<string, string> = {
  stun: 'blue',
  'turn-relay': 'gold',
  http: 'green',
};

const REG_TYPE_COLOR: Record<string, string> = {
  component: 'blue',
  node: 'green',
};

export default function NodesPage() {
  const [overview, setOverview] = useState<nodesApi.NodesOverview | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await nodesApi.getNodesOverview();
      setOverview(data);
    } catch (err) {
      log.error('nodes', 'Failed to load nodes overview');
      message.error('Failed to load nodes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const persisted = overview?.persisted || [];
  const registrations = overview?.registrations || [];

  const peerColumns: ColumnsType<nodesApi.PersistedPeer> = [
    {
      title: 'Peer ID',
      dataIndex: 'peer_id',
      key: 'peer_id',
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 160,
      render: (v: string) => (v ? <Text strong>{v}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Version',
      dataIndex: 'version',
      key: 'version',
      width: 110,
      render: (v: string) => (v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Addresses',
      key: 'addresses',
      render: (_, r) => (
        <Flexbox gap={4}>
          {(r.addresses || []).length === 0 ? (
            <Text type="secondary">no addresses</Text>
          ) : (
            r.addresses.map((a, i) => (
              <Flexbox horizontal gap={6} align="center" key={`${a.type}-${a.addr}-${i}`}>
                <Tag color={ADDR_TYPE_COLOR[a.type] || 'default'}>{a.type}</Tag>
                <Text code style={{ fontSize: 12 }}>{a.addr}</Text>
              </Flexbox>
            ))
          )}
        </Flexbox>
      ),
    },
    {
      title: 'Updated',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 160,
      render: (v: string) => formatRelativeTime(v),
    },
  ];

  const regColumns: ColumnsType<nodesApi.RegistryRegistration> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 180,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 110,
      render: (v: string) => <Tag color={REG_TYPE_COLOR[v] || 'default'}>{v || '—'}</Tag>,
    },
    {
      title: 'Namespaces',
      dataIndex: 'namespaces',
      key: 'namespaces',
      render: (v: string[]) => (
        v?.length ? v.map((n) => <Tag key={n}>{n}</Tag>) : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'Addresses',
      dataIndex: 'addresses',
      key: 'addresses',
      render: (v: string[]) => (
        v?.length ? v.map((a) => (
          <div key={a}><Text code style={{ fontSize: 12 }}>{a}</Text></div>
        )) : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'TTL',
      dataIndex: 'ttl_seconds',
      key: 'ttl',
      width: 90,
      render: (v?: number) => (v ? `${v}s` : <Text type="secondary">—</Text>),
    },
  ];

  return (
    <Flexbox gap={0}>
      <PageHeader
        title="Nodes"
        subtitle="Persisted peers and live registry registrations"
        extra={
          <RefreshCw
            size={16}
            style={{ cursor: 'pointer' }}
            onClick={load}
          />
        }
      />

      <Flexbox style={{ padding: 24 }} gap={16}>
        <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
          <Card style={{ flex: 1, minWidth: 220 }} loading={loading}>
            <Statistic
              title="Persisted Peers"
              value={persisted.length}
              prefix={<Server size={16} style={{ marginRight: 4 }} />}
              suffix="in touch_peer"
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 220 }} loading={loading}>
            <Statistic
              title="Live Registrations"
              value={registrations.length}
              prefix={<Network size={16} style={{ marginRight: 4 }} />}
              suffix="in registry"
            />
          </Card>
        </Flexbox>

        <Card title="Persisted Peers" loading={loading} styles={{ body: { padding: 0 } }}>
          <Table
            dataSource={persisted}
            columns={peerColumns}
            rowKey={(r) => r.peer_id || String(r.id)}
            size="small"
            pagination={{ pageSize: 20 }}
            locale={{ emptyText: 'No persisted peers' }}
          />
        </Card>

        <Card title="Live Registrations" loading={loading} styles={{ body: { padding: 0 } }}>
          <Table
            dataSource={registrations}
            columns={regColumns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20 }}
            locale={{
              emptyText: 'No live registrations (registry may not be configured)',
            }}
            expandable={{
              expandedRowRender: (r) => (
                r.metadata && Object.keys(r.metadata).length > 0 ? (
                  <Flexbox gap={4}>
                    <Text strong style={{ fontSize: 12 }}>Metadata</Text>
                    {Object.entries(r.metadata).map(([k, v]) => (
                      <div key={k}>
                        <Text type="secondary">{k}: </Text>
                        <Text code style={{ fontSize: 12 }}>{v}</Text>
                      </div>
                    ))}
                  </Flexbox>
                ) : <Text type="secondary">No metadata</Text>
              ),
              rowExpandable: (r) => Boolean(r.metadata && Object.keys(r.metadata).length > 0),
            }}
          />
        </Card>

        {persisted.length > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Last loaded {formatTime(new Date().toISOString())}
          </Text>
        )}
      </Flexbox>
    </Flexbox>
  );
}
