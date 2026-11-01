/**
 * ChatRail — LEFT catalog rail for the chat surface (desktop SocialChatPage
 * parity). Header is one horizontal row: 消息/联系人 tabs, a compact search
 * tile that expands and takes over the tab space on focus/input, and the
 * new-conversation menu. Body is either the session list (pin/mute state)
 * or the contacts pane.
 */
import { useMemo, useState } from 'react';
import { BellOff, CheckCheck, EyeOff, MessageCircle, MoreHorizontal, Pin, Trash2, UserPlus, Users } from 'lucide-react';
import {
  Alert, Avatar, Button, Dialog, Empty, IconButton, Menu, Segmented, Tag,
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
  onSelectContact: (person: Person) => void;
  onFindPeople: () => void;
  onCreateGroup: () => void;
}) {
  const { t } = useT();
  // Finding conversations/people belongs to the global search overlay
  // (outer rail, ⌘K); the rail itself is always pinned-first, latest-first.
  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    if (Number(b.pinned ?? false) !== Number(a.pinned ?? false)) return Number(b.pinned ?? false) - Number(a.pinned ?? false);
    return (b.lastTs ?? 0) - (a.lastTs ?? 0);
  }), [sessions]);

  return (
    <aside className="sk-conv-rail" aria-label={t('rail.aria')}>
      <header className="sk-rail-header">
        <div className="sk-rail-tabs">
          <Segmented<'chats' | 'contacts'> className="sk-chat-subnav" aria-label="chat-subnav"
            density="compact"
            options={[
              { value: 'chats', label: <span className="sk-subnav-label"><MessageCircle size={13} />{t('tab.chats')}</span> },
              { value: 'contacts', label: <span className="sk-subnav-label"><Users size={13} />{t('tab.contacts')}</span> },
            ]}
            value={tab} onValueChange={value => onTabChange(value ?? 'chats')} />
        </div>

        <Menu placement="bottom" actions={[
          { id: 'sk.new-person', label: t('rail.new.person'), leading: <UserPlus size={14} />, onActivate: onFindPeople },
          { id: 'sk.new-group', label: t('rail.new.group'), leading: <Users size={14} />, onActivate: onCreateGroup },
        ]}>
          <IconButton actionId="sk.new-menu" iconId="plus" iconSize={16} density="compact"
            className="sk-rail-new" label={t('rail.new')} emphasis="quiet" />
        </Menu>
      </header>

      {tab === 'chats' ? (
        <>
          <h2 className="sk-conv-title">{t('rail.recent')}</h2>
          <SessionRows sessions={sortedSessions} selectedId={selectedId} onSelect={onSelect}
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
