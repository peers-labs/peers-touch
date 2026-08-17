import { ActionIcon } from '@lobehub/ui';
import { theme } from 'antd';
import { MessageSquarePlus, UserRound } from 'lucide-react';
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
  onToggle: () => void;
  onOpenProfile: (agentName: string) => void;
  onOpenChat: (agentName: string) => void;
}

export function TopicRail({
  collapsed,
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
  const upsertTopics = useActiveAgentTopicSlice((state) => state.upsertTopics);

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
          icon={MessageSquarePlus}
          title={t('agent.sidebar.startNewTopic')}
          onClick={startNewTopic}
          size={{ blockSize: 36, size: 16 }}
        />
        <ActionIcon
          icon={UserRound}
          title={t('agent.sidebar.agentProfile')}
          onClick={() => onOpenProfile(selectedAgent)}
          size={{ blockSize: 36, size: 16 }}
        />
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
        width: 230,
        minWidth: 230,
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
        hideAgentPicker
        onCreateAgent={() => onOpenProfile(selectedAgent)}
        onEditAgent={(agent) => onOpenProfile(agent.name)}
        onNavigateProfile={onOpenProfile}
        onNavigateChat={() => onOpenChat(selectedAgent)}
      />
      <PanelToggleDock
        open
        title={t('agent.chat.collapsePanel')}
        onClick={onToggle}
      />
    </aside>
  );
}
