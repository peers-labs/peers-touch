/**
 * ChatRail — right rail for the chat surface. Hosts the chats/contacts
 * sub-navigation, unified search (people + groups + sessions grouped in a
 * popover), the new-conversation menu, and either the session list with
 * pin/mute state or the contacts pane.
 */
import { useMemo, useState } from 'react';
import { BellOff, CheckCheck, EyeOff, MessageCircle, MoreHorizontal, Pin, Search, Trash2, UserPlus, Users } from 'lucide-react';
import {
  Alert, Avatar, AvatarGroup, Button, Dialog, Empty, Menu, Popover, Segmented, Tag,
} from '@peers-touch/ui';
import type { Conversation, Person } from './chat-data';

/* ── Session list ──────────────────────────────────────── */

function relativeTime(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
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
  // The single open context/overflow menu: { id, point? }. Right-click sets a
  // pointer position; the ⋯ button anchors the menu to itself.
  const [openMenu, setOpenMenu] = useState<{ id: string; point?: { x: number; y: number } } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);

  const menuFor = (c: Conversation) => [
    { id: 'pin', label: c.pinned ? '取消置顶' : '置顶', leading: <Pin size={14} /> },
    { id: 'mute', label: c.muted ? '取消免打扰' : '免打扰', leading: <BellOff size={14} /> },
    { id: 'read', label: '标记已读', leading: <CheckCheck size={14} />,
      availability: c.unread > 0 ? undefined : { kind: 'disabled' as const, reason: '没有未读消息' } },
    { id: 'sep-1', kind: 'separator' as const, label: '' },
    { id: 'hide', label: '隐藏会话', leading: <EyeOff size={14} /> },
    { id: 'delete', label: '删除会话', leading: <Trash2 size={14} /> },
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
                    {c.pinned && <Pin size={11} aria-label="已置顶" />}
                    {c.muted && <BellOff size={11} aria-label="已免打扰" />}
                  </span>
                </span>
                <span className="sk-conv-preview">
                  <span className="sk-conv-last">{c.last}</span>
                  <time>{relativeTime(c.lastTs) || c.lastAt}</time>
                </span>
              </span>
            </button>
            <span className="sk-conv-actions">
              <button type="button" className="sk-conv-state"
                aria-label={c.muted ? '取消免打扰' : '免打扰'}
                data-row-action="mute"
                onClick={() => onToggleMute(c.id)}>
                <BellOff size={11} />
              </button>
              <button type="button" className="sk-conv-state"
                aria-label={c.pinned ? '取消置顶' : '置顶'}
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
                  aria-label="更多会话操作" aria-haspopup="menu"
                  data-row-action="more"
                  onClick={() => setOpenMenu({ id: c.id })}>
                  <MoreHorizontal size={12} />
                </button>
              </Menu>
            </span>
          </li>
        ))}
        {sessions.length === 0 && (
          <li className="sk-conv-empty"><Empty description="没有匹配的会话" /></li>
        )}
      </ul>

      <Dialog open={!!deleteTarget} onDismiss={() => setDeleteTarget(null)}
        title={`删除会话「${deleteTarget?.name ?? ''}」？`} width={380} closeLabel="取消"
        description="将从本机的会话列表移除（本地示例，不影响对方与 Station 记录）。"
        footer={
          <>
            <Button actionId="session.delete-cancel" emphasis="quiet" label="取消"
              onActivate={() => setDeleteTarget(null)} />
            <Button actionId="session.delete-confirm" emphasis="primary" tone="danger" label="删除"
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
              <Alert tone="danger" className="sk-request-error" title="操作失败" description="网络异常，请重试。" />
            )}
            {request.state === 'pending' && (
              <div className="sk-request-actions">
                <Button actionId={`request.accept-${request.id}`} emphasis="primary" density="compact"
                  label={failedIds.has(request.id) ? '重试接受' : '接受'}
                  onActivate={() => onAccept(request.id)} />
                <Button actionId={`request.reject-${request.id}`} emphasis="quiet" density="compact"
                  label="拒绝" onActivate={() => onReject(request.id)} />
              </div>
            )}
          </div>
        </div>
      ))}
      {outgoing.length > 0 && (
        <h2 className="sk-conv-title">已发出 · {outgoing.length}</h2>
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
            <span className="sk-request-greeting sk-request-sent">· 已发送，等待对方接受</span>
            <div className="sk-request-actions">
              <Button actionId={`request.cancel-${request.id}`} emphasis="quiet" density="compact"
                label="撤回请求" onActivate={() => onCancelRequest(request.id)} />
            </div>
          </div>
        </div>
      ))}
      {history.length > 0 && (
        <h2 className="sk-conv-title">历史请求 · {history.length}</h2>
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
              {request.state === 'accepted' && <Tag tone="success">已同意</Tag>}
              {request.state === 'rejected' && <Tag>已拒绝</Tag>}
            </div>
            <span className="sk-request-greeting">{request.greeting}</span>
          </div>
        </div>
      ))}
      <h2 className="sk-conv-title">联系人 · {friends.length}</h2>
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
  const [query, setQuery] = useState('');

  const filteredSessions = useMemo(() => {
    const list = [...sessions].sort((a, b) => {
      if (Number(b.pinned ?? false) !== Number(a.pinned ?? false)) return Number(b.pinned ?? false) - Number(a.pinned ?? false);
      return (b.lastTs ?? 0) - (a.lastTs ?? 0);
    });
    const q = query.trim().toLowerCase();
    return q ? list.filter(c => `${c.name} ${c.last}`.toLowerCase().includes(q)) : list;
  }, [sessions, query]);

  const peopleResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? friends.filter(p => p.name.toLowerCase().includes(q)) : [];
  }, [friends, query]);
  const groupResults = filteredSessions.filter(c => c.kind === 'group');
  const directResults = filteredSessions.filter(c => c.kind === 'person');

  const searchOpen = query.trim().length > 0 && tab === 'chats';

  return (
    <aside className="sk-conv-rail" aria-label="聊天导航">
      <Segmented<'chats' | 'contacts'> className="sk-chat-subnav" aria-label="聊天子导航"
        options={[
          { value: 'chats', label: <span className="sk-subnav-label"><MessageCircle size={13} />消息</span> },
          { value: 'contacts', label: <span className="sk-subnav-label"><Users size={13} />联系人</span> },
        ]}
        value={tab} onValueChange={value => onTabChange(value ?? 'chats')} />

      <div className="sk-conv-search">
        <Popover open={searchOpen} placement="bottom"
          content={
            <div className="sk-search-pop" data-chat-search-dropdown>
              {peopleResults.length > 0 && (
                <div className="sk-search-group">
                  <span className="sk-search-group-title">联系人</span>
                  {peopleResults.map(person => (
                    <button key={person.id} type="button" className="sk-search-row"
                      data-chat-search-result-kind="person"
                      onClick={() => { onPickSearchPerson(person); setQuery(''); }}>
                      <Avatar name={person.name} background={person.tone} size={26}
                        style={{ borderRadius: 8 }} />
                      <strong>{person.name}</strong><span>{person.station}</span>
                    </button>
                  ))}
                </div>
              )}
              {groupResults.length > 0 && (
                <div className="sk-search-group">
                  <span className="sk-search-group-title">群聊</span>
                  {groupResults.map(c => (
                    <button key={c.id} type="button" className="sk-search-row"
                      data-chat-search-result-kind="group"
                      onClick={() => { onSelect(c.id); setQuery(''); }}>
                      <AvatarGroup aria-label={c.name}>
                        {(c.members ?? []).slice(0, 3).map(m => (
                          <Avatar key={m.name} name={m.name} background={m.tone} size={26} style={{ borderRadius: 8 }} />
                        ))}
                      </AvatarGroup>
                      <strong>{c.name}</strong><span>{c.last}</span>
                    </button>
                  ))}
                </div>
              )}
              {directResults.length > 0 && (
                <div className="sk-search-group">
                  <span className="sk-search-group-title">会话</span>
                  {directResults.map(c => (
                    <button key={c.id} type="button" className="sk-search-row"
                      data-chat-search-result-kind="session"
                      onClick={() => { onSelect(c.id); setQuery(''); }}>
                        <Avatar name={c.name} background={c.tone} size={26} style={{ borderRadius: 8 }} />
                        <strong>{c.name}</strong><span>{c.last}</span>
                      </button>
                  ))}
                </div>
              )}
              {peopleResults.length + groupResults.length + directResults.length === 0 && (
                <Empty description="没有匹配结果" />
              )}
            </div>
          }>
          <div className="sk-conv-search-anchor">
            <Search size={15} className="sf-leading" aria-hidden="true" />
            <input className="sf-field sk-conv-search-input" type="search"
              value={query} onChange={event => setQuery(event.target.value)}
              placeholder="搜索联系人、群聊、会话" aria-label="聊天搜索" />
          </div>
        </Popover>
      </div>

      <div className="sk-conv-new">
        <Menu placement="bottom" actions={[
          { id: 'sk.new-person', label: '找人', leading: <UserPlus size={14} />, onActivate: onFindPeople },
          { id: 'sk.new-group', label: '创建群聊', leading: <Users size={14} />, onActivate: onCreateGroup },
        ]}>
          <Button actionId="sk.new-menu" emphasis="primary" fullWidth leading={<UserPlus size={15} />}
            label="新建" />
        </Menu>
      </div>

      {tab === 'chats' ? (
        <>
          <h2 className="sk-conv-title">{query ? `搜索“${query}”` : '最近对话'}</h2>
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
