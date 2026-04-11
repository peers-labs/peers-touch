/**
 * StoragePage — Placeholder for storage management.
 * No real data source is currently available for storage metrics.
 *
 * Created: 2026-04-10
 * Changed: 2026-04-10 — Replaced fake zero-value data with honest "not yet
 *   available" placeholder.
 */

import { Typography, Card, Empty } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { HardDrive } from 'lucide-react';
import PageHeader from '../components/PageHeader';

const { Text } = Typography;

export default function StoragePage() {
  return (
    <Flexbox>
      <PageHeader title="Storage" subtitle="Database and file storage management" />

      <Flexbox style={{ padding: 24 }}>
        <Card>
          <Empty
            image={<HardDrive size={48} strokeWidth={1} style={{ color: '#999' }} />}
            description={
              <Text type="secondary">
                Storage metrics are not yet available. This page will display
                database driver info, table statistics, and disk usage once the
                underlying APIs are implemented.
              </Text>
            }
          />
        </Card>
      </Flexbox>
    </Flexbox>
  );
}
