/**
 * SubServersPage — Sub-server (service) status and management.
 * Lists all registered sub-servers with their name, type, and runtime status.
 * Uses the system API to fetch sub-server info and StatusBadge for visual state.
 *
 * Created: 2026-04-10
 * Updated: 2026-04-10 — Full implementation replacing placeholder.
 */

import { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Button, Empty, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import type { SubServerInfo } from '../api/overview';
import * as systemApi from '../api/system';
import { log } from '../utils/logger';

const { Text } = Typography;

export default function SubServersPage() {
  const [subservers, setSubservers] = useState<SubServerInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────

  const loadSubservers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await systemApi.getSystemSubservers();
      setSubservers(result.items || []);
      log.debug('subservers', 'Loaded sub-server list', { count: result.count });
    } catch (err) {
      log.error('subservers', 'Failed to load sub-server list');
      message.error('Failed to load services');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubservers();
  }, [loadSubservers]);

  // ── Column definitions ───────────────────────────────────────────────

  const columns: ColumnsType<SubServerInfo> = [
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
      width: 150,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (v: string) => <StatusBadge status={v} />,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: () => (
        <Button type="link" size="small" disabled>
          View
        </Button>
      ),
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <Flexbox gap={0}>
      <PageHeader title="Services" subtitle="Sub-server status and management" />

      <Flexbox style={{ padding: 24 }}>
        {!loading && subservers.length === 0 ? (
          <Empty description="No sub-servers registered" />
        ) : (
          <Table
            dataSource={subservers}
            columns={columns}
            rowKey="name"
            size="small"
            loading={loading}
            pagination={false}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
}
