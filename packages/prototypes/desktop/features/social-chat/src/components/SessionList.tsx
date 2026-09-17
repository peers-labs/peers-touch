import { useState, type ReactNode } from 'react';
import { Pin, BellOff, EyeOff, Trash2, CheckCheck, Volume2, VolumeX, Clock3, Plus, RefreshCw, UserPlus, Users, X } from 'lucide-react';
import { Button } from '@lobehub/ui';
import { Alert } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { T } from '../theme';
import { Avatar } from './Avatar';
import { ContactIdentityRow } from './ContactIdentityRow';
import { ContextMenu } from './ContextMenu';
import { CONTACTS, type MockConversation } from '../mock';

interface SessionListProps {
  conversations: MockConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  onHide: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateFriend: (name: string, peerId: string) => void;
  onCreateGroup: (name: string, invitees: string[]) => void;
  onFindPeople?: () => void;
  compact?: boolean;
  fill?: boolean;
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60_000) return 'Now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function CreateAction({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        border: 'none',
        borderRadius: T.radiusMd,
        background: 'transparent',
        display: 'grid',
        gridTemplateColumns: '28px 1fr',
        gap: T.space2,
        alignItems: 'center',
        padding: T.space2,
        cursor: 'pointer',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = T.bgHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: T.radiusMd,
          background: 'rgba(107,91,214,0.1)',
          color: T.primary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: T.fontSm, fontWeight: 800, color: T.text }}>{title}</span>
        <span style={{ display: 'block', fontSize: T.fontXs, color: T.textTertiary, lineHeight: 1.35 }}>{desc}</span>
      </span>
    </button>
  );
}

function CreateInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: 'block', marginTop: T.space2 }}>
      <span style={{ display: 'block', fontSize: T.fontXs, color: T.textTertiary, fontWeight: 700, marginBottom: T.space1 }}>
        {label}
      </span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          height: 32,
          border: `1px solid ${T.border}`,
          borderRadius: T.radiusMd,
          background: T.bg,
          color: T.text,
          outline: 'none',
          padding: `0 ${T.space2}px`,
          fontSize: T.fontSm,
        }}
      />
    </label>
  );
}

export function SessionList({
  conversations,
  activeId,
  onSelect,
  onTogglePin,
  onToggleMute,
  onMarkAsRead,
  onHide,
  onDelete,
  onCreateFriend,
  onCreateGroup,
  onFindPeople,
  compact = false,
  fill = false,
}: SessionListProps) {
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'friend' | 'group' | null>(null);
  const [friendName, setFriendName] = useState('');
  const [friendPeerId, setFriendPeerId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupSelectedIds, setGroupSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [groupError, setGroupError] = useState('');

  const closeCreateSurface = () => {
    setCreateMenuOpen(false);
    setCreateMode(null);
    setFriendName('');
    setFriendPeerId('');
    setGroupName('');
    setGroupSelectedIds(new Set());
    setGroupError('');
  };

  const submitCreate = () => {
    if (createMode === 'friend') {
      onCreateFriend(friendName, friendPeerId);
      closeCreateSurface();
    }
    if (createMode === 'group') {
      if (groupSelectedIds.size === 0) return;
      if (!groupError) {
        const unavailable = CONTACTS.find(
          (contact) => groupSelectedIds.has(contact.id),
        );
        setGroupError(
          `${unavailable?.name || 'Selected member'} · `
          + `${unavailable?.federatedHandle || unavailable?.homeStation || ''} `
          + 'is not ready for encrypted group chat.',
        );
        return;
      }
      onCreateGroup(groupName, [...groupSelectedIds]);
      closeCreateSurface();
    }
  };

  const toggleGroupContact = (contactId: string) => {
    setGroupSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
    setGroupError('');
  };

  return (
    <div
      style={{
        position: 'relative',
        width: fill ? '100%' : compact ? 156 : T.sessionListWidth,
        height: '100%',
        borderRight: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        background: T.bg,
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          height: T.headerHeight,
          padding: `0 ${T.space4}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: compact ? T.fontXl : T.fontHeading, fontWeight: 600, color: T.text }}>Messages</span>
        <button
          onClick={() => {
            setCreateMenuOpen((value) => !value);
            setCreateMode(null);
          }}
          title="Add friend or group"
          aria-label="Add friend or group"
          aria-haspopup="menu"
          aria-expanded={createMenuOpen}
          style={{
            width: 28,
            height: 28,
            border: 'none',
            background: T.bgMuted,
            borderRadius: T.radiusMd,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: T.textSecondary,
          }}
        >
          <Plus size={16} />
        </button>
        {createMenuOpen && !createMode && (
          <div
            style={{
              position: 'absolute',
              top: T.headerHeight - 6,
              right: T.space3,
              zIndex: 30,
              width: 246,
              border: `1px solid ${T.border}`,
              borderRadius: T.radiusLg,
              background: T.bg,
              boxShadow: '0 18px 44px rgba(15,23,42,0.16)',
              padding: T.space2,
            }}
          >
            <CreateAction
              icon={<UserPlus size={16} />}
              title="Add friend"
              desc="Maps to Friend create/list before first message."
              onClick={() => setCreateMode('friend')}
            />
            <CreateAction
              icon={<Users size={16} />}
              title="Create group"
              desc="Maps to Group create, then invite selected members."
              onClick={() => setCreateMode('group')}
            />
          </div>
        )}
      </div>

      {createMode && (
        <div
          style={{
            margin: `0 ${T.space3}px ${T.space2}px`,
            border: `1px solid ${T.border}`,
            borderRadius: T.radiusLg,
            background: T.bgSubtle,
            padding: T.space3,
            boxShadow: T.shadowSm,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.space2 }}>
            <div>
              <div style={{ fontSize: T.fontSm, fontWeight: 800, color: T.text }}>
                {createMode === 'friend' ? 'Add friend' : 'Create group'}
              </div>
              <div style={{ fontSize: T.fontXs, color: T.textTertiary }}>
                {createMode === 'friend' ? 'Friend create -> open private session' : 'Group create -> queue member invites'}
              </div>
            </div>
            <button
              onClick={closeCreateSurface}
              title="Close"
              style={{
                width: 24,
                height: 24,
                border: 'none',
                borderRadius: T.radiusSm,
                background: 'transparent',
                color: T.textTertiary,
                cursor: 'pointer',
              }}
            >
              <X size={15} />
            </button>
          </div>
          {createMode === 'friend' ? (
            <>
              <CreateInput label="Display name" value={friendName} onChange={setFriendName} placeholder="Sarah Jenkins" />
              <CreateInput label="Peer ID / station handle" value={friendPeerId} onChange={setFriendPeerId} placeholder="station.example/alice" />
            </>
          ) : (
            <>
              <CreateInput label="Group name" value={groupName} onChange={setGroupName} placeholder="Release Review" />
              <Flexbox gap={6} style={{ marginTop: T.space2 }}>
                {CONTACTS.map((contact) => {
                  const selected = groupSelectedIds.has(contact.id);
                  const station = contact.homeStation
                    || contact.federatedHandle
                    || 'Station unavailable';
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      data-prototype-create-group-contact={contact.id}
                      aria-label={`Select ${contact.name} from ${station}`}
                      aria-pressed={selected}
                      onClick={() => toggleGroupContact(contact.id)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 8px',
                        border: 'none',
                        borderRadius: T.radiusMd,
                        background: selected ? T.bgHover : T.bg,
                        color: 'inherit',
                        cursor: 'pointer',
                        font: 'inherit',
                        textAlign: 'left',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: T.radiusFull,
                          border: selected
                            ? `1px solid ${T.primary}`
                            : `1px solid ${T.border}`,
                          background: selected ? T.primary : T.bg,
                          color: T.textOnPrimary,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {selected ? '✓' : ''}
                      </span>
                      <ContactIdentityRow
                        contact={contact}
                        selected={selected}
                      />
                    </button>
                  );
                })}
              </Flexbox>
              {groupError ? (
                <Alert
                  type="error"
                  showIcon
                  message={groupError}
                  style={{ marginTop: T.space2 }}
                />
              ) : null}
            </>
          )}
          <Button
            block
            type="primary"
            icon={
              createMode === 'group' && groupError
                ? <RefreshCw size={13} />
                : undefined
            }
            disabled={
              createMode === 'group' && groupSelectedIds.size === 0
            }
            onClick={submitCreate}
            style={{
              height: 32,
              borderRadius: T.radiusMd,
              marginTop: T.space2,
              border: 'none',
              background:
                createMode === 'group' && groupSelectedIds.size === 0
                  ? T.bgActive
                  : T.primary,
              color:
                createMode === 'group' && groupSelectedIds.size === 0
                  ? T.textQuaternary
                  : T.textOnPrimary,
            }}
          >
            {createMode === 'friend'
              ? 'Create friend chat'
              : groupError
                ? 'Retry'
                : 'Create group'}
          </Button>
        </div>
      )}

      {/* Search */}
      <div style={{ padding: `${T.space2}px ${T.space3}px` }}>
        <div
          style={{
            height: 32,
            borderRadius: T.radiusMd,
            background: T.bgMuted,
            display: 'flex',
            alignItems: 'center',
            padding: `0 ${T.space3}px`,
            gap: T.space2,
            color: T.textTertiary,
            fontSize: T.fontMd,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <span>Search</span>
        </div>
      </div>

      {/* Conversation list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {conversations.map((conv) => {
          const isActive = conv.id === activeId;
          const menuItems = [
            {
              key: 'pin',
              label: conv.pinned ? 'Unpin' : 'Pin to top',
              icon: <Pin size={14} />,
            },
            {
              key: 'mute',
              label: conv.muted ? 'Unmute' : 'Mute',
              icon: conv.muted ? <Volume2 size={14} /> : <VolumeX size={14} />,
            },
            {
              key: 'read',
              label: conv.unread > 0 ? 'Mark as read' : 'Mark as unread',
              icon: <CheckCheck size={14} />,
              disabled: conv.unread === 0,
            },
            { key: 'divider-1', type: 'divider' as const },
            {
              key: 'hide',
              label: 'Hide',
              icon: <EyeOff size={14} />,
            },
            { key: 'divider-2', type: 'divider' as const },
            {
              key: 'delete',
              label: 'Delete',
              icon: <Trash2 size={14} />,
              danger: true,
            },
          ];

          return (
            <ContextMenu
              key={conv.id}
              items={menuItems}
              onAction={(key) => {
                switch (key) {
                  case 'pin': onTogglePin(conv.id); break;
                  case 'mute': onToggleMute(conv.id); break;
                  case 'read': onMarkAsRead(conv.id); break;
                  case 'hide': onHide(conv.id); break;
                  case 'delete': onDelete(conv.id); break;
                }
              }}
            >
              <div
                onClick={() => onSelect(conv.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: compact ? T.space2 : T.space3,
                  padding: compact ? `${T.space3}px ${T.space3}px` : `${T.space3}px ${T.space4}px`,
                  cursor: 'pointer',
                  background: isActive ? T.bgHover : conv.pinned ? T.bgSubtle : 'transparent',
                  transition: 'background 0.15s',
                  borderLeft: isActive ? `3px solid ${T.primary}` : '3px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = T.bgHover;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = conv.pinned ? T.bgSubtle : 'transparent';
                }}
              >
                <Avatar
                  name={conv.name}
                  size={44}
                  online={conv.type === 'friend' ? conv.online : undefined}
                  groupIcon={conv.type === 'group'}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        fontSize: T.fontBase,
                        fontWeight: conv.unread > 0 ? 600 : 400,
                        color: T.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {conv.name}
                    </span>
                    <span style={{ fontSize: T.fontXs, color: T.textTertiary, flexShrink: 0, marginLeft: T.space2 }}>
                      {formatTime(conv.lastMessageTime)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                    <span
                      style={{
                        fontSize: T.fontSm,
                        color: conv.historyClearedAt ? T.warning : T.textTertiary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {conv.historyClearedAt ? 'History hidden on this device' : conv.lastMessage}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: T.space1, marginLeft: T.space2, flexShrink: 0 }}>
                      {conv.historyClearedAt && <Clock3 size={12} color={T.warning} />}
                      {conv.muted && <BellOff size={12} color={T.textQuaternary} />}
                      {!compact && conv.pinned && <Pin size={12} color={T.textQuaternary} />}
                      {conv.unread > 0 && (
                        <div
                          style={{
                            minWidth: 18,
                            height: 18,
                            borderRadius: T.radiusFull,
                            background: conv.muted ? T.textQuaternary : T.primary,
                            color: T.textOnPrimary,
                            fontSize: T.fontXs,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0 5px',
                          }}
                        >
                          {conv.unread > 99 ? '99+' : conv.unread}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}
