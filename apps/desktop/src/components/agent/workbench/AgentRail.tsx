import { useCallback, useMemo, useState } from 'react';
import { ActionIcon, Dropdown, SearchBar, toast } from '@lobehub/ui';
import type { MenuProps } from '@lobehub/ui';
import { Modal, Skeleton, theme } from 'antd';
import {
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '../../../services/desktop_api';
import { useActiveAgentSlice } from '../useActiveAgentStores';
import { AgentIconTile } from '../AgentIconTile';
import { PanelToggleDock } from './PanelToggleDock';
import { openAgentCreateFlow } from '../create';
import { openAgentChatSession } from '../../../services/openAgentChatSession';

interface AgentRailProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenProfile: (agentName: string) => void;
  onSelectAgent?: (agent: Agent) => void;
}

export function AgentRail({
  collapsed,
  onToggle,
  onOpenProfile,
  onSelectAgent,
}: AgentRailProps) {
  const { t } = useTranslation(['agent', 'common']);
  const { token } = theme.useToken();
  const [search, setSearch] = useState('');
  const {
    agents,
    selectedAgent,
    loading,
    error,
    deleteAgent,
    loadAgents,
  } = useActiveAgentSlice((state) => ({
    agents: state.agents,
    selectedAgent: state.selectedAgent,
    loading: state.loading,
    error: state.error,
    deleteAgent: state.deleteAgent,
    loadAgents: state.loadAgents,
  }));

  const visibleAgents = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? agents.filter((agent) =>
          [agent.name, agent.title, agent.description].some((value) =>
            value?.toLowerCase().includes(query),
          ),
        )
      : agents;
    return [...filtered].sort(
      (left, right) =>
        Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
        (left.title || left.name).localeCompare(right.title || right.name),
    );
  }, [agents, search]);
  const pinnedAgents = visibleAgents.filter((agent) => agent.pinned);
  const otherAgents = visibleAgents.filter((agent) => !agent.pinned);

  const selectAgent = useCallback(
    (agent: Agent) => {
      void openAgentChatSession(agent, {
        reason: 'agent-roster-selection',
        draftTitle: t('agent.sidebar.newTopic'),
      }).catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
      onSelectAgent?.(agent);
    },
    [onSelectAgent, t],
  );

  const confirmAgentDelete = useCallback(
    (agent: Agent) => {
      Modal.confirm({
        title: t('agent.chat.deleteConfirm.title'),
        content: t('agent.chat.deleteConfirm.content', {
          name: agent.title || agent.name,
        }),
        okText: t('agent.chat.menu.delete'),
        okButtonProps: {
          danger: true,
          'data-pt-agent-delete-confirm': agent.id,
        },
        centered: true,
        onOk: async () => {
          try {
            await deleteAgent(agent.id);
            toast.success(t('agent.chat.toast.agentDeleted', {
              name: agent.title || agent.name,
            }));
          } catch (errorValue) {
            const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
            toast.error(message);
          }
        },
      });
    },
    [deleteAgent, t],
  );

  const createLocalAgent = useCallback(() => {
    openAgentCreateFlow(onOpenProfile);
  }, [onOpenProfile]);

  if (collapsed) {
    return (
      <aside
        data-pt-agent-rail="collapsed"
        style={{
          width: 48,
          minWidth: 48,
          height: '100%',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '12px 0 52px',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgLayout,
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <ActionIcon
          data-pt-agent-create
          icon={Plus}
          title={t('agent.chat.newAgent')}
          onClick={() => void createLocalAgent()}
          size={{ blockSize: 36, size: 16 }}
        />
        <ActionIcon
          icon={Search}
          title={t('common.action.search', { ns: 'common' })}
          onClick={onToggle}
          size={{ blockSize: 36, size: 16 }}
        />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            width: '100%',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            paddingTop: 8,
          }}
        >
          {visibleAgents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              title={agent.title || agent.name}
              aria-label={agent.title || agent.name}
              onClick={() => selectAgent(agent)}
              style={{
                width: 40,
                height: 42,
                border: 0,
                borderRadius: 7,
                background:
                  selectedAgent === agent.name ? token.colorPrimaryBg : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <AgentIconTile
                agent={agent}
                size={28}
                selected={selectedAgent === agent.name}
              />
            </button>
          ))}
        </div>
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
      data-pt-agent-rail="expanded"
      style={{
        width: 230,
        minWidth: 230,
        height: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 10px 52px',
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgLayout,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 700,
            color: token.colorText,
          }}
        >
          {t('agent.chat.myAgents')}
        </span>
        <ActionIcon
          data-pt-agent-create
          icon={Plus}
          title={t('agent.chat.newAgent')}
          onClick={() => void createLocalAgent()}
          size={{ blockSize: 30, size: 15 }}
        />
      </div>
      <SearchBar
        placeholder={t('agent.sidebar.searchAgents')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        allowClear
        size="small"
      />
      {error && agents.length > 0 ? (
        <div
          data-pt-agent-lifecycle-error
          role="alert"
          style={{
            color: token.colorError,
            fontSize: 12,
            padding: '8px 4px 0',
          }}
        >
          {error}
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingTop: 8 }}>
        {loading && agents.length === 0 ? (
          <Skeleton active paragraph={{ rows: 4 }} title={false} />
        ) : error && agents.length === 0 ? (
          <button
            type="button"
            onClick={() => void loadAgents()}
            style={{
              width: '100%',
              border: 0,
              background: 'transparent',
              color: token.colorError,
              cursor: 'pointer',
              padding: 12,
              textAlign: 'left',
            }}
          >
            {error}
          </button>
        ) : (
          <>
            {pinnedAgents.length > 0 && (
              <div style={{ padding: '8px 8px 4px', color: token.colorTextTertiary, fontSize: 11, fontWeight: 700 }}>
                {t('agent.chat.pinned')}
              </div>
            )}
            {pinnedAgents.map((agent) => (
              <AgentRailItem
                key={agent.id}
                agent={agent}
                selected={selectedAgent === agent.name}
                onSelect={() => selectAgent(agent)}
                onEdit={() => onOpenProfile(agent.name)}
                onDelete={agent.name === 'assistant' ? undefined : () => confirmAgentDelete(agent)}
              />
            ))}
            <div style={{ padding: '8px 8px 4px', color: token.colorTextTertiary, fontSize: 11, fontWeight: 700 }}>
              {t('agent.chat.allAgents')}
            </div>
            {otherAgents.map((agent) => (
              <AgentRailItem
                key={agent.id}
                agent={agent}
                selected={selectedAgent === agent.name}
                onSelect={() => selectAgent(agent)}
                onEdit={() => onOpenProfile(agent.name)}
                onDelete={agent.name === 'assistant' ? undefined : () => confirmAgentDelete(agent)}
              />
            ))}
          </>
        )}
      </div>
      <PanelToggleDock
        open
        title={t('agent.chat.collapsePanel')}
        onClick={onToggle}
      />
    </aside>
  );
}

interface AgentRailItemProps {
  agent: Agent;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}

function AgentRailItem({
  agent,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: AgentRailItemProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const menuItems: MenuProps['items'] = [
    {
      key: 'edit',
      icon: <Pencil size={14} />,
      label: (
        <span data-pt-agent-id={agent.id} data-pt-agent-menu-action="edit">
          {t('agent.profile.title')}
        </span>
      ),
      onClick: onEdit,
    },
    ...(onDelete ? [{
      key: 'delete',
      icon: <Trash2 size={14} />,
      label: (
        <span data-pt-agent-id={agent.id} data-pt-agent-menu-action="delete">
          {t('agent.chat.menu.delete')}
        </span>
      ),
      danger: true,
      onClick: onDelete,
    }] : []),
  ];

  return (
    <div
      data-pt-agent-default={agent.isDefault ? 'true' : 'false'}
      data-pt-agent-id={agent.id}
      data-pt-agent-name={agent.name}
      data-pt-agent-row
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      style={{
        height: 46,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 8px',
        borderRadius: 7,
        background: selected ? token.colorPrimaryBg : 'transparent',
        cursor: 'pointer',
      }}
    >
      <AgentIconTile agent={agent} size={28} selected={selected} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 12,
            fontWeight: 650,
            color: token.colorText,
          }}
        >
          {agent.title || agent.name}
        </span>
        <span
          style={{
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 11,
            color: token.colorTextTertiary,
          }}
        >
          {agent.description}
        </span>
      </span>
      <Dropdown
        menu={{
          items: menuItems,
          onClick: ({ domEvent }) => domEvent.stopPropagation(),
        }}
        trigger={['click']}
        placement="bottomRight"
      >
        <button
          data-pt-agent-id={agent.id}
          data-pt-agent-menu
          type="button"
          aria-label={t('agent.chat.menu.edit')}
          onClick={(event) => event.stopPropagation()}
          style={{
            width: 24,
            height: 24,
            border: 0,
            borderRadius: 6,
            background: 'transparent',
            color: token.colorTextTertiary,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </Dropdown>
    </div>
  );
}
