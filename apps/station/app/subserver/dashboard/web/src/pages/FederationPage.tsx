/**
 * FederationPage — ActivityPub federation overview.
 * Displays social stats from the overview API as a proxy for federation
 * health, with a placeholder for future remote-instance management.
 *
 * Created: 2026-04-10
 * Changed: 2026-04-10 — Replaced placeholder with real social stats.
 */

import { useState, useCallback, useEffect } from 'react';
import { Card, Empty, Statistic, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { Globe, MessageSquare, Heart, UserPlus, Repeat2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getOverviewStats } from '../api/overview';
import { log } from '../utils/logger';

const { Text } = Typography;

interface SocialStats {
  total_posts: number;
  total_comments: number;
  total_likes: number;
  total_follows: number;
  posts_today: number;
}

export default function FederationPage() {
  const [social, setSocial] = useState<SocialStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const stats = await getOverviewStats();
      setSocial(stats.social);
    } catch (err) {
      log.error('federation', 'Failed to load federation stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  return (
    <Flexbox>
      <PageHeader title="Federation" subtitle="ActivityPub federation and social stats" />

      <Flexbox gap={24} style={{ padding: 24 }}>
        <Flexbox horizontal gap={16} wrap="wrap">
          <Card style={{ flex: 1, minWidth: 180 }} loading={loading}>
            <Statistic
              title="Total Posts"
              value={social?.total_posts ?? 0}
              prefix={<MessageSquare size={16} style={{ marginRight: 4 }} />}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 180 }} loading={loading}>
            <Statistic
              title="Total Comments"
              value={social?.total_comments ?? 0}
              prefix={<Repeat2 size={16} style={{ marginRight: 4 }} />}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 180 }} loading={loading}>
            <Statistic
              title="Total Likes"
              value={social?.total_likes ?? 0}
              prefix={<Heart size={16} style={{ marginRight: 4 }} />}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 180 }} loading={loading}>
            <Statistic
              title="Total Follows"
              value={social?.total_follows ?? 0}
              prefix={<UserPlus size={16} style={{ marginRight: 4 }} />}
            />
          </Card>
        </Flexbox>

        <Card title="Remote Instances">
          <Empty
            image={<Globe size={48} strokeWidth={1} style={{ color: '#999' }} />}
            description={
              <Text type="secondary">
                Remote instance discovery and management will be available when
                the ActivityPub federation module is fully integrated.
              </Text>
            }
          />
        </Card>
      </Flexbox>
    </Flexbox>
  );
}
