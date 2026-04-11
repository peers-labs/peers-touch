/**
 * OverviewPage — Dashboard home screen displaying aggregated system statistics
 * and recent activity feeds (actors + audit logs).
 *
 * Only displays fields backed by real database/runtime data.
 * Polls the overview stats endpoint every 30 seconds.
 *
 * Created: 2026-04-10
 * Changed: 2026-04-10 — Removed fake data cards (Sessions stats, System Uptime,
 *   hardcoded version). Only real DB/runtime data is shown.
 */

import { useState, useCallback } from 'react';
import { Table, Typography, Tag, Card } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import {
  Users,
  Server,
  Cpu,
  MessageSquare,
} from 'lucide-react';

import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import * as overviewApi from '../api/overview';
import { usePolling } from '../hooks/usePolling';
import { formatRelativeTime } from '../utils/format';
import { log } from '../utils/logger';

const { Text } = Typography;

export default function OverviewPage() {
  const [stats, setStats] = useState<any>(null);
  const [recentActors, setRecentActors] = useState<any[]>([]);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);

  const loadStats = useCallback(async () => {
    try {
      const data = await overviewApi.getOverviewStats();
      setStats(data);
    } catch (err) {
      log.error('overview', 'Failed to load overview stats');
    }
  }, []);

  const loadRecentActors = useCallback(async () => {
    try {
      const items = await overviewApi.getRecentActors(5);
      setRecentActors(items || []);
    } catch (err) {
      log.error('overview', 'Failed to load recent actors');
    }
  }, []);

  const loadRecentLogs = useCallback(async () => {
    try {
      const items = await overviewApi.getRecentAuditLogs(8);
      setRecentLogs(items || []);
    } catch (err) {
      log.error('overview', 'Failed to load recent audit logs');
    }
  }, []);

  usePolling(loadStats, 30_000);
  usePolling(loadRecentActors, 3_600_000);
  usePolling(loadRecentLogs, 3_600_000);

  const recentActorColumns: ColumnsType<any> = [
    {
      title: 'Username',
      dataIndex: 'preferred_username',
      key: 'username',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created',
      render: (v: string) => v ? formatRelativeTime(v) : '—',
    },
  ];

  const recentLogColumns: ColumnsType<any> = [
    {
      title: 'Admin',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'Resource',
      dataIndex: 'resource',
      key: 'resource',
      ellipsis: true,
    },
    {
      title: 'Time',
      dataIndex: 'created_at',
      key: 'time',
      render: (v: string) => v ? formatRelativeTime(v) : '—',
    },
  ];

  return (
    <Flexbox gap={0}>
      <PageHeader
        title="Overview"
        subtitle="System-wide statistics and recent activity"
      />

      <Flexbox style={{ padding: 24 }} gap={24}>
        <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
          <StatCard
            title="Actors"
            value={stats?.actors?.total ?? 0}
            icon={<Users size={18} />}
            subtitle={`${stats?.actors?.active ?? 0} active · ${stats?.actors?.new_today ?? 0} new today`}
          />

          <StatCard
            title="Registered Nodes"
            value={stats?.nodes?.registered ?? 0}
            icon={<Server size={18} />}
            subtitle="P2P registry"
          />

          <StatCard
            title="Running Services"
            value={stats?.sub_servers?.running ?? 0}
            icon={<Cpu size={18} />}
            subtitle={`${stats?.sub_servers?.total ?? 0} total · ${stats?.sub_servers?.stopped ?? 0} stopped`}
          />

          <StatCard
            title="Total Posts"
            value={stats?.social?.total_posts ?? 0}
            icon={<MessageSquare size={18} />}
            subtitle={`${stats?.social?.posts_today ?? 0} today · ${stats?.social?.total_comments ?? 0} comments`}
          />
        </Flexbox>

        <Flexbox horizontal gap={24} style={{ flexWrap: 'wrap' }}>
          <Card
            title="Recent Actors"
            size="small"
            style={{ flex: 1, minWidth: 360 }}
            styles={{ body: { padding: 0 } }}
          >
            <Table
              dataSource={recentActors}
              columns={recentActorColumns}
              rowKey="id"
              size="small"
              pagination={false}
              locale={{ emptyText: 'No recent actors' }}
            />
          </Card>

          <Card
            title="Recent Activity"
            size="small"
            style={{ flex: 1, minWidth: 360 }}
            styles={{ body: { padding: 0 } }}
          >
            <Table
              dataSource={recentLogs}
              columns={recentLogColumns}
              rowKey="id"
              size="small"
              pagination={false}
              locale={{ emptyText: 'No recent activity' }}
            />
          </Card>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
