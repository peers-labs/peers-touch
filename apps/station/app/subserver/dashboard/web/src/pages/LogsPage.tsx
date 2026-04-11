/**
 * LogsPage — Paginated audit log viewer with search capabilities.
 * Fetches audit log entries from the system API with server-side pagination.
 */

import { useState, useEffect, useCallback } from 'react';
import { Table, Input, Typography, theme, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import { Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import * as systemApi from '../api/system';
import { formatTime } from '../utils/format';
import { log } from '../utils/logger';

const { Text } = Typography;

/** Page size for audit log pagination. */
const PAGE_SIZE = 30;

export default function LogsPage() {
  const [logs, setLogs] = useState<systemApi.AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const { token } = theme.useToken();

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await systemApi.getAuditLogs(page, PAGE_SIZE);
      setLogs(result.items || []);
      setTotal(result.total);
    } catch (err) {
      log.error('logs', 'Failed to fetch audit logs');
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  /**
   * Client-side search filter applied on top of the paginated data.
   * Matches against username, action, resource, and detail fields.
   */
  const filteredLogs = search
    ? logs.filter((entry) => {
        const term = search.toLowerCase();
        return (
          entry.username?.toLowerCase().includes(term) ||
          entry.action?.toLowerCase().includes(term) ||
          entry.resource?.toLowerCase().includes(term) ||
          entry.detail?.toLowerCase().includes(term)
        );
      })
    : logs;

  const columns: ColumnsType<systemApi.AuditLog> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 60,
    },
    {
      title: 'Admin',
      dataIndex: 'username',
      key: 'username',
      render: (v: string) => <Text strong>{v}</Text>,
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
    },
    {
      title: 'Detail',
      dataIndex: 'detail',
      key: 'detail',
      ellipsis: true,
    },
    {
      title: 'IP',
      dataIndex: 'ip_address',
      key: 'ip',
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: 'User Agent',
      dataIndex: 'user_agent',
      key: 'ua',
      ellipsis: true,
      width: 200,
    },
    {
      title: 'Time',
      dataIndex: 'created_at',
      key: 'time',
      width: 170,
      render: (v: string) => formatTime(v),
    },
  ];

  return (
    <Flexbox gap={0}>
      <PageHeader
        title="Audit Logs"
        subtitle={`${total} log entries`}
        extra={
          <Input
            placeholder="Filter logs..."
            prefix={<Search size={14} style={{ color: token.colorTextPlaceholder }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            style={{ width: 240 }}
          />
        }
      />

      <Flexbox style={{ padding: 24 }}>
        <Table
          dataSource={filteredLogs}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{
            current: page,
            total: search ? filteredLogs.length : total,
            pageSize: PAGE_SIZE,
            onChange: (p) => { setPage(p); setSearch(''); },
            showTotal: (t) => `Total ${t}`,
          }}
          style={{
            borderRadius: token.borderRadiusLG,
            background: token.colorBgContainer,
          }}
        />
      </Flexbox>
    </Flexbox>
  );
}
