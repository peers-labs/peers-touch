import { useCallback, useMemo, useState } from 'react';
import { ActionIcon, Dropdown, SearchBar, toast } from '@lobehub/ui';
import type { MenuProps } from '@lobehub/ui';
import { Modal, Skeleton, theme } from 'antd';
import {
  Copy,
  Download,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '../../../services/desktop_api';
import { api } from '../../../services/desktop_api';
import { useActiveAgentSlice } from '../useActiveAgentStores';
import { AgentIconTile } from '../AgentIconTile';
import { PanelToggleDock } from './PanelToggleDock';

interface AgentRailProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenProfile: (agentName: string) => void;
}

export function AgentRail({ collapsed, onToggle, onOpenProfile }: AgentRailProps) {
  const { t } = useTranslation(['agent', 'common']);
  const { token } = theme.useToken();
  const [search, setSearch] = useState('');
  const {
    agents,
    selectedAgent,
    loading,
    error,
    setSelectedAgent,
    setDefaultAgent,
    loadAgents,
  } = useActiveAgentSlice((state) => ({
    agents: state.agents,
    selectedAgent: state.selectedAgent,
    loading: state.loading,
    error: state.error,
    setSelectedAgent: state.setSelectedAgent,
    setDefaultAgent: state.setDefaultAgent,
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

  const selectAgent = useCallback(
    (agent: Agent) => {
      setSelectedAgent(agent.name);
    },
    [setSelectedAgent],
  );

  const mutateAgent = useCallback(
    async (operation: () => Promise<unknown>, successKey: string, agent: Agent) => {
      try {
        await operation();
        await loadAgents();
        toast.success(t(successKey, { name: agent.title || agent.name }));
      } catch (errorValue) {
        const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
        toast.error(message);
      }
    },
    [loadAgents, t],
  );

  const exportAgent = useCallback(
    async (agent: Agent) => {
      try {
        const exported = await api.exportAgentPackage(agent.id);
        const blob = new Blob([JSON.stringify(exported.package, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${agent.name || agent.id}.agent.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        if (exported.unresolvedDependencies.length > 0) {
          toast.warning(t('agent.sidebar.toast.agentExportUnresolved', {
            count: exported.unresolvedDependencies.length,
          }));
        }
        toast.success(t('agent.chat.toast.agentExported'));
      } catch (errorValue) {
        const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
        toast.error(message);
      }
    },
    [t],
  );

  const deleteAgent = useCallback(
    (agent: Agent) => {
      Modal.confirm({
        title: t('agent.chat.deleteConfirm.title'),
        content: t('agent.chat.deleteConfirm.content', {
          name: agent.title || agent.name,
        }),
        okText: t('agent.chat.menu.delete'),
        okButtonProps: { danger: true },
        centered: true,
        onOk: () =>
          mutateAgent(
            () => api.deleteAgent(agent.id),
            'agent.chat.toast.agentDeleted',
            agent,
          ),
      });
    },
    [mutateAgent, t],
  );

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
          icon={Plus}
          title={t('agent.chat.newAgent')}
          onClick={() => onOpenProfile(selectedAgent)}
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
          icon={Plus}
          title={t('agent.chat.newAgent')}
          onClick={() => onOpenProfile(selectedAgent)}
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
          visibleAgents.map((agent) => (
            <AgentRailItem
              key={agent.id}
              agent={agent}
              selected={selectedAgent === agent.name}
              onSelect={() => selectAgent(agent)}
              onEdit={() => onOpenProfile(agent.name)}
              onTogglePin={() =>
                void mutateAgent(
                  () => api.updateAgent(agent.id, { pinned: !agent.pinned }),
                  agent.pinned
                    ? 'agent.chat.toast.agentUnpinned'
                    : 'agent.chat.toast.agentPinned',
                  agent,
                )
              }
              onSetDefault={() =>
                void mutateAgent(
                  () => setDefaultAgent(agent.id),
                  'agent.chat.toast.defaultAgentUpdated',
                  agent,
                )
              }
              onClone={() =>
                void mutateAgent(
                  () => api.duplicateAgent(agent.id, `${agent.name} copy`),
                  'agent.chat.toast.agentCloned',
                  agent,
                )
              }
              onExport={() => void exportAgent(agent)}
              onDelete={() => deleteAgent(agent)}
            />
          ))
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
  onTogglePin: () => void;
  onSetDefault: () => void;
  onClone: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function AgentRailItem({
  agent,
  selected,
  onSelect,
  onEdit,
  onTogglePin,
  onSetDefault,
  onClone,
  onExport,
  onDelete,
}: AgentRailItemProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const menuItems: MenuProps['items'] = [
    {
      key: 'pin',
      icon: <Pin size={14} />,
      label: t(agent.pinned ? 'agent.chat.menu.unpin' : 'agent.chat.menu.pin'),
      onClick: onTogglePin,
    },
    {
      key: 'default',
      icon: <Sparkles size={14} />,
      label: t('agent.chat.menu.setDefault'),
      disabled: agent.isDefault,
      onClick: onSetDefault,
    },
    { type: 'divider' },
    {
      key: 'edit',
      icon: <Pencil size={14} />,
      label: t('agent.chat.menu.edit'),
      onClick: onEdit,
    },
    {
      key: 'clone',
      icon: <Copy size={14} />,
      label: t('agent.chat.menu.clone'),
      onClick: onClone,
    },
    {
      key: 'export',
      icon: <Download size={14} />,
      label: t('agent.chat.menu.export'),
      onClick: onExport,
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <Trash2 size={14} />,
      label: t('agent.chat.menu.delete'),
      danger: true,
      onClick: onDelete,
    },
  ];

  return (
    <div
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
      <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
        <button
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
