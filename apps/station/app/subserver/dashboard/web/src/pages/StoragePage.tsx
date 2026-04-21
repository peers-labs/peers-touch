/**
 * StoragePage — Database driver, connection pool stats and per-table row
 * counts. All numbers come straight from the live *gorm.DB / *sql.DB on
 * the station; tables that don't exist in the active schema are simply
 * omitted from the list (they are NOT shown as 0).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Descriptions, Statistic, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import { Database, HardDrive, RefreshCw } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import * as storageApi from '../api/storage';
import { log } from '../utils/logger';

const { Text } = Typography;

const GROUP_COLOR: Record<string, string> = {
  Identity: 'blue',
  Social: 'magenta',
  Chat: 'cyan',
  'Friend Chat': 'geekblue',
  Network: 'gold',
  OAuth: 'purple',
  Dashboard: 'green',
};

export default function StoragePage() {
  const [info, setInfo] = useState<storageApi.StorageInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await storageApi.getStorageInfo();
      setInfo(data);
    } catch (err) {
      log.error('storage', 'Failed to load storage info');
      message.error('Failed to load storage info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalRows = useMemo(() => {
    if (!info?.tables) return 0;
    return info.tables.reduce((acc, t) => acc + (t.rows > 0 ? t.rows : 0), 0);
  }, [info]);

  const columns: ColumnsType<storageApi.StorageTableCount> = [
    {
      title: 'Group',
      dataIndex: 'group',
      key: 'group',
      width: 140,
      render: (v: string) => <Tag color={GROUP_COLOR[v] || 'default'}>{v}</Tag>,
      filters: Array.from(new Set((info?.tables || []).map((t) => t.group))).map((g) => ({
        text: g,
        value: g,
      })),
      onFilter: (value, record) => record.group === value,
    },
    {
      title: 'Table',
      dataIndex: 'table',
      key: 'table',
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: 'Rows',
      dataIndex: 'rows',
      key: 'rows',
      width: 140,
      align: 'right',
      sorter: (a, b) => a.rows - b.rows,
      render: (v: number, r) => {
        if (r.error) return <Tag color="red">error</Tag>;
        return <Text>{v.toLocaleString()}</Text>;
      },
    },
  ];

  const pool = info?.pool;

  return (
    <Flexbox gap={0}>
      <PageHeader
        title="Storage"
        subtitle="Database driver, connection pool, and table sizes"
        extra={
          <Flexbox horizontal gap={8} align="center">
            <RefreshCw
              size={16}
              style={{ cursor: 'pointer' }}
              onClick={load}
            />
          </Flexbox>
        }
      />

      <Flexbox gap={16} style={{ padding: 24 }}>
        <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
          <Card style={{ flex: 1, minWidth: 220 }} loading={loading}>
            <Statistic
              title="Driver"
              value={info?.driver || 'unknown'}
              prefix={<Database size={16} style={{ marginRight: 4 }} />}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 220 }} loading={loading}>
            <Statistic
              title="Tables"
              value={info?.tables?.length ?? 0}
              prefix={<HardDrive size={16} style={{ marginRight: 4 }} />}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 220 }} loading={loading}>
            <Statistic title="Total Rows" value={totalRows} />
          </Card>
        </Flexbox>

        {pool ? (
          <Card title="Connection Pool" loading={loading}>
            <Descriptions column={3} size="small" bordered>
              <Descriptions.Item label="Open">{pool.open_connections}</Descriptions.Item>
              <Descriptions.Item label="In Use">{pool.in_use}</Descriptions.Item>
              <Descriptions.Item label="Idle">{pool.idle}</Descriptions.Item>
              <Descriptions.Item label="Max Open">{pool.max_open_connections}</Descriptions.Item>
              <Descriptions.Item label="Wait Count">{pool.wait_count}</Descriptions.Item>
              <Descriptions.Item label="Wait Duration">
                {pool.wait_duration_ms} ms
              </Descriptions.Item>
              <Descriptions.Item label="Max Idle Closed">
                {pool.max_idle_closed}
              </Descriptions.Item>
              <Descriptions.Item label="Max Lifetime Closed">
                {pool.max_lifetime_closed}
              </Descriptions.Item>
              <Descriptions.Item label="Max Idle Time Closed">
                {pool.max_idle_time_closed}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        ) : null}

        <Card title="Tables" loading={loading} styles={{ body: { padding: 0 } }}>
          <Table
            dataSource={info?.tables || []}
            columns={columns}
            rowKey="table"
            size="small"
            pagination={{ pageSize: 50, showTotal: (t) => `Total ${t} tables` }}
          />
        </Card>
      </Flexbox>
    </Flexbox>
  );
}
