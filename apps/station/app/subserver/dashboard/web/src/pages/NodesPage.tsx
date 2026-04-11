/**
 * NodesPage — Cluster node overview.
 * Displays registered node count from the P2P registry.
 *
 * Created: 2026-04-10
 * Changed: 2026-04-10 — Removed fake "Online Nodes" card (was always == registered,
 *   no real online/offline distinction). Only shows truthful registered count.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, Statistic, Empty, message } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { Server } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getOverviewStats } from '../api/overview';
import { log } from '../utils/logger';

export default function NodesPage() {
  const [registered, setRegistered] = useState(0);
  const [loading, setLoading] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getOverviewStats();
      setRegistered(data?.nodes?.registered ?? 0);
    } catch (err) {
      log.error('nodes', 'Failed to load overview stats');
      message.error('Failed to load node statistics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  return (
    <Flexbox gap={0}>
      <PageHeader title="Nodes" subtitle="Cluster node status and configuration" />

      <Flexbox gap={24} style={{ padding: 24 }}>
        <Card loading={loading} style={{ maxWidth: 300 }}>
          <Statistic
            title="Registered Nodes"
            value={registered}
            prefix={<Server size={18} style={{ marginRight: 4 }} />}
            suffix="in P2P registry"
          />
        </Card>

        <Card>
          <Empty
            description="Detailed node list will be available when the Node Registry API is exposed to the dashboard"
          />
        </Card>
      </Flexbox>
    </Flexbox>
  );
}
