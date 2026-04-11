/**
 * SystemPage — System information, routes, and sub-server status.
 * Aggregates data from multiple system API endpoints into a tabbed view.
 *
 * Created: 2026-04-10
 * Changed: 2026-04-10 — Removed fake fields (version, node_name, database_driver)
 *   that had no real data source. Only shows runtime-verifiable fields.
 */

import { useState, useEffect, useCallback } from 'react';
import { Table, Descriptions, Typography, Tabs, Tag, Spin } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import { Info, Route, Server } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import * as systemApi from '../api/system';
import { formatTime } from '../utils/format';
import { log } from '../utils/logger';

const { Text } = Typography;

const METHOD_COLORS: Record<string, string> = {
  GET: 'green',
  POST: 'blue',
  PUT: 'orange',
  PATCH: 'orange',
  DELETE: 'red',
};

interface SystemInfo {
  go_version: string;
  listen_addr: string;
  started_at: string;
}

interface SubServerItem {
  name: string;
  type: string;
  status: string;
}

export default function SystemPage() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [routes, setRoutes] = useState<systemApi.RouteInfo[]>([]);
  const [subservers, setSubservers] = useState<SubServerItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [info, routeData, subData] = await Promise.all([
        systemApi.getSystemInfo(),
        systemApi.getSystemRoutes(),
        systemApi.getSystemSubservers(),
      ]);
      setSystemInfo(info);
      setRoutes(routeData.routes || []);
      setSubservers(subData.items || []);
    } catch (err) {
      log.error('system', 'Failed to load system data');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%', minHeight: 300 }}>
        <Spin size="large" />
      </Flexbox>
    );
  }

  const routeColumns: ColumnsType<systemApi.RouteInfo> = [
    {
      title: 'Method',
      dataIndex: 'method',
      key: 'method',
      width: 80,
      render: (m: string) => (
        <Tag color={METHOD_COLORS[m] || 'default'}>{m}</Tag>
      ),
    },
    {
      title: 'Path',
      dataIndex: 'path',
      key: 'path',
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
    },
  ];

  const subserverColumns: ColumnsType<SubServerItem> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <StatusBadge status={s} />,
    },
  ];

  const tabItems = [
    {
      key: 'info',
      label: (
        <span>
          <Info size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          System Info
        </span>
      ),
      children: systemInfo ? (
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="Go Version">{systemInfo.go_version}</Descriptions.Item>
          <Descriptions.Item label="Listen Address">
            <Text code>{systemInfo.listen_addr}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Started At">{formatTime(systemInfo.started_at)}</Descriptions.Item>
        </Descriptions>
      ) : (
        <Text type="secondary">System information unavailable</Text>
      ),
    },
    {
      key: 'routes',
      label: (
        <span>
          <Route size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Routes ({routes.length})
        </span>
      ),
      children: (
        <Table
          dataSource={routes}
          columns={routeColumns}
          rowKey={(r) => `${r.method}-${r.path}`}
          size="small"
          pagination={{ pageSize: 50, showTotal: (t) => `Total ${t} routes` }}
        />
      ),
    },
    {
      key: 'subservers',
      label: (
        <span>
          <Server size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          SubServers
        </span>
      ),
      children: (
        <Table
          dataSource={subservers}
          columns={subserverColumns}
          rowKey="name"
          size="small"
          pagination={false}
        />
      ),
    },
  ];

  return (
    <Flexbox gap={0}>
      <PageHeader title="System" subtitle="System information and configuration" />

      <Flexbox style={{ padding: 24 }}>
        <Tabs items={tabItems} />
      </Flexbox>
    </Flexbox>
  );
}
