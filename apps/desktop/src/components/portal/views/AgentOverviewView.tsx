import { Flexbox } from 'react-layout-kit';
import { Avatar, Empty } from '@lobehub/ui';
import { Button, Descriptions, Typography, theme } from 'antd';
import { Settings, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '../../../store/agent';
import { useChatStore } from '../../../store/chat';
import { useAgentTopicStore } from '../../../store/agentTopics';

interface AgentOverviewViewProps {
  agentId: string;
}

export function AgentOverviewView({ agentId }: AgentOverviewViewProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const agents = useAgentStore((s) => s.agents);
  const messages = useChatStore((s) => s.messages);
  const getTopicsForAgent = useAgentTopicStore((s) => s.getTopicsForAgent);

  const agent = agents.find((a) => a.id === agentId || a.name === agentId);

  if (!agent) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%', padding: 32 }}>
        <Empty description={t('agent.profile.notFound')} />
      </Flexbox>
    );
  }

  const totalTopics = getTopicsForAgent(agentId).length;
  const totalMessages = messages.length;

  // Truncate system prompt for preview
  const systemPromptPreview = agent.systemPrompt
    ? agent.systemPrompt.length > 200
      ? `${agent.systemPrompt.slice(0, 200)}...`
      : agent.systemPrompt
    : '';

  return (
    <Flexbox gap={20}>
      {/* Agent identity header */}
      <Flexbox horizontal align="center" gap={12} style={{ padding: '4px 0' }}>
        <Avatar
          avatar={agent.avatar || undefined}
          title={agent.title || agent.name}
          size={48}
        />
        <Flexbox style={{ flex: 1 }}>
          <Typography.Text style={{ fontSize: 16, fontWeight: 600 }}>
            {agent.title || agent.name}
          </Typography.Text>
          {agent.description && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {agent.description}
            </Typography.Text>
          )}
        </Flexbox>
      </Flexbox>

      {/* Model info */}
      {agent.model && (
        <Flexbox
          style={{
            padding: '10px 12px',
            borderRadius: token.borderRadius,
            background: token.colorBgElevated,
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 11, marginBottom: 4 }}>
            {t('agent.profile.defaultModel')}
          </Typography.Text>
          <Typography.Text style={{ fontSize: 13 }}>
            {agent.model}
          </Typography.Text>
        </Flexbox>
      )}

      {/* System prompt preview */}
      {systemPromptPreview && (
        <Flexbox
          style={{
            padding: '10px 12px',
            borderRadius: token.borderRadius,
            background: token.colorBgElevated,
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 11, marginBottom: 4 }}>
            {t('agent.working.systemPrompt')}
          </Typography.Text>
          <Typography.Paragraph
            style={{ fontSize: 12, margin: 0, color: token.colorTextSecondary }}
          >
            {systemPromptPreview}
          </Typography.Paragraph>
        </Flexbox>
      )}

      {/* Stats */}
      <Descriptions
        column={2}
        size="small"
        items={[
          {
            key: 'topics',
            label: t('agent.working.totalTopics'),
            children: totalTopics,
          },
          {
            key: 'messages',
            label: t('agent.working.totalMessages'),
            children: totalMessages,
          },
        ]}
      />

      {/* Quick actions */}
      <Flexbox horizontal gap={8}>
        <Button
          icon={<Settings size={14} />}
          size="small"
          onClick={() => {
            const store = useAgentStore.getState();
            store.setAgentSurface(agent.name, 'profile');
          }}
        >
          {t('agent.profile.editSettings')}
        </Button>
        <Button
          icon={<MessageSquare size={14} />}
          size="small"
          type="primary"
          onClick={() => {
            const store = useAgentStore.getState();
            store.setSelectedAgent(agent.name);
            store.setAgentSurface(agent.name, 'chat');
          }}
        >
          {t('agent.profile.startConversation')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}
