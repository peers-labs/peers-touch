/**
 * AgentRoster — the single persistent left rail.
 *
 * The head holds an expandable search slot and a `+` menu; the body always
 * delegates to AgentListBody. The 230/48 geometry, dock and Drawer embedding
 * live here once. The row overflow menu and delete confirm Dialog are
 * agent-only concerns. There is no separate tasks entity — starting work is
 * creating a conversation topic in the topic rail.
 */
import { useState, type ReactNode } from 'react';
import {
  AgentAvatar, Button, Dialog, Flex, Icon, IconButton, Menu, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../prefs';
import { AgentListBody } from './AgentListBody';
import type { AgentRecord } from './types';

interface AgentRosterProps {
  agents: readonly AgentRecord[];
  selectedAgentId: string;
  collapsed: boolean;
  /** Rendered inside a Drawer: the Drawer owns the title and close affordance. */
  embedded?: boolean;
  onToggle: () => void;
  onSelectAgent: (id: string) => void;
  onOpenProfile: (id: string) => void;
  onCreateAgent: () => void;
  onDeleteAgent: (id: string) => void;
}

export function AgentRoster({
  agents, selectedAgentId, collapsed, embedded = false,
  onToggle, onSelectAgent, onOpenProfile, onCreateAgent, onDeleteAgent,
}: AgentRosterProps) {
  const { t } = usePrefsTranslation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AgentRecord | null>(null);

  const closeSearch = () => { setSearchOpen(false); setQuery(''); };

  if (collapsed) {
    return (
      <Flex
        direction="column"
        align="center"
        className="pa-rail pa-rail--collapsed"
        width={48}
        aria-label={t('agent.roster.title')}
        data-pt-agent-rail="collapsed"
      >
        <IconButton
          actionId="agent.roster.create"
          iconId="plus"
          iconSize={16}
          label={t('agent.roster.create.title')}
          emphasis="quiet"
          onActivate={onCreateAgent}
        />
        <ScrollAreaSlot>
          {agents.map(agent => (
            <Button
              key={agent.id}
              actionId={`agent.roster.compact.${agent.id}`}
              emphasis="quiet"
              className="pa-compact-row"
              data-selected={agent.id === selectedAgentId || undefined}
              aria-current={agent.id === selectedAgentId ? 'page' : undefined}
              aria-label={agent.name}
              onActivate={() => onSelectAgent(agent.id)}
            >
              <AgentAvatar name={agent.name} size={28}>
                {agent.avatarMode === 'emoji' ? agent.avatarValue : undefined}
              </AgentAvatar>
            </Button>
          ))}
        </ScrollAreaSlot>
        {!embedded && (
          <IconButton
            actionId="agent.roster.expand-bottom"
            iconId="panel-left-open"
            iconSize={15}
            label={t('agent.common.expand')}
            emphasis="quiet"
            className="pa-rail__toggle"
            onActivate={onToggle}
          />
        )}
      </Flex>
    );
  }

  return (
    <Flex
      direction="column"
      className="pa-rail"
      width={230}
      aria-label={t('agent.roster.title')}
      data-pt-agent-rail="expanded"
    >
      <Flex direction="row" align="center" gap={6} className="pa-rail__head" data-rail-search={searchOpen ? 'active' : 'idle'}>
        {searchOpen ? (
          <>
            <span className="pa-rail__search-field">
              <TextField
                density="compact"
                clearable
                autoFocus
                leading={<Icon iconId="search" size={15} />}
                aria-label={t('agent.roster.search')}
                placeholder={t('agent.roster.search')}
                value={query}
                data-pt-rail-search={query}
                onClear={() => setQuery('')}
                onValueChange={setQuery}
                onKeyDown={event => { if (event.key === 'Escape') closeSearch(); }}
              />
            </span>
            <IconButton
              actionId="agent.roster.search-close"
              iconId="close"
              iconSize={15}
              label={t('agent.common.cancel')}
              emphasis="quiet"
              density="compact"
              onActivate={closeSearch}
            />
          </>
        ) : (
          <>
            <span className="pa-rail__head-title" data-pt-rail-title>
              {t('agent.roster.title')}
            </span>
            <IconButton
              actionId="agent.roster.search"
              iconId="search"
              iconSize={15}
              label={t('agent.roster.search')}
              emphasis="quiet"
              density="compact"
              onActivate={() => setSearchOpen(true)}
            />
            <Menu
              placement="bottom"
              label={t('agent.common.menu')}
              actions={[{
                id: 'agent.roster.menu-new-agent',
                label: t('agent.roster.create.title'),
                iconId: 'plus',
                onActivate: onCreateAgent,
              }]}
            >
              <IconButton
                actionId="agent.roster.create-head"
                iconId="plus"
                iconSize={16}
                label={t('agent.roster.create.title')}
                emphasis="quiet"
                density="compact"
              />
            </Menu>
          </>
        )}
      </Flex>

      <div className="pa-rail__body">
        <AgentListBody
          agents={agents}
          selectedId={selectedAgentId}
          query={query}
          t={t}
          onSelect={onSelectAgent}
          onOpenProfile={onOpenProfile}
          onRequestDelete={setPendingDelete}
        />
      </div>

      {!embedded && (
        <IconButton
          actionId="agent.roster.collapse"
          iconId="panel-left-close"
          iconSize={15}
          label={t('agent.common.collapse')}
          emphasis="quiet"
          className="pa-rail__toggle"
          onActivate={onToggle}
        />
      )}

      <Dialog
        open={pendingDelete !== null}
        title={t('agent.roster.delete.title')}
        description={pendingDelete
          ? t('agent.roster.delete.content', { name: pendingDelete.name })
          : ''}
        onDismiss={() => setPendingDelete(null)}
        closeLabel={t('agent.common.cancel')}
        footer={(
          <Flex direction="row" gap={8} justify="flex-end">
            <Button
              actionId="agent.roster.delete.cancel"
              label={t('agent.common.cancel')}
              emphasis="quiet"
              onActivate={() => setPendingDelete(null)}
            />
            <Button
              actionId="agent.roster.delete.confirm"
              label={t('agent.common.delete')}
              tone="danger"
              emphasis="primary"
              onActivate={() => {
                if (pendingDelete) onDeleteAgent(pendingDelete.id);
                setPendingDelete(null);
              }}
            />
          </Flex>
        )}
      />
    </Flex>
  );
}

/** Collapsed-rail scroller; keeps the compact rows in the same list slot. */
function ScrollAreaSlot({ children }: { children: ReactNode }) {
  return <div className="pa-rail__list pa-rail__list--collapsed">{children}</div>;
}

function usePrefsTranslation() {
  const prefs = usePrefs();
  return { t: makeTranslate(prefs.locale) };
}
