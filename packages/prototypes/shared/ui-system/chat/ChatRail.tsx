/**
 * ChatRail — LEFT catalog rail for the chat surface (desktop SocialChatPage
 * parity). Header is one horizontal row: 消息/联系人 tabs, an in-rail search
 * tile that expands and takes over the tab space, and the new-conversation
 * menu. In-rail search is a LOCAL list filter (sessions, or the contacts
 * sections); cross-surface navigation stays on the outer rail ⌘K overlay.
 * Body is the session list (pin/mute state) or the contacts pane:
 * collapsible sections with icon-only decisions on the request name row.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  BellOff, CheckCheck, ChevronDown, EyeOff, MessageCircle, MoreHorizontal, Pin, Search,
  Trash2, UserPlus, Users,
} from 'lucide-react';
import {
  Alert, Avatar, Button, Dialog, Empty, IconButton, Menu, Segmented, Tag, TextField,
} from '@peers-touch/ui';
import type { Conversation, Person } from './chat-data';
import { useT, type Translate } from '../prefs';
import { GroupAvatarComposite } from './GroupAvatar';

/* ── Session list ──────────────────────────────────────── */

function relativeTime(ts: number | undefined, t: Translate): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('time.justNow');
  if (diff < 3_600_000) return t('time.minutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('time.hoursAgo', { n: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000) return t('time.daysAgo', { n: Math.floor(diff / 86_400_000) });
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function SessionRows({ sessions, selectedId, onSelect, onTogglePin, onToggleMute, onMarkRead, onHide, onDelete }: {
  sessions: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onMarkRead: (id: string) => void;
  onHide: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useT();
  // The single open context/overflow menu: { id, point? }. Right-click sets a
  // pointer position; the ⋯ button anchors the menu to itself.
  const [openMenu, setOpenMenu] = useState<{ id: string; point?: { x: number; y: number } } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);

  const menuFor = (c: Conversation) => [
    { id: 'pin', label: c.pinned ? t('session.unpin') : t('session.pin'), leading: <Pin size={14} /> },
    { id: 'mute', label: c.muted ? t('session.unmute') : t('session.mute'), leading: <BellOff size={14} /> },
    { id: 'read', label: t('session.markRead'), leading: <CheckCheck size={14} />,
      availability: c.unread > 0 ? undefined : { kind: 'disabled' as const, reason: t('session.noUnread') } },
    { id: 'sep-1', kind: 'separator' as const, label: '' },
    { id: 'hide', label: t('session.hide'), leading: <EyeOff size={14} /> },
    { id: 'delete', label: t('session.delete'), leading: <Trash2 size={14} /> },
  ];

  const invoke = (c: Conversation, id: string) => {
    setOpenMenu(null);
    switch (id) {
      case 'pin': onTogglePin(c.id); break;
      case 'mute': onToggleMute(c.id); break;
      case 'read': onMarkRead(c.id); break;
      case 'hide': onHide(c.id); break;
      case 'delete': setDeleteTarget(c); break;
    }
  };

  return (
    <>
      <ul className="sk-conv-list" data-session-count={sessions.length}>
        {sessions.map(c => (
          <li key={c.id} className="sk-conv-item"
            data-conversation-kind={c.kind}
            data-pinned={c.pinned ? 'true' : 'false'}
            data-muted={c.muted ? 'true' : 'false'}
            onContextMenu={event => {
              event.preventDefault();
              setOpenMenu({ id: c.id, point: { x: event.clientX, y: event.clientY } });
            }}>
            <button type="button"
              className={`sk-conv-row${selectedId === c.id ? ' is-selected' : ''}${c.pinned ? ' is-pinned-row' : ''}`}
              aria-current={selectedId === c.id ? 'true' : undefined}
              onClick={() => onSelect(c.id)}>
              <span className="sk-conv-avatar">
                {c.kind === 'group'
                  ? <GroupAvatarComposite members={c.members ?? []} label={c.name} size={40} />
                  : <Avatar name={c.name} background={c.tone} size={40}
                      style={{ borderRadius: 'var(--sk-avatar-radius)' }} aria-label={c.name} />}
                {c.kind === 'person' && (
                  <span className={`sk-presence-dot ${c.online ? 'is-online' : 'is-offline'}`}
                    data-presence={c.online ? 'online' : 'offline'} aria-hidden />
                )}
                {c.unread > 0 && (
                  <span className={`sk-unread-badge${c.muted ? ' is-muted' : ''}`} data-unread={c.unread}>
                    {c.unread > 99 ? '99+' : c.unread}
                  </span>
                )}
              </span>
              <span className="sk-conv-meta">
                <span className="sk-conv-name-line">
                  <strong>{c.name}</strong>
                  <span className="sk-conv-flags">
                    {c.pinned && <Pin size={11} aria-label={t('session.pinnedFlag')} />}
                    {c.muted && <BellOff size={11} aria-label={t('session.mutedFlag')} />}
                  </span>
                </span>
                <span className="sk-conv-preview">
                  <span className="sk-conv-last">{c.last}</span>
                  <time>{relativeTime(c.lastTs, t) || c.lastAt}</time>
                </span>
              </span>
            </button>
            <span className="sk-conv-actions">
              <button type="button" className="sk-conv-state"
                aria-label={c.muted ? t('session.unmute') : t('session.mute')}
                data-row-action="mute"
                onClick={() => onToggleMute(c.id)}>
                <BellOff size={11} />
              </button>
              <button type="button" className="sk-conv-state"
                aria-label={c.pinned ? t('session.unpin') : t('session.pin')}
                data-row-action="pin"
                onClick={() => onTogglePin(c.id)}>
                <Pin size={11} />
              </button>
              <Menu
                open={openMenu?.id === c.id}
                onOpenChange={open => { if (!open) setOpenMenu(null); }}
                anchorPoint={openMenu?.id === c.id ? openMenu.point : undefined}
                placement="bottom"
                onAction={id => invoke(c, id)}
                actions={menuFor(c)}>
                <button type="button" className="sk-conv-state"
                  aria-label={t('session.moreActions')} aria-haspopup="menu"
                  data-row-action="more"
                  onClick={() => setOpenMenu({ id: c.id })}>
                  <MoreHorizontal size={12} />
                </button>
              </Menu>
            </span>
          </li>
        ))}
        {sessions.length === 0 && (
          <li className="sk-conv-empty"><Empty description={t('session.empty')} /></li>
        )}
      </ul>

      <Dialog open={!!deleteTarget} onDismiss={() => setDeleteTarget(null)}
        title={t('session.deleteTitle', { name: deleteTarget?.name ?? '' })} width={380} closeLabel={t('common.cancel')}
        description={t('session.deleteBody')}
        footer={
          <>
            <Button actionId="session.delete-cancel" emphasis="quiet" label={t('common.cancel')}
              onActivate={() => setDeleteTarget(null)} />
            <Button actionId="session.delete-confirm" emphasis="primary" tone="danger" label={t('common.delete')}
              onActivate={() => { if (deleteTarget) onDelete(deleteTarget.id); setDeleteTarget(null); }} />
          </>
        }>
        <span data-session-delete-confirm />
      </Dialog>
    </>
  );
}

/* ── Contacts pane ─────────────────────────────────────── */

import type { FriendRequest } from './chat-data';

type ContactSectionKey = 'incoming' | 'outgoing' | 'history' | 'friends';

// Settled history is an archive, not a todo queue: it starts collapsed while
// every action-bearing section starts open.
const SECTION_COLLAPSED_DEFAULT: Record<ContactSectionKey, boolean> = {
  incoming: false,
  outgoing: false,
  history: true,
  friends: false,
};

function RequestCard({ request, failed, onAccept, onReject, onCancel, onDeleteRecord }: {
  request: FriendRequest;
  failed: boolean;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onCancel: (id: string) => void;
  onDeleteRecord: (id: string) => void;
}) {
  const { t } = useT();
  const outgoing = request.direction === 'out';
  const settled = request.state !== 'pending';
  return (
    <div className={`sk-request-card${outgoing ? ' is-outgoing' : ''}${settled ? ' is-history' : ''}`}
      data-request-id={request.id}
      data-request-state={request.state} data-request-direction={outgoing ? 'outgoing' : 'in'}>
      <Avatar name={request.name} background={request.tone} size={40}
        style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
      <div className="sk-request-id">
        <div className="sk-request-name">
          <strong>{request.name}</strong>
          <Tag tone="neutral">{request.station}</Tag>
          {settled && request.state === 'accepted' && <Tag tone="success">{t('contacts.accepted')}</Tag>}
          {settled && request.state === 'rejected' && <Tag>{t('contacts.declined')}</Tag>}
          <span className="sk-request-decide">
            {!outgoing && request.state === 'pending' && (
              <>
                <IconButton actionId={`request.accept-${request.id}`} iconId="check" iconSize={14}
                  density="compact" emphasis="quiet" className="sk-decide is-accept"
                  label={failed ? t('contacts.retry') : t('contacts.accept')}
                  onActivate={() => onAccept(request.id)} />
                <IconButton actionId={`request.reject-${request.id}`} iconId="close" iconSize={14}
                  density="compact" emphasis="quiet" className="sk-decide is-reject"
                  label={t('contacts.reject')}
                  onActivate={() => onReject(request.id)} />
              </>
            )}
            {outgoing && (
              <IconButton actionId={`request.cancel-${request.id}`} iconId="undo-2" iconSize={13}
                density="compact" emphasis="quiet" className="sk-decide"
                label={t('contacts.withdraw')}
                onActivate={() => onCancel(request.id)} />
            )}
            {settled && (
              <IconButton actionId={`request.delete-${request.id}`} iconId="delete" iconSize={13}
                density="compact" emphasis="quiet" className="sk-decide is-danger"
                label={t('contacts.deleteRecord')}
                onActivate={() => onDeleteRecord(request.id)} />
            )}
          </span>
        </div>
        {outgoing
          ? <span className="sk-request-greeting sk-request-sent">· {t('contacts.sent')}</span>
          : <span className="sk-request-greeting">{request.greeting}</span>}
        {failed && (
          <Alert tone="danger" className="sk-request-error" title={t('contacts.actionFailed')}
            description={t('contacts.networkError')} />
        )}
      </div>
    </div>
  );
}

function ContactSection({ sectionKey, label, collapsed, onToggle, children }: {
  sectionKey: ContactSectionKey;
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="sk-contact-section" data-contact-section={sectionKey}
      data-collapsed={collapsed ? 'true' : 'false'}>
      <Button actionId={`contacts.section.${sectionKey}`} emphasis="quiet" density="compact"
        fullWidth className="sk-section-toggle" label={label} aria-expanded={!collapsed}
        leading={<ChevronDown size={12} className="sk-section-chevron" aria-hidden />}
        onActivate={onToggle} />
      <div className="sk-section-body">{children}</div>
    </section>
  );
}

export function ContactsPane({ requests, friends, selectedContactId, failedIds, query,
  onAccept, onReject, onCancelRequest, onDeleteRecord, onRemoveContact, onSelectContact }: {
  requests: FriendRequest[];
  friends: Person[];
  selectedContactId: string | null;
  failedIds: Set<string>;
  query: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onCancelRequest: (id: string) => void;
  onDeleteRecord: (id: string) => void;
  onRemoveContact: (id: string) => void;
  onSelectContact: (person: Person) => void;
}) {
  const { t } = useT();
  const [collapsed, setCollapsed] = useState(SECTION_COLLAPSED_DEFAULT);
  const [removeTarget, setRemoveTarget] = useState<Person | null>(null);
  const toggle = (key: ContactSectionKey) =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const incoming = requests.filter(request => request.state === 'pending' && request.direction !== 'out');
  const outgoing = requests.filter(request => request.state === 'pending' && request.direction === 'out');
  // Accepted/rejected incoming requests stay visible as settled history.
  const history = requests.filter(request => request.direction !== 'out' && request.state !== 'pending');

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const requestMatches = (request: FriendRequest) =>
    [request.name, request.station, request.greeting].join(' ').toLowerCase().includes(q);
  const friendMatches = (person: Person) =>
    [person.name, person.station ?? '', person.bio].join(' ').toLowerCase().includes(q);

  const renderCard = (request: FriendRequest) => (
    <RequestCard key={request.id} request={request} failed={failedIds.has(request.id)}
      onAccept={onAccept} onReject={onReject} onCancel={onCancelRequest}
      onDeleteRecord={onDeleteRecord} />
  );
  const renderFriend = (person: Person) => (
    <li key={person.id} className="sk-conv-item sk-contact-friend" data-contact-id={person.id}>
      <button type="button"
        className={`sk-conv-row${selectedContactId === person.id ? ' is-selected' : ''}`}
        onClick={() => onSelectContact(person)}>
        <Avatar name={person.name} background={person.tone} size={38}
          style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
        <span className="sk-conv-meta">
          <span className="sk-conv-name-line"><strong>{person.name}</strong></span>
          <span className="sk-conv-preview"><span className="sk-conv-last">{person.bio}</span></span>
        </span>
      </button>
      <span className="sk-conv-actions">
        <IconButton actionId={`contact.remove-${person.id}`} iconId="user-minus" iconSize={13}
          density="compact" emphasis="quiet" className="sk-contact-remove"
          label={t('contacts.removeContact')}
          onActivate={event => { event.stopPropagation(); setRemoveTarget(person); }} />
      </span>
    </li>
  );

  const matchedRequests = searching
    ? [...incoming, ...outgoing, ...history].filter(requestMatches)
    : [];
  const matchedFriends = searching ? friends.filter(friendMatches) : [];

  return (
    <div className="sk-contacts" data-pending-count={incoming.length} data-outgoing-count={outgoing.length}
      data-history-count={history.length} data-friends-count={friends.length}
      data-searching={searching ? 'true' : 'false'}>
      {searching ? (
        <>
          {matchedRequests.map(renderCard)}
          {matchedFriends.map(renderFriend)}
          {matchedRequests.length === 0 && matchedFriends.length === 0 && (
            <Empty description={t('contacts.noResults')} />
          )}
        </>
      ) : (
        <>
          {incoming.length > 0 && (
            <ContactSection sectionKey="incoming"
              label={t('contacts.incoming', { n: incoming.length })}
              collapsed={collapsed.incoming} onToggle={() => toggle('incoming')}>
              {incoming.map(renderCard)}
            </ContactSection>
          )}
          {outgoing.length > 0 && (
            <ContactSection sectionKey="outgoing"
              label={t('contacts.outgoing', { n: outgoing.length })}
              collapsed={collapsed.outgoing} onToggle={() => toggle('outgoing')}>
              {outgoing.map(renderCard)}
            </ContactSection>
          )}
          {history.length > 0 && (
            <ContactSection sectionKey="history"
              label={t('contacts.history', { n: history.length })}
              collapsed={collapsed.history} onToggle={() => toggle('history')}>
              {history.map(renderCard)}
            </ContactSection>
          )}
          <ContactSection sectionKey="friends"
            label={t('contacts.friends', { n: friends.length })}
            collapsed={collapsed.friends} onToggle={() => toggle('friends')}>
            {friends.length > 0
              ? <ul className="sk-conv-list">{friends.map(renderFriend)}</ul>
              : <Empty description={t('contacts.emptyFriends')} />}
          </ContactSection>
        </>
      )}

      <Dialog open={!!removeTarget} onDismiss={() => setRemoveTarget(null)}
        title={t('contacts.removeContactTitle', { name: removeTarget?.name ?? '' })} width={380}
        closeLabel={t('common.cancel')} description={t('contacts.removeContactBody')}
        footer={
          <>
            <Button actionId="contact.remove-cancel" emphasis="quiet" label={t('common.cancel')}
              onActivate={() => setRemoveTarget(null)} />
            <Button actionId="contact.remove-ok" emphasis="primary" tone="danger"
              label={t('contacts.removeContact')}
              onActivate={() => { if (removeTarget) onRemoveContact(removeTarget.id); setRemoveTarget(null); }} />
          </>
        }>
        <span data-contact-remove-confirm />
      </Dialog>
    </div>
  );
}

/* ── Rail shell ────────────────────────────────────────── */

export function ChatRail({ tab, onTabChange, sessions, selectedId, onSelect, onTogglePin, onToggleMute,
  onMarkRead, onHide, onDelete,
  requests, friends, selectedContactId, failedRequestIds, onAccept, onReject, onCancelRequest,
  onDeleteRequestRecord, onRemoveContact, onSelectContact,
  onFindPeople, onCreateGroup }: {
  tab: 'chats' | 'contacts';
  onTabChange: (tab: 'chats' | 'contacts') => void;
  sessions: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onMarkRead: (id: string) => void;
  onHide: (id: string) => void;
  onDelete: (id: string) => void;
  requests: FriendRequest[];
  friends: Person[];
  selectedContactId: string | null;
  failedRequestIds: Set<string>;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onCancelRequest: (id: string) => void;
  onDeleteRequestRecord: (id: string) => void;
  onRemoveContact: (id: string) => void;
  onSelectContact: (person: Person) => void;
  onFindPeople: () => void;
  onCreateGroup: () => void;
}) {
  const { t } = useT();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const closeSearch = () => { setSearchOpen(false); setQuery(''); };

  // The rail is always pinned-first, latest-first. Search is a local filter;
  // global finding/navigation belongs to the outer rail ⌘K overlay.
  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    if (Number(b.pinned ?? false) !== Number(a.pinned ?? false)) return Number(b.pinned ?? false) - Number(a.pinned ?? false);
    return (b.lastTs ?? 0) - (a.lastTs ?? 0);
  }), [sessions]);
  const q = query.trim().toLowerCase();
  const visibleSessions = q
    ? sortedSessions.filter(c => [c.name, c.last].join(' ').toLowerCase().includes(q))
    : sortedSessions;

  return (
    <aside className="sk-conv-rail" aria-label={t('rail.aria')}>
      <header className="sk-rail-header" data-rail-search={searchOpen ? 'active' : 'idle'}>
        {searchOpen ? (
          <>
            <span className="sk-rail-search">
              <TextField density="compact" leading={<Search size={14} />} clearable
                onClear={() => setQuery('')} autoFocus
                aria-label={t('rail.search')} placeholder={t('rail.searchPlaceholder')}
                value={query} onValueChange={setQuery} data-rail-search-value={query}
                onKeyDown={event => { if (event.key === 'Escape') closeSearch(); }} />
            </span>
            <IconButton actionId="sk.rail-search-close" iconId="close" iconSize={15} density="compact"
              className="sk-rail-new" label={t('rail.cancelSearch')} emphasis="quiet"
              onActivate={closeSearch} />
          </>
        ) : (
          <>
            <div className="sk-rail-tabs">
              <Segmented<'chats' | 'contacts'> className="sk-chat-subnav" aria-label="chat-subnav"
                density="compact"
                options={[
                  { value: 'chats', label: <span className="sk-subnav-label"><MessageCircle size={13} />{t('tab.chats')}</span> },
                  { value: 'contacts', label: <span className="sk-subnav-label"><Users size={13} />{t('tab.contacts')}</span> },
                ]}
                value={tab} onValueChange={value => onTabChange(value ?? 'chats')} />
            </div>

            <IconButton actionId="sk.rail-search" iconId="search" iconSize={15} density="compact"
              className="sk-rail-new" label={t('rail.search')} emphasis="quiet"
              onActivate={() => setSearchOpen(true)} />
            <Menu placement="bottom" actions={[
              { id: 'sk.new-person', label: t('rail.new.person'), leading: <UserPlus size={14} />, onActivate: onFindPeople },
              { id: 'sk.new-group', label: t('rail.new.group'), leading: <Users size={14} />, onActivate: onCreateGroup },
            ]}>
              <IconButton actionId="sk.new-menu" iconId="plus" iconSize={16} density="compact"
                className="sk-rail-new" label={t('rail.new')} emphasis="quiet" />
            </Menu>
          </>
        )}
      </header>

      {tab === 'chats' ? (
        <>
          <h2 className="sk-conv-title">{t('rail.recent')}</h2>
          <SessionRows sessions={visibleSessions} selectedId={selectedId} onSelect={onSelect}
            onTogglePin={onTogglePin} onToggleMute={onToggleMute}
            onMarkRead={onMarkRead} onHide={onHide} onDelete={onDelete} />
        </>
      ) : (
        <ContactsPane requests={requests} friends={friends} selectedContactId={selectedContactId}
          failedIds={failedRequestIds} query={query}
          onAccept={onAccept} onReject={onReject} onCancelRequest={onCancelRequest}
          onDeleteRecord={onDeleteRequestRecord} onRemoveContact={onRemoveContact}
          onSelectContact={onSelectContact} />
      )}
    </aside>
  );
}
