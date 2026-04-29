/**
 * UsageTab — at-a-glance OSS storage and visibility breakdown.
 *
 * Reads the single `GET /oss/usage` endpoint, which performs the
 * aggregate joins on the station side and returns a compact summary
 * (totals + top owners + visibility mix). Everything below is a
 * projection of that one payload — there are no per-row queries,
 * which keeps the page responsive on a station with millions of
 * objects.
 *
 * The visibility-mix percentages are computed client-side from the
 * file counts so we render *something* even when the server's
 * payload pre-dates the Bytes column (older builds may omit it).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, Empty, message, Progress, Statistic, Table, Tooltip, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import {
  Database, FileBarChart2, Files, FolderTree, RefreshCw, Users,
} from 'lucide-react';
import * as ossApi from '../../api/oss';
import { log } from '../../utils/logger';
import { formatBytes, shortHash, VisibilityChip } from './shared';

const { Text } = Typography;

function visibilityRowColor(v: string): string {
  switch (v) {
    case 'public':  return '#1677ff';
    case 'chat':    return '#13c2c2';
    case 'private': return '#8c8c8c';
    default:        return '#bfbfbf';
  }
}

export function UsageTab() {
  const [data, setData] = useState<ossApi.OSSUsageSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await ossApi.getUsage();
      setData(resp);
    } catch (err) {
      log.error('oss', 'Failed to load usage');
      message.error('Failed to load usage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalFiles = data?.total_files ?? 0;
  const totalBytes = data?.total_bytes ?? 0;
  const bucketCount = data?.bucket_count ?? 0;
  const topOwners = data?.top_owners ?? [];
  const visibilityMix = data?.visibility_mix ?? [];

  const ownerColumns: ColumnsType<ossApi.OSSOwnerUsage> = [
    {
      title: 'Owner actor',
      dataIndex: 'owner_actor_id',
      key: 'owner_actor_id',
      render: (v: string) => v
        ? <Tooltip title={v}><Text code>{shortHash(v, 14, 6)}</Text></Tooltip>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Files',
      dataIndex: 'files',
      key: 'files',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.files - b.files,
      render: (v: number) => <Text>{v.toLocaleString()}</Text>,
    },
    {
      title: 'Bytes',
      dataIndex: 'bytes',
      key: 'bytes',
      width: 160,
      align: 'right',
      sorter: (a, b) => a.bytes - b.bytes,
      defaultSortOrder: 'descend',
      render: (v: number) => <Text>{formatBytes(v)}</Text>,
    },
    {
      title: 'Share',
      key: 'share',
      width: 200,
      render: (_, r) => {
        const pct = totalBytes > 0 ? Math.round((r.bytes / totalBytes) * 100) : 0;
        return (
          <Tooltip title={`${pct}% of station total`}>
            <Progress percent={pct} size="small" showInfo={false} />
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
        <Card style={{ flex: 1, minWidth: 220 }} loading={loading}>
          <Statistic
            title="Total bytes"
            value={formatBytes(totalBytes)}
            prefix={<Database size={16} style={{ marginRight: 4 }} />}
          />
        </Card>
        <Card style={{ flex: 1, minWidth: 220 }} loading={loading}>
          <Statistic
            title="Total files"
            value={totalFiles}
            prefix={<Files size={16} style={{ marginRight: 4 }} />}
          />
        </Card>
        <Card style={{ flex: 1, minWidth: 220 }} loading={loading}>
          <Statistic
            title="Buckets"
            value={bucketCount}
            prefix={<FolderTree size={16} style={{ marginRight: 4 }} />}
          />
        </Card>
        <Card style={{ flex: 1, minWidth: 220 }} loading={loading}>
          <Statistic
            title="Top owners tracked"
            value={topOwners.length}
            prefix={<Users size={16} style={{ marginRight: 4 }} />}
          />
        </Card>
      </Flexbox>

      <Card
        title={
          <Flexbox horizontal gap={12} align="center">
            <FileBarChart2 size={16} />
            <Text strong>Visibility breakdown</Text>
          </Flexbox>
        }
        extra={
          <Button icon={<RefreshCw size={14} />} onClick={load} loading={loading} size="small">
            Refresh
          </Button>
        }
        loading={loading}
      >
        {visibilityMix.length === 0 ? (
          <Empty description="No files yet — nothing to break down." />
        ) : (
          <Flexbox gap={12}>
            {visibilityMix.map((v) => {
              const pctFiles = totalFiles > 0 ? Math.round((v.files / totalFiles) * 100) : 0;
              return (
                <Flexbox key={v.visibility} horizontal gap={12} align="center">
                  <div style={{ minWidth: 110 }}><VisibilityChip value={v.visibility} /></div>
                  <Flexbox style={{ flex: 1 }} gap={2}>
                    <Progress
                      percent={pctFiles}
                      size="small"
                      showInfo={false}
                      strokeColor={visibilityRowColor(v.visibility)}
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {v.files.toLocaleString()} file{v.files === 1 ? '' : 's'}
                      {v.bytes > 0 ? ` · ${formatBytes(v.bytes)}` : ''}
                      {totalFiles > 0 ? ` · ${pctFiles}%` : ''}
                    </Text>
                  </Flexbox>
                </Flexbox>
              );
            })}
          </Flexbox>
        )}
      </Card>

      <Card
        title={
          <Flexbox horizontal gap={12} align="center">
            <Users size={16} />
            <Text strong>Top owners by bytes</Text>
          </Flexbox>
        }
        loading={loading}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          dataSource={topOwners}
          columns={ownerColumns}
          rowKey={(r) => r.owner_actor_id || 'unknown'}
          size="small"
          loading={loading}
          pagination={false}
          locale={{ emptyText: loading ? 'Loading…' : 'No owner usage data yet' }}
        />
      </Card>
    </Flexbox>
  );
}

export default UsageTab;
