import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, SearchBar } from '@lobehub/ui';
import {
  Plus,
  MessageSquarePlus,
  User,
  Search,
  Hash,
  ChevronsUpDown,
  ChevronRight,
  Trash2,
  ArrowLeft,
  Pin,
  MoreHorizontal,
  Star,
  Sparkles,
  Pencil,
  Copy,
} from 'lucide-react';
import { theme, Dropdown, Modal, Input, Popover, message as antMessage } from 'antd';
import type { MenuProps } from 'antd';
import { useChatStore } from '../store/chat';
import type { Agent, Session } from '../services/api';
import { api } from '../services/api';

interface AgentSidebarProps {
  onEditAgent: (agent: Agent) => void;
  onCreateAgent: () => void;
  onNavigateProfile?: (agentName: string) => void;
  onNavigateChat?: () => void;
  onAgentChanged?: (agentName: string) => void;
}

function groupTopicsByDate(sessions: Session[]): { key: string; label: string; items: Session[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const groups: Record<string, Session[]> = {};
  const groupOrder: string[] = [];

  const addToGroup = (key: string, session: Session) => {
    if (!groups[key]) {
      groups[key] = [];
      groupOrder.push(key);
    }
    groups[key].push(session);
  };

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  for (const s of sorted) {
    const d = new Date(s.updated_at);
    if (d >= today) {
      addToGroup('today', s);
    } else if (d >= yesterday) {
      addToGroup('yesterday', s);
    } else if (d >= weekAgo) {
      addToGroup('week', s);
    } else if (d >= monthStart) {
      addToGroup('month', s);
    } else {
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      addToGroup(monthKey, s);
    }
  }

  const labelMap: Record<string, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    week: 'This Week',
    month: 'This Month',
  };

  return groupOrder.map((key) => ({
    key,
    label:
      labelMap[key] ||
      new Date(key + '-01').toLocaleDateString('en-US', { year: 'numeric', month: 'long' }),
    items: groups[key],
  }));
}

export function AgentSidebar({ onEditAgent, onCreateAgent, onNavigateProfile, onNavigateChat, onAgentChanged }: AgentSidebarProps) {
  const {
    agents,
    loadAgents,
    selectedAgent,
    setSelectedAgent,
    currentSessionKey,
    sessions: storeSessions,
    selectSession,
    deleteSession,
    mergeSessions,
  } = useChatStore();

  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [agentSessions, setAgentSessions] = useState<Session[]>([]);
  const [searchText, setSearchText] = useState('');
  const [topicSearch, setTopicSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const { token } = theme.useToken();

  const currentAgent = useMemo(
    () => agents.find((a) => a.name === selectedAgent),
    [agents, selectedAgent],
  );

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const loadAgentTopics = useCallback(() => {
    if (!currentAgent) {
      setAgentSessions([]);
      return;
    }
    api
      .listAgentSessions(currentAgent.id)
      .then((sessions) => {
        setAgentSessions(sessions);
        mergeSessions(sessions);
      })
      .catch(() => setAgentSessions([]));
  }, [currentAgent, mergeSessions]);

  useEffect(() => {
    loadAgentTopics();
  }, [loadAgentTopics]);

  const handleSwitchAgent = useCallback(
    (agent: Agent) => {
      setSelectedAgent(agent.name);
      setShowAgentPicker(false);
      onAgentChanged?.(agent.name);

      api
        .listAgentSessions(agent.id)
        .then((sessions) => {
          setAgentSessions(sessions);
          mergeSessions(sessions);
          if (sessions.length > 0) {
            selectSession(sessions[0].key, sessions[0]);
          } else {
            const key = `agent:${agent.name}:${Date.now()}`;
            selectSession(key);
          }
        })
        .catch(() => {
          setAgentSessions([]);
          const key = `agent:${agent.name}:${Date.now()}`;
          selectSession(key);
        });
    },
    [setSelectedAgent, selectSession, mergeSessions, onAgentChanged],
  );

  const handleNewTopic = useCallback(() => {
    const agentName = selectedAgent || 'assistant';
    const key = `agent:${agentName}:${Date.now()}`;
    selectSession(key);
    onNavigateChat?.();
    setTimeout(loadAgentTopics, 300);
  }, [selectedAgent, selectSession, loadAgentTopics, onNavigateChat]);

  const handleDeleteTopic = useCallback(
    async (sessionKey: string) => {
      await deleteSession(sessionKey);
      loadAgentTopics();
    },
    [deleteSession, loadAgentTopics],
  );

  const handleSelectTopic = useCallback(
    (key: string) => {
      // Prefer store session (has model_override from mergeSessionModel) over agentSessions
      const session =
        storeSessions.find((s) => s.key === key) ?? agentSessions.find((s) => s.key === key);
      selectSession(key, session);
      onNavigateChat?.();
    },
    [agentSessions, storeSessions, selectSession, onNavigateChat],
  );

  const topicGroups = useMemo(() => {
    let filtered = agentSessions;
    if (topicSearch) {
      const q = topicSearch.toLowerCase();
      filtered = agentSessions.filter(
        (s) => (s.title || '').toLowerCase().includes(q) || s.key.toLowerCase().includes(q),
      );
    }
    return groupTopicsByDate(filtered);
  }, [agentSessions, topicSearch]);

  const totalTopics = agentSessions.length;

  if (showAgentPicker) {
    return (
      <AgentPicker
        agents={agents}
        selectedAgent={selectedAgent}
        searchText={searchText}
        onSearchChange={setSearchText}
        onSelect={handleSwitchAgent}
        onBack={() => setShowAgentPicker(false)}
        onCreate={onCreateAgent}
        token={token}
      />
    );
  }

  return (
    <Flexbox height="100%" style={{ background: token.colorBgLayout }}>
      {/* Agent Header */}
      <Flexbox
        style={{
          padding: '12px 12px 0',
          flexShrink: 0,
        }}
      >
        <Flexbox
          horizontal
          align="center"
          gap={8}
          onClick={() => setShowAgentPicker(true)}
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = token.colorFillTertiary;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = 'transparent';
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #667eea, #764ba2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            {currentAgent?.avatar || '🤖'}
          </div>
          <span
            style={{
              flex: 1,
              fontSize: 14,
              fontWeight: 600,
              color: token.colorText,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentAgent?.title || currentAgent?.name || selectedAgent || 'Default Agent'}
          </span>
          <ChevronsUpDown size={14} style={{ color: token.colorTextTertiary, flexShrink: 0 }} />
        </Flexbox>
      </Flexbox>

      {/* Nav Actions */}
      <Flexbox style={{ padding: '4px 12px 8px', flexShrink: 0 }} gap={1}>
        <NavItem
          icon={<MessageSquarePlus size={16} />}
          label="Start New Topic"
          onClick={handleNewTopic}
          token={token}
        />
        <NavItem
          icon={<User size={16} />}
          label="Agent Profile"
          onClick={() => currentAgent && (onNavigateProfile ? onNavigateProfile(currentAgent.name) : onEditAgent(currentAgent))}
          token={token}
        />
        <NavItem
          icon={<Search size={16} />}
          label="Search"
          onClick={() => setShowSearch(!showSearch)}
          active={showSearch}
          token={token}
        />
      </Flexbox>

      {showSearch && (
        <div style={{ padding: '0 12px 8px' }}>
          <SearchBar
            placeholder="Search topics..."
            value={topicSearch}
            onChange={(e) => setTopicSearch(e.target.value)}
            allowClear
            size="small"
          />
        </div>
      )}

      {/* Topic Section */}
      <Flexbox flex={1} style={{ overflow: 'auto', padding: '0 8px' }}>
        {/* Section header */}
        <Flexbox
          horizontal
          align="center"
          justify="space-between"
          style={{ padding: '4px 8px', marginBottom: 2 }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>
            Topic {totalTopics > 0 ? totalTopics : ''}
          </span>
        </Flexbox>

        {totalTopics === 0 ? (
          <NavItem
            icon={<MessageSquarePlus size={16} />}
            label="Start New Topic"
            onClick={handleNewTopic}
            token={token}
            style={{ margin: '0 4px' }}
          />
        ) : (
          topicGroups.map((group) => (
            <TopicGroup
              key={group.key}
              label={group.label}
              topics={group.items}
              currentSessionKey={currentSessionKey}
              onSelectTopic={handleSelectTopic}
              onDeleteTopic={handleDeleteTopic}
              onReload={loadAgentTopics}
              token={token}
            />
          ))
        )}
      </Flexbox>
    </Flexbox>
  );
}

function NavItem({
  icon,
  label,
  onClick,
  active,
  token,
  style,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  token: any;
  style?: React.CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Flexbox
      horizontal
      align="center"
      gap={10}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '7px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 13,
        color: active ? token.colorPrimary : token.colorText,
        background: active ? token.colorPrimaryBg : hovered ? token.colorFillTertiary : 'transparent',
        transition: 'all 0.15s',
        ...style,
      }}
    >
      <span style={{ display: 'flex', color: active ? token.colorPrimary : token.colorTextSecondary }}>
        {icon}
      </span>
      <span>{label}</span>
    </Flexbox>
  );
}

function TopicGroup({
  label,
  topics,
  currentSessionKey,
  onSelectTopic,
  onDeleteTopic,
  onReload,
  token,
}: {
  label: string;
  topics: Session[];
  currentSessionKey: string;
  onSelectTopic: (key: string) => void;
  onDeleteTopic: (key: string) => void;
  onReload: () => void;
  token: any;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ marginBottom: 2 }}>
      <Flexbox
        horizontal
        align="center"
        gap={4}
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '4px 8px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <ChevronRight
          size={12}
          style={{
            color: token.colorTextQuaternary,
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 0.15s',
          }}
        />
        <span style={{ fontSize: 12, color: token.colorTextSecondary, fontWeight: 500 }}>
          {label}
        </span>
      </Flexbox>

      {!collapsed && (
        <Flexbox gap={1} style={{ paddingLeft: 4 }}>
          {topics.map((topic) => (
            <TopicItem
              key={topic.key}
              topic={topic}
              isActive={topic.key === currentSessionKey}
              onSelect={() => onSelectTopic(topic.key)}
              onDelete={() => onDeleteTopic(topic.key)}
              onReload={onReload}
              token={token}
            />
          ))}
        </Flexbox>
      )}
    </div>
  );
}

// TopicItem — LobeChat-style topic with context menu
// - Right-click: context menu
// - Hover: "..." dropdown button
// - Rename: inline Input replacing the title text (not a Popover)
// - Delete: Modal.confirm()
// - Smart Rename: calls backend LLM to generate title
function TopicItem({
  topic,
  isActive,
  onSelect,
  onDelete,
  onReload,
  token,
}: {
  topic: Session;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onReload: () => void;
  token: any;
}) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const renameInputRef = useRef<any>(null);

  useEffect(() => {
    if (renaming) {
      setTimeout(() => renameInputRef.current?.focus({ cursor: 'end' }), 50);
    }
  }, [renaming]);

  const handleClick = useCallback(() => {
    if (renaming) return;
    onSelect();
  }, [onSelect, renaming]);

  const handleRename = useCallback(() => {
    setRenameTitle(topic.title || '');
    setRenaming(true);
  }, [topic.title]);

  const handleSaveRename = useCallback(async () => {
    const newTitle = renameTitle.trim();
    setRenaming(false);
    if (!newTitle || newTitle === (topic.title || '')) return;
    try {
      await api.renameSession(topic.key, newTitle);
      onReload();
    } catch (e: any) {
      antMessage.error(e.message || 'Rename failed');
    }
  }, [renameTitle, topic.title, topic.key, onReload]);

  const handleSmartRename = useCallback(async () => {
    try {
      antMessage.loading({ content: 'Generating title...', key: 'smart-rename' });
      const res = await api.smartRenameSession(topic.key);
      antMessage.success({ content: `Renamed to "${res.title}"`, key: 'smart-rename' });
      onReload();
    } catch (e: any) {
      antMessage.error({ content: e.message || 'Smart rename failed', key: 'smart-rename' });
    }
  }, [topic.key, onReload]);

  const handleDuplicate = useCallback(async () => {
    try {
      await api.duplicateSession(topic.key);
      antMessage.success('Topic duplicated');
      onReload();
    } catch (e: any) {
      antMessage.error(e.message || 'Duplicate failed');
    }
  }, [topic.key, onReload]);

  const handleDeleteConfirm = useCallback(() => {
    Modal.confirm({
      title: 'Delete this topic?',
      content: 'All messages in this topic will be permanently deleted.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => onDelete(),
    });
  }, [onDelete]);

  const menuItems: MenuProps['items'] = [
    { key: 'favorite', icon: <Star size={14} />, label: 'Favorite', disabled: true },
    { type: 'divider' },
    { key: 'smart-rename', icon: <Sparkles size={14} />, label: 'Smart Rename', onClick: handleSmartRename },
    { key: 'rename', icon: <Pencil size={14} />, label: 'Rename', onClick: handleRename },
    { key: 'duplicate', icon: <Copy size={14} />, label: 'Duplicate', onClick: handleDuplicate },
    { type: 'divider' },
    { key: 'delete', icon: <Trash2 size={14} />, label: 'Delete', danger: true, onClick: handleDeleteConfirm },
  ];

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
      <Flexbox
        horizontal
        align="center"
        gap={8}
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: '6px 8px 6px 12px',
          borderRadius: 6,
          cursor: 'pointer',
          background: isActive ? token.colorPrimaryBg : hovered ? token.colorFillTertiary : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        <Hash
          size={14}
          style={{
            color: isActive ? token.colorPrimary : token.colorTextTertiary,
            flexShrink: 0,
          }}
        />

        {/* Title + Popover rename (appears below the title, not covering it) */}
        <Popover
          open={renaming}
          placement="bottomLeft"
          trigger={[]}
          content={
            <Input
              ref={renameInputRef}
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onPressEnter={handleSaveRename}
              onBlur={handleSaveRename}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false); } }}
              onClick={(e) => e.stopPropagation()}
              style={{ width: 220 }}
              size="small"
            />
          }
          overlayInnerStyle={{ padding: 8 }}
          arrow={false}
        >
          <span
            style={{
              flex: 1,
              fontSize: 13,
              color: isActive ? token.colorPrimary : token.colorText,
              fontWeight: isActive ? 500 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {topic.title || 'New Topic'}
          </span>
        </Popover>

        {(hovered || isActive) && !renaming && (
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                cursor: 'pointer', color: token.colorTextTertiary,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = token.colorFillSecondary; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <MoreHorizontal size={14} />
            </div>
          </Dropdown>
        )}
      </Flexbox>
    </Dropdown>
  );
}

function AgentPicker({
  agents,
  selectedAgent,
  searchText,
  onSearchChange,
  onSelect,
  onBack,
  onCreate,
  token,
}: {
  agents: Agent[];
  selectedAgent: string;
  searchText: string;
  onSearchChange: (v: string) => void;
  onSelect: (a: Agent) => void;
  onBack: () => void;
  onCreate: () => void;
  token: any;
}) {
  const filtered = searchText
    ? agents.filter(
        (a) =>
          (a.title || '').toLowerCase().includes(searchText.toLowerCase()) ||
          (a.name || '').toLowerCase().includes(searchText.toLowerCase()) ||
          (a.description || '').toLowerCase().includes(searchText.toLowerCase()),
      )
    : agents;

  const pinnedAgents = filtered.filter((a) => a.pinned);
  const unpinnedAgents = filtered.filter((a) => !a.pinned);

  return (
    <Flexbox height="100%" style={{ background: token.colorBgLayout }}>
      {/* Header with back button */}
      <Flexbox horizontal align="center" gap={8} style={{ padding: '12px 12px 4px' }}>
        <ActionIcon
          icon={ArrowLeft}
          size="small"
          onClick={onBack}
          title="Back"
        />
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Switch Agent</span>
        <ActionIcon
          icon={Plus}
          size="small"
          onClick={onCreate}
          title="Create agent"
          style={{ background: token.colorPrimary, color: '#fff', borderRadius: 6 }}
        />
      </Flexbox>

      <div style={{ padding: '8px 12px' }}>
        <SearchBar
          placeholder="Search agents..."
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          allowClear
        />
      </div>

      <Flexbox flex={1} style={{ overflow: 'auto', padding: '0 8px 8px' }}>
        {filtered.length === 0 && (
          <Flexbox
            align="center"
            justify="center"
            flex={1}
            style={{ color: token.colorTextQuaternary, padding: 40, fontSize: 13 }}
          >
            {searchText ? 'No matching agents' : 'No agents yet'}
          </Flexbox>
        )}

        {pinnedAgents.map((agent) => (
          <AgentPickerItem
            key={agent.id}
            agent={agent}
            isSelected={selectedAgent === agent.name}
            onSelect={() => onSelect(agent)}
            token={token}
          />
        ))}

        {pinnedAgents.length > 0 && unpinnedAgents.length > 0 && (
          <div style={{ height: 1, background: token.colorBorderSecondary, margin: '4px 12px' }} />
        )}

        {unpinnedAgents.map((agent) => (
          <AgentPickerItem
            key={agent.id}
            agent={agent}
            isSelected={selectedAgent === agent.name}
            onSelect={() => onSelect(agent)}
            token={token}
          />
        ))}
      </Flexbox>
    </Flexbox>
  );
}

function AgentPickerItem({
  agent,
  isSelected,
  onSelect,
  token,
}: {
  agent: Agent;
  isSelected: boolean;
  onSelect: () => void;
  token: any;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Flexbox
      horizontal
      align="center"
      gap={10}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        cursor: 'pointer',
        background: isSelected ? token.colorPrimaryBg : hovered ? token.colorFillTertiary : 'transparent',
        transition: 'background 0.15s',
        marginBottom: 2,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: isSelected
            ? 'linear-gradient(135deg, #667eea, #764ba2)'
            : token.colorFillSecondary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        {agent.avatar || '🤖'}
      </div>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={4}>
          <span
            style={{
              fontSize: 13,
              fontWeight: isSelected ? 600 : 400,
              color: token.colorText,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.title || agent.name}
          </span>
          {agent.pinned && (
            <Pin size={10} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
          )}
        </Flexbox>
        <span
          style={{
            fontSize: 11,
            color: token.colorTextDescription,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {agent.description}
        </span>
      </Flexbox>
    </Flexbox>
  );
}
