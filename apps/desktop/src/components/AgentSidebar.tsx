import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ActionIcon, Dropdown, Input, SearchBar, toast } from '@lobehub/ui';
import type { MenuProps } from '@lobehub/ui';
import { Modal, theme } from 'antd';
import type { GlobalToken, InputRef } from 'antd';
import {
  CheckSquare2,
  ChevronRight,
  Hash,
  ListChecks,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  Search,
  Square,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { resolveI18nValue } from '../i18n';
import type { AgentTopic } from '../store/agentTopics';
import { useChatStore } from '../store/chat';
import {
  useActiveAgentSlice,
  useActiveAgentTopicSlice,
  useActiveChatSlice,
} from './agent/useActiveAgentStores';
import { openAgentChatSession } from '../services/openAgentChatSession';

interface AgentSidebarProps {
  onNavigateProfile: (agentName: string) => void;
  onNavigateChat?: () => void;
}

interface TopicDateGroup {
  key: string;
  label: string;
  items: AgentTopic[];
}

const TOPIC_ACTION_SLOT_STYLE: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  width: 'auto',
};

function groupTopicsByDate(
  topics: AgentTopic[],
  t: (key: string) => string,
): TopicDateGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const groups = new Map<string, AgentTopic[]>();

  const add = (key: string, topic: AgentTopic) => {
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, topic]);
  };

  [...topics]
    .sort(
      (left, right) =>
        new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
    )
    .forEach((topic) => {
      const updatedAt = new Date(topic.updated_at);
      if (updatedAt >= today) add('today', topic);
      else if (updatedAt >= yesterday) add('yesterday', topic);
      else if (updatedAt >= weekAgo) add('week', topic);
      else if (updatedAt >= monthStart) add('month', topic);
      else {
        add(
          `${updatedAt.getFullYear()}-${String(updatedAt.getMonth() + 1).padStart(2, '0')}`,
          topic,
        );
      }
    });

  const labels: Record<string, string> = {
    today: t('agent.sidebar.dateGroup.today'),
    yesterday: t('agent.sidebar.dateGroup.yesterday'),
    week: t('agent.sidebar.dateGroup.thisWeek'),
    month: t('agent.sidebar.dateGroup.thisMonth'),
  };
  return [...groups.entries()].map(([key, items]) => ({
    key,
    items,
    label: labels[key] || new Date(`${key}-01`).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    }),
  }));
}

export function AgentSidebar({
  onNavigateProfile,
  onNavigateChat,
}: AgentSidebarProps) {
  const { t } = useTranslation(['agent', 'common']);
  const { token } = theme.useToken();
  const { currentAgent } = useActiveAgentSlice((state) => ({
    currentAgent: state.agents.find(
      (agent) => agent.name === state.selectedAgent,
    ),
  }));
  const {
    currentSessionKey,
    sessions,
    selectSession,
  } = useActiveChatSlice((state) => ({
    currentSessionKey: state.currentSessionKey,
    sessions: state.sessions,
    selectSession: state.selectSession,
  }));
  const {
    activeAgentId,
    topicsByAgentId,
    loadingAgentIds,
    loadErrorsByAgentId,
    loadTopicsForAgent,
    createDraftTopic,
    deleteTopics: deleteTopicBatch,
    renameTopic,
    pinTopic,
  } = useActiveAgentTopicSlice((state) => ({
    activeAgentId: state.activeAgentId,
    topicsByAgentId: state.topicsByAgentId,
    loadingAgentIds: state.loadingAgentIds,
    loadErrorsByAgentId: state.loadErrorsByAgentId,
    loadTopicsForAgent: state.loadTopicsForAgent,
    createDraftTopic: state.createDraftTopic,
    deleteTopics: state.deleteTopics,
    renameTopic: state.renameTopic,
    pinTopic: state.pinTopic,
  }));
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<string>>(
    new Set(),
  );
  const [interactionAgentId, setInteractionAgentId] = useState<string>();

  if (interactionAgentId !== currentAgent?.id) {
    setInteractionAgentId(currentAgent?.id);
    setSearchOpen(false);
    setQuery('');
    setSelectionMode(false);
    setSelectedTopicIds(new Set());
  }

  const topics = useMemo(
    () => (currentAgent ? topicsByAgentId[currentAgent.id] ?? [] : []),
    [currentAgent, topicsByAgentId],
  );
  const filteredTopics = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return topics;
    return topics.filter((topic) => (
      resolveI18nValue(topic.title).toLowerCase().includes(normalized)
    ));
  }, [query, topics]);
  const pinnedTopics = filteredTopics.filter(
    (topic) => topic.pinned || topic.favorite,
  );
  const datedGroups = useMemo(
    () => groupTopicsByDate(
      filteredTopics.filter((topic) => !topic.pinned && !topic.favorite),
      t,
    ),
    [filteredTopics, t],
  );
  const loading = currentAgent
    ? Boolean(loadingAgentIds[currentAgent.id])
    : false;
  const loadError = currentAgent
    ? loadErrorsByAgentId[currentAgent.id]
    : undefined;

  const reloadTopics = useCallback(() => {
    if (!currentAgent) return;
    void loadTopicsForAgent(currentAgent.id, 'topic-rail').catch(() => undefined);
  }, [currentAgent, loadTopicsForAgent]);

  const startTopic = useCallback(() => {
    const agentName = currentAgent?.name || 'assistant';
    const topic = createDraftTopic(
      currentAgent?.id || activeAgentId || agentName,
      agentName,
      t('agent.sidebar.newTopic'),
    );
    void selectSession(topic.key, topic);
    onNavigateChat?.();
  }, [
    activeAgentId,
    createDraftTopic,
    currentAgent,
    onNavigateChat,
    selectSession,
    t,
  ]);

  const selectTopic = useCallback((topic: AgentTopic) => {
    const projected = sessions.find((session) => session.key === topic.key) ?? topic;
    void selectSession(topic.key, projected);
    onNavigateChat?.();
  }, [onNavigateChat, selectSession, sessions]);

  const deleteTopics = useCallback(async (topicIds: Set<string>) => {
    if (topicIds.size === 0) return;
    const remaining = topics.filter((topic) => !topicIds.has(topic.key));
    const currentDeleted = topicIds.has(currentSessionKey);
    await deleteTopicBatch([...topicIds]);
    await useChatStore.getState().purgeSessions([...topicIds]);
    if (currentDeleted) {
      if (remaining[0]) {
        await selectSession(remaining[0].key, remaining[0]);
      } else if (currentAgent) {
        const draft = createDraftTopic(
          currentAgent.id,
          currentAgent.name,
          t('agent.sidebar.newTopic'),
        );
        await selectSession(draft.key, draft);
      }
    }
    setSelectedTopicIds(new Set());
    setSelectionMode(false);
    reloadTopics();
  }, [
    createDraftTopic,
    currentAgent,
    currentSessionKey,
    deleteTopicBatch,
    reloadTopics,
    selectSession,
    t,
    topics,
  ]);

  const confirmBatchDelete = () => {
    if (selectedTopicIds.size === 0) return;
    Modal.confirm({
      centered: true,
      title: t('agent.sidebar.batchDelete.title', {
        count: selectedTopicIds.size,
      }),
      content: t('agent.sidebar.batchDelete.content'),
      okText: t('agent.sidebar.menu.delete'),
      okButtonProps: { danger: true },
      onOk: () => deleteTopics(selectedTopicIds),
    });
  };

  const toggleSelected = (topicId: string) => {
    setSelectedTopicIds((previous) => {
      const next = new Set(previous);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  };

  return (
    <Flexbox
      data-pt-agent-topic-list
      height="100%"
      style={{ background: token.colorBgContainer }}
    >
      <div
        style={{
          height: 44,
          padding: '0 14px',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: token.colorText,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {currentAgent?.title || currentAgent?.name || t('agent.sidebar.noAgentsYet')}
        </span>
      </div>

      <Flexbox
        horizontal
        align="center"
        gap={4}
        style={{ height: 42, padding: '2px 14px 6px', flexShrink: 0 }}
      >
        {searchOpen ? (
          <>
            <SearchBar
              autoFocus
              allowClear
              size="small"
              value={query}
              placeholder={t('agent.sidebar.searchTopics')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                setQuery('');
                setSearchOpen(false);
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
            <ActionIcon
              icon={X}
              size={{ blockSize: 30, size: 14 }}
              title={t('common.action.cancel', { ns: 'common' })}
              onClick={() => {
                setQuery('');
                setSearchOpen(false);
              }}
            />
          </>
        ) : (
          <>
            <ActionIcon
              data-pt-agent-session-start
              icon={MessageSquarePlus}
              size={{ blockSize: 34, size: 15 }}
              title={t('agent.sidebar.startNewTopic')}
              onClick={startTopic}
              style={TOPIC_ACTION_SLOT_STYLE}
            />
            <ActionIcon
              data-pt-agent-topic-profile
              icon={User}
              size={{ blockSize: 34, size: 15 }}
              title={t('agent.sidebar.agentProfile')}
              onClick={() => currentAgent && onNavigateProfile(currentAgent.name)}
              style={TOPIC_ACTION_SLOT_STYLE}
            />
            <ActionIcon
              data-pt-agent-topic-search
              icon={Search}
              size={{ blockSize: 34, size: 15 }}
              title={t('agent.sidebar.search')}
              onClick={() => setSearchOpen(true)}
              style={TOPIC_ACTION_SLOT_STYLE}
            />
          </>
        )}
      </Flexbox>

      <Flexbox
        horizontal
        align="center"
        gap={4}
        style={{
          height: 34,
          padding: '0 8px 0 14px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: token.colorTextSecondary,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {t('agent.sidebar.topicsCount', { count: topics.length })}
        </span>
        {loading ? (
          <span style={{ marginLeft: 'auto', color: token.colorTextTertiary, fontSize: 11 }}>
            {t('agent.sidebar.topicSyncing')}
          </span>
        ) : (
          <Flexbox horizontal gap={2} style={{ marginLeft: 'auto' }}>
            {selectionMode ? (
              <>
                <span
                  style={{
                    minWidth: 18,
                    color: token.colorTextTertiary,
                    fontSize: 11,
                    textAlign: 'center',
                  }}
                >
                  {selectedTopicIds.size}
                </span>
                <ActionIcon
                  data-pt-agent-topic-batch-delete
                  icon={Trash2}
                  size={{ blockSize: 28, size: 14 }}
                  disabled={selectedTopicIds.size === 0}
                  title={t('agent.sidebar.batchDelete.deleteSelected')}
                  onClick={confirmBatchDelete}
                />
                <ActionIcon
                  icon={X}
                  size={{ blockSize: 28, size: 14 }}
                  title={t('common.action.cancel', { ns: 'common' })}
                  onClick={() => {
                    setSelectionMode(false);
                    setSelectedTopicIds(new Set());
                  }}
                />
              </>
            ) : (
              <ActionIcon
                data-pt-agent-topic-batch-select
                icon={ListChecks}
                size={{ blockSize: 28, size: 14 }}
                title={t('agent.sidebar.batchDelete.select')}
                onClick={() => setSelectionMode(true)}
              />
            )}
          </Flexbox>
        )}
      </Flexbox>

      <Flexbox flex={1} gap={4} style={{ minHeight: 0, overflowY: 'auto', padding: '8px' }}>
        {loadError ? (
          <button
            type="button"
            data-pt-agent-topic-load-error={currentAgent?.id}
            data-pt-agent-topic-load-retry
            onClick={() => {
              if (!currentAgent) return;
              void openAgentChatSession(currentAgent, {
                forceReload: true,
                draftTitle: t('agent.sidebar.newTopic'),
                reason: 'topic-rail-retry',
              }).catch(() => undefined);
            }}
            style={{
              width: '100%',
              padding: 10,
              border: 0,
              borderRadius: 7,
              background: token.colorErrorBg,
              color: token.colorErrorText,
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 12,
            }}
          >
            {t('agent.sidebar.topicLoadFailed')}
          </button>
        ) : null}
        {filteredTopics.length === 0 ? (
          <div style={{ padding: '10px 8px', color: token.colorTextTertiary, fontSize: 12 }}>
            {query
              ? t('agent.sidebar.noMatchingTopics')
              : t('agent.sidebar.noTopics')}
          </div>
        ) : (
          <>
            {pinnedTopics.length > 0 ? (
              <TopicGroup
                label={t('agent.sidebar.pinnedSection')}
                topics={pinnedTopics}
                currentSessionKey={currentSessionKey}
                selectionMode={selectionMode}
                selectedTopicIds={selectedTopicIds}
                onSelect={selectTopic}
                onToggleSelected={toggleSelected}
                onDelete={(topic) => deleteTopics(new Set([topic.key]))}
                onPin={pinTopic}
                onRename={renameTopic}
                onReload={reloadTopics}
                token={token}
                t={t}
              />
            ) : null}
            {datedGroups.map((group) => (
              <TopicGroup
                key={group.key}
                label={group.label}
                topics={group.items}
                currentSessionKey={currentSessionKey}
                selectionMode={selectionMode}
                selectedTopicIds={selectedTopicIds}
                onSelect={selectTopic}
                onToggleSelected={toggleSelected}
                onDelete={(topic) => deleteTopics(new Set([topic.key]))}
                onPin={pinTopic}
                onRename={renameTopic}
                onReload={reloadTopics}
                token={token}
                t={t}
              />
            ))}
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
}

function TopicGroup({
  label,
  topics,
  currentSessionKey,
  selectionMode,
  selectedTopicIds,
  onSelect,
  onToggleSelected,
  onDelete,
  onPin,
  onRename,
  onReload,
  token,
  t,
}: {
  label: string;
  topics: AgentTopic[];
  currentSessionKey: string;
  selectionMode: boolean;
  selectedTopicIds: Set<string>;
  onSelect: (topic: AgentTopic) => void;
  onToggleSelected: (topicId: string) => void;
  onDelete: (topic: AgentTopic) => Promise<void>;
  onPin: (topicId: string, pinned: boolean) => Promise<void>;
  onRename: (topicId: string, title: string) => Promise<void>;
  onReload: () => void;
  token: GlobalToken;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section>
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        style={{
          width: '100%',
          height: 28,
          padding: '0 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          border: 0,
          background: 'transparent',
          color: token.colorTextSecondary,
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
          textAlign: 'left',
        }}
      >
        <ChevronRight
          size={12}
          style={{
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 0.15s ease',
          }}
        />
        {label}
      </button>
      {!collapsed ? (
        <Flexbox gap={1}>
          {topics.map((topic) => (
            <TopicItem
              key={topic.key}
              active={topic.key === currentSessionKey}
              selected={selectedTopicIds.has(topic.key)}
              selectionMode={selectionMode}
              topic={topic}
              onSelect={() => onSelect(topic)}
              onToggleSelected={() => onToggleSelected(topic.key)}
              onDelete={() => onDelete(topic)}
              onPin={onPin}
              onRename={onRename}
              onReload={onReload}
              token={token}
              t={t}
            />
          ))}
        </Flexbox>
      ) : null}
    </section>
  );
}

function TopicItem({
  topic,
  active,
  selected,
  selectionMode,
  onSelect,
  onToggleSelected,
  onDelete,
  onPin,
  onRename,
  onReload,
  token,
  t,
}: {
  topic: AgentTopic;
  active: boolean;
  selected: boolean;
  selectionMode: boolean;
  onSelect: () => void;
  onToggleSelected: () => void;
  onDelete: () => Promise<void>;
  onPin: (topicId: string, pinned: boolean) => Promise<void>;
  onRename: (topicId: string, title: string) => Promise<void>;
  onReload: () => void;
  token: GlobalToken;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<InputRef>(null);

  const startRename = () => {
    setRenameValue(resolveI18nValue(topic.title));
    setRenaming(true);
    requestAnimationFrame(() => renameRef.current?.focus({ cursor: 'end' }));
  };
  const saveRename = async () => {
    const value = renameValue.trim();
    setRenaming(false);
    if (!value || value === resolveI18nValue(topic.title)) return;
    try {
      await onRename(topic.key, value);
      onReload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('agent.sidebar.toast.renameFailed'),
      );
    }
  };
  const togglePin = async () => {
    try {
      await onPin(topic.key, !topic.pinned);
      onReload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('agent.sidebar.toast.renameFailed'),
      );
    }
  };
  const confirmDelete = () => {
    Modal.confirm({
      centered: true,
      title: t('agent.sidebar.deleteConfirm.title'),
      content: t('agent.sidebar.deleteConfirm.content'),
      okText: t('agent.sidebar.menu.delete'),
      okButtonProps: { danger: true },
      onOk: onDelete,
    });
  };
  const menuItems: MenuProps['items'] = [
    {
      key: 'pin',
      icon: <Pin size={14} />,
      label: topic.pinned
        ? t('agent.sidebar.menu.unpin')
        : t('agent.sidebar.menu.pin'),
      onClick: togglePin,
    },
    {
      key: 'rename',
      icon: <Pencil size={14} />,
      label: t('agent.sidebar.menu.rename'),
      onClick: startRename,
    },
    { type: 'divider' },
    {
      key: 'delete',
      danger: true,
      icon: <Trash2 size={14} />,
      label: t('agent.sidebar.menu.delete'),
      onClick: confirmDelete,
    },
  ];

  const rowContent = (
    <Flexbox
      data-pt-agent-topic-row={topic.key}
      horizontal
      align="center"
      gap={8}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (renaming) return;
        if (selectionMode) onToggleSelected();
        else onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (selectionMode) onToggleSelected();
        else onSelect();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        minHeight: 36,
        padding: '4px 8px',
        borderRadius: 7,
        background: active ? token.colorFillSecondary : hovered
          ? token.colorFillTertiary
          : 'transparent',
        cursor: 'pointer',
      }}
    >
      {selectionMode ? (
        selected
          ? <CheckSquare2 size={14} color={token.colorPrimary} />
          : <Square size={14} color={token.colorTextTertiary} />
      ) : (
        <Hash size={14} color={active ? token.colorText : token.colorTextDescription} />
      )}
      {renaming ? (
        <Input
          ref={renameRef}
          size="small"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void saveRename()}
          onBlur={() => void saveRename()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') setRenaming(false);
          }}
          onClick={(event) => event.stopPropagation()}
          style={{ flex: 1, minWidth: 0 }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: active ? token.colorText : token.colorTextSecondary,
            fontSize: 13,
            fontWeight: active ? 500 : 400,
          }}
        >
          {resolveI18nValue(topic.title) || t('agent.sidebar.newTopic')}
        </span>
      )}
      {!selectionMode && !renaming && (hovered || active) ? (
        <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
          <span
            aria-label={t('agent.sidebar.topicActions')}
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 24,
              height: 24,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              color: token.colorTextTertiary,
            }}
          >
            <MoreHorizontal size={14} />
          </span>
        </Dropdown>
      ) : null}
    </Flexbox>
  );

  return selectionMode
    ? rowContent
    : (
        <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
          {rowContent}
        </Dropdown>
      );
}
