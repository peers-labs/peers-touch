import { ActionIcon } from '@lobehub/ui';
import { theme } from 'antd';
import { Hash, MessageSquarePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../../store/chat';
import {
  useActiveAgentSlice,
  useActiveAgentTopicSlice,
  useActiveChatSlice,
} from '../useActiveAgentStores';
import { AgentSidebar } from '../../AgentSidebar';
import { PanelToggleDock } from './PanelToggleDock';

interface TopicRailProps {
  collapsed: boolean;
  fullWidth?: boolean;
  onToggle: () => void;
  onOpenProfile: (agentName: string) => void;
  onOpenChat: (agentName: string) => void;
}

export function TopicRail({
  collapsed,
  fullWidth = false,
  onToggle,
  onOpenProfile,
  onOpenChat,
}: TopicRailProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const { selectedAgent, currentAgent } = useActiveAgentSlice((state) => ({
    selectedAgent: state.selectedAgent,
    currentAgent: state.agents.find((agent) => agent.name === state.selectedAgent),
  }));
  const newSession = useActiveChatSlice((state) => state.newSession);
  const { upsertTopics, topicCount } = useActiveAgentTopicSlice((state) => ({
    upsertTopics: state.upsertTopics,
    topicCount: currentAgent ? (state.topicsByAgentId[currentAgent.id]?.length || 0) : 0,
  }));

  const startNewTopic = () => {
    newSession();
    const chatState = useChatStore.getState();
    const draft = chatState.sessions.find(
      (session) => session.key === chatState.currentSessionKey,
    );
    if (currentAgent && draft) upsertTopics(currentAgent.id, [draft]);
    onOpenChat(selectedAgent);
  };

  if (collapsed) {
    return (
      <aside
        data-pt-topic-rail="collapsed"
        style={{
          width: 48,
          minWidth: 48,
          height: '100%',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          padding: '12px 0 52px',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          boxSizing: 'border-box',
        }}
      >
        <ActionIcon
          data-pt-agent-session-start
          icon={MessageSquarePlus}
          title={t('agent.sidebar.startNewTopic')}
          onClick={startNewTopic}
          size={{ blockSize: 36, size: 16 }}
        />
        <ActionIcon
          data-pt-agent-topics-expand
          icon={Hash}
          title={t('agent.sidebar.topicsCount', { count: topicCount })}
          aria-label={t('agent.sidebar.topicsCount', { count: topicCount })}
          onClick={onToggle}
          size={{ blockSize: 36, size: 16 }}
        />
        <span style={{ fontSize: 11, color: token.colorTextSecondary }}>{topicCount}</span>
        <PanelToggleDock
          open={false}
          title={t('agent.chat.expandPanel')}
          onClick={onToggle}
        />
      </aside>
    );
  }

  return (
    <aside
      data-pt-topic-rail="expanded"
      style={{
        width: fullWidth ? '100%' : 238,
        minWidth: fullWidth ? 0 : 238,
        height: '100%',
        position: 'relative',
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        boxSizing: 'border-box',
        overflow: 'hidden',
        paddingBottom: 48,
      }}
    >
      <AgentSidebar
        onNavigateProfile={onOpenProfile}
        onNavigateChat={() => onOpenChat(selectedAgent)}
      />
      {!fullWidth && (
        <PanelToggleDock
          open
          title={t('agent.chat.collapsePanel')}
          onClick={onToggle}
        />
      )}
    </aside>
  );
}
