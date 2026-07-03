import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  Image as ImageIcon,
  Lock,
  MoreHorizontal,
  Paperclip,
  Phone,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Smile,
  Video,
} from 'lucide-react';
import { T } from '../theme';
import { Avatar } from './Avatar';
import { USERS, type MockMessage, type MockConversation } from '../mock';

interface ChatAreaProps {
  conversation: MockConversation | null;
  messages: MockMessage[];
  onToggleDetail: () => void;
  onSendMessage: (conversationId: string, content: string) => void;
  onRestoreHistory: (conversationId: string) => void;
  compact?: boolean;
}

const HISTORY_RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;

function formatMessageTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageStatus({ status }: { status?: MockMessage['status'] }) {
  if (!status) return null;
  if (status === 'failed') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: T.textDanger }}>
        <AlertCircle size={11} /> Failed
      </span>
    );
  }
  if (status === 'read') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <CheckCheck size={11} /> Read
      </span>
    );
  }
  if (status === 'delivered') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <CheckCheck size={11} /> Delivered
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Check size={11} /> Sent
    </span>
  );
}

function AttachmentPreview({ message, isOwn }: { message: MockMessage; isOwn: boolean }) {
  if (message.type !== 'file' && message.type !== 'image') return null;
  const Icon = message.type === 'image' ? ImageIcon : FileText;
  return (
    <div
      style={{
        marginTop: message.content ? T.space2 : 0,
        display: 'flex',
        alignItems: 'center',
        gap: T.space2,
        padding: T.space2,
        borderRadius: T.radiusMd,
        background: isOwn ? 'rgba(255,255,255,0.16)' : T.bg,
        border: `1px solid ${isOwn ? 'rgba(255,255,255,0.18)' : T.borderSubtle}`,
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: T.radiusMd,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isOwn ? T.textOnPrimary : T.primary,
          background: isOwn ? 'rgba(255,255,255,0.14)' : 'rgba(107,91,214,0.08)',
          flexShrink: 0,
        }}
      >
        <Icon size={18} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: T.fontSm, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message.attachmentName}
        </span>
        <span style={{ display: 'block', fontSize: T.fontXs, opacity: 0.72 }}>
          {message.attachmentMeta}
        </span>
      </span>
    </div>
  );
}

function MessageBubble({ message, isOwn, compact }: { message: MockMessage; isOwn: boolean; compact?: boolean }) {
  if (message.type === 'system') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: `${T.space2}px 0` }}>
        <span
          style={{
            maxWidth: 520,
            padding: `${T.space1}px ${T.space3}px`,
            borderRadius: T.radiusFull,
            background: T.bgSubtle,
            color: T.textTertiary,
            fontSize: T.fontXs,
            lineHeight: 1.5,
            textAlign: 'center',
          }}
        >
          {message.content}
        </span>
      </div>
    );
  }
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
      <div style={{ maxWidth: compact ? '82%' : '68%', minWidth: 0 }}>
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
          {message.content ? <div>{message.content}</div> : null}
          <AttachmentPreview message={message} isOwn={isOwn} />
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
          {isOwn ? <span style={{ marginLeft: T.space1 }}><MessageStatus status={message.status} /></span> : null}
        </div>
      </div>
    </div>
  );
}

function trustColor(tone: MockConversation['trustTone']) {
  if (tone === 'verified') return T.success;
  if (tone === 'attention') return T.warning;
  if (tone === 'remote') return T.textTertiary;
  return T.primary;
}

function formatRemaining(ms: number) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function ChatArea({
  conversation,
  messages,
  onToggleDetail,
  onSendMessage,
  onRestoreHistory,
  compact = false,
}: ChatAreaProps) {
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

  const send = () => {
    if (!inputValue.trim()) return;
    onSendMessage(conversation.id, inputValue);
    setInputValue('');
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: T.chatReadableMinWidth }}>
      {/* Header — same height as session list header */}
      <div
        style={{
          height: T.headerHeight,
          padding: compact ? `0 ${T.space3}px` : `0 ${T.space5}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: T.space2 }}>
            <span style={{ fontSize: T.fontLg, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conversation.name}</span>
            {!compact && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  borderRadius: T.radiusFull,
                  background: 'rgba(0,0,0,0.035)',
                  color: trustColor(conversation.trustTone),
                  fontSize: T.fontXs,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {conversation.trustTone === 'verified' ? <ShieldCheck size={11} /> : <Lock size={11} />}
                {conversation.trustLabel}
              </span>
            )}
          </div>
          <span style={{ display: 'block', fontSize: T.fontXs, color: T.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {conversation.type === 'group'
              ? `${conversation.memberCount} members · ${conversation.detailHint}`
              : `${conversation.online ? 'Online' : 'Offline'} · ${conversation.detailHint}`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: T.space1 }}>
          {(compact ? [Search] : [Search, Phone, Video]).map((Icon, i) => (
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
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: compact ? `${T.space3}px` : `${T.space4}px ${T.space5}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: T.space2,
          background: conversation.background === 'Graphite' ? '#f7f7f8' : T.bg,
        }}
      >
        {!compact && <div style={{ display: 'flex', justifyContent: 'center', padding: `${T.space1}px 0 ${T.space2}px` }}>
          <span style={{ fontSize: T.fontXs, color: T.textTertiary }}>
            Prototype path: list / conversation / details / action surface
          </span>
        </div>}
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
          <MessageBubble key={msg.id} message={msg} isOwn={msg.senderId === 'user-self'} compact={compact} />
        ))}
      </div>

      {/* Input */}
      <div
        style={{
          padding: compact ? `${T.space2}px ${T.space3}px ${T.space3}px` : `${T.space3}px ${T.space5}px ${T.space4}px`,
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder={conversation.type === 'group' ? 'Message the group...' : 'Type a private message...'}
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
            onClick={send}
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
