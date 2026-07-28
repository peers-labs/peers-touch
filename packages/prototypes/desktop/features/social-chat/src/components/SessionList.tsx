import { Pin, BellOff, EyeOff, Trash2, CheckCheck, Volume2, VolumeX, Clock3 } from 'lucide-react';
import { T } from '../theme';
import { Avatar } from './Avatar';
import { ContextMenu } from './ContextMenu';
import type { MockConversation } from '../mock';

interface SessionListProps {
  conversations: MockConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  onHide: (id: string) => void;
  onDelete: (id: string) => void;
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

export function SessionList({
  conversations,
  activeId,
  onSelect,
  onTogglePin,
  onToggleMute,
  onMarkAsRead,
  onHide,
  onDelete,
  onFindPeople,
  compact = false,
  fill = false,
}: SessionListProps) {
  return (
    <div
      style={{
        width: fill ? '100%' : compact ? T.sessionListCompactWidth : T.sessionListWidth,
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
          onClick={onFindPeople}
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
            fontSize: T.fontXl,
          }}
        >
          +
        </button>
      </div>

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
