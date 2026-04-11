/**
 * SessionsPage — Active Peers actor session management.
 * Lists all active actor sessions with device info, IP, timestamps,
 * and provides session revocation via confirmation dialog.
 *
 * Created: 2026-04-10
 * Updated: 2026-04-10 — Full implementation replacing placeholder.
 */

import { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Button, Popconfirm, Typography, Empty, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import { RefreshCw } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import * as systemApi from '../api/system';
import { formatTime, formatRelativeTime } from '../utils/format';
import { log } from '../utils/logger';

const { Text } = Typography;

/** Device type to Tag color mapping for visual distinction. */
const DEVICE_TYPE_COLOR: Record<string, string> = {
  desktop: 'blue',
  mobile:  'green',
  web:     'purple',
};

export default function SessionsPage() {
  const [sessions, setSessions] = useState<systemApi.PeersSession[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await systemApi.getActivePeersSessions();
      setSessions(result.items || []);
      log.debug('sessions', 'Loaded active Peers sessions', { count: result.count });
    } catch (err) {
      log.error('sessions', 'Failed to load active Peers sessions');
      message.error('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // ── Actions ──────────────────────────────────────────────────────────

  const handleRevoke = async (sessionId: string) => {
    try {
      await systemApi.revokePeersSession(sessionId);
      message.success('Session revoked');
      loadSessions();
    } catch (err) {
      log.error('sessions', 'Failed to revoke session', { sessionId });
      message.error('Failed to revoke session');
    }
  };

  // ── Column definitions ───────────────────────────────────────────────

  const columns: ColumnsType<systemApi.PeersSession> = [
    {
      title: 'Session ID',
      dataIndex: 'session_id',
      key: 'session_id',
      width: 130,
      render: (v: string) => (
        <Text code style={{ fontSize: 12 }}>
          {v.slice(0, 8)}...
        </Text>
      ),
    },
    {
      title: 'Device Type',
      dataIndex: 'device_type',
      key: 'device_type',
      width: 120,
      render: (v: string) => (
        <Tag color={DEVICE_TYPE_COLOR[v?.toLowerCase()] || 'default'}>
          {v || 'unknown'}
        </Tag>
      ),
    },
    {
      title: 'IP Address',
      dataIndex: 'ip_address',
      key: 'ip_address',
      width: 160,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: 'User Agent',
      dataIndex: 'user_agent',
      key: 'user_agent',
      ellipsis: true,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (v: string) => formatTime(v),
    },
    {
      title: 'Last Active',
      dataIndex: 'last_active_at',
      key: 'last_active_at',
      width: 140,
      render: (v: string) => formatRelativeTime(v),
    },
    {
      title: 'Expires',
      dataIndex: 'expires_at',
      key: 'expires_at',
      width: 170,
      render: (v: string) => formatTime(v),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Popconfirm
          title="Revoke this session?"
          description="The user will be signed out on this device."
          onConfirm={() => handleRevoke(record.session_id)}
        >
          <Button type="text" danger size="small">
            Revoke
          </Button>
        </Popconfirm>
      ),
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <Flexbox gap={0}>
      <PageHeader
        title="Sessions"
        subtitle="Active Peers actor sessions"
        extra={
          <Button
            icon={<RefreshCw size={14} />}
            onClick={loadSessions}
            loading={loading}
          >
            Refresh
          </Button>
        }
      />

      <Flexbox style={{ padding: 24 }}>
        {!loading && sessions.length === 0 ? (
          <Empty description="No active sessions" />
        ) : (
          <Table
            dataSource={sessions}
            columns={columns}
            rowKey="session_id"
            size="small"
            loading={loading}
            pagination={false}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
}
