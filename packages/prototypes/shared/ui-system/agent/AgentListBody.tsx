/**
 * AgentListBody — the Agents-mode list rendered inside the shared rail shell.
 *
 * Extracted from AgentRoster so the rail frame (head/search/dock/collapse) is
 * owned once and reused by the Tasks list. The DOM contract is unchanged:
 * pinned section, all section, `.pa-row-wrap` rows with `data-pt-agent-id`,
 * select Button and the sibling overflow Menu (row click never opens a menu).
 */
import { useMemo } from 'react';
import { AgentAvatar, Badge, Button, Empty, Flex, IconButton, Menu, ScrollArea, Tag, Text } from '@peers-touch/ui';
import type { Translate } from '../prefs';
import type { AgentRecord } from './types';

interface AgentListBodyProps {
  agents: readonly AgentRecord[];
  selectedId: string;
  query: string;
  t: Translate;
  onSelect: (id: string) => void;
  onOpenProfile: (id: string) => void;
  onRequestDelete: (agent: AgentRecord) => void;
}

export function AgentListBody({
  agents, selectedId, query, t, onSelect, onOpenProfile, onRequestDelete,
}: AgentListBodyProps) {
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const filtered = q
      ? agents.filter(a => a.name.toLocaleLowerCase().includes(q)
        || a.description.toLocaleLowerCase().includes(q))
      : [...agents];
    return filtered.sort((left, right) =>
      Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
      || left.name.localeCompare(right.name));
  }, [agents, query]);

  const pinned = visible.filter(agent => agent.pinned);
  const others = visible.filter(agent => !agent.pinned);

  if (visible.length === 0) {
    return <Empty description={t('agent.roster.search')} />;
  }

  return (
    <ScrollArea className="pa-rail__list">
      {pinned.length > 0 && (
        <p className="pa-group-label">{t('agent.common.pinned')}</p>
      )}
      {pinned.map(agent => (
        <AgentRow
          key={agent.id}
          agent={agent}
          selected={agent.id === selectedId}
          t={t}
          onSelect={onSelect}
          onOpenProfile={onOpenProfile}
          onRequestDelete={onRequestDelete}
        />
      ))}
      <p className="pa-group-label">{t('agent.common.all')}</p>
      {others.map(agent => (
        <AgentRow
          key={agent.id}
          agent={agent}
          selected={agent.id === selectedId}
          t={t}
          onSelect={onSelect}
          onOpenProfile={onOpenProfile}
          onRequestDelete={onRequestDelete}
        />
      ))}
    </ScrollArea>
  );
}

function AgentRow({
  agent, selected, t, onSelect, onOpenProfile, onRequestDelete,
}: {
  agent: AgentRecord;
  selected: boolean;
  t: Translate;
  onSelect: (id: string) => void;
  onOpenProfile: (id: string) => void;
  onRequestDelete: (agent: AgentRecord) => void;
}) {
  const menuActions = [
    {
      id: `agent.row.profile.${agent.id}`,
      label: t('agent.common.profile'),
      iconId: 'user',
      className: 'pa-row-menu__item',
      onActivate: () => onOpenProfile(agent.id),
    },
    ...(agent.systemOwned
      ? []
      : [{
        id: `agent.row.delete.${agent.id}`,
        label: t('agent.common.delete'),
        iconId: 'delete',
        tone: 'danger' as const,
        className: 'pa-row-menu__item',
        onActivate: () => onRequestDelete(agent),
      }]),
  ];

  return (
    <div
      className="pa-row-wrap"
      data-pt-agent-id={agent.id}
      data-pt-agent-default={agent.systemOwned ? 'true' : undefined}
    >
      <Button
        actionId={`agent.roster.select.${agent.id}`}
        emphasis="quiet"
        fullWidth
        className="pa-row"
        data-selected={selected || undefined}
        aria-current={selected ? 'page' : undefined}
        onActivate={() => onSelect(agent.id)}
      >
        <AgentAvatar name={agent.name} size={34} data-identity="agent">
          {agent.avatarMode === 'emoji' ? agent.avatarValue : undefined}
        </AgentAvatar>
        <span className="pa-row__text">
          <Text strong truncate className="pa-row__title">{agent.name}</Text>
          <Text tone="secondary" truncate className="pa-row__desc">{agent.description}</Text>
        </span>
        {agent.status === 'disabled'
          ? <Tag tone="warning">{t('agent.status.disabled')}</Tag>
          : <Badge indicator tone="success" label={t('agent.status.active')} />}
      </Button>
      <Menu
        actions={menuActions}
        placement="bottom"
        label={t('agent.common.menu')}
        className="pa-row-menu"
      >
        <IconButton
          actionId={`agent.roster.menu.${agent.id}`}
          iconId="more-horizontal"
          iconSize={15}
          label={t('agent.common.menu')}
          emphasis="quiet"
          density="compact"
          className="pa-row__menu"
          data-pt-agent-menu
        />
      </Menu>
    </div>
  );
}
