import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, Block, Center, SearchBar, Text } from '@lobehub/ui';
import {
  Plus,
  Download,
  MessageSquarePlus,
  User,
  Search,
  Hash,
  ChevronRight,
  Trash2,
  Pin,
  MoreHorizontal,
  Star,
  Sparkles,
  Pencil,
  Copy,
  Undo2,
  Upload,
  Loader2,
  Settings2,
} from 'lucide-react';
import { theme, Modal, Popover } from 'antd';
import { Dropdown, Input, toast } from '@lobehub/ui';
import type { MenuProps } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import type { AgentTopic } from '../store/agentTopics';
import type { AgentMessageSearchResult } from '../store/agentSearch';
import { api, type Agent, parseAgentChatConfig } from '../services/desktop_api';
import { AgentIconTile } from './agent/AgentIconTile';
import {
  useActiveAgentSearchSlice,
  useActiveAgentSlice,
  useActiveAgentTopicSlice,
  useActiveChatSlice,
} from './agent/useActiveAgentStores';
import { openAgentChatSession } from '../utils/openAgentChatSession';

interface AgentSidebarProps {
  onEditAgent: (agent: Agent) => void;
  onCreateAgent: () => void;
  onNavigateProfile?: (agentName: string) => void;
  onNavigateChat?: () => void;
  onNavigateMarketplace?: () => void;
  onAgentChanged?: (agentName: string) => void;
  hideAgentPicker?: boolean;
}

function groupTopicsByDate(sessions: AgentTopic[], t: (key: string) => string): { key: string; label: string; items: AgentTopic[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const groups: Record<string, AgentTopic[]> = {};
  const groupOrder: string[] = [];

  const addToGroup = (key: string, session: AgentTopic) => {
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

export function AgentSidebar({ onEditAgent, onCreateAgent, onNavigateProfile, onNavigateChat, onNavigateMarketplace, onAgentChanged, hideAgentPicker = false }: AgentSidebarProps) {
  const { t } = useTranslation('agent');
  const {
    agents,
    loadAgents,
    selectedAgent,
    defaultAgent,
    setDefaultAgent,
  } = useActiveAgentSlice((s) => ({
    agents: s.agents,
    loadAgents: s.loadAgents,
    selectedAgent: s.selectedAgent,
    defaultAgent: s.defaultAgent,
    setDefaultAgent: s.setDefaultAgent,
  }));
  const {
    currentSessionKey,
    sessions: storeSessions,
    selectSession,
  } = useActiveChatSlice((s) => ({
    currentSessionKey: s.currentSessionKey,
    sessions: s.sessions,
    selectSession: s.selectSession,
  }));
  const {
    activeAgentId,
    topicsByAgentId,
    loadingAgentIds,
    loadTopicsForAgent,
    createDraftTopic,
    deleteTopic,
    renameTopic,
    smartRenameTopic,
    revertGeneratedTitle,
    duplicateTopic,
  } = useActiveAgentTopicSlice((s) => ({
    activeAgentId: s.activeAgentId,
    topicsByAgentId: s.topicsByAgentId,
    loadingAgentIds: s.loadingAgentIds,
    loadTopicsForAgent: s.loadTopicsForAgent,
    createDraftTopic: s.createDraftTopic,
    deleteTopic: s.deleteTopic,
    renameTopic: s.renameTopic,
    smartRenameTopic: s.smartRenameTopic,
    revertGeneratedTitle: s.revertGeneratedTitle,
    duplicateTopic: s.duplicateTopic,
  }));
  const {
    searching: messageSearching,
    results: messageSearchResults,
    searchAgentMessages,
    resetSearch,
  } = useActiveAgentSearchSlice((s) => ({
    searching: s.searching,
    results: s.results,
    searchAgentMessages: s.searchAgentMessages,
    resetSearch: s.resetSearch,
  }));

  const [searchText, setSearchText] = useState('');
  const [topicSearch, setTopicSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const { token } = theme.useToken();

  const currentAgent = useMemo(
    () => agents.find((a) => a.name === selectedAgent),
    [agents, selectedAgent],
  );

  const agentTopics = useMemo(
    () => (currentAgent ? topicsByAgentId[currentAgent.id] || [] : []),
    [currentAgent, topicsByAgentId],
  );

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const loadAgentTopics = useCallback(() => {
    if (!currentAgent) {
      return;
    }
    void loadTopicsForAgent(currentAgent.id, 'sidebar');
  }, [currentAgent, loadTopicsForAgent]);

  useEffect(() => {
    loadAgentTopics();
  }, [loadAgentTopics]);

  useEffect(() => {
    setShowSearch(false);
    setTopicSearch('');
    resetSearch();
  }, [currentAgent?.id, resetSearch]);

  useEffect(() => {
    if (!showSearch || topicSearch.trim().length < 2) {
      resetSearch();
      return;
    }
    const timer = window.setTimeout(() => {
      void searchAgentMessages(topicSearch, agentTopics);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [agentTopics, resetSearch, searchAgentMessages, showSearch, topicSearch]);

  const switchSeqRef = useRef(0);

  const handleSwitchAgent = useCallback(
    (agent: Agent) => {
      const seq = switchSeqRef.current + 1;
      switchSeqRef.current = seq;
      onAgentChanged?.(agent.name);

      openAgentChatSession(agent, { reason: 'switch-agent' })
        .catch(() => {
          if (switchSeqRef.current !== seq) return;
          const topic = createDraftTopic(agent.id, agent.name, t('agent.sidebar.newTopic'));
          void selectSession(topic.key, topic);
        });
    },
    [createDraftTopic, onAgentChanged, selectSession, t],
  );

  const handleNewTopic = useCallback(() => {
    const agentName = selectedAgent || 'assistant';
    const topic = createDraftTopic(currentAgent?.id || activeAgentId || agentName, agentName, t('agent.sidebar.newTopic'));
    selectSession(topic.key, topic);
    onNavigateChat?.();
  }, [activeAgentId, createDraftTopic, currentAgent, selectedAgent, selectSession, onNavigateChat, t]);

  const handleExportAgentPackage = useCallback(async () => {
    if (!currentAgent) return;
    try {
      const pkg = await api.exportAgentPackage(currentAgent.id);
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${currentAgent.name || currentAgent.id}.agent.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(t('agent.sidebar.toast.agentExported'));
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.agentExportFailed'));
    }
  }, [currentAgent, t]);

  const handleImportAgentPackage = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const pkg = JSON.parse(text);
      const imported = await api.importAgentPackage(pkg);
      await loadAgents();
      void openAgentChatSession(imported, { reason: 'import-agent-package' });
      toast.success(t('agent.sidebar.toast.agentImported', { name: imported.title || imported.name }));
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.agentImportFailed'));
    }
  }, [loadAgents, t]);

  const handleCloneAgent = useCallback(async () => {
    if (!currentAgent) return;
    try {
      const cloned = await api.duplicateAgent(currentAgent.id, `${currentAgent.name} copy`);
      await loadAgents();
      void openAgentChatSession(cloned, { reason: 'clone-agent' });
      toast.success(t('agent.sidebar.toast.agentCloned', { name: cloned.title || cloned.name }));
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.agentCloneFailed'));
    }
  }, [currentAgent, loadAgents, t]);

  const handleSetDefaultAgent = useCallback(async (agent: Agent) => {
    try {
      await setDefaultAgent(agent.id);
      toast.success(t('agent.sidebar.toast.defaultAgentUpdated', { name: agent.title || agent.name }));
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.defaultAgentUpdateFailed'));
    }
  }, [setDefaultAgent, t]);

  const handleToggleAgentPin = useCallback(async (agent: Agent) => {
    try {
      await api.updateAgent(agent.id, { pinned: !agent.pinned });
      await loadAgents();
      toast.success(t(agent.pinned ? 'agent.sidebar.toast.agentUnpinned' : 'agent.sidebar.toast.agentPinned', { name: agent.title || agent.name }));
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.agentPinUpdateFailed'));
    }
  }, [loadAgents, t]);

  const handleToggleAgentFavorite = useCallback(async (agent: Agent) => {
    try {
      await api.updateAgent(agent.id, { favorite: !agent.favorite });
      await loadAgents();
      toast.success(t(agent.favorite ? 'agent.sidebar.toast.agentUnfavorited' : 'agent.sidebar.toast.agentFavorited', { name: agent.title || agent.name }));
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.agentFavoriteUpdateFailed'));
    }
  }, [loadAgents, t]);

  const handleDeleteTopic = useCallback(
    async (sessionKey: string) => {
      const wasCurrent = currentSessionKey === sessionKey;
      const nextTopic = agentTopics.find((topic) => topic.key !== sessionKey);
      await deleteTopic(sessionKey);
      if (wasCurrent) {
        if (nextTopic) {
          await selectSession(nextTopic.key, nextTopic);
        } else if (currentAgent) {
          const topic = createDraftTopic(currentAgent.id, currentAgent.name, t('agent.sidebar.newTopic'));
          await selectSession(topic.key, topic);
        }
      }
      loadAgentTopics();
    },
    [agentTopics, createDraftTopic, currentAgent, currentSessionKey, deleteTopic, loadAgentTopics, selectSession, t],
  );

  const handleSelectTopic = useCallback(
    (key: string) => {
      // Prefer store session when it carries model overrides from the chat projection.
      const session =
        storeSessions.find((s) => s.key === key) ?? agentTopics.find((s) => s.key === key);
      selectSession(key, session);
      onNavigateChat?.();
    },
    [agentTopics, storeSessions, selectSession, onNavigateChat],
  );

  const topicGroups = useMemo(() => {
    let filtered = agentTopics;
    if (topicSearch) {
      const q = topicSearch.toLowerCase();
      filtered = agentTopics.filter(
        (s) => (s.title || '').toLowerCase().includes(q) || s.key.toLowerCase().includes(q),
      );
    }
    return groupTopicsByDate(filtered, t);
  }, [agentTopics, topicSearch, t]);

  const totalTopics = agentTopics.length;
  const loadingTopics = currentAgent ? !!loadingAgentIds[currentAgent.id] : false;
  const showMessageResults = showSearch && topicSearch.trim().length >= 2;

  return (
    <Flexbox height="100%" style={{ background: token.colorBgContainer }}>
      {hideAgentPicker ? (
        <AgentContextCard agent={currentAgent} token={token} t={t} />
      ) : (
        <AgentPicker
          agents={agents}
          selectedAgent={selectedAgent}
          defaultAgent={defaultAgent}
          searchText={searchText}
          onSearchChange={setSearchText}
          onSelect={handleSwitchAgent}
          onSetDefault={handleSetDefaultAgent}
          onTogglePin={handleToggleAgentPin}
          onToggleFavorite={handleToggleAgentFavorite}
          onCreate={onCreateAgent}
          onClone={handleCloneAgent}
          onExport={handleExportAgentPackage}
          onImportClick={() => importInputRef.current?.click()}
          onNavigateMarketplace={onNavigateMarketplace}
          token={token}
          t={t}
        />
      )}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void handleImportAgentPackage(file);
        }}
      />

      {/* Nav Actions */}
      <Flexbox style={{ padding: hideAgentPicker ? '0 14px 8px' : '8px', flexShrink: 0, borderBottom: hideAgentPicker ? 'none' : `1px solid ${token.colorBorderSecondary}` }} gap={2}>
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
          style={hideAgentPicker ? { height: 30, paddingInline: 0 } : undefined}
        />
      </Flexbox>

      {showSearch && (
        <div style={{ padding: hideAgentPicker ? '0 14px 8px' : '0 12px 8px' }}>
          <SearchBar
            placeholder={t('agent.sidebar.searchTopics')}
            value={topicSearch}
            onChange={(e) => setTopicSearch(e.target.value)}
            allowClear
            size="small"
          />
        </div>
      )}

      {/* Topic Section */}
      <Flexbox flex={1} style={{ overflow: 'auto', padding: hideAgentPicker ? '8px 14px 16px' : '8px' }}>
        {/* Section header */}
        <Flexbox
          horizontal
          align="center"
          justify="space-between"
          style={{ padding: hideAgentPicker ? '0 0 6px' : '0 8px 6px' }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>
            {t('agent.sidebar.topic')} {totalTopics > 0 ? totalTopics : ''}
          </span>
          {loadingTopics ? (
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
              {t('agent.sidebar.topicSyncing')}
            </span>
          ) : (
            <Settings2 size={13} color={token.colorTextTertiary} />
          )}
        </Flexbox>

        {showMessageResults ? (
          <MessageSearchResults
            results={messageSearchResults}
            searching={messageSearching}
            onSelectResult={handleSelectTopic}
            token={token}
            t={t}
          />
        ) : totalTopics === 0 ? (
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
              key={`${currentAgent?.id || 'agent'}:${group.key}`}
              label={group.label}
              topics={group.items}
              currentSessionKey={currentSessionKey}
              onSelectTopic={handleSelectTopic}
              onDeleteTopic={handleDeleteTopic}
              onReload={loadAgentTopics}
              onRenameTopic={renameTopic}
              onSmartRenameTopic={smartRenameTopic}
              onRevertGeneratedTitle={revertGeneratedTitle}
              onDuplicateTopic={duplicateTopic}
              token={token}
              t={t}
            />
          ))
        )}
      </Flexbox>
    </Flexbox>
  );
}

function AgentContextCard({
  agent,
  token,
  t,
}: {
  agent?: Agent;
  token: any;
  t: (key: string, options?: Record<string, any>) => string;
}) {
  if (!agent) {
    return (
      <div style={{ padding: 10, borderBottom: `1px solid ${token.colorBorderSecondary}`, color: token.colorTextTertiary, fontSize: 12 }}>
        {t('agent.sidebar.noAgentsYet')}
      </div>
    );
  }
  return (
    <Flexbox
      horizontal
      align="center"
      gap={10}
      style={{
        margin: '16px 14px 12px',
        padding: 14,
        borderRadius: 22,
        border: 'none',
        background: token.colorBgContainer,
        boxShadow: '0 14px 40px rgba(15, 23, 42, 0.08)',
        flexShrink: 0,
      }}
    >
      <AgentIconTile agent={agent} size={44} />
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.title || agent.name}
        </span>
        <span style={{ fontSize: 11, color: token.colorTextTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.description || t('agent.canvas.agentFallback')}
        </span>
      </Flexbox>
      <Sparkles size={14} color={token.colorWarning} />
    </Flexbox>
  );
}

function MessageSearchResults({
  results,
  searching,
  onSelectResult,
  token,
  t,
}: {
  results: AgentMessageSearchResult[];
  searching: boolean;
  onSelectResult: (key: string) => void;
  token: any;
  t: (key: string, options?: Record<string, any>) => string;
}) {
  if (searching) {
    return (
      <Flexbox horizontal align="center" gap={8} style={{ padding: '10px 8px', color: token.colorTextSecondary, fontSize: 12 }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
        {t('agent.sidebar.searchingMessages')}
      </Flexbox>
    );
  }

  if (results.length === 0) {
    return (
      <div style={{ padding: '10px 8px', color: token.colorTextTertiary, fontSize: 12 }}>
        {t('agent.sidebar.noMessageResults')}
      </div>
    );
  }

  return (
    <Flexbox gap={4}>
      <div style={{ padding: '0 8px 6px', color: token.colorTextSecondary, fontSize: 12, fontWeight: 600 }}>
        {t('agent.sidebar.messageResults', { count: results.length })}
      </div>
      {results.map((result) => (
        <Flexbox
          key={result.id}
          onClick={() => onSelectResult(result.topicKey)}
          gap={3}
          style={{
            padding: '8px',
            borderRadius: 8,
            cursor: 'pointer',
            background: token.colorFillQuaternary,
          }}
        >
          <span style={{ fontSize: 12, color: token.colorText, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {result.topicTitle || result.topicKey}
          </span>
          <span style={{ fontSize: 11, color: token.colorTextSecondary, lineHeight: 1.35 }}>
            {result.snippet}
          </span>
        </Flexbox>
      ))}
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
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  token: any;
  style?: React.CSSProperties;
}) {
  return (
    <Block
      horizontal
      align="center"
      clickable
      gap={8}
      height={36}
      paddingInline={4}
      variant={active ? 'filled' : 'borderless'}
      onClick={() => onClick?.()}
      style={{
        color: active ? token.colorText : token.colorTextSecondary,
        userSelect: 'none',
        ...style,
      }}
    >
      <Center flex="none" height={28} width={28}>
        <span style={{ display: 'flex', color: active ? token.colorText : token.colorTextDescription }}>
          {icon}
        </span>
      </Center>
      <Text
        color={active ? token.colorText : token.colorTextSecondary}
        ellipsis={{ tooltipWhenOverflow: true }}
        style={{ flex: 1 }}
      >
        {label}
      </Text>
    </Block>
  );
}

function TopicGroup({
  label,
  topics,
  currentSessionKey,
  onSelectTopic,
  onDeleteTopic,
  onReload,
  onRenameTopic,
  onSmartRenameTopic,
  onRevertGeneratedTitle,
  onDuplicateTopic,
  token,
  t,
}: {
  label: string;
  topics: AgentTopic[];
  currentSessionKey: string;
  onSelectTopic: (key: string) => void;
  onDeleteTopic: (key: string) => void;
  onReload: () => void;
  onRenameTopic: (key: string, title: string) => Promise<void>;
  onSmartRenameTopic: (key: string) => Promise<{ title: string }>;
  onRevertGeneratedTitle: (key: string) => Promise<void>;
  onDuplicateTopic: (key: string) => Promise<void>;
  token: any;
  t: (key: string, options?: Record<string, any>) => string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ marginBottom: 4 }}>
      <Flexbox
        horizontal
        align="center"
        gap={4}
        onClick={() => setCollapsed(!collapsed)}
        style={{
          minHeight: 28,
          padding: '0 8px',
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
        <Flexbox gap={1}>
          {topics.map((topic) => (
            <TopicItem
              key={topic.key}
              topic={topic}
              isActive={topic.key === currentSessionKey}
              onSelect={() => onSelectTopic(topic.key)}
              onDelete={() => onDeleteTopic(topic.key)}
              onReload={onReload}
              onRenameTopic={onRenameTopic}
              onSmartRenameTopic={onSmartRenameTopic}
              onRevertGeneratedTitle={onRevertGeneratedTitle}
              onDuplicateTopic={onDuplicateTopic}
              token={token}
              t={t}
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
  onRenameTopic,
  onSmartRenameTopic,
  onRevertGeneratedTitle,
  onDuplicateTopic,
  token,
  t,
}: {
  topic: AgentTopic;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onReload: () => void;
  onRenameTopic: (key: string, title: string) => Promise<void>;
  onSmartRenameTopic: (key: string) => Promise<{ title: string }>;
  onRevertGeneratedTitle: (key: string) => Promise<void>;
  onDuplicateTopic: (key: string) => Promise<void>;
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
      await onRenameTopic(topic.key, newTitle);
      onReload();
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.renameFailed'));
    }
  }, [renameTitle, topic.title, topic.key, onRenameTopic, onReload, t]);

  const handleSmartRename = useCallback(async () => {
    try {
      toast.loading(t('agent.sidebar.toast.generatingTitle'));
      const res = await onSmartRenameTopic(topic.key);
      toast.success(t('agent.sidebar.toast.renamedTo', { title: res.title }));
      onReload();
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.smartRenameFailed'));
    }
  }, [topic.key, onSmartRenameTopic, onReload, t]);

  const handleUndoGeneratedTitle = useCallback(async (event: MouseEvent) => {
    event.stopPropagation();
    try {
      await onRevertGeneratedTitle(topic.key);
      toast.success(t('agent.sidebar.toast.titleReverted'));
      onReload();
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.renameFailed'));
    }
  }, [topic.key, onRevertGeneratedTitle, onReload, t]);

  const handleDuplicate = useCallback(async () => {
    try {
      await onDuplicateTopic(topic.key);
      toast.success(t('agent.sidebar.toast.topicDuplicated'));
      onReload();
    } catch (e: any) {
      toast.error(e.message || t('agent.sidebar.toast.duplicateFailed'));
    }
  }, [topic.key, onDuplicateTopic, onReload, t]);

  const handleDeleteConfirm = useCallback(() => {
    Modal.confirm({
      title: t('agent.sidebar.deleteConfirm.title'),
      content: t('agent.sidebar.deleteConfirm.content'),
      okText: t('agent.sidebar.menu.delete'),
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => onDelete(),
    });
  }, [onDelete]);

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
          minHeight: 36,
          padding: '4px 8px',
          borderRadius: 8,
          cursor: 'pointer',
          background: isActive ? token.colorFillSecondary : hovered ? token.colorFillTertiary : 'transparent',
          transition: 'background 0.18s ease',
        }}
      >
        <Hash
          size={14}
          style={{
            color: isActive ? token.colorText : token.colorTextDescription,
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
          styles={{ container: { padding: 8 } }}
          arrow={false}
        >
          <span
            style={{
              flex: 1,
              fontSize: 13,
              color: isActive ? token.colorText : token.colorTextSecondary,
              fontWeight: isActive ? 500 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {topic.title || t('agent.sidebar.newTopic')}
          </span>
        </Popover>

        {topic.titleState === 'generating' && (
          <span style={{ fontSize: 11, color: token.colorTextTertiary, flexShrink: 0 }}>
            {t('agent.sidebar.titleState.generating')}
          </span>
        )}

        {topic.titleState === 'generated' && topic.previousTitle && (
          <button
            type="button"
            title={t('agent.sidebar.titleState.undoGenerated')}
            onClick={handleUndoGeneratedTitle}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              border: 0,
              background: 'transparent',
              color: token.colorPrimary,
              cursor: 'pointer',
              fontSize: 11,
              padding: 0,
              flexShrink: 0,
            }}
          >
            <Undo2 size={12} />
            {t('agent.sidebar.titleState.generated')}
          </button>
        )}

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
  defaultAgent,
  searchText,
  onSearchChange,
  onSelect,
  onSetDefault,
  onTogglePin,
  onToggleFavorite,
  onCreate,
  onClone,
  onExport,
  onImportClick,
  onNavigateMarketplace,
  token,
  t,
}: {
  agents: Agent[];
  selectedAgent: string;
  defaultAgent: string;
  searchText: string;
  onSearchChange: (v: string) => void;
  onSelect: (a: Agent) => void;
  onSetDefault: (a: Agent) => void;
  onTogglePin: (a: Agent) => void;
  onToggleFavorite: (a: Agent) => void;
  onCreate: () => void;
  onClone: () => void;
  onExport: () => void;
  onImportClick: () => void;
  onNavigateMarketplace?: () => void;
  token: any;
  t: (key: string, options?: Record<string, any>) => string;
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
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Flexbox
      gap={8}
      style={{
        padding: '8px',
        flexShrink: 0,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Flexbox horizontal align="center" gap={8} style={{ minHeight: 32, padding: '0 4px' }}>
        <button
          type="button"
          title={t(collapsed ? 'agent.sidebar.expandAgents' : 'agent.sidebar.collapseAgents')}
          onClick={() => setCollapsed(!collapsed)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            flex: 1,
            minWidth: 0,
            border: 0,
            background: 'transparent',
            color: token.colorTextSecondary,
            cursor: 'pointer',
            padding: 0,
            font: 'inherit',
            textAlign: 'left',
          }}
        >
          <ChevronRight
            size={13}
            style={{
              color: token.colorTextQuaternary,
              transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
              transition: 'transform 0.15s ease',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t('agent.sidebar.switchAgent')}
          </span>
        </button>
        <ActionIcon
          icon={Upload}
          size="small"
          onClick={onImportClick}
          title={t('agent.sidebar.importAgent')}
        />
        {onNavigateMarketplace && (
          <ActionIcon
            icon={Sparkles}
            size="small"
            onClick={onNavigateMarketplace}
            title={t('agent.sidebar.marketplace')}
          />
        )}
        <ActionIcon
          icon={Download}
          size="small"
          onClick={onExport}
          title={t('agent.sidebar.exportAgent')}
        />
        <ActionIcon
          icon={Copy}
          size="small"
          onClick={onClone}
          title={t('agent.sidebar.cloneAgent')}
        />
        <ActionIcon
          icon={Plus}
          size="small"
          onClick={onCreate}
          title={t('agent.sidebar.createAgent')}
          style={{ background: token.colorPrimary, color: '#fff', borderRadius: 6 }}
        />
      </Flexbox>

      {!collapsed && (
        <>
          <SearchBar
            placeholder={t('agent.sidebar.searchAgents')}
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            allowClear
            size="small"
          />

          <Flexbox
            gap={1}
            style={{
              maxHeight: 236,
              overflow: 'auto',
            }}
          >
            {filtered.length === 0 && (
              <Flexbox
                align="center"
                justify="center"
                style={{
                  color: token.colorTextQuaternary,
                  padding: '16px 8px',
                  fontSize: 13,
                }}
              >
                {searchText ? t('agent.sidebar.noMatchingAgents') : t('agent.sidebar.noAgentsYet')}
              </Flexbox>
            )}

            {pinnedAgents.map((agent) => (
              <AgentPickerItem
                key={agent.id}
                agent={agent}
                isSelected={selectedAgent === agent.name}
                isDefault={defaultAgent === agent.name || agent.isDefault}
                onSelect={() => onSelect(agent)}
                onSetDefault={() => onSetDefault(agent)}
                onTogglePin={() => onTogglePin(agent)}
                onToggleFavorite={() => onToggleFavorite(agent)}
                token={token}
                t={t}
              />
            ))}

            {pinnedAgents.length > 0 && unpinnedAgents.length > 0 && (
              <div style={{ height: 1, background: token.colorBorderSecondary, margin: '4px 8px' }} />
            )}

            {unpinnedAgents.map((agent) => (
              <AgentPickerItem
                key={agent.id}
                agent={agent}
                isSelected={selectedAgent === agent.name}
                isDefault={defaultAgent === agent.name || agent.isDefault}
                onSelect={() => onSelect(agent)}
                onSetDefault={() => onSetDefault(agent)}
                onTogglePin={() => onTogglePin(agent)}
                onToggleFavorite={() => onToggleFavorite(agent)}
                token={token}
                t={t}
              />
            ))}
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
}

function AgentPickerItem({
  agent,
  isSelected,
  isDefault,
  onSelect,
  onSetDefault,
  onTogglePin,
  onToggleFavorite,
  token,
  t,
}: {
  agent: Agent;
  isSelected: boolean;
  isDefault: boolean;
  onSelect: () => void;
  onSetDefault: () => void;
  onTogglePin: () => void;
  onToggleFavorite: () => void;
  token: any;
  t: (key: string, options?: Record<string, any>) => string;
}) {
  const [hovered, setHovered] = useState(false);
  const chatConfig = parseAgentChatConfig(agent);
  const statusBadges = [
    chatConfig.memory?.enabled ? t('agent.sidebar.status.memory') : '',
    (chatConfig.tools?.length ?? 0) > 0 || (chatConfig.skills?.length ?? 0) > 0 || (chatConfig.mcpServers?.length ?? 0) > 0 ? t('agent.sidebar.status.tools') : '',
    chatConfig.workspace?.root ? t('agent.sidebar.status.workspace') : '',
  ].filter(Boolean);

  return (
    <Block
      horizontal
      align="center"
      clickable
      gap={8}
      height={38}
      paddingInline={4}
      variant={isSelected ? 'filled' : 'borderless'}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        minWidth: 0,
        userSelect: 'none',
      }}
    >
      <Center flex="none" height={28} width={28}>
        <AgentIconTile agent={agent} size={22} selected={isSelected} subtle />
      </Center>
      <Text
        color={isSelected ? token.colorText : token.colorTextSecondary}
        ellipsis={{ tooltipWhenOverflow: true }}
        style={{
          flex: 1,
          minWidth: 0,
          fontWeight: isSelected ? 600 : 400,
        }}
      >
        {agent.title || agent.name}
      </Text>
      {statusBadges.length > 0 && (
        <span
          title={t('agent.sidebar.status.summary', { status: statusBadges.join(' · ') })}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            flexShrink: 0,
          }}
        >
          {statusBadges.slice(0, 3).map((badge) => (
            <span
              key={badge}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: token.colorSuccess,
              }}
            />
          ))}
        </span>
      )}
      {isDefault && (
        <span
          title={t('agent.sidebar.defaultAgent')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: token.colorWarning,
            flexShrink: 0,
          }}
        >
          <Sparkles size={12} fill="currentColor" />
        </span>
      )}
      {!isDefault && hovered && (
        <button
          type="button"
          title={t('agent.sidebar.setDefaultAgent')}
          onClick={(event) => {
            event.stopPropagation();
            onSetDefault();
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            border: 0,
            borderRadius: 5,
            background: 'transparent',
            color: token.colorTextQuaternary,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Sparkles size={12} />
        </button>
      )}
      {(agent.favorite || hovered) && (
        <button
          type="button"
          title={t(agent.favorite ? 'agent.sidebar.unfavoriteAgent' : 'agent.sidebar.favoriteAgent')}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            border: 0,
            borderRadius: 5,
            background: 'transparent',
            color: agent.favorite ? token.colorWarning : token.colorTextQuaternary,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Star size={12} fill={agent.favorite ? 'currentColor' : 'none'} />
        </button>
      )}
      {agent.pinned && (
        <button
          type="button"
          title={t('agent.sidebar.unpinAgent')}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            border: 0,
            borderRadius: 5,
            background: 'transparent',
            color: token.colorPrimary,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Pin size={12} fill="currentColor" />
        </button>
      )}
      {!agent.pinned && hovered && (
        <button
          type="button"
          title={t('agent.sidebar.pinAgent')}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            border: 0,
            borderRadius: 5,
            background: 'transparent',
            color: token.colorTextQuaternary,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Pin size={12} />
        </button>
      )}
    </Block>
  );
}
