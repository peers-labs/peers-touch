import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import type { ComponentProps } from 'react';
import { ActionIcon, Avatar, SearchBar } from '@lobehub/ui';
import { MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Search, Workflow } from 'lucide-react';
import { AgentSettingsDrawer } from '../components/AgentSettingsDrawer';
import { AgentSidebar } from '../components/AgentSidebar';
import type { Agent } from '../services/desktop_api';
import { useAgentStore } from '../store/agent';
import { ChatPage } from './ChatPage';

type AgentChatPageProps = ComponentProps<typeof ChatPage> & {
  onNavigateAgentCanvas?: () => void;
};

export function AgentChatPage(props: AgentChatPageProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const { agents, selectedAgent, setSelectedAgent } = useAgentStore();
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [agentListOpen, setAgentListOpen] = useState(true);
  const [agentSearch, setAgentSearch] = useState('');

  const filteredAgents = useMemo(() => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) return agents;
    return agents.filter((agent) =>
      [agent.title, agent.name, agent.description].some((value) => value.toLowerCase().includes(query)),
    );
  }, [agentSearch, agents]);
  const pinnedAgents = filteredAgents.filter((agent) => agent.pinned);
  const otherAgents = filteredAgents.filter((agent) => !agent.pinned);

  const handleSelectAgent = useCallback((agent: Agent) => {
    setSelectedAgent(agent.name);
  }, [setSelectedAgent]);

  const handleCreateAgent = useCallback(() => {
    setEditingAgent(null);
    setAgentDrawerOpen(true);
  }, []);

  const handleEditAgent = useCallback((agent: Agent) => {
    setEditingAgent(agent);
    setAgentDrawerOpen(true);
  }, []);

  const handleAgentSaved = useCallback((agent: Agent) => {
    setAgentDrawerOpen(false);
    setEditingAgent(null);
    setSelectedAgent(agent.name);
    props.onNavigateAgentProfile?.(agent.name);
  }, [props, setSelectedAgent]);

  return (
    <Flexbox
      horizontal
      height="100%"
      style={{
        minWidth: 0,
        overflow: 'hidden',
        background: token.colorBgLayout,
      }}
    >
      <aside
        style={{
          width: agentListOpen ? 230 : 48,
          height: '100%',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          overflow: 'hidden',
          transition: 'width 0.18s ease',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {agentListOpen ? (
          <>
            <Flexbox horizontal align="center" gap={8} style={{ height: 48, padding: '0 10px' }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 800, color: token.colorText }}>
                {t('agent.chat.myAgents')}
              </span>
              <ActionIcon icon={Plus} size="small" onClick={handleCreateAgent} title={t('agent.sidebar.createAgent')} />
              <ActionIcon icon={Workflow} size="small" onClick={props.onNavigateAgentCanvas} title={t('agent.chat.openCanvas')} />
            </Flexbox>
            <div style={{ padding: '0 10px 8px' }}>
              <SearchBar
                placeholder={t('agent.sidebar.searchAgents')}
                value={agentSearch}
                onChange={(event) => setAgentSearch(event.target.value)}
                allowClear
                size="small"
              />
            </div>
            <Flexbox flex={1} gap={4} style={{ minHeight: 0, overflow: 'auto', padding: '0 8px 52px' }}>
              <AgentRosterGroup label={t('agent.chat.pinned')} visible={pinnedAgents.length > 0} token={token} />
              {pinnedAgents.map((agent) => (
                <AgentRosterItem
                  key={agent.id}
                  agent={agent}
                  active={selectedAgent === agent.name}
                  compact={false}
                  token={token}
                  onClick={() => handleSelectAgent(agent)}
                />
              ))}
              <AgentRosterGroup label={t('agent.chat.allAgents')} visible={otherAgents.length > 0} token={token} />
              {otherAgents.map((agent) => (
                <AgentRosterItem
                  key={agent.id}
                  agent={agent}
                  active={selectedAgent === agent.name}
                  compact={false}
                  token={token}
                  onClick={() => handleSelectAgent(agent)}
                />
              ))}
            </Flexbox>
          </>
        ) : (
          <Flexbox align="center" gap={4} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 4px 52px' }}>
            <ActionIcon icon={Plus} size="small" onClick={handleCreateAgent} title={t('agent.sidebar.createAgent')} />
            <ActionIcon icon={Search} size="small" onClick={() => setAgentListOpen(true)} title={t('agent.sidebar.search')} />
            {agents.map((agent) => (
              <AgentRosterItem
                key={agent.id}
                agent={agent}
                active={selectedAgent === agent.name}
                compact
                token={token}
                onClick={() => {
                  handleSelectAgent(agent);
                  setAgentListOpen(true);
                }}
              />
            ))}
          </Flexbox>
        )}
        <button
          type="button"
          onClick={() => setAgentListOpen((open) => !open)}
          title={t(agentListOpen ? 'agent.sidebar.collapseAgents' : 'agent.sidebar.expandAgents')}
          style={{
            position: 'absolute',
            left: 9,
            bottom: 12,
            width: 34,
            height: 34,
            border: 0,
            borderRadius: 999,
            background: 'transparent',
            color: token.colorTextSecondary,
            cursor: 'pointer',
          }}
        >
          {agentListOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </aside>

      <aside
        style={{
          width: 284,
          minWidth: 260,
          height: '100%',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          overflow: 'hidden',
        }}
      >
        <AgentSidebar
          hideAgentPicker
          onCreateAgent={handleCreateAgent}
          onEditAgent={handleEditAgent}
          onNavigateProfile={props.onNavigateAgentProfile}
          onNavigateChat={() => undefined}
          onNavigateMarketplace={props.onNavigateSkills}
        />
      </aside>

      <Flexbox flex={1} height="100%" style={{ minWidth: 0, overflow: 'hidden' }}>
        <ChatPage {...props} />
      </Flexbox>

      <AgentSettingsDrawer
        open={agentDrawerOpen}
        editingAgent={editingAgent}
        onClose={() => {
          setAgentDrawerOpen(false);
          setEditingAgent(null);
        }}
        onSaved={handleAgentSaved}
      />
    </Flexbox>
  );
}

function AgentRosterGroup({ label, visible, token }: { label: string; visible: boolean; token: any }) {
  if (!visible) return null;
  return (
    <div style={{ padding: '10px 8px 5px', color: token.colorTextTertiary, fontSize: 11, fontWeight: 700 }}>
      {label}
    </div>
  );
}

function AgentRosterItem({
  agent,
  active,
  compact,
  token,
  onClick,
}: {
  agent: Agent;
  active: boolean;
  compact: boolean;
  token: any;
  onClick: () => void;
}) {
  if (compact) {
    return (
      <button
        type="button"
        title={agent.title || agent.name}
        onClick={onClick}
        style={{
          width: 40,
          height: 48,
          border: 0,
          borderRadius: 12,
          background: active ? token.colorPrimaryBg : 'transparent',
          cursor: 'pointer',
        }}
      >
        <Avatar avatar={agent.avatar || '🤖'} shape="square" size={30} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        minHeight: 52,
        padding: '7px 8px',
        border: 0,
        borderRadius: 12,
        background: active ? token.colorPrimaryBg : 'transparent',
        color: token.colorText,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <Avatar avatar={agent.avatar || '🤖'} shape="square" size={30} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.title || agent.name}{agent.pinned ? ' ★' : ''}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: token.colorTextTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.description}
        </span>
      </span>
      <MoreHorizontal size={14} color={token.colorTextTertiary} />
    </button>
  );
}
