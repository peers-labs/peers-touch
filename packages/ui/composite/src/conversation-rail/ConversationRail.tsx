import { useState } from 'react';
import { Empty, IconButton, Menu, Segmented, TextField } from '@peers-touch/ui';
import type {
  ConversationRailProps, ConversationRailRegionKey, ConversationRowModel,
} from './conversation-rail.types';
import './conversation-rail.css';

function regionClass(base: string, hooks: ConversationRailProps['hooks'], key: ConversationRailRegionKey): string {
  const host = hooks?.classNames?.[key];
  return host ? `${base} ${host}` : base;
}

function regionData(
  hooks: ConversationRailProps['hooks'],
  key: ConversationRailRegionKey,
): Record<string, string | boolean | undefined> | undefined {
  return hooks?.dataAttributes?.[key];
}

function ConversationRow({
  row, selected, t, hooks, onSelect, onQuickAction, onRowAction,
}: {
  row: ConversationRowModel;
  selected: boolean;
  t: ConversationRailProps['t'];
  hooks: ConversationRailProps['hooks'];
  onSelect: (id: string) => void;
  onQuickAction: (id: string, actionId: string) => void;
  onRowAction: (id: string, actionId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | undefined>(undefined);

  const menuActions = row.rowActions
    .filter(action => !action.separator)
    .map(action => ({
      id: action.id,
      label: action.label,
      iconId: action.iconId,
      availability: action.disabled ? { kind: 'disabled' as const, reason: '' } : undefined,
      onActivate: () => onRowAction(row.id, action.id),
    }));

  return (
    <li
      className={regionClass('ptc-conv-item', hooks, 'row')}
      data-conversation-kind={row.kind}
      data-self-direct={row.selfDirect ? 'true' : 'false'}
      data-pinned={row.pinned ? 'true' : 'false'}
      data-muted={row.muted ? 'true' : 'false'}
      {...(row.hooks ?? {})}
      onContextMenu={event => {
        event.preventDefault();
        setAnchor({ x: event.clientX, y: event.clientY });
        setMenuOpen(true);
      }}
    >
      <button
        type="button"
        className={`ptc-conv-row${selected ? ' is-selected' : ''}${row.pinned ? ' is-pinned-row' : ''}`}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(row.id)}
      >
        <span className={regionClass('ptc-conv-avatar', hooks, 'avatar')} {...regionData(hooks, 'avatar')}>
          {row.avatarSlot}
          {row.kind === 'friend' && !row.selfDirect && (
            <span
              className={`ptc-presence-dot ${row.online ? 'is-online' : 'is-offline'}`}
              data-presence={row.online ? 'online' : 'offline'}
              aria-hidden
            />
          )}
          <span
            className={`ptc-unread-badge${row.unread <= 0 ? ' is-empty' : ''}${row.muted ? ' is-muted' : ''}`}
            data-unread={row.unread}
            aria-hidden={row.unread <= 0}
          >
            {row.unread > 0 ? (row.unread > 99 ? '99+' : row.unread) : ''}
          </span>
        </span>
        <span className="ptc-conv-meta">
          <span className="ptc-conv-name-line">
            <strong>{row.name}</strong>
          </span>
          <span className={regionClass('ptc-conv-preview', hooks, 'preview')} {...regionData(hooks, 'preview')}>
            <span className="ptc-conv-last">{row.preview}</span>
            <time>{row.timeLabel}</time>
          </span>
        </span>
      </button>
      <span className={regionClass('ptc-conv-actions', hooks, 'rowActions')} {...regionData(hooks, 'rowActions')}>
        {row.quickActions.map(action => (
          <IconButton
            key={action.id}
            actionId={`session.${action.id}-${row.id}`}
            className="ptc-conv-state"
            iconId={action.iconId}
            iconSize={11}
            emphasis="quiet"
            density="compact"
            label={t(action.labelKey)}
            data-row-action={action.id}
            onClick={event => {
              event.stopPropagation();
              onQuickAction(row.id, action.id);
            }}
          />
        ))}
        <Menu
          open={menuOpen}
          onOpenChange={open => { if (!open) setMenuOpen(false); }}
          anchorPoint={anchor}
          placement="bottom"
          actions={menuActions}
        >
          <IconButton
            className="ptc-conv-state"
            actionId={`session.more-${row.id}`}
            iconId="more-horizontal"
            iconSize={12}
            emphasis="quiet"
            density="compact"
            aria-haspopup="menu"
            label={t('rail.moreActions')}
            data-row-action="more"
            onClick={event => {
              event.stopPropagation();
              setAnchor(undefined);
              setMenuOpen(true);
            }}
          />
        </Menu>
      </span>
    </li>
  );
}

export function ConversationRail({ model, intents, slots, t, hooks }: ConversationRailProps) {
  if (model.tab === 'contacts' && slots?.contactsSlot) {
    return (
      <div className={regionClass('ptc-conv-rail', hooks, 'pane')} data-rail-tab="contacts" {...regionData(hooks, 'pane')}>
        {slots.contactsSlot}
      </div>
    );
  }

  return (
    <div
      className={regionClass('ptc-conv-rail', hooks, 'pane')}
      data-chat-conversation-pane
      data-rail-tab={model.tab}
      data-rail-search={model.searchOpen ? 'active' : 'idle'}
      {...regionData(hooks, 'pane')}
    >
      <header
        className={regionClass('ptc-rail-header', hooks, 'header')}
        data-rail-search={model.searchOpen ? 'active' : 'idle'}
        {...regionData(hooks, 'header')}
      >
        {model.searchOpen ? (
          <>
            <span className={regionClass('ptc-rail-search', hooks, 'searchField')} {...regionData(hooks, 'searchField')}>
              <TextField
                density="compact"
                autoFocus
                clearable
                data-rail-search-value={model.searchValue}
                placeholder={t(model.searchPlaceholderKey)}
                value={model.searchValue}
                onValueChange={intents.onSearchChange}
                onClear={() => intents.onSearchChange('')}
                onKeyDown={event => { if (event.key === 'Escape') intents.onCloseSearch(); }}
              />
            </span>
            <IconButton
              actionId="chat.rail-search-close"
              iconId="close"
              iconSize={15}
              emphasis="quiet"
              density="compact"
              label={t(model.searchCloseLabelKey)}
              onActivate={intents.onCloseSearch}
            />
          </>
        ) : (
          <>
            <div className={regionClass('ptc-rail-tabs', hooks, 'tabs')} {...regionData(hooks, 'tabs')}>
              <Segmented<'chats' | 'contacts'>
                density="compact"
                fullWidth
                value={model.tab}
                onValueChange={value => intents.onTabChange(value ?? 'chats')}
                options={[
                  { value: 'chats', label: t(model.tabLabelKeys.chats) },
                  { value: 'contacts', label: t(model.tabLabelKeys.contacts) },
                ]}
              />
            </div>
            <IconButton
              actionId="chat.rail-search"
              iconId="search"
              iconSize={15}
              emphasis="quiet"
              density="compact"
              data-rail-search-trigger
              label={t(model.searchPlaceholderKey)}
              aria-expanded={false}
              onActivate={intents.onOpenSearch}
            />
            {slots?.plusMenuSlot ?? (
              <Menu
                placement="bottom"
                actions={model.plusMenuActions.map(action => ({
                  id: action.id,
                  label: action.label,
                  iconId: action.iconId,
                  onActivate: () => intents.onRowAction('rail', action.id),
                }))}
              >
                <span className={regionClass('ptc-rail-plus', hooks, 'plusMenu')} {...regionData(hooks, 'plusMenu')}>
                  <IconButton actionId="chat.new-menu" iconId="plus" iconSize={16} emphasis="quiet" density="compact"
                    label={t('rail.new')} data-chat-new-menu />
                </span>
              </Menu>
            )}
          </>
        )}
      </header>

      {model.error && model.rows.length === 0 ? (
        <div
          className={regionClass('ptc-conv-error', hooks, 'error')}
          data-chat-session-list-error
          data-chat-session-list-error-mode={model.error.mode}
          role={model.error.mode === 'blocking' ? 'alert' : 'status'}
          {...regionData(hooks, 'error')}
        >
          <span>{t(model.error.titleKey)}</span>
          {intents.onRetry && (
            <IconButton actionId="chat.session-list.retry" iconId="refresh-cw" emphasis="quiet" density="compact"
              label={t(model.error.retryLabelKey)} data-chat-session-list-retry
              onActivate={() => intents.onRetry?.()} />
          )}
        </div>
      ) : model.rows.length === 0 ? (
        <div className={regionClass('ptc-conv-empty', hooks, 'empty')} {...regionData(hooks, 'empty')}>
          <Empty description={model.emptyKey ? t(model.emptyKey) : ''} />
        </div>
      ) : (
        <>
          <h2 className={regionClass('ptc-conv-title', hooks, 'title')} {...regionData(hooks, 'title')}>
            {t(model.recentLabelKey)}
          </h2>
          <ul className={regionClass('ptc-conv-list', hooks, 'scroll')} data-session-count={model.rows.length}
            {...regionData(hooks, 'scroll')}>
            {model.rows.map(row => (
              <ConversationRow
                key={row.id}
                row={row}
                selected={model.selectedRowKey === row.id}
                t={t}
                hooks={hooks}
                onSelect={intents.onSelectRow}
                onQuickAction={intents.onQuickAction}
                onRowAction={intents.onRowAction}
              />
            ))}
          </ul>
          {model.error && (
            <div className="ptc-conv-error ptc-conv-error--stale"
              data-chat-session-list-error data-chat-session-list-error-mode="stale" role="status">
              <span>{t(model.error.titleKey)}</span>
            </div>
          )}
        </>
      )}

      {slots?.railExtraSlot}
    </div>
  );
}
