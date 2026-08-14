// HomePage — v1 landing page showing recent topics, pinned agents,
// quick actions, and activity summary. Uses existing agent + topic stores.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Typography, Card, Button, Empty, Statistic, Avatar } from 'antd';
import {
  MessageSquare,
  Plus,
  Download,
  Bot,
  Clock,
} from 'lucide-react';
import { theme } from 'antd';

import { useAgentStore } from '../store/agent';
import { useAgentTopicStore, type AgentTopic } from '../store/agentTopics';
import { usePageContext } from '../kernel/usePageContext';

const { useToken } = theme;
const RECENT_TOPICS_LIMIT = 5;

export function HomePage() {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const { navigation } = usePageContext();

  const agents = useAgentStore((s) => s.agents);
  const topicsByAgentId = useAgentTopicStore((s) => s.topicsByAgentId);

  // Derive pinned agents from the full agent list
  const pinnedAgents = useMemo(
    () => agents.filter((a) => a.pinned),
    [agents],
  );

  // Gather all topics across agents, sorted by updated_at descending
  const recentTopics = useMemo(() => {
    const allTopics: AgentTopic[] = [];
    for (const topics of Object.values(topicsByAgentId)) {
      allTopics.push(...topics);
    }
    allTopics.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
    return allTopics.slice(0, RECENT_TOPICS_LIMIT);
  }, [topicsByAgentId]);

  const totalAgents = agents.length;
  const totalTopics = useMemo(() => {
    let count = 0;
    for (const topics of Object.values(topicsByAgentId)) {
      count += topics.length;
    }
    return count;
  }, [topicsByAgentId]);

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
            title={t('agent.home.totalAgents')}
            value={totalAgents}
            prefix={<Bot size={16} />}
          />
        </Card>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic
            title={t('agent.home.totalTopics')}
            value={totalTopics}
            prefix={<MessageSquare size={16} />}
          />
        </Card>
      </Flexbox>

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
        {pinnedAgents.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('agent.home.noPinnedAgents')}
          />
        ) : (
          <Flexbox horizontal gap={token.marginSM} wrap="wrap">
            {pinnedAgents.map((agent) => (
              <Card
                key={agent.id}
                hoverable
                size="small"
                style={{ width: 160, cursor: 'pointer' }}
                onClick={() => navigation.navigateToAgentSurface(agent.name, 'chat')}
              >
                <Flexbox align="center" gap={token.marginXS}>
                  <Avatar
                    src={agent.avatar || undefined}
                    style={{ backgroundColor: agent.backgroundColor || token.colorPrimary }}
                    size={40}
                  >
                    {agent.title?.[0] ?? agent.name[0]}
                  </Avatar>
                  <Typography.Text ellipsis style={{ maxWidth: 120, textAlign: 'center' }}>
                    {agent.title || agent.name}
                  </Typography.Text>
                </Flexbox>
              </Card>
            ))}
          </Flexbox>
        )}
      </Card>

      {/* Recent Topics */}
      <Card title={t('agent.home.recentTopics')} size="small">
        {recentTopics.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('agent.home.noRecentTopics')}
          />
        ) : (
          <Flexbox gap={token.marginXS}>
            {recentTopics.map((topic) => (
              <Card
                key={topic.key}
                hoverable
                size="small"
                style={{ cursor: 'pointer' }}
                onClick={() => navigation.navigateToAgentSurface(topic.agent_name, 'chat')}
              >
                <Flexbox horizontal align="center" gap={token.marginSM}>
                  <Clock size={14} color={token.colorTextSecondary} />
                  <Flexbox style={{ flex: 1, minWidth: 0 }}>
                    <Typography.Text ellipsis strong>
                      {topic.title || t('agent.home.untitledTopic')}
                    </Typography.Text>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: token.fontSizeSM }}
                    >
                      {topic.agent_name}
                    </Typography.Text>
                  </Flexbox>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: token.fontSizeSM, flexShrink: 0 }}
                  >
                    {formatRelativeTime(topic.updated_at)}
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
