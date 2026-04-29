import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Col, Row, Skeleton, Statistic, Tooltip } from 'antd';
import {
  FileTextOutlined,
  HeartOutlined,
  MessageOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { socialGetMyStats } from '../../services/social_api';
import type { GetMyMomentsStatsResponse } from '../../gen/proto/domain/social/post_pb';
import { log } from '../../utils/logger';

const TAG = 'moments-stats-panel';

// MomentsStatsPanel — the user-side dashboard summary.
//
// Renders eight live counters drawn from the
// `GET /api/v1/social/me/stats` endpoint. Mounted at the top of the
// MomentsApp shell (above the tab bar) so it stays visible across
// every Moments sub-view; we deliberately avoid coupling it to any
// single page so opening "Explore" or "Search" still shows the
// stats context.
//
// Loading shape: a single-call lifecycle. We `useEffect` once on
// mount; subsequent updates are triggered by the `refreshKey` prop
// so the parent can force a re-fetch (e.g. after the user publishes
// a new post). No client-side caching beyond the local state — the
// underlying queries are cheap and aging stats hurt UX more than the
// network round-trip helps.

interface MomentsStatsPanelProps {
  /** Bumping this prop value forces a refetch (use after user actions). */
  refreshKey?: number;
}

export function MomentsStatsPanel({ refreshKey = 0 }: MomentsStatsPanelProps) {
  const { t } = useTranslation('moments');
  const [stats, setStats] = useState<GetMyMomentsStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    socialGetMyStats()
      .then((resp) => {
        if (cancelled) return;
        setStats(resp);
      })
      .catch((err: unknown) => {
        log.warn(TAG, 'failed to load stats', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (loading && !stats) {
    return (
      <Card size="small" style={{ marginBottom: 16 }}>
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      </Card>
    );
  }
  if (!stats) {
    return null;
  }

  // Convert all bigint counters to Number for AntD Statistic.
  // `int64` proto fields surface as `bigint` in TS — Statistic only
  // accepts `number`, and at the magnitudes we expect (tens of
  // thousands at most for a single user) the precision loss is nil.
  const num = (v: bigint | number | undefined) => Number(v ?? 0);

  const tiles: Array<{
    titleKey: string;
    value: number;
    icon: React.ReactNode;
    tooltipKey?: string;
  }> = [
    {
      titleKey: 'moments.stats.posts',
      value: num(stats.postsCount),
      icon: <FileTextOutlined />,
    },
    {
      titleKey: 'moments.stats.followers',
      value: num(stats.followersCount),
      icon: <UserAddOutlined />,
    },
    {
      titleKey: 'moments.stats.following',
      value: num(stats.followingCount),
      icon: <UserOutlined />,
    },
    {
      titleKey: 'moments.stats.circles',
      value: num(stats.circlesCount),
      icon: <TeamOutlined />,
    },
    {
      titleKey: 'moments.stats.commentsReceived',
      value: num(stats.commentsReceivedCount),
      icon: <MessageOutlined />,
      tooltipKey: 'moments.stats.commentsReceivedHint',
    },
    {
      titleKey: 'moments.stats.reactionsReceived',
      value: num(stats.reactionsReceivedCount),
      icon: <HeartOutlined />,
      tooltipKey: 'moments.stats.reactionsReceivedHint',
    },
  ];

  return (
    <Card size="small" style={{ marginBottom: 16 }} bordered>
      <Row gutter={[12, 12]}>
        {tiles.map(({ titleKey, value, icon, tooltipKey }) => (
          <Col xs={12} sm={8} md={4} key={titleKey}>
            <Tooltip title={tooltipKey ? t(tooltipKey) : undefined}>
              <Statistic
                title={t(titleKey)}
                value={value}
                prefix={icon}
                valueStyle={{ fontSize: 16 }}
              />
            </Tooltip>
          </Col>
        ))}
      </Row>
    </Card>
  );
}
