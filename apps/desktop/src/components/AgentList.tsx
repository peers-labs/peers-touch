import { useEffect, useState, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, SearchBar } from '@lobehub/ui';
import { Plus, Pin, Trash2, MessageSquare, ChevronRight, Settings2 } from 'lucide-react';
import { theme, Popconfirm } from 'antd';
import { useChatStore } from '../store/chat';
import type { Agent, Session } from '../services/desktop_api';
import { api } from '../services/desktop_api';

interface AgentListProps {
  onCreateAgent: () => void;
  onEditAgent: (agent: Agent) => void;
}

export function AgentList({ onCreateAgent, onEditAgent }: AgentListProps) {
  const {
    agents,
    loadAgents,
    selectedAgent,
    setSelectedAgent,
    sessions,
    currentSessionKey,
    selectSession,
  } = useChatStore();

  const [search, setSearch] = useState('');
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [agentSessions, setAgentSessions] = useState<Session[]>([]);
  const { token } = theme.useToken();

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleSelectAgent = useCallback((agent: Agent) => {
    setSelectedAgent(agent.name);

    // Find or create a session for this agent
    const existingSession = sessions.find((s) => s.agent_name === agent.name);
    if (existingSession) {
      selectSession(existingSession.key);
    } else {
      const key = `agent:${agent.name}:${Date.now()}`;
      selectSession(key);
    }

    if (expandedAgent === agent.id) {
      setExpandedAgent(null);
    } else {
      setExpandedAgent(agent.id);
      api.listAgentSessions(agent.id).then(setAgentSessions).catch(() => setAgentSessions([]));
    }
  }, [sessions, selectSession, setSelectedAgent, expandedAgent]);

  const handleNewTopic = useCallback((agentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAgent(agentName);
    const key = `agent:${agentName}:${Date.now()}`;
    selectSession(key);
  }, [setSelectedAgent, selectSession]);

  const handleDeleteAgent = useCallback(async (agentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteAgent(agentId);
      loadAgents();
    } catch {
      // built-in agents can't be deleted
    }
  }, [loadAgents]);

  const filtered = search
    ? agents.filter(
        (a) =>
          (a.title || '').toLowerCase().includes(search.toLowerCase()) ||
          (a.name || '').toLowerCase().includes(search.toLowerCase()) ||
          (a.description || '').toLowerCase().includes(search.toLowerCase()),
      )
    : agents;

  const pinnedAgents = filtered.filter((a) => a.pinned);
  const unpinnedAgents = filtered.filter((a) => !a.pinned);

  return (
    <Flexbox height="100%" style={{ background: token.colorBgLayout }}>
      {/* Header */}
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        padding={16}
        gap={8}
      >
        <SearchBar
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ flex: 1 }}
        />
        <ActionIcon
          icon={Plus}
          onClick={onCreateAgent}
          title="Create agent"
          style={{
            background: token.colorPrimary,
            color: '#fff',
            borderRadius: 8,
          }}
        />
      </Flexbox>

      {/* Agent List */}
      <Flexbox flex={1} style={{ overflow: 'auto', padding: '0 8px 8px' }}>
        {filtered.length === 0 && (
          <Flexbox
            align="center"
            justify="center"
            flex={1}
            style={{ color: token.colorTextQuaternary, padding: 40, fontSize: 13 }}
          >
            {search ? 'No matching agents' : 'No agents yet'}
          </Flexbox>
        )}

        {pinnedAgents.length > 0 && (
          <>
            {pinnedAgents.map((agent) => (
              <AgentItem
                key={agent.id}
                agent={agent}
                isSelected={selectedAgent === agent.name}
                isExpanded={expandedAgent === agent.id}
                agentSessions={expandedAgent === agent.id ? agentSessions : []}
                currentSessionKey={currentSessionKey}
                onSelect={() => handleSelectAgent(agent)}
                onSelectSession={selectSession}
                onNewTopic={(e) => handleNewTopic(agent.name, e)}
                onEdit={() => onEditAgent(agent)}
                onDelete={(e) => handleDeleteAgent(agent.id, e)}
                token={token}
              />
            ))}
            {unpinnedAgents.length > 0 && (
              <div style={{ height: 1, background: token.colorBorderSecondary, margin: '4px 12px' }} />
            )}
          </>
        )}

        {unpinnedAgents.map((agent) => (
          <AgentItem
            key={agent.id}
            agent={agent}
            isSelected={selectedAgent === agent.name}
            isExpanded={expandedAgent === agent.id}
            agentSessions={expandedAgent === agent.id ? agentSessions : []}
            currentSessionKey={currentSessionKey}
            onSelect={() => handleSelectAgent(agent)}
            onSelectSession={selectSession}
            onNewTopic={(e) => handleNewTopic(agent.name, e)}
            onEdit={() => onEditAgent(agent)}
            onDelete={(e) => handleDeleteAgent(agent.id, e)}
            token={token}
          />
        ))}
      </Flexbox>
    </Flexbox>
  );
}

function AgentItem({
  agent,
  isSelected,
  isExpanded,
  agentSessions,
  currentSessionKey,
  onSelect,
  onSelectSession,
  onNewTopic,
  onEdit,
  onDelete,
  token,
}: {
  agent: Agent;
  isSelected: boolean;
  isExpanded: boolean;
  agentSessions: Session[];
  currentSessionKey: string;
  onSelect: () => void;
  onSelectSession: (key: string) => void;
  onNewTopic: (e: React.MouseEvent) => void;
  onEdit: () => void;
  onDelete: (e: React.MouseEvent) => void;
  token: any;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ marginBottom: 2 }}>
      <Flexbox
        horizontal
        align="center"
        gap={10}
        onClick={onSelect}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: '10px 12px',
          borderRadius: 8,
          cursor: 'pointer',
          background: isSelected ? token.colorPrimaryBg : hovered ? token.colorFillTertiary : 'transparent',
          transition: 'background 0.2s',
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: isSelected
              ? 'linear-gradient(135deg, #667eea, #764ba2)'
              : token.colorFillSecondary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          {agent.avatar || '🤖'}
        </div>

        {/* Name + Description */}
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={4}>
            <div
              style={{
                fontSize: 14,
                fontWeight: isSelected ? 600 : 400,
                color: token.colorText,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {agent.title || agent.name}
            </div>
            {agent.pinned && (
              <Pin size={10} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
            )}
          </Flexbox>
          <div
            style={{
              fontSize: 12,
              color: token.colorTextDescription,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.description}
          </div>
        </Flexbox>

        {/* Actions (on hover) */}
        {hovered && (
          <Flexbox horizontal gap={0} style={{ flexShrink: 0 }}>
            <ActionIcon
              icon={Settings2}
              size={{ blockSize: 24, size: 13 }}
              title="Agent settings"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); onEdit(); }}
              style={{ color: token.colorTextTertiary }}
            />
            {!agent.isDefault && (
              <Popconfirm
                title="Delete this agent?"
                onConfirm={(e) => onDelete(e as unknown as React.MouseEvent)}
                okText="Delete"
                cancelText="Cancel"
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <ActionIcon
                    icon={Trash2}
                    size={{ blockSize: 24, size: 13 }}
                    title="Delete"
                    style={{ color: token.colorTextTertiary }}
                  />
                </div>
              </Popconfirm>
            )}
          </Flexbox>
        )}

        <ChevronRight
          size={14}
          style={{
            color: token.colorTextQuaternary,
            flexShrink: 0,
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        />
      </Flexbox>

      {/* Expanded: Topics */}
      {isExpanded && (
        <Flexbox style={{ paddingLeft: 20, paddingRight: 4 }}>
          {/* New Topic button */}
          <Flexbox
            horizontal
            align="center"
            gap={8}
            onClick={onNewTopic}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
              color: token.colorPrimary,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
              (e.currentTarget as HTMLDivElement).style.background = token.colorFillTertiary;
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
              (e.currentTarget as HTMLDivElement).style.background = 'transparent';
            }}
          >
            <Plus size={12} />
            <span>Start New Topic</span>
          </Flexbox>

          {agentSessions.map((s) => (
            <Flexbox
              key={s.key}
              horizontal
              align="center"
              gap={8}
              onClick={() => onSelectSession(s.key)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                background: s.key === currentSessionKey ? token.colorPrimaryBg : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                if (s.key !== currentSessionKey) (e.currentTarget as HTMLDivElement).style.background = token.colorFillTertiary;
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                if (s.key !== currentSessionKey) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
              }}
            >
              <MessageSquare size={12} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: token.colorText,
              }}>
                {s.title || 'New Topic'}
              </span>
              <span style={{ color: token.colorTextQuaternary, fontSize: 11, flexShrink: 0 }}>
                {s.message_count}
              </span>
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </div>
  );
}
