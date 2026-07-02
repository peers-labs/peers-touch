import { useEffect, useState } from 'react';
import { MoreHorizontal, Phone, Video, Send, Smile, Paperclip, Lock, Clock3, RotateCcw } from 'lucide-react';
import { T } from '../theme';
import { Avatar } from './Avatar';
import { USERS, type MockMessage, type MockConversation } from '../mock';

interface ChatAreaProps {
  conversation: MockConversation | null;
  messages: MockMessage[];
  onToggleDetail: () => void;
  onRestoreHistory: (conversationId: string) => void;
}

const HISTORY_RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;

function formatMessageTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageBubble({ message, isOwn }: { message: MockMessage; isOwn: boolean }) {
  const sender = USERS[message.senderId];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isOwn ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        gap: T.space2,
        padding: `${T.space1}px 0`,
      }}
    >
      {!isOwn && <Avatar name={sender?.name ?? 'Unknown'} size={32} />}
      <div style={{ maxWidth: '65%' }}>
        {!isOwn && (
          <div style={{ fontSize: T.fontXs, color: T.textTertiary, marginBottom: 2, paddingLeft: 2 }}>
            {sender?.name ?? 'Unknown'}
          </div>
        )}
        <div
          style={{
            padding: `${T.space2}px ${T.space3}px`,
            borderRadius: isOwn ? `${T.radiusLg}px ${T.radiusSm}px ${T.radiusLg}px ${T.radiusLg}px` : `${T.radiusSm}px ${T.radiusLg}px ${T.radiusLg}px ${T.radiusLg}px`,
            background: isOwn ? T.primary : T.bgMuted,
            color: isOwn ? T.textOnPrimary : T.text,
            fontSize: T.fontBase,
            lineHeight: 1.5,
            wordBreak: 'break-word',
          }}
        >
          {message.content}
        </div>
        <div
          style={{
            fontSize: T.fontXs,
            color: T.textQuaternary,
            marginTop: 2,
            textAlign: isOwn ? 'right' : 'left',
            paddingLeft: isOwn ? 0 : 2,
            paddingRight: isOwn ? 2 : 0,
          }}
        >
          {formatMessageTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
}

function formatRemaining(ms: number) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function ChatArea({ conversation, messages, onToggleDetail, onRestoreHistory }: ChatAreaProps) {
  const [inputValue, setInputValue] = useState('');
  const [now, setNow] = useState(Date.now());
  const historyClearedAt = conversation?.historyClearedAt ?? 0;
  const historyRestoreExpiresAt = historyClearedAt + HISTORY_RESTORE_WINDOW_MS;
  const canRestoreHistory = historyClearedAt > 0 && now < historyRestoreExpiresAt;
  const historyRestoreExpired = historyClearedAt > 0 && !canRestoreHistory;
  const historyRestoreRemaining = canRestoreHistory
    ? formatRemaining(historyRestoreExpiresAt - now)
    : '';
  const visibleMessages = historyClearedAt > 0
    ? messages.filter((message) => message.timestamp > historyClearedAt)
    : messages;

  useEffect(() => {
    setNow(Date.now());
  }, [conversation?.id, conversation?.historyClearedAt]);

  useEffect(() => {
    if (!canRestoreHistory) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [canRestoreHistory, historyRestoreExpiresAt]);

  if (!conversation) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: T.textTertiary,
          fontSize: T.fontLg,
        }}
      >
        Select a conversation to start chatting
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Header — same height as session list header */}
      <div
        style={{
          height: T.headerHeight,
          padding: `0 ${T.space5}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: T.space2 }}>
            <span style={{ fontSize: T.fontLg, fontWeight: 600, color: T.text }}>{conversation.name}</span>
            <Lock size={13} color={T.textQuaternary} />
          </div>
          {conversation.type === 'group' && (
            <span style={{ fontSize: T.fontXs, color: T.textTertiary }}>{conversation.memberCount} members</span>
          )}
          {conversation.type === 'friend' && conversation.online && (
            <span style={{ fontSize: T.fontXs, color: T.success }}>Online</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: T.space1 }}>
          {[Phone, Video].map((Icon, i) => (
            <button
              key={i}
              style={{
                width: 32,
                height: 32,
                border: 'none',
                background: 'transparent',
                borderRadius: T.radiusMd,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: T.textSecondary,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.bgHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Icon size={18} />
            </button>
          ))}
          <button
            onClick={onToggleDetail}
            style={{
              width: 32,
              height: 32,
              border: 'none',
              background: 'transparent',
              borderRadius: T.radiusMd,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.textSecondary,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.bgHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: `${T.space4}px ${T.space5}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: T.space2,
        }}
      >
        {historyClearedAt > 0 && (
          <div
            style={{
              alignSelf: 'center',
              maxWidth: 420,
              border: `1px solid ${T.borderSubtle}`,
              borderRadius: T.radiusLg,
              background: T.bgSubtle,
              padding: `${T.space3}px ${T.space4}px`,
              display: 'flex',
              gap: T.space3,
              color: T.textSecondary,
              fontSize: T.fontSm,
              lineHeight: 1.5,
            }}
          >
            <Clock3 size={18} style={{ flexShrink: 0, color: canRestoreHistory ? T.warning : T.textTertiary }} />
            <div style={{ flex: 1 }}>
              <div style={{ color: T.text, fontWeight: 700, marginBottom: 2 }}>
                History hidden on this device
              </div>
              <div>
                {canRestoreHistory
                  ? `Messages before this point are hidden. Restore is available for ${historyRestoreRemaining}.`
                  : historyRestoreExpired
                    ? 'The 24h restore window has ended. New messages will appear here.'
                    : 'Messages before this point are hidden.'}
              </div>
              {canRestoreHistory && (
                <button
                  onClick={() => onRestoreHistory(conversation.id)}
                  style={{
                    marginTop: T.space2,
                    height: 28,
                    border: `1px solid ${T.border}`,
                    borderRadius: T.radiusMd,
                    background: T.bg,
                    color: T.text,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: T.space1,
                    padding: `0 ${T.space2}px`,
                    cursor: 'pointer',
                    fontSize: T.fontXs,
                    fontWeight: 800,
                  }}
                >
                  <RotateCcw size={13} />
                  Restore history
                </button>
              )}
            </div>
          </div>
        )}
        {visibleMessages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.textTertiary,
              fontSize: T.fontBase,
            }}
          >
            {historyClearedAt > 0 ? 'No visible messages after clearing history.' : 'No messages yet.'}
          </div>
        )}
        {visibleMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} isOwn={msg.senderId === 'user-self'} />
        ))}
      </div>

      {/* Input */}
      <div
        style={{
          padding: `${T.space3}px ${T.space5}px ${T.space4}px`,
          borderTop: `1px solid ${T.border}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: T.space2,
            background: T.bgMuted,
            borderRadius: T.radiusLg,
            padding: `${T.space2}px ${T.space3}px`,
          }}
        >
          <button
            style={{
              width: 28, height: 28, border: 'none', background: 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.textTertiary, borderRadius: T.radiusSm,
            }}
          >
            <Smile size={18} />
          </button>
          <button
            style={{
              width: 28, height: 28, border: 'none', background: 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.textTertiary, borderRadius: T.radiusSm,
            }}
          >
            <Paperclip size={18} />
          </button>
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type a message..."
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontSize: T.fontBase,
              color: T.text,
              padding: `${T.space1}px 0`,
              lineHeight: 1.5,
            }}
          />
          <button
            style={{
              width: 28, height: 28, border: 'none',
              background: inputValue.trim() ? T.primary : 'transparent',
              cursor: inputValue.trim() ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: inputValue.trim() ? T.textOnPrimary : T.textQuaternary,
              borderRadius: T.radiusFull,
              transition: 'all 0.15s',
            }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
