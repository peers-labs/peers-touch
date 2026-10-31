/**
 * ChatRail — LEFT catalog rail for the chat surface (desktop SocialChatPage
 * parity). Header is one horizontal row: 消息/联系人 tabs, a compact search
 * tile that expands and takes over the tab space on focus/input, and the
 * new-conversation menu. Body is either the session list (pin/mute state)
 * or the contacts pane.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BellOff, CheckCheck, EyeOff, MessageCircle, MoreHorizontal, Pin, Plus, Search, Trash2, UserPlus, Users, X } from 'lucide-react';
import {
  Alert, Avatar, AvatarGroup, Button, Dialog, Empty, Menu, Popover, Segmented, Tag,
} from '@peers-touch/ui';
import type { Conversation, Person } from './chat-data';
import { useT, type Translate } from '../prefs';

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

/** Up to 9 members as a 3×3 rounded-square composite (desktop parity). */
function GroupAvatar9({ members, label }: { members: { name: string; tone: string }[]; label: string }) {
  const tiles = members.slice(0, 9);
  return (
    <span className="sk-group-avatar9" data-member-count={members.length} aria-label={label}>
      {tiles.map(m => (
        <span key={m.name} className="sk-group-avatar9-tile" style={{ background: m.tone }}>
          {m.name.slice(0, 1)}
        </span>
      ))}
    </span>
  );
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
                  ? <GroupAvatar9 members={c.members ?? []} label={c.name} />
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

export function ContactsPane({ requests, friends, selectedContactId, failedIds, onAccept, onReject, onCancelRequest, onSelectContact }: {
  requests: FriendRequest[];
  friends: Person[];
  selectedContactId: string | null;
  failedIds: Set<string>;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onCancelRequest: (id: string) => void;
  onSelectContact: (person: Person) => void;
}) {
  const { t } = useT();
  const incoming = requests.filter(request => request.state === 'pending' && request.direction !== 'out');
  const outgoing = requests.filter(request => request.state === 'pending' && request.direction === 'out');
  // Accepted/rejected incoming requests stay visible as history, but carry
  // no decision actions (desktop ContactsBook renders them with status tags).
  const history = requests.filter(request => request.direction !== 'out' && request.state !== 'pending');
  return (
    <div className="sk-contacts" data-pending-count={incoming.length} data-outgoing-count={outgoing.length}>
      {incoming.map(request => (
        <div className="sk-request-card" key={request.id} data-request-id={request.id}
          data-request-state={request.state} data-request-direction="in">
          <Avatar name={request.name} background={request.tone} size={40}
            style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
          <div className="sk-request-id">
            <div className="sk-request-name">
              <strong>{request.name}</strong>
              <Tag tone="neutral">{request.station}</Tag>
            </div>
            <span className="sk-request-greeting">{request.greeting}</span>
            {failedIds.has(request.id) && (
              <Alert tone="danger" className="sk-request-error" title={t('contacts.actionFailed')}
                description={t('contacts.networkError')} />
            )}
            {request.state === 'pending' && (
              <div className="sk-request-actions">
                <Button actionId={`request.accept-${request.id}`} emphasis="primary" density="compact"
                  label={failedIds.has(request.id) ? t('contacts.retry') : t('contacts.accept')}
                  onActivate={() => onAccept(request.id)} />
                <Button actionId={`request.reject-${request.id}`} emphasis="quiet" density="compact"
                  label={t('contacts.reject')} onActivate={() => onReject(request.id)} />
              </div>
            )}
          </div>
        </div>
      ))}
      {outgoing.length > 0 && (
        <h2 className="sk-conv-title">{t('contacts.outgoing', { n: outgoing.length })}</h2>
      )}
      {outgoing.map(request => (
        <div className="sk-request-card is-outgoing" key={request.id} data-request-id={request.id}
          data-request-state={request.state} data-request-direction="outgoing">
          <Avatar name={request.name} background={request.tone} size={40}
            style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
          <div className="sk-request-id">
            <div className="sk-request-name">
              <strong>{request.name}</strong>
              <Tag tone="neutral">{request.station}</Tag>
            </div>
            <span className="sk-request-greeting sk-request-sent">· {t('contacts.sent')}</span>
            <div className="sk-request-actions">
              <Button actionId={`request.cancel-${request.id}`} emphasis="quiet" density="compact"
                label={t('contacts.withdraw')} onActivate={() => onCancelRequest(request.id)} />
            </div>
          </div>
        </div>
      ))}
      {history.length > 0 && (
        <h2 className="sk-conv-title">{t('contacts.history', { n: history.length })}</h2>
      )}
      {history.map(request => (
        <div className="sk-request-card is-history" key={request.id} data-request-id={request.id}
          data-request-state={request.state} data-request-direction="in">
          <Avatar name={request.name} background={request.tone} size={40}
            style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
          <div className="sk-request-id">
            <div className="sk-request-name">
              <strong>{request.name}</strong>
              <Tag tone="neutral">{request.station}</Tag>
              {request.state === 'accepted' && <Tag tone="success">{t('contacts.accepted')}</Tag>}
              {request.state === 'rejected' && <Tag>{t('contacts.declined')}</Tag>}
            </div>
            <span className="sk-request-greeting">{request.greeting}</span>
          </div>
        </div>
      ))}
      <h2 className="sk-conv-title">{t('contacts.friends', { n: friends.length })}</h2>
      <ul className="sk-conv-list">
        {friends.map(person => (
          <li key={person.id}>
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
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Rail shell ────────────────────────────────────────── */

export function ChatRail({ tab, onTabChange, sessions, selectedId, onSelect, onTogglePin, onToggleMute,
  onMarkRead, onHide, onDelete,
  requests, friends, selectedContactId, failedRequestIds, onAccept, onReject, onCancelRequest, onSelectContact,
  onFindPeople, onCreateGroup, onPickSearchPerson }: {
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
  onSelectContact: (person: Person) => void;
  onFindPeople: () => void;
  onCreateGroup: () => void;
  onPickSearchPerson: (person: Person) => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const q = query.trim();
  // Expanded while focused OR while a query survives focus loss (results
  // must stay clickable); collapses once the field is empty and blurred.
  const searchExpanded = searchFocused || q.length > 0;

  const filteredSessions = useMemo(() => {
    const list = [...sessions].sort((a, b) => {
      if (Number(b.pinned ?? false) !== Number(a.pinned ?? false)) return Number(b.pinned ?? false) - Number(a.pinned ?? false);
      return (b.lastTs ?? 0) - (a.lastTs ?? 0);
    });
    const needle = q.toLowerCase();
    return needle ? list.filter(c => `${c.name} ${c.last}`.toLowerCase().includes(needle)) : list;
  }, [sessions, q]);

  const peopleResults = useMemo(() => {
    const needle = q.toLowerCase();
    return needle ? friends.filter(p => p.name.toLowerCase().includes(needle)) : [];
  }, [friends, q]);

  // Tapping a person opens/creates the conversation directly from either tab
  // (WeChat / desktop SessionList parity — no intermediate profile pane).
  const pickPerson = (person: Person) => {
    onPickSearchPerson(person);
    setQuery('');
  };
  const searchOpen = q.length > 0;
  // One row-end icon control with two explicit modes (desktop compact search
  // parity): + opens the create menu while collapsed; × cancels search —
  // clears the query, releases focus and collapses — while expanded.
  const cancelSearch = () => {
    setQuery('');
    setSearchFocused(false);
    searchInputRef.current?.blur();
  };

  // While results are open the Popover's DismissableLayer swallows Escape at
  // the document capture phase, before React's root listener sees it. Listen
  // on the window (capture runs window -> document) so search cancel wins.
  useEffect(() => {
    if (!searchExpanded) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.activeElement === searchInputRef.current) {
        event.stopPropagation();
        event.preventDefault();
        cancelSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
    // cancelSearch is a stable closure over the two setters + ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchExpanded]);

  return (
    <aside className="sk-conv-rail" aria-label={t('rail.aria')}>
      <header className="sk-rail-header" data-search-expanded={searchExpanded ? 'true' : 'false'}>
        <div className="sk-rail-tabs">
          <Segmented<'chats' | 'contacts'> className="sk-chat-subnav" aria-label="chat-subnav"
            options={[
              { value: 'chats', label: <span className="sk-subnav-label"><MessageCircle size={13} />{t('tab.chats')}</span> },
              { value: 'contacts', label: <span className="sk-subnav-label"><Users size={13} />{t('tab.contacts')}</span> },
            ]}
            value={tab} onValueChange={value => onTabChange(value ?? 'chats')} />
        </div>

        <div className="sk-conv-search">
          <Popover open={searchOpen} placement="bottom"
            content={
              <div className="sk-search-pop" data-chat-search-dropdown>
                <div className="sk-search-group" data-search-section="contacts">
                  <span className="sk-search-group-title">{t('search.contacts')}</span>
                  {peopleResults.length > 0 ? peopleResults.map(person => (
                    <button key={person.id} type="button" className="sk-search-row"
                      data-chat-search-result-kind="person"
                      onClick={() => pickPerson(person)}>
                      <Avatar name={person.name} background={person.tone} size={26}
                        style={{ borderRadius: 8 }} />
                      <strong>{person.name}</strong><span>{person.station}</span>
                    </button>
                  )) : <span className="sk-search-empty-tip">{t('search.empty.contacts')}</span>}
                </div>
                <div className="sk-search-group" data-search-section="chats">
                  <span className="sk-search-group-title">{t('search.chats')}</span>
                  {filteredSessions.length > 0 ? filteredSessions.map(c => (
                    <button key={c.id} type="button" className="sk-search-row"
                      data-chat-search-result-kind={c.kind === 'group' ? 'group' : 'session'}
                      onClick={() => { onSelect(c.id); setQuery(''); }}>
                      {c.kind === 'group' ? (
                        <AvatarGroup aria-label={c.name}>
                          {(c.members ?? []).slice(0, 3).map(m => (
                            <Avatar key={m.name} name={m.name} background={m.tone} size={26} style={{ borderRadius: 8 }} />
                          ))}
                        </AvatarGroup>
                      ) : (
                        <Avatar name={c.name} background={c.tone} size={26} style={{ borderRadius: 8 }} />
                      )}
                      <strong>{c.name}</strong><span>{c.last}</span>
                    </button>
                  )) : <span className="sk-search-empty-tip">{t('search.empty.chats')}</span>}
                </div>
              </div>
            }>
            <div className={`sk-conv-search-anchor${searchExpanded ? ' is-expanded' : ''}`}
              onMouseDown={event => {
                // Collapsed tile: focus the (zero-width) field so a click on
                // the magnifier expands search instead of doing nothing.
                if (!searchExpanded) {
                  event.preventDefault();
                  searchInputRef.current?.focus();
                }
              }}>
              <Search size={15} className="sf-leading" aria-hidden="true" />
              <input ref={searchInputRef} className="sk-conv-search-input" type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder={t('rail.searchPlaceholder')} aria-label="chat-search" />
            </div>
          </Popover>
        </div>

        <div className="sk-conv-new">
          {searchExpanded ? (
            <Button actionId="sk.search-cancel" emphasis="secondary" density="compact"
              leading={<X size={16} />} aria-label={t('rail.cancelSearch')} label=""
              onClick={cancelSearch} />
          ) : (
            <Menu placement="bottom" actions={[
              { id: 'sk.new-person', label: t('rail.new.person'), leading: <UserPlus size={14} />, onActivate: onFindPeople },
              { id: 'sk.new-group', label: t('rail.new.group'), leading: <Users size={14} />, onActivate: onCreateGroup },
            ]}>
              <Button actionId="sk.new-menu" emphasis="secondary" density="compact"
                leading={<Plus size={16} />} aria-label={t('rail.new')} label="" />
            </Menu>
          )}
        </div>
      </header>

      {tab === 'chats' ? (
        <>
          <h2 className="sk-conv-title">{query ? t('rail.searching', { query }) : t('rail.recent')}</h2>
          <SessionRows sessions={filteredSessions} selectedId={selectedId} onSelect={onSelect}
            onTogglePin={onTogglePin} onToggleMute={onToggleMute}
            onMarkRead={onMarkRead} onHide={onHide} onDelete={onDelete} />
        </>
      ) : (
        <ContactsPane requests={requests} friends={friends} selectedContactId={selectedContactId}
          failedIds={failedRequestIds}
          onAccept={onAccept} onReject={onReject} onCancelRequest={onCancelRequest} onSelectContact={onSelectContact} />
      )}
    </aside>
  );
}
