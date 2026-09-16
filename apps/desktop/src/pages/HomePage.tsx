// HomePage renders the Station-owned Home projection and dispatches user intent.

import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Empty,
  Skeleton,
  Statistic,
  Typography,
} from 'antd';
import {
  Bot,
  Clock,
  Download,
  MessageSquare,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { theme } from 'antd';

import { HomeProjectionFreshness } from '../gen/proto/domain/agent/home_pb';
import { usePageContext } from '../kernel/usePageContext';
import {
  openHomeConversation,
  refreshHomeProjection,
} from '../runtimes/homeRuntime';
import { useHomeStore } from '../store/home';

const { useToken } = theme;

export function HomePage() {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const { navigation } = usePageContext();

  const projection = useHomeStore((state) => state.projection);
  const loading = useHomeStore((state) => state.loading);
  const error = useHomeStore((state) => state.error);
  const pinnedAgents = projection?.pinnedAgents ?? [];
  const recentWork = projection?.recentWork ?? [];
  const degraded =
    projection?.freshness === HomeProjectionFreshness.PARTIAL
    || projection?.freshness === HomeProjectionFreshness.STALE;

  const retryAction = (
    <Button
      aria-label={t('agent.home.retry')}
      icon={<RefreshCw size={14} />}
      loading={loading}
      onClick={() => void refreshHomeProjection()}
      size="small"
      type="text"
    />
  );

  const openRecentConversation = (work: (typeof recentWork)[number]) => {
    const pending = openHomeConversation(work);
    navigation.navigateTo('agent');
    void pending.catch(() => refreshHomeProjection('conversation-open-failed'));
  };

  return (
    <Flexbox
      padding={token.paddingLG}
      gap={token.marginLG}
      style={{ height: '100%', overflow: 'auto' }}
    >
      {/* Activity Summary */}
      <Flexbox horizontal gap={token.marginMD}>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic
            title={t('agent.home.pinnedCount')}
            value={pinnedAgents.length}
            prefix={<Bot size={16} />}
          />
        </Card>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic
            title={t('agent.home.recentCount')}
            value={recentWork.length}
            prefix={<MessageSquare size={16} />}
          />
        </Card>
      </Flexbox>

      {error ? (
        <Alert
          action={retryAction}
          message={t('agent.home.loadFailed')}
          showIcon
          type="error"
        />
      ) : null}
      {degraded ? (
        <Alert
          action={retryAction}
          message={t('agent.home.partial')}
          showIcon
          type="warning"
        />
      ) : null}

      {/* Quick Actions */}
      <Card title={t('agent.home.quickActions')} size="small">
        <Flexbox horizontal gap={token.marginSM} wrap="wrap">
          <Button
            icon={<Plus size={14} />}
            onClick={() => navigation.navigateTo('agent')}
          >
            {t('agent.home.newChat')}
          </Button>
          <Button
            icon={<Bot size={14} />}
            onClick={() => navigation.navigateToSettings('agents')}
          >
            {t('agent.home.createAgent')}
          </Button>
          <Button
            icon={<Download size={14} />}
            onClick={() => navigation.navigateToSettings('agents')}
          >
            {t('agent.home.importAgent')}
          </Button>
        </Flexbox>
      </Card>

      {/* Pinned Agents */}
      <Card title={t('agent.home.pinnedAgents')} size="small">
        {!projection && loading ? (
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        ) : pinnedAgents.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('agent.home.noPinnedAgents')}
          />
        ) : (
          <Flexbox horizontal gap={token.marginSM} wrap="wrap">
            {pinnedAgents.map((agent) => (
              <Card
                key={agent.agentId}
                hoverable
                size="small"
                style={{ width: 160, cursor: 'pointer' }}
                onClick={() => navigation.navigateToAgentSurface(agent.agentName, 'chat')}
              >
                <Flexbox align="center" gap={token.marginXS}>
                  <Avatar
                    src={agent.avatarRef || undefined}
                    style={{ backgroundColor: token.colorPrimary }}
                    size={40}
                  >
                    {agent.displayName[0]}
                  </Avatar>
                  <Typography.Text ellipsis style={{ maxWidth: 120, textAlign: 'center' }}>
                    {agent.displayName}
                  </Typography.Text>
                </Flexbox>
              </Card>
            ))}
          </Flexbox>
        )}
      </Card>

      {/* Recent Topics */}
      <Card title={t('agent.home.recentTopics')} size="small">
        {!projection && loading ? (
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        ) : recentWork.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('agent.home.noRecentTopics')}
          />
        ) : (
          <Flexbox gap={token.marginXS}>
            {recentWork.map((work) => (
              <Card
                key={work.workId}
                hoverable
                size="small"
                style={{ cursor: 'pointer' }}
                onClick={() => openRecentConversation(work)}
              >
                <Flexbox horizontal align="center" gap={token.marginSM}>
                  <Clock size={14} color={token.colorTextSecondary} />
                  <Flexbox style={{ flex: 1, minWidth: 0 }}>
                    <Typography.Text ellipsis strong>
                      {work.title || t('agent.home.untitledTopic')}
                    </Typography.Text>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: token.fontSizeSM }}
                    >
                      {work.agentName}
                    </Typography.Text>
                  </Flexbox>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: token.fontSizeSM, flexShrink: 0 }}
                  >
                    {formatRelativeTime(work.updatedAt)}
                  </Typography.Text>
                </Flexbox>
              </Card>
            ))}
          </Flexbox>
        )}
      </Card>
    </Flexbox>
  );
}

/** Format ISO timestamp to a short relative or absolute string. */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return '<1m';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}
