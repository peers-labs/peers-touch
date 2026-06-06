import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, SearchBar } from '@lobehub/ui';
import {
  Plus,
  MessageSquarePlus,
  User,
  Search,
  Hash,
  ChevronRight,
  Trash2,
  Pin,
  PinOff,
  MoreHorizontal,
  Star,
  Sparkles,
  Pencil,
  Copy,
  GripVertical,
} from 'lucide-react';
import { theme, Modal, Popover } from 'antd';
import { Dropdown, Input, toast } from '@lobehub/ui';
import type { MenuProps } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../store/chat';
import type { Agent, AgentOrderItem, Session } from '../services/desktop_api';
import { api } from '../services/desktop_api';

interface AgentSidebarProps {
  onEditAgent: (agent: Agent) => void;
  onCreateAgent: () => void;
  onNavigateProfile?: (agentName: string) => void;
  onNavigateChat?: () => void;
  onAgentChanged?: (agentName: string) => void;
}

function groupTopicsByDate(sessions: Session[], t: (key: string) => string): { key: string; label: string; items: Session[] }[] {
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
    today: t('agent.sidebar.dateGroup.today'),
    yesterday: t('agent.sidebar.dateGroup.yesterday'),
    week: t('agent.sidebar.dateGroup.thisWeek'),
    month: t('agent.sidebar.dateGroup.thisMonth'),
  };

  return groupOrder.map((key) => ({
    key,
    label:
      labelMap[key] ||
      new Date(key + '-01').toLocaleDateString('en-US', { year: 'numeric', month: 'long' }),
    items: groups[key],
  }));
}

function toOrderItems(nextAgents: Agent[]): AgentOrderItem[] {
  return nextAgents.map((agent, index) => ({
    id: agent.id,
    pinned: Boolean(agent.pinned),
    sort_order: index,
  }));
}

export function AgentSidebar({ onEditAgent, onCreateAgent, onNavigateProfile, onNavigateChat, onAgentChanged }: AgentSidebarProps) {
  const { t } = useTranslation('agent');
  const {
    agents,
    loadAgents,
    reorderAgents,
    selectedAgent,
    setSelectedAgent,
    currentSessionKey,
    sessions: storeSessions,
    selectSession,
    deleteSession,
    mergeSessions,
  } = useChatStore();

  const [agentSessions, setAgentSessions] = useState<Session[]>([]);
  const [agentSearch, setAgentSearch] = useState('');
  const [topicSearch, setTopicSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [draggingAgentId, setDraggingAgentId] = useState<string | null>(null);
  const { token } = theme.useToken();

  const currentAgent = useMemo(
    () => agents.find((a) => a.name === selectedAgent),
    [agents, selectedAgent],
  );

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.name || '').toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q),
    );
  }, [agents, agentSearch]);

  const pinnedAgents = useMemo(() => filteredAgents.filter((agent) => agent.pinned), [filteredAgents]);
  const normalAgents = useMemo(() => filteredAgents.filter((agent) => !agent.pinned), [filteredAgents]);

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

  const handleSelectAgent = useCallback(
    (agent: Agent) => {
      setSelectedAgent(agent.name);
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

  const persistAgentOrder = useCallback(
    (nextAgents: Agent[]) => reorderAgents(toOrderItems(nextAgents)),
    [reorderAgents],
  );

  const handleTogglePin = useCallback(
    (agent: Agent) => {
      const rest = agents.filter((item) => item.id !== agent.id);
      const pinned = rest.filter((item) => item.pinned);
      const normal = rest.filter((item) => !item.pinned);
      const moved = { ...agent, pinned: !agent.pinned };
      const next = moved.pinned
        ? [moved, ...pinned, ...normal]
        : [...pinned, moved, ...normal];
      persistAgentOrder(next);
    },
    [agents, persistAgentOrder],
  );

  const handleDropAgent = useCallback(
    (targetPinned: boolean, targetId?: string) => {
      if (!draggingAgentId) return;
      const dragged = agents.find((agent) => agent.id === draggingAgentId);
      if (!dragged) return;

      const rest = agents.filter((agent) => agent.id !== draggingAgentId);
      const pinned = rest.filter((agent) => agent.pinned);
      const normal = rest.filter((agent) => !agent.pinned);
      const section = targetPinned ? pinned : normal;
      const moved = { ...dragged, pinned: targetPinned };

      const targetIndex = targetId ? section.findIndex((agent) => agent.id === targetId) : -1;
      if (targetIndex >= 0) {
        section.splice(targetIndex, 0, moved);
      } else {
        section.push(moved);
      }

      const next = targetPinned ? [...section, ...normal] : [...pinned, ...section];
      persistAgentOrder(next);
      setDraggingAgentId(null);
    },
    [agents, draggingAgentId, persistAgentOrder],
  );

  const handleNewTopic = useCallback(() => {
    const agentName = selectedAgent || 'assistant';
    const key = `agent:${agentName}:${Date.now()}`;
    const now = new Date().toISOString();
    const placeholder: Session = {
      id: key,
      key,
      agent_name: agentName,
      title: t('agent.sidebar.newTopic'),
      message_count: 0,
      created_at: now,
      updated_at: now,
    };
    setAgentSessions((prev) => [placeholder, ...prev]);
    selectSession(key);
    onNavigateChat?.();
  }, [selectedAgent, selectSession, onNavigateChat, t]);

  const handleDeleteTopic = useCallback(
    async (sessionKey: string) => {
      await deleteSession(sessionKey);
      loadAgentTopics();
    },
    [deleteSession, loadAgentTopics],
  );

  const handleSelectTopic = useCallback(
    (key: string) => {
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
    return groupTopicsByDate(filtered, t);
  }, [agentSessions, topicSearch, t]);

  const totalTopics = agentSessions.length;

  return (
    <Flexbox height="100%" style={{ background: token.colorBgLayout }}>
      <Flexbox style={{ padding: '12px 12px 8px', flexShrink: 0 }} gap={8}>
        <Flexbox horizontal align="center" gap={8}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SearchBar
              placeholder={t('agent.sidebar.searchAgents')}
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              allowClear
              size="small"
            />
          </div>
          <ActionIcon
            icon={Plus}
            size="small"
            onClick={onCreateAgent}
            title={t('agent.sidebar.createAgent')}
            style={{ background: token.colorPrimary, color: '#fff', borderRadius: 6, flexShrink: 0 }}
          />
        </Flexbox>
      </Flexbox>

      <Flexbox
        style={{
          padding: '0 8px 8px',
          flexShrink: 0,
          maxHeight: '44%',
          overflow: 'auto',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {filteredAgents.length === 0 ? (
          <Flexbox
            align="center"
            justify="center"
            style={{ color: token.colorTextQuaternary, padding: 24, fontSize: 13 }}
          >
            {agentSearch ? t('agent.sidebar.noMatchingAgents') : t('agent.sidebar.noAgentsYet')}
          </Flexbox>
        ) : (
          <>
            <AgentListSection
              title={t('agent.sidebar.pinnedAgents')}
              agents={pinnedAgents}
              pinned
              selectedAgent={selectedAgent}
              draggingAgentId={draggingAgentId}
              onSelect={handleSelectAgent}
              onTogglePin={handleTogglePin}
              onEdit={onEditAgent}
              onDragStart={setDraggingAgentId}
              onDropAgent={handleDropAgent}
              onDragEnd={() => setDraggingAgentId(null)}
              token={token}
              t={t}
            />
            <AgentListSection
              title={t('agent.sidebar.agents')}
              agents={normalAgents}
              pinned={false}
              selectedAgent={selectedAgent}
              draggingAgentId={draggingAgentId}
              onSelect={handleSelectAgent}
              onTogglePin={handleTogglePin}
              onEdit={onEditAgent}
              onDragStart={setDraggingAgentId}
              onDropAgent={handleDropAgent}
              onDragEnd={() => setDraggingAgentId(null)}
              token={token}
              t={t}
            />
          </>
        )}
      </Flexbox>

      <Flexbox style={{ padding: '8px 12px', flexShrink: 0 }} gap={1}>
        <NavItem
          icon={<MessageSquarePlus size={16} />}
          label={t('agent.sidebar.startNewTopic')}
          onClick={handleNewTopic}
          token={token}
        />
        <NavItem
          icon={<User size={16} />}
          label={t('agent.sidebar.agentProfile')}
          onClick={() => currentAgent && (onNavigateProfile ? onNavigateProfile(currentAgent.name) : onEditAgent(currentAgent))}
          token={token}
        />
        <NavItem
          icon={<Search size={16} />}
          label={t('agent.sidebar.search')}
          onClick={() => setShowSearch(!showSearch)}
          active={showSearch}
          token={token}
        />
      </Flexbox>

      {showSearch && (
        <div style={{ padding: '0 12px 8px' }}>
          <SearchBar
            placeholder={t('agent.sidebar.searchTopics')}
            value={topicSearch}
            onChange={(e) => setTopicSearch(e.target.value)}
            allowClear
            size="small"
          />
        </div>
      )}

      <Flexbox flex={1} style={{ overflow: 'auto', padding: '0 8px' }}>
        <Flexbox
          horizontal
          align="center"
          justify="space-between"
          style={{ padding: '4px 8px', marginBottom: 2 }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>
            {t('agent.sidebar.topic')} {totalTopics > 0 ? totalTopics : ''}
          </span>
        </Flexbox>

        {totalTopics === 0 ? (
          <NavItem
            icon={<MessageSquarePlus size={16} />}
            label={t('agent.sidebar.startNewTopic')}
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
              t={t}
            />
          ))
        )}
      </Flexbox>
    </Flexbox>
  );
}

function AgentListSection({
  title,
  agents,
  pinned,
  selectedAgent,
  draggingAgentId,
  onSelect,
  onTogglePin,
  onEdit,
  onDragStart,
  onDropAgent,
  onDragEnd,
  token,
  t,
}: {
  title: string;
  agents: Agent[];
  pinned: boolean;
  selectedAgent: string;
  draggingAgentId: string | null;
  onSelect: (agent: Agent) => void;
  onTogglePin: (agent: Agent) => void;
  onEdit: (agent: Agent) => void;
  onDragStart: (id: string) => void;
  onDropAgent: (targetPinned: boolean, targetId?: string) => void;
  onDragEnd: () => void;
  token: any;
  t: (key: string, options?: Record<string, any>) => string;
}) {
  const isDropping = draggingAgentId && agents.every((agent) => agent.id !== draggingAgentId);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDropAgent(pinned)}
      style={{
        paddingBottom: agents.length > 0 ? 6 : 2,
        minHeight: pinned ? 28 : 42,
      }}
    >
      {(agents.length > 0 || pinned) && (
        <Flexbox horizontal align="center" style={{ padding: '4px 8px 3px' }}>
          <span style={{ fontSize: 12, color: token.colorTextSecondary, fontWeight: 600 }}>
            {title}
          </span>
        </Flexbox>
      )}
      {agents.map((agent) => (
        <AgentNavItem
          key={agent.id}
          agent={agent}
          selected={selectedAgent === agent.name}
          dragging={draggingAgentId === agent.id}
          onSelect={() => onSelect(agent)}
          onTogglePin={() => onTogglePin(agent)}
          onEdit={() => onEdit(agent)}
          onDragStart={() => onDragStart(agent.id)}
          onDragEnd={onDragEnd}
          onDrop={(e) => {
            e.stopPropagation();
            onDropAgent(pinned, agent.id);
          }}
          token={token}
          t={t}
        />
      ))}
      {agents.length === 0 && isDropping && (
        <div
          style={{
            margin: '0 8px 4px',
            height: 30,
            borderRadius: 6,
            border: `1px dashed ${token.colorBorder}`,
          }}
        />
      )}
    </div>
  );
}

function AgentNavItem({
  agent,
  selected,
  dragging,
  onSelect,
  onTogglePin,
  onEdit,
  onDragStart,
  onDragEnd,
  onDrop,
  token,
  t,
}: {
  agent: Agent;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onEdit: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  token: any;
  t: (key: string, options?: Record<string, any>) => string;
}) {
  const [hovered, setHovered] = useState(false);
  const menuItems: MenuProps['items'] = [
    {
      key: 'pin',
      icon: agent.pinned ? <PinOff size={14} /> : <Pin size={14} />,
      label: agent.pinned ? t('agent.sidebar.unpin') : t('agent.sidebar.pin'),
      onClick: onTogglePin,
    },
    {
      key: 'profile',
      icon: <User size={14} />,
      label: t('agent.sidebar.agentProfile'),
      onClick: onEdit,
    },
  ];

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
      <Flexbox
        horizontal
        align="center"
        gap={8}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', agent.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={onSelect}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: '7px 8px',
          borderRadius: 6,
          cursor: 'pointer',
          background: selected ? token.colorPrimaryBg : hovered ? token.colorFillTertiary : 'transparent',
          opacity: dragging ? 0.45 : 1,
          transition: 'background 0.15s, opacity 0.15s',
          marginBottom: 2,
        }}
      >
        <GripVertical
          size={13}
          style={{ color: hovered ? token.colorTextQuaternary : 'transparent', flexShrink: 0 }}
          aria-label={t('agent.sidebar.dragToReorder')}
        />
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: selected ? token.colorPrimaryBgHover : token.colorFillSecondary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 15,
            flexShrink: 0,
          }}
        >
          {agent.avatar || '🤖'}
        </div>
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={4} style={{ minWidth: 0 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: selected ? 600 : 500,
                color: selected ? token.colorPrimary : token.colorText,
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
            {agent.description || agent.name}
          </span>
        </Flexbox>
        {(hovered || selected) && (
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: 4,
                flexShrink: 0,
                cursor: 'pointer',
                color: token.colorTextTertiary,
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

function NavItem({
  icon,
  label,
  onClick,
  active,
  token,
  style,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  token: any;
  style?: CSSProperties;
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
  t,
}: {
  label: string;
  topics: Session[];
  currentSessionKey: string;
  onSelectTopic: (key: string) => void;
  onDeleteTopic: (key: string) => void;
  onReload: () => void;
  token: any;
  t: (key: string, options?: Record<string, any>) => string;
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
              t={t}
            />
          ))}
        </Flexbox>
      )}
    </div>
  );
}

function TopicItem({
  topic,
  isActive,
  onSelect,
  onDelete,
  onReload,
  token,
  t,
}: {
  topic: Session;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onReload: () => void;
  token: any;
  t: (key: string, options?: Record<string, any>) => string;
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
      toast.error(e.message || t('agent.sidebar.toast.renameFailed'));
    }
  }, [renameTitle, topic.title, topic.key, onReload, t]);

  const handleSmartRename = useCallback(async () => {
    try {
      toast.loading(t('agent.sidebar.toast.generatingTitle'));
      const res = await api.smartRenameSession(topic.key);
      toast.success(t('agent.sidebar.toast.renamedTo', { title: res.title }));
      onReload();
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.smartRenameFailed'));
    }
  }, [topic.key, onReload, t]);

  const handleDuplicate = useCallback(async () => {
    try {
      await api.duplicateSession(topic.key);
      toast.success(t('agent.sidebar.toast.topicDuplicated'));
      onReload();
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.duplicateFailed'));
    }
  }, [topic.key, onReload, t]);

  const handleDeleteConfirm = useCallback(() => {
    Modal.confirm({
      title: t('agent.sidebar.deleteConfirm.title'),
      content: t('agent.sidebar.deleteConfirm.content'),
      okText: t('agent.sidebar.menu.delete'),
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => onDelete(),
    });
  }, [onDelete, t]);

  const menuItems: MenuProps['items'] = [
    { key: 'favorite', icon: <Star size={14} />, label: t('agent.sidebar.menu.favorite'), disabled: true },
    { type: 'divider' },
    { key: 'smart-rename', icon: <Sparkles size={14} />, label: t('agent.sidebar.menu.smartRename'), onClick: handleSmartRename },
    { key: 'rename', icon: <Pencil size={14} />, label: t('agent.sidebar.menu.rename'), onClick: handleRename },
    { key: 'duplicate', icon: <Copy size={14} />, label: t('agent.sidebar.menu.duplicate'), onClick: handleDuplicate },
    { type: 'divider' },
    { key: 'delete', icon: <Trash2 size={14} />, label: t('agent.sidebar.menu.delete'), danger: true, onClick: handleDeleteConfirm },
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
            {topic.title || t('agent.sidebar.newTopic')}
          </span>
        </Popover>

        {(hovered || isActive) && !renaming && (
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                borderRadius: 4,
                flexShrink: 0,
                cursor: 'pointer',
                color: token.colorTextTertiary,
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
