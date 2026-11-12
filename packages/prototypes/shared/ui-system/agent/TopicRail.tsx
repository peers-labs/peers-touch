/**
 * TopicRail — the sibling Topic rail between the Agent roster and the
 * dominant conversation rail.
 *
 * Behavior parity with the production AgentSidebar/TopicRail:
 *  - one selected-Agent name projection (no avatar, no description);
 *  - three equal action slots (new topic / Agent Profile / search); search
 *    replaces the slots in place, Esc/Cancel restores them without shifting
 *    the list;
 *  - a Topics <count> label owns batch selection and destructive delete;
 *  - pinned topics precede quiet date groups (today / yesterday / this week
 *    / this month / older month);
 *  - each row exposes pin / rename / delete through an overflow Menu and
 *    context menu; rename is an inline TextField with Enter/Esc semantics;
 *  - 48px collapsed form keeps new-topic and a count-bearing topics entry;
 *  - fullWidth renders inside the ultra-narrow Drawer without its own dock.
 */
import { useMemo, useState } from 'react';
import {
  Button, Checkbox, Dialog, Empty, Flex, Icon, IconButton, Menu, ScrollArea,
  Text, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs, type Translate } from '../prefs';
import type { AgentRecord, TopicRecord } from './types';

interface TopicRailProps {
  agent: AgentRecord;
  topics: readonly TopicRecord[];
  selectedTopicId: string | null;
  collapsed: boolean;
  fullWidth?: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onNewTopic: () => void;
  onOpenProfile: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (ids: readonly string[]) => void;
}

interface DateGroup {
  key: string;
  label: string;
  items: TopicRecord[];
}

const DAY_MS = 86_400_000;

function groupByDate(topics: readonly TopicRecord[], t: Translate): DateGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - DAY_MS);
  const weekAgo = new Date(today.getTime() - 7 * DAY_MS);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const buckets = new Map<string, TopicRecord[]>();

  const put = (key: string, topic: TopicRecord) => {
    buckets.set(key, [...(buckets.get(key) ?? []), topic]);
  };

  [...topics]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .forEach((topic) => {
      const date = new Date(topic.updatedAt);
      if (date >= today) put('today', topic);
      else if (date >= yesterday) put('yesterday', topic);
      else if (date >= weekAgo) put('week', topic);
      else if (date >= monthStart) put('month', topic);
      else put(`${date.getFullYear()}-${date.getMonth()}`, topic);
    });

  const labels: Record<string, string> = {
    today: t('agent.date.today'),
    yesterday: t('agent.date.yesterday'),
    week: t('agent.date.week'),
    month: t('agent.date.month'),
  };

  return [...buckets.entries()].map(([key, items]) => ({
    key,
    label: labels[key] ?? key,
    items,
  }));
}

export function TopicRail({
  agent, topics, selectedTopicId, collapsed, fullWidth = false, onToggle,
  onSelect, onNewTopic, onOpenProfile, onRename, onPin, onDelete,
}: TopicRailProps) {
  const { t } = usePrefsTranslation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingDelete, setPendingDelete] = useState<readonly string[] | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? topics.filter(item => item.title.toLocaleLowerCase().includes(q)) : topics;
  }, [topics, query]);

  const pinned = filtered.filter(item => item.pinned);
  const groups = useMemo(
    () => groupByDate(filtered.filter(item => !item.pinned), t),
    [filtered, t],
  );

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds([]);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(previous =>
      previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  };

  const startRename = (topic: TopicRecord) => {
    setRenamingId(topic.id);
    setRenameValue(topic.title);
  };

  const commitRename = () => {
    const value = renameValue.trim();
    if (renamingId && value) onRename(renamingId, value);
    setRenamingId(null);
  };

  const confirmDelete = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    setPendingDelete(ids);
  };

  if (collapsed) {
    return (
      <Flex
        direction="column"
        align="center"
        className="pa-rail pa-rail--collapsed"
        width={48}
        aria-label={t('agent.topic.title')}
        data-pt-topic-rail="collapsed"
      >
        <IconButton
          actionId="agent.topic.create"
          iconId="message-square-plus"
          iconSize={16}
          label={t('agent.topic.new')}
          emphasis="quiet"
          onActivate={onNewTopic}
        />
        <IconButton
          actionId="agent.topic.expand"
          iconId="hash"
          iconSize={16}
          label={t('agent.topic.count', { count: agent.topicCount })}
          emphasis="quiet"
          onActivate={onToggle}
        />
        <Text tone="muted" className="pa-compact-count">{agent.topicCount}</Text>
        {!fullWidth && (
          <IconButton
            actionId="agent.topic.expand-bottom"
            iconId="panel-left-open"
            iconSize={15}
            label={t('agent.common.expand')}
            emphasis="quiet"
            className="pa-rail__dock"
            onActivate={onToggle}
          />
        )}
      </Flex>
    );
  }

  return (
    <Flex
      direction="column"
      className="pa-rail pa-topics"
      width={fullWidth ? undefined : 238}
      style={fullWidth ? { flex: 1, width: '100%' } : undefined}
      aria-label={t('agent.topic.title')}
      data-pt-topic-rail="expanded"
    >
      <Flex direction="row" align="center" className="pa-topics__name">
        <Text strong truncate>{agent.name}</Text>
      </Flex>

      <Flex direction="row" align="center" gap={4} className="pa-topics__slots">
        {searchOpen ? (
          <TextField
            value={query}
            aria-label={t('agent.topic.search')}
            placeholder={t('agent.topic.search')}
            autoFocus
            clearable
            onClear={() => setQuery('')}
            onValueChange={setQuery}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('');
                setSearchOpen(false);
              }
            }}
            trailing={(
              <IconButton
                actionId="agent.topic.search-cancel"
                iconId="close"
                iconSize={14}
                label={t('agent.common.cancel')}
                emphasis="quiet"
                density="compact"
                onActivate={() => {
                  setQuery('');
                  setSearchOpen(false);
                }}
              />
            )}
          />
        ) : (
          <>
            <IconButton
              actionId="agent.topic.slot-new"
              iconId="message-square-plus"
              iconSize={15}
              label={t('agent.topic.new')}
              emphasis="quiet"
              className="pa-slot"
              onActivate={onNewTopic}
            />
            <IconButton
              actionId="agent.topic.slot-profile"
              iconId="user"
              iconSize={15}
              label={t('agent.common.profile')}
              emphasis="quiet"
              className="pa-slot"
              onActivate={() => onOpenProfile(agent.id)}
            />
            <IconButton
              actionId="agent.topic.slot-search"
              iconId="search"
              iconSize={15}
              label={t('agent.topic.search')}
              emphasis="quiet"
              className="pa-slot"
              onActivate={() => setSearchOpen(true)}
            />
          </>
        )}
      </Flex>

      <Flex direction="row" align="center" className="pa-topics__count-bar">
        <Text tone="secondary" className="pa-topics__count">
          {t('agent.topic.count', { count: topics.length })}
        </Text>
        <span className="pa-topics__count-actions">
          {selectionMode ? (
            <>
              <Text tone="muted" className="pa-topics__selected-count">
                {selectedIds.length}
              </Text>
              <IconButton
                actionId="agent.topic.batch-delete"
                iconId="delete"
                iconSize={14}
                label={t('agent.topic.batch.deleteSelected')}
                emphasis="quiet"
                density="compact"
                availability={selectedIds.length === 0
                  ? { kind: 'disabled', reason: t('agent.topic.batch.empty') }
                  : undefined}
                onActivate={() => confirmDelete(selectedIds)}
              />
              <IconButton
                actionId="agent.topic.batch-cancel"
                iconId="close"
                iconSize={14}
                label={t('agent.common.cancel')}
                emphasis="quiet"
                density="compact"
                onActivate={exitSelection}
              />
            </>
          ) : (
            <IconButton
              actionId="agent.topic.batch-select"
              iconId="list-checks"
              iconSize={14}
              label={t('agent.topic.batch.select')}
              emphasis="quiet"
              density="compact"
              onActivate={() => setSelectionMode(true)}
            />
          )}
        </span>
      </Flex>

      <ScrollArea className="pa-rail__list">
        {filtered.length === 0
          ? <Empty description={t('agent.topic.empty')} />
          : (
            <>
              {pinned.length > 0 && (
                <TopicGroup label={t('agent.common.pinned')} topics={pinned}
                  collapsed={false} onToggleGroup={() => undefined}
                  t={t} selectionMode={selectionMode} selectedIds={selectedIds}
                  selectedTopicId={selectedTopicId} renamingId={renamingId}
                  renameValue={renameValue}
                  onSelect={onSelect} onToggleSelected={toggleSelected}
                  onStartRename={startRename} setRenameValue={setRenameValue}
                  onCommitRename={commitRename} onPin={onPin}
                  onRequestDelete={confirmDelete} />
              )}
              {groups.map(group => (
                <TopicGroup key={group.key} label={group.label} topics={group.items}
                  collapsed={collapsedGroups.has(group.key)}
                  onToggleGroup={() => setCollapsedGroups(previous => {
                    const next = new Set(previous);
                    if (next.has(group.key)) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  })}
                  t={t} selectionMode={selectionMode} selectedIds={selectedIds}
                  selectedTopicId={selectedTopicId} renamingId={renamingId}
                  renameValue={renameValue}
                  onSelect={onSelect} onToggleSelected={toggleSelected}
                  onStartRename={startRename} setRenameValue={setRenameValue}
                  onCommitRename={commitRename} onPin={onPin}
                  onRequestDelete={confirmDelete} />
              ))}
            </>
          )}
      </ScrollArea>

      {!fullWidth && (
        <IconButton
          actionId="agent.topic.collapse"
          iconId="panel-left-close"
          iconSize={15}
          label={t('agent.common.collapse')}
          emphasis="quiet"
          className="pa-rail__dock"
          onActivate={onToggle}
        />
      )}

      <Dialog
        open={pendingDelete !== null}
        title={t('agent.topic.delete.title', { count: pendingDelete?.length ?? 0 })}
        description={t('agent.topic.delete.content')}
        onDismiss={() => setPendingDelete(null)}
        closeLabel={t('agent.common.cancel')}
        footer={(
          <Flex direction="row" gap={8} justify="flex-end">
            <Button
              actionId="agent.topic.delete.cancel"
              label={t('agent.common.cancel')}
              emphasis="quiet"
              onActivate={() => setPendingDelete(null)}
            />
            <Button
              actionId="agent.topic.delete.confirm"
              label={t('agent.common.delete')}
              tone="danger"
              emphasis="primary"
              onActivate={() => {
                if (pendingDelete) {
                  onDelete(pendingDelete);
                  exitSelection();
                }
                setPendingDelete(null);
              }}
            />
          </Flex>
        )}
      />
    </Flex>
  );
}

function TopicGroup({
  label, topics, collapsed, onToggleGroup, t, selectionMode, selectedIds,
  selectedTopicId, renamingId, renameValue, onSelect, onToggleSelected,
  onStartRename, setRenameValue, onCommitRename, onPin, onRequestDelete,
}: {
  label: string;
  topics: readonly TopicRecord[];
  collapsed: boolean;
  onToggleGroup: () => void;
  t: Translate;
  selectionMode: boolean;
  selectedIds: readonly string[];
  selectedTopicId: string | null;
  renamingId: string | null;
  renameValue: string;
  onSelect: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onStartRename: (topic: TopicRecord) => void;
  setRenameValue: (value: string) => void;
  onCommitRename: () => void;
  onPin: (id: string, pinned: boolean) => void;
  onRequestDelete: (ids: readonly string[]) => void;
}) {
  return (
    <section className="pa-date-group">
      <Button
        actionId={`agent.topic.group.${label}`}
        emphasis="quiet"
        fullWidth
        className="pa-date-group__head"
        aria-expanded={!collapsed}
        onActivate={onToggleGroup}
      >
        <Icon
          iconId="chevron-right"
          size={12}
          className="pa-date-group__chevron"
          data-collapsed={collapsed || undefined}
        />
        <Text tone="secondary" className="pa-date-group__label">{label}</Text>
      </Button>
      {!collapsed && topics.map(topic => (
        <TopicRow
          key={topic.id}
          topic={topic}
          t={t}
          active={topic.id === selectedTopicId}
          selectionMode={selectionMode}
          selected={selectedIds.includes(topic.id)}
          renaming={renamingId === topic.id}
          renameValue={renameValue}
          onSelect={() => (selectionMode ? onToggleSelected(topic.id) : onSelect(topic.id))}
          onToggleSelected={() => onToggleSelected(topic.id)}
          onStartRename={() => onStartRename(topic)}
          setRenameValue={setRenameValue}
          onCommitRename={onCommitRename}
          onPin={() => onPin(topic.id, !topic.pinned)}
          onRequestDelete={() => onRequestDelete([topic.id])}
        />
      ))}
    </section>
  );
}

function TopicRow({
  topic, t, active, selectionMode, selected, renaming, renameValue,
  onSelect, onToggleSelected, onStartRename, setRenameValue, onCommitRename,
  onPin, onRequestDelete,
}: {
  topic: TopicRecord;
  t: Translate;
  active: boolean;
  selectionMode: boolean;
  selected: boolean;
  renaming: boolean;
  renameValue: string;
  onSelect: () => void;
  onToggleSelected: () => void;
  onStartRename: (topic: TopicRecord) => void;
  setRenameValue: (value: string) => void;
  onCommitRename: () => void;
  onPin: () => void;
  onRequestDelete: () => void;
}) {
  const menuActions = [
    {
      id: `agent.topic.pin.${topic.id}`,
      label: topic.pinned ? t('agent.topic.unpin') : t('agent.topic.pin'),
      iconId: 'pin',
      onActivate: onPin,
    },
    {
      id: `agent.topic.rename.${topic.id}`,
      label: t('agent.topic.rename'),
      iconId: 'pencil-line',
      onActivate: () => onStartRename(topic),
    },
    {
      id: `agent.topic.delete.${topic.id}`,
      label: t('agent.common.delete'),
      iconId: 'delete',
      tone: 'danger' as const,
      onActivate: onRequestDelete,
    },
  ];

  const glyph = (
    <Icon iconId="hash" size={14} className="pa-topic-row__glyph" />
  );
  const title = (
    <Text truncate className="pa-topic-row__title">{topic.title}</Text>
  );

  // Rename owns an inline field inside a plain layout container: the
  // TextField is the sole interactive element, so no hand-rolled control.
  if (renaming) {
    return (
      <div className="pa-topic-row pa-topic-row--editing" data-pt-agent-topic-row={topic.id}>
        {glyph}
        <TextField
          value={renameValue}
          aria-label={t('agent.topic.rename')}
          density="compact"
          onValueChange={setRenameValue}
          onEnter={(event) => {
            event.stopPropagation();
            onCommitRename();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCommitRename();
          }}
          autoFocus
        />
      </div>
    );
  }

  // Selection mode: the peers-ui Checkbox label IS the row, so the whole
  // row toggles one library-owned control without nested interactives.
  if (selectionMode) {
    return (
      <Checkbox
        className="pa-topic-row pa-topic-row--select"
        data-pt-agent-topic-row={topic.id}
        data-active={active || undefined}
        checked={selected}
        aria-label={topic.title}
        onCheckedChange={onToggleSelected}
      >
        <span className="pa-topic-row__select-body">
          <Icon
            iconId={selected ? 'square-check' : 'square'}
            size={14}
            className="pa-topic-row__glyph"
          />
          {title}
        </span>
      </Checkbox>
    );
  }

  // Select and overflow menu are sibling controls inside one row wrap:
  // clicking the row selects only, while the hover-revealed IconButton is
  // the Menu trigger (parity with AgentRoster.AgentRow).
  return (
    <div className="pa-topic-row-wrap" data-pt-agent-topic-row={topic.id}>
      <Button
        actionId={`agent.topic.select.${topic.id}`}
        emphasis="quiet"
        fullWidth
        className="pa-topic-row"
        data-active={active || undefined}
        aria-current={active ? 'page' : undefined}
        onActivate={onSelect}
      >
        {glyph}
        {title}
      </Button>
      <Menu actions={menuActions} placement="bottom" label={t('agent.topic.actions')}>
        <IconButton
          actionId={`agent.topic.menu.${topic.id}`}
          iconId="more-horizontal"
          iconSize={14}
          label={t('agent.topic.actions')}
          emphasis="quiet"
          density="compact"
          className="pa-topic-row__menu"
        />
      </Menu>
    </div>
  );
}

function usePrefsTranslation() {
  const prefs = usePrefs();
  return { t: makeTranslate(prefs.locale) };
}
