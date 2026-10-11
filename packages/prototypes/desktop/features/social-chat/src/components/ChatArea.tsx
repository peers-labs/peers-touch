import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  CornerUpLeft,
  ExternalLink,
  FileText,
  FolderOpen,
  Forward,
  Image as ImageIcon,
  Lock,
  Maximize2,
  MessagesSquare,
  Mic,
  MicOff,
  Minimize2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Pin,
  Play,
  Scissors,
  Search,
  Send,
  Server,
  ShieldCheck,
  Smile,
  RotateCcw,
  Copy,
  Trash2,
  Undo2,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { T } from '../theme';
import { Avatar } from './Avatar';
import { USERS, type MockMessage, type MockConversation } from '../mock';
import {
  CHAT_JOURNEY,
  CHAT_JOURNEY_COPY,
  resolveChatJourneyLocale,
} from '../../../../../shared/chat-journey';

if (typeof document !== 'undefined' && !document.getElementById('peers-chat-typing-keyframes')) {
  const style = document.createElement('style');
  style.id = 'peers-chat-typing-keyframes';
  style.textContent = '@keyframes chat-typing-dot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-3px);opacity:1}}';
  document.head.appendChild(style);
}


interface ChatAreaProps {
  conversation: MockConversation | null;
  messages: MockMessage[];
  conversations: MockConversation[];
  onToggleDetail: () => void;
  onSendMessage: (conversationId: string, content: string) => void;
  onSendAttachment: (conversationId: string, file: File) => void;
  onRetryMessage: (conversationId: string, messageId: string) => void;
  onEditMessage: (conversationId: string, messageId: string, content: string) => void;
  externalJumpMessageId?: string | null;
  onJumpConsumed?: () => void;
  backgroundImageUrl?: string;
  compact?: boolean;
}

const REACTION_PICKER_EMOJIS = [
  '👍', '❤️', '😂', '😮', '😢', '🙏', '👏', '🎉',
  '🔥', '💯', '🤔', '👀', '🙌', '✨', '✅', '💪',
  '🤝', '🥳', '😍', '😊', '😅', '🤯', '😎', '💡',
];
const MESSAGE_MUTATION_WINDOW_MS = 4 * 60_000 + 30_000;
const COMPOSER_EMOJI_RECENT_KEY = 'peers-touch:prototype:composer:recent-emojis';
const COMPOSER_EMOJI_GROUPS = [
  ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '😭', '😡'],
  ['👍', '👎', '👏', '🙏', '💪', '🤝', '👌', '✌️', '🤟', '👋'],
  ['❤️', '💔', '💕', '💯', '✨', '🔥', '🎉', '🌹', '⭐', '💤'],
  ['😅', '😇', '🙂', '🙃', '😉', '😌', '😋', '🤔', '🤫', '😴'],
];
const MESSAGE_ACTIONS = [
  { key: 'thread', label: 'Reply in thread', icon: MessagesSquare, ownOnly: false },
  { key: 'pin', label: 'Pin', icon: Pin, ownOnly: false },
  { key: 'reply', label: 'Reply', icon: CornerUpLeft, ownOnly: false },
  { key: 'forward', label: 'Forward', icon: Forward, ownOnly: false },
  { key: 'copy', label: 'Copy text', icon: Copy, ownOnly: false },
  { key: 'edit', label: 'Edit', icon: Pencil, ownOnly: true, withinWindow: true, textOnly: true },
  { key: 'recall', label: 'Recall', icon: Undo2, ownOnly: true, withinWindow: true },
  { key: 'delete', label: 'Delete for me', icon: Trash2, ownOnly: true },
] as const;
type MessageActionKey = (typeof MESSAGE_ACTIONS)[number]['key'];

type CallState =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'ringing_all_devices'
  | 'active'
  | 'active_here'
  | 'reconnecting'
  | 'ended'
  | 'handled_elsewhere'
  | 'failed';
type MediaKind = 'audio' | 'video';
type EndReason = 'hangup' | 'canceled' | 'rejected' | 'missed' | 'denied' | 'network';

const CALL_STATES: CallState[] = [
  'idle',
  'outgoing',
  'incoming',
  'ringing_all_devices',
  'active',
  'active_here',
  'reconnecting',
  'ended',
  'handled_elsewhere',
  'failed',
];
const CALL_REASONS: EndReason[] = ['hangup', 'canceled', 'rejected', 'missed', 'denied', 'network'];
const chatJourneyLocale = typeof window === 'undefined'
  ? 'en'
  : resolveChatJourneyLocale(window.location.search, window.navigator.language);
const chatJourneyCopy = CHAT_JOURNEY_COPY[chatJourneyLocale];
const endReasonText: Record<EndReason, { title: string; tone: 'neutral' | 'bad' }> = {
  hangup: { title: 'Call ended', tone: 'neutral' },
  canceled: { title: 'Call canceled', tone: 'neutral' },
  rejected: { title: 'Call declined', tone: 'neutral' },
  missed: { title: 'No answer', tone: 'bad' },
  denied: { title: 'Microphone / camera permission denied', tone: 'bad' },
  network: { title: 'Connection failed - please retry', tone: 'bad' },
};

function formatMessageTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageStatus({ status, onRetry }: { status?: MockMessage['status']; onRetry?: () => void }) {
  if (!status) return null;
  if (status === 'sending') {
    return (
      <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <RotateCcw size={11} /> {chatJourneyCopy.retrying}
      </span>
    );
  }
  if (status === 'failed') {
    const label = chatJourneyLocale === 'zh' ? '失败，点击重试' : 'Failed · tap to retry';
    return onRetry ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRetry();
        }}
        title={label}
        aria-label={label}
        data-chat-inline-retry
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          border: 'none',
          background: 'transparent',
          padding: 0,
          color: T.textDanger,
          font: 'inherit',
          fontSize: T.fontXs,
          lineHeight: 1.4,
          cursor: 'pointer',
        }}
      >
        <RotateCcw size={11} /> {chatJourneyLocale === 'zh' ? '失败，点击重试' : 'Failed, click to retry'}
      </button>
    ) : (
      <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: T.textDanger }}>
        <AlertCircle size={11} /> {chatJourneyLocale === 'zh' ? '失败' : 'Failed'}
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
        <CheckCheck size={11} /> {chatJourneyCopy.delivered}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Check size={11} /> Sent
    </span>
  );
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
function extractUrls(text: string): string[] {
  return text.match(URL_REGEX) ?? [];
}
function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
const EMOJI_ONLY_REGEX = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\s]+$/u;
function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 24 && EMOJI_ONLY_REGEX.test(trimmed);
}

function VoiceNoteChip({ message, isOwn }: { message: MockMessage; isOwn: boolean }) {
  const seconds = Math.max(1, Math.round(message.durationSeconds ?? 1));
  return (
    <div
      data-chat-voice-note
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        minWidth: 180,
        padding: '8px 10px',
        borderRadius: 10,
        background: isOwn ? 'rgba(255,255,255,0.14)' : T.bg,
        border: `1px solid ${isOwn ? 'rgba(255,255,255,0.18)' : T.borderSubtle}`,
      }}
    >
      <span
        style={{
          width: 30, height: 30, flexShrink: 0, borderRadius: T.radiusFull,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: isOwn ? '#fff' : T.primary,
          background: isOwn ? 'rgba(255,255,255,0.18)' : 'rgba(107,91,214,0.1)',
        }}
      >
        <Play size={14} />
      </span>
      <span aria-hidden style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        {Array.from({ length: 22 }).map((_, index) => (
          <span
            key={index}
            style={{
              width: 2,
              height: 4 + ((index * 7) % 14),
              borderRadius: 1,
              background: isOwn ? 'rgba(255,255,255,0.7)' : T.textQuaternary,
            }}
          />
        ))}
      </span>
      <span style={{ fontSize: T.fontXs, color: isOwn ? 'rgba(255,255,255,0.85)' : T.textTertiary, fontVariantNumeric: 'tabular-nums' }}>
        0:{String(seconds).padStart(2, '0')}
      </span>
    </div>
  );
}

function FileAttachmentCard({ message, isOwn }: { message: MockMessage; isOwn: boolean }) {
  const isImage = message.type === 'image';
  const Icon = isImage ? ImageIcon : FileText;
  return (
    <div
      data-chat-attachment={message.attachmentName ?? ''}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: T.space2,
        minWidth: 200,
        maxWidth: 260,
        padding: T.space2,
        borderRadius: T.radiusMd,
        background: isOwn ? 'rgba(255,255,255,0.16)' : T.bg,
        border: `1px solid ${isOwn ? 'rgba(255,255,255,0.18)' : T.borderSubtle}`,
      }}
    >
      <span
        style={{
          width: 36, height: 36, borderRadius: T.radiusMd,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
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
        <span style={{ display: 'block', fontSize: T.fontXs, opacity: 0.78 }}>
          {message.attachmentMeta}
        </span>
      </span>
    </div>
  );
}

function LinkPreviewCard({ url, isOwn }: { url: string; isOwn: boolean }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      style={{ textDecoration: 'none', maxWidth: '100%', display: 'block', marginTop: 6 }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', borderRadius: 8,
          background: isOwn ? 'rgba(255,255,255,0.12)' : T.bgSubtle,
          border: `1px solid ${isOwn ? 'rgba(255,255,255,0.15)' : T.borderSubtle}`,
          maxWidth: 260,
        }}
      >
        <ExternalLink size={14} color={isOwn ? 'rgba(255,255,255,0.7)' : T.textTertiary} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: isOwn ? 'rgba(255,255,255,0.92)' : T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {domainFromUrl(url)}
          </span>
          <span style={{ display: 'block', fontSize: 11, color: isOwn ? 'rgba(255,255,255,0.62)' : T.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {url}
          </span>
        </span>
      </div>
    </a>
  );
}

function InBubbleReplyQuote({ target, isOwn }: { target: MockMessage; isOwn: boolean }) {
  return (
    <div
      data-chat-reply-quote
      style={{
        padding: '6px 9px',
        marginBottom: 8,
        borderLeft: `3px solid ${isOwn ? 'rgba(255,255,255,0.6)' : T.primary}`,
        borderRadius: 8,
        background: isOwn ? 'rgba(255,255,255,0.14)' : T.bgSubtle,
        fontSize: 11,
        color: isOwn ? 'rgba(255,255,255,0.85)' : T.textSecondary,
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {target.content || target.attachmentName || ''}
    </div>
  );
}

function TypingBubble({ peerName, compact }: { peerName?: string; compact?: boolean }) {
  return (
    <div
      data-chat-typing
      aria-label={`${peerName ?? 'Peer'} is typing`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: T.space2,
        padding: `${T.space1}px 0`,
      }}
    >
      <Avatar name={peerName ?? 'Peer'} size={32} />
      <div style={{ maxWidth: compact ? '82%' : '72%' }}>
        <div
          className="msg-bubble"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '10px 14px',
            borderRadius: `${T.radiusSm}px ${T.radiusLg}px ${T.radiusLg}px ${T.radiusLg}px`,
            background: T.bg,
            border: `1px solid ${T.borderSubtle}`,
            boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
          }}
        >
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              style={{
                width: 6,
                height: 6,
                borderRadius: T.radiusFull,
                background: T.textQuaternary,
                animation: `chat-typing-dot 1.2s ${index * 0.18}s ease-in-out infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isOwn,
  compact,
  replyTarget,
  onRetry,
}: {
  message: MockMessage;
  isOwn: boolean;
  compact?: boolean;
  replyTarget?: MockMessage | null;
  onRetry?: () => void;
}) {
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
  const urls = extractUrls(message.content);
  const isMediaOnly = !message.content && (message.type === 'image' || message.type === 'voice');
  const emojiOnly = Boolean(message.content) && isEmojiOnly(message.content) && message.type === 'text';

  const metaRow = (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: T.fontXs, color: T.textQuaternary,
        marginTop: 2, height: 16,
        paddingLeft: isOwn ? 0 : 4,
        paddingRight: isOwn ? 4 : 0,
        justifyContent: isOwn ? 'flex-end' : 'flex-start',
      }}
    >
      {formatMessageTime(message.timestamp)}
      {message.edited ? (
        <span data-chat-message-edited style={{ fontWeight: 600 }}>
          {chatJourneyLocale === 'zh' ? '已编辑' : 'Edited'}
        </span>
      ) : null}
      {isOwn ? <span style={{ marginLeft: T.space1 }}><MessageStatus status={message.status} onRetry={onRetry} /></span> : null}
    </div>
  );

  // Emoji-only messages render large, without a chat bubble (matches real client).
  if (emojiOnly) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: isOwn ? 'row-reverse' : 'row',
          alignItems: 'flex-end',
          gap: T.space2,
          padding: `${T.space1}px 0`,
        }}
      >
        {!isOwn && <Avatar name={sender?.name ?? 'Unknown'} size={32} />}
        <div style={{ maxWidth: compact ? '82%' : '72%', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
          <div style={{ fontSize: 32, lineHeight: '40px' }}>{message.content}</div>
          {metaRow}
        </div>
      </div>
    );
  }

  const ownBubbleRadius = { borderRadius: `${T.radiusLg}px ${T.radiusSm}px ${T.radiusLg}px ${T.radiusLg}px` };
  const peerBubbleRadius = { borderRadius: `${T.radiusSm}px ${T.radiusLg}px ${T.radiusLg}px ${T.radiusLg}px` };

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
      <div style={{ maxWidth: compact ? '82%' : '72%', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
        {!isOwn && (
          <div style={{ fontSize: T.fontXs, color: T.textTertiary, marginBottom: 2, paddingLeft: 4 }}>
            {sender?.name ?? 'Unknown'}
          </div>
        )}
        {isMediaOnly ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
            {message.type === 'voice'
              ? <VoiceNoteChip message={message} isOwn={isOwn} />
              : message.type === 'image' && message.attachmentUrl
                ? (
                  <img
                    src={message.attachmentUrl}
                    alt={message.attachmentName ?? 'image'}
                    data-chat-image-attachment={message.attachmentName ?? ''}
                    style={{
                      display: 'block',
                      maxWidth: 260,
                      maxHeight: 220,
                      borderRadius: 12,
                      border: `1px solid ${isOwn ? 'rgba(255,255,255,0.18)' : T.borderSubtle}`,
                      objectFit: 'cover',
                    }}
                  />
                )
                : <FileAttachmentCard message={message} isOwn={isOwn} />}
          </div>
        ) : (
          <div
            className="msg-bubble"
            style={{
              padding: message.type === 'file' || message.type === 'image' ? T.space2 : `${T.space2}px ${T.space3}px`,
              ...(isOwn ? ownBubbleRadius : peerBubbleRadius),
              background: isOwn ? T.primary : T.bg,
              border: isOwn ? '1px solid transparent' : `1px solid ${T.borderSubtle}`,
              boxShadow: isOwn ? '0 1px 2px rgba(15,23,42,0.10)' : '0 1px 2px rgba(15,23,42,0.06)',
              color: isOwn ? T.textOnPrimary : T.text,
              fontSize: T.fontBase,
              lineHeight: 1.5,
              wordBreak: 'break-word',
            }}
          >
            {replyTarget ? <InBubbleReplyQuote target={replyTarget} isOwn={isOwn} /> : null}
            {message.content ? <div data-message-text>{message.content}</div> : null}
            {urls.slice(0, 3).map((url) => (
              <LinkPreviewCard key={url} url={url} isOwn={isOwn} />
            ))}
            {message.type === 'file' || message.type === 'image'
              ? <FileAttachmentCard message={message} isOwn={isOwn} />
              : null}
          </div>
        )}
        {metaRow}
      </div>
    </div>
  );
}

function MessageRow({
  message,
  isOwn,
  compact,
  reactions,
  recalled,
  activeMenu,
  reactionOpen,
  onRetry,
  onToggleMenu,
  onToggleReactions,
  onReact,
  onAction,
  replyTarget,
  threadCount,
  onOpenThread,
  pinned,
  highlighted,
}: {
  message: MockMessage;
  isOwn: boolean;
  compact?: boolean;
  reactions: string[];
  recalled: boolean;
  activeMenu: boolean;
  reactionOpen: boolean;
  onRetry?: () => void;
  onToggleMenu: () => void;
  onToggleReactions: () => void;
  onReact: (emoji: string) => void;
  onAction: (action: MessageActionKey) => void;
  replyTarget?: MockMessage | null;
  threadCount: number;
  onOpenThread: () => void;
  pinned: boolean;
  highlighted?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const withinMutationWindow = Date.now() - message.timestamp < MESSAGE_MUTATION_WINDOW_MS;

  if (recalled) {
    // Keep the persistent row wrapper so message identity (id/own/highlight)
    // survives recall, mirroring the real timeline row lifecycle.
    return (
      <div
        data-chat-message-id={message.id}
        data-chat-message-own={isOwn ? 'true' : 'false'}
        data-chat-message-recalled="true"
        data-chat-message-highlight={highlighted ? 'true' : undefined}
        style={{
          position: 'relative',
          borderRadius: 12,
          backgroundColor: highlighted ? 'rgba(107,91,214,0.12)' : 'transparent',
        }}
      >
        <div style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start', padding: '2px 0' }}>
          <span
            style={{
              fontSize: T.fontXs, color: T.textTertiary, fontStyle: 'italic',
              padding: `${T.space2}px ${T.space3}px`,
              background: T.bgSubtle, borderRadius: T.radiusMd,
            }}
          >
            {isOwn ? 'You recalled a message' : 'A message was recalled'}
          </span>
        </div>
      </div>
    );
  }

  // System event rows (member joined, etc.) carry no user actions. The More
  // menu already filters them, but the hover quick-actions bar must hide too.
  const showToolbar = message.type !== 'system' && (hovered || activeMenu || reactionOpen);

  return (
    <div
      data-chat-message-id={message.id}
      data-chat-message-own={isOwn ? 'true' : 'false'}
      data-chat-message-highlight={highlighted ? 'true' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        borderRadius: 12,
        transition: 'background-color 240ms ease',
        backgroundColor: highlighted ? 'rgba(107,91,214,0.12)' : 'transparent',
      }}
    >
      {showToolbar ? (
        <div
          style={{
            position: 'absolute',
            top: -8,
            [isOwn ? 'right' : 'left']: 44,
            zIndex: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            padding: '2px 4px',
            background: T.bg,
            border: `1px solid ${T.border}`,
            borderRadius: T.radiusFull,
            boxShadow: '0 6px 18px rgba(15,23,42,0.14)',
          }}
        >
          <ToolbarIconButton title="React" aria-label="React to message" onClick={onToggleReactions}>
            <Smile size={14} />
          </ToolbarIconButton>
          <ToolbarIconButton title="Reply" aria-label="Reply to message" onClick={() => onAction('reply')}>
            <CornerUpLeft size={14} />
          </ToolbarIconButton>
          <ToolbarIconButton title="Forward" aria-label="Forward message" onClick={() => onAction('forward')}>
            <Forward size={14} />
          </ToolbarIconButton>
          <ToolbarIconButton title="More actions" aria-label="More message actions" onClick={onToggleMenu}>
            <MoreHorizontal size={14} />
          </ToolbarIconButton>
          {reactionOpen ? (
            <div
              role="dialog"
              aria-label="All emojis"
              style={{
                position: 'absolute',
                top: 30,
                [isOwn ? 'right' : 'left']: 0,
                zIndex: 14,
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 28px)',
                gap: 4,
                padding: 8,
                background: T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: 10,
                boxShadow: '0 12px 30px rgba(15,23,42,0.2)',
              }}
            >
              {REACTION_PICKER_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={emoji}
                  data-chat-reaction={emoji}
                  onClick={() => onReact(emoji)}
                  style={{
                    width: 28, height: 28, border: 'none', background: 'transparent',
                    borderRadius: 8, cursor: 'pointer', fontSize: 17,
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
          {activeMenu ? (
            <div
              style={{
                position: 'absolute',
                top: 30,
                right: 0,
                minWidth: 168,
                padding: 4,
                background: T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: T.radiusLg,
                boxShadow: '0 12px 30px rgba(15,23,42,0.18)',
                zIndex: 13,
              }}
            >
              {MESSAGE_ACTIONS.filter((item) => {
                if ('ownOnly' in item && item.ownOnly && !isOwn) return false;
                if ('withinWindow' in item && item.withinWindow && !withinMutationWindow) return false;
                if ('textOnly' in item && item.textOnly && (!message.content || recalled)) return false;
                if (message.type === 'system') return false;
                return true;
              }).map((item) => {
                const Icon = item.icon;
                const danger = item.key === 'delete' || item.key === 'recall';
                const label = item.key === 'pin' ? (pinned ? 'Unpin' : 'Pin') : item.label;
                return (
                  <button
                    key={item.key}
                    type="button"
                    data-chat-message-action={item.key}
                    onClick={() => onAction(item.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '7px 10px',
                      border: 'none', background: 'transparent',
                      borderRadius: T.radiusSm, cursor: 'pointer',
                      color: danger ? T.textDanger : T.text,
                      font: 'inherit', fontSize: T.fontSm, textAlign: 'left',
                    }}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      <MessageBubble message={message} isOwn={isOwn} compact={compact} onRetry={onRetry} replyTarget={replyTarget} />
      {reactions.length > 0 || threadCount > 0 || pinned ? (
        <div
          data-chat-message-meta={message.id}
          style={{
            display: 'flex', gap: 4, alignItems: 'center',
            justifyContent: isOwn ? 'flex-end' : 'flex-start',
            paddingLeft: isOwn ? 0 : 4,
            paddingRight: isOwn ? 4 : 0,
            marginTop: 1,
          }}
        >
          {pinned ? (
            <span
              data-chat-message-pinned
              title="Pinned message"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                height: 20, padding: '0 6px', borderRadius: 8,
                background: 'rgba(107,91,214,0.1)', color: T.primary,
                fontSize: 11, fontWeight: 700,
              }}
            >
              <Pin size={10} /> Pinned
            </span>
          ) : null}
          {reactions.map((emoji, index) => (
            <button
              key={`${emoji}-${index}`}
              type="button"
              data-chat-message-reaction={emoji}
              aria-label={`React ${emoji}`}
              onClick={(event) => {
                event.stopPropagation();
                onReact(emoji);
              }}
              style={{
                fontSize: 11, lineHeight: 1,
                height: 20, padding: '0 5px',
                borderRadius: 8,
                background: T.bgMuted,
                border: 'none',
                color: T.textSecondary,
                cursor: 'pointer',
              }}
            >
              {emoji}
            </button>
          ))}
          {threadCount > 0 ? (
            <button
              type="button"
              data-message-thread-summary={threadCount}
              aria-label={`${threadCount} thread replies`}
              title={`${threadCount} thread replies`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenThread();
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                height: 20, padding: '0 6px',
                border: 0, borderRadius: 8,
                background: T.bgMuted, color: T.textTertiary,
                cursor: 'pointer', fontSize: 11,
              }}
            >
              <MessagesSquare size={11} />
              {threadCount}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolbarIconButton({ title, children, onClick, ...rest }: {
  title: string;
  children: React.ReactNode;
  onClick: () => void;
  'aria-label': string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{
        width: 26, height: 26, border: 'none', background: 'transparent',
        borderRadius: T.radiusFull, cursor: 'pointer', color: T.textSecondary,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function ComposerToolButton({ label, active = false, ariaPressed, onClick, children }: {
  label: string;
  active?: boolean;
  ariaPressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={ariaPressed}
      onClick={onClick}
      style={{
        width: 34, height: 34, border: 'none', borderRadius: 8,
        background: 'transparent', cursor: 'pointer',
        color: active ? T.primary : T.textSecondary,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

function trustColor(tone: MockConversation['trustTone']) {
  if (tone === 'verified') return T.success;
  if (tone === 'attention') return T.warning;
  if (tone === 'remote') return T.textTertiary;
  return T.primary;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function HeaderIconButton({
  icon: Icon,
  title,
  active,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        border: 'none',
        background: active ? T.bgHover : 'transparent',
        borderRadius: T.radiusMd,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: active ? T.primary : T.textSecondary,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = T.bgHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = active ? T.bgHover : 'transparent')}
    >
      <Icon size={18} />
    </button>
  );
}

function CircleButton({
  icon: Icon,
  title,
  tone = 'neutral',
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  tone?: 'neutral' | 'danger' | 'accept';
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const palette = {
    neutral: { bg: hover ? T.bgHover : T.bgMuted, fg: T.textSecondary, border: T.border },
    danger: { bg: T.textDanger, fg: T.textOnPrimary, border: T.textDanger },
    accept: { bg: T.success, fg: T.textOnPrimary, border: T.success },
  }[tone];
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 42,
        height: 42,
        borderRadius: T.radiusFull,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <Icon size={18} />
    </button>
  );
}

function Segmented<TValue extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly TValue[];
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, background: T.bgMuted, padding: 3, borderRadius: T.radiusMd, flexWrap: 'wrap' }}>
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            onClick={() => onChange(option)}
            style={{
              border: 'none',
              cursor: 'pointer',
              fontSize: T.fontXs,
              padding: `4px ${T.space2}px`,
              borderRadius: T.radiusSm,
              fontWeight: active ? 700 : 500,
              color: active ? T.primary : T.textSecondary,
              background: active ? T.bg : 'transparent',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function CallDiagnosticsMenu({
  state,
  media,
  reason,
  onState,
  onMedia,
  onReason,
  onOpenDetail,
}: {
  state: CallState;
  media: MediaKind;
  reason: EndReason;
  onState: (state: CallState) => void;
  onMedia: (media: MediaKind) => void;
  onReason: (reason: EndReason) => void;
  onOpenDetail: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 42,
        right: 0,
        zIndex: 40,
        width: 320,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusLg,
        background: T.bg,
        boxShadow: '0 18px 48px rgba(15, 23, 42, 0.16)',
        padding: T.space3,
      }}
    >
      <button
        onClick={onOpenDetail}
        style={{
          width: '100%',
          height: 34,
          border: `1px solid ${T.borderSubtle}`,
          borderRadius: T.radiusMd,
          background: T.bgSubtle,
          color: T.text,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `0 ${T.space3}px`,
          fontSize: T.fontSm,
          fontWeight: 700,
          marginBottom: T.space3,
        }}
      >
        <span>Conversation details</span>
        <MoreHorizontal size={15} />
      </button>
      <div style={{ fontSize: T.fontXs, fontWeight: 800, color: T.textTertiary, letterSpacing: 0.4, marginBottom: T.space2 }}>
        Stream call simulator
      </div>
      <div style={{ display: 'grid', gap: T.space2 }}>
        <Segmented options={CALL_STATES} value={state} onChange={onState} />
        <Segmented options={['audio', 'video'] as const} value={media} onChange={onMedia} />
        {(state === 'ended' || state === 'failed') && (
          <Segmented options={CALL_REASONS} value={reason} onChange={onReason} />
        )}
      </div>
      <div style={{ marginTop: T.space2, color: T.textTertiary, fontSize: T.fontXs, lineHeight: 1.5 }}>
        Hidden by default; use this only to review non-happy-path call states.
      </div>
    </div>
  );
}

function ModalAction({
  icon: Icon,
  label,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  tone: 'danger' | 'accept';
  onClick: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: T.space2 }}>
      <CircleButton icon={Icon} title={label} tone={tone} onClick={onClick} />
      <span style={{ fontSize: T.fontXs, color: T.textTertiary }}>{label}</span>
    </div>
  );
}

function IncomingCallModal({
  conversation,
  media,
  multiDevice = false,
  onAccept,
  onReject,
  onHandledElsewhere,
}: {
  conversation: MockConversation;
  media: MediaKind;
  multiDevice?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onHandledElsewhere?: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15,23,42,0.42)',
      }}
    >
      <div
        style={{
          width: 320,
          borderRadius: T.radiusLg,
          background: T.bg,
          padding: `${T.space6}px ${T.space5}px`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
        }}
      >
        <div style={{ position: 'relative' }}>
          <Avatar name={conversation.name} size={80} online={conversation.online} groupIcon={conversation.type === 'group'} />
          <span
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              width: 30,
              height: 30,
              borderRadius: T.radiusFull,
              background: T.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.textOnPrimary,
              border: `3px solid ${T.bg}`,
            }}
          >
            <PhoneIncoming size={15} />
          </span>
        </div>
        <div style={{ marginTop: T.space4, fontSize: T.fontLg, fontWeight: 700, color: T.text }}>{conversation.name}</div>
        <div style={{ marginTop: 5, fontSize: T.fontSm, color: T.textTertiary }}>
          {multiDevice
            ? `Incoming ${media === 'video' ? 'video' : 'voice'} call on this Mac and your phone`
            : `Incoming ${media === 'video' ? 'video' : 'voice'} call`}
        </div>
        <div style={{ marginTop: T.space6, display: 'flex', gap: 40 }}>
          <ModalAction icon={PhoneOff} label="Decline" tone="danger" onClick={onReject} />
          <ModalAction icon={media === 'video' ? Video : Phone} label="Accept" tone="accept" onClick={onAccept} />
        </div>
        {multiDevice && onHandledElsewhere ? (
          <button onClick={onHandledElsewhere} style={{ ...simButtonStyle, marginTop: T.space4 }}>
            Simulate accepted on phone
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CallHud({
  conversation,
  state,
  media,
  duration,
  micOn,
  camOn,
  audioDevice,
  videoDevice,
  onToggleMic,
  onToggleCam,
  onAudioDevice,
  onVideoDevice,
  onHangup,
  onPeerAccept,
  onSimWeak,
}: {
  conversation: MockConversation;
  state: 'outgoing' | 'active' | 'active_here' | 'reconnecting';
  media: MediaKind;
  duration: number;
  micOn: boolean;
  camOn: boolean;
  audioDevice: string;
  videoDevice: string;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onAudioDevice: (device: string) => void;
  onVideoDevice: (device: string) => void;
  onPeerAccept: () => void;
  onSimWeak: () => void;
}) {
  const isVideo = media === 'video';
  const isActive = state === 'active' || state === 'active_here' || state === 'reconnecting';
  const reconnecting = state === 'reconnecting';

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 22,
        right: 22,
        zIndex: 25,
        width: isVideo ? 360 : 264,
        background: T.bg,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusLg,
        boxShadow: '0 12px 48px rgba(15,23,42,0.22)',
        overflow: 'hidden',
      }}
    >
      {isVideo && isActive ? (
        <div style={{ position: 'relative', width: '100%', height: 200, background: '#111827' }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              background: reconnecting
                ? 'linear-gradient(135deg, #111827, #312e81)'
                : 'linear-gradient(135deg, #312e81, #6d28d9)',
              filter: reconnecting ? 'blur(1px) brightness(0.82)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.textOnPrimary,
              fontSize: T.fontLg,
              fontWeight: 800,
            }}
          >
            {conversation.name}
          </div>
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 80,
              height: 60,
              borderRadius: T.radiusSm,
              border: `1px solid rgba(255,255,255,0.28)`,
              background: camOn ? `linear-gradient(135deg, ${T.primary}, #9a8df0)` : '#111827',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.textOnPrimary,
              fontSize: T.fontXs,
              fontWeight: 700,
            }}
          >
            {camOn ? 'You' : <VideoOff size={18} />}
          </div>
          <span
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: T.fontXs,
              padding: '2px 7px',
              borderRadius: T.radiusFull,
              background: 'rgba(0,0,0,0.45)',
              color: T.textOnPrimary,
            }}
          >
            <ShieldCheck size={12} /> E2E
          </span>
        </div>
      ) : (
        <div
          style={{
            height: isVideo ? 200 : 104,
            background: T.bgMuted,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isVideo ? <Video size={44} color={T.textTertiary} /> : <Phone size={34} color={T.textTertiary} />}
        </div>
      )}

      <div style={{ padding: T.space3, display: 'flex', flexDirection: 'column', gap: T.space2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: T.space2 }}>
          <span style={{ fontSize: T.fontBase, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {conversation.name}
          </span>
          <span style={{ fontSize: T.fontXs, display: 'inline-flex', alignItems: 'center', gap: 4, color: T.textTertiary, flexShrink: 0 }}>
            {state === 'outgoing' ? (
              'Ringing'
            ) : reconnecting ? (
              <><WifiOff size={13} color={T.warning} /> Reconnecting</>
            ) : (
              <><Wifi size={13} color={T.success} /> {fmtDuration(duration)}</>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: T.space3 }}>
          {isActive && (
            <CircleButton icon={micOn ? Mic : MicOff} title={micOn ? 'Mute' : 'Unmute'} tone={micOn ? 'neutral' : 'danger'} onClick={onToggleMic} />
          )}
          {isActive && isVideo && (
            <CircleButton icon={camOn ? Video : VideoOff} title={camOn ? 'Camera off' : 'Camera on'} tone={camOn ? 'neutral' : 'danger'} onClick={onToggleCam} />
          )}
          <CircleButton icon={PhoneOff} title={isActive ? 'End' : 'Cancel'} tone="danger" onClick={onHangup} />
        </div>
        {isActive ? (
          <div style={{ display: 'grid', gridTemplateColumns: isVideo ? '1fr 1fr' : '1fr', gap: T.space2 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: T.fontXs, color: T.textTertiary }}>
              Microphone
              <select
                aria-label="Microphone device"
                value={audioDevice}
                onChange={(event) => onAudioDevice(event.target.value)}
                style={deviceSelectStyle}
              >
                <option>MacBook Microphone</option>
                <option>Studio Display Microphone</option>
              </select>
            </label>
            {isVideo ? (
              <label style={{ display: 'grid', gap: 3, fontSize: T.fontXs, color: T.textTertiary }}>
                Camera
                <select
                  aria-label="Camera device"
                  value={videoDevice}
                  onChange={(event) => onVideoDevice(event.target.value)}
                  style={deviceSelectStyle}
                >
                  <option>FaceTime HD Camera</option>
                  <option>Continuity Camera</option>
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: T.space2, justifyContent: 'center' }}>
          {state === 'outgoing' && <button onClick={onPeerAccept} style={simButtonStyle}>Simulate accept</button>}
          {isActive && <button onClick={onSimWeak} style={simButtonStyle}>{reconnecting ? 'Simulate recover' : 'Simulate weak network'}</button>}
        </div>
      </div>
    </div>
  );
}

const simButtonStyle: CSSProperties = {
  fontSize: T.fontXs,
  color: T.textTertiary,
  cursor: 'pointer',
  padding: `3px ${T.space2}px`,
  borderRadius: T.radiusFull,
  border: `1px dashed ${T.border}`,
  background: T.bg,
};

const deviceSelectStyle: CSSProperties = {
  width: '100%',
  height: 30,
  borderRadius: T.radiusSm,
  border: `1px solid ${T.border}`,
  background: T.bg,
  color: T.text,
  fontSize: T.fontXs,
  padding: `0 ${T.space2}px`,
};

function CallResultToast({
  reason,
  duration,
  onClose,
}: {
  reason: EndReason;
  duration: number;
  onClose: () => void;
}) {
  const meta = endReasonText[reason];
  const bad = meta.tone === 'bad';
  return (
    <div
      style={{
        position: 'absolute',
        top: 74,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 25,
        display: 'flex',
        alignItems: 'center',
        gap: T.space3,
        padding: `${T.space3}px ${T.space4}px`,
        borderRadius: T.radiusLg,
        background: T.bg,
        border: `1px solid ${bad ? T.textDanger : T.border}`,
        boxShadow: '0 12px 36px rgba(15,23,42,0.16)',
      }}
    >
      <PhoneOff size={18} color={bad ? T.textDanger : T.textSecondary} />
      <div>
        <div style={{ fontSize: T.fontSm, fontWeight: 700, color: T.text }}>{meta.title}</div>
        <div style={{ fontSize: T.fontXs, color: T.textTertiary }}>
          {reason === 'hangup' ? `Duration ${fmtDuration(duration)}` : 'Use the call button to retry'}
        </div>
      </div>
      <button
        onClick={onClose}
        style={{
          marginLeft: T.space1,
          fontSize: T.fontXs,
          color: T.textTertiary,
          cursor: 'pointer',
          padding: `4px ${T.space2}px`,
          borderRadius: T.radiusSm,
          border: 'none',
          background: T.bgMuted,
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function HandledElsewhereToast({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 74,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 25,
        display: 'flex',
        alignItems: 'center',
        gap: T.space3,
        padding: `${T.space3}px ${T.space4}px`,
        borderRadius: T.radiusLg,
        background: T.bg,
        border: `1px solid ${T.border}`,
        boxShadow: '0 12px 36px rgba(15,23,42,0.16)',
      }}
    >
      <CheckCheck size={18} color={T.success} />
      <div>
        <div style={{ fontSize: T.fontSm, fontWeight: 700, color: T.text }}>
          Answered on another device
        </div>
        <div style={{ fontSize: T.fontXs, color: T.textTertiary }}>
          This device stopped ringing and released temporary call resources.
        </div>
      </div>
      <button onClick={onClose} style={{ ...simButtonStyle, marginLeft: T.space1 }}>
        Dismiss
      </button>
    </div>
  );
}

export function ChatArea({
  conversation,
  messages,
  conversations,
  onToggleDetail,
  onSendMessage,
  onSendAttachment,
  onRetryMessage,
  onEditMessage,
  externalJumpMessageId = null,
  onJumpConsumed,
  backgroundImageUrl,
  compact = false,
}: ChatAreaProps) {
  const [inputValue, setInputValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  // Message interaction state (prototype-local interaction form)
  const [reactionsByMessage, setReactionsByMessage] = useState<Record<string, string[]>>({});
  const [recalledIds, setRecalledIds] = useState<Set<string>>(new Set());
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<MockMessage | null>(null);
  const [forwardMessage, setForwardMessage] = useState<MockMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MockMessage | null>(null);
  const [threadRoot, setThreadRoot] = useState<MockMessage | null>(null);
  const [threadReplies, setThreadReplies] = useState<Record<string, MockMessage[]>>({});
  const [threadDraft, setThreadDraft] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(COMPOSER_EMOJI_RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  });
  const [toast, setToast] = useState<string | null>(null);

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = inputExpanded ? 320 : 180;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 74), max)}px`;
  };

  useEffect(() => {
    resizeTextarea();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, inputExpanded, conversation?.id]);

  useEffect(() => {
    setInputExpanded(false);
  }, [conversation?.id]);

  const insertComposerEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? inputValue.length;
    const end = el?.selectionEnd ?? inputValue.length;
    setInputValue(inputValue.slice(0, start) + emoji + inputValue.slice(end));
    const nextRecent = [emoji, ...recentEmojis.filter((item) => item !== emoji)].slice(0, 24);
    setRecentEmojis(nextRecent);
    try {
      window.localStorage.setItem(COMPOSER_EMOJI_RECENT_KEY, JSON.stringify(nextRecent));
    } catch {
      // best-effort UI preference
    }
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const caret = start + emoji.length;
      textareaRef.current?.setSelectionRange(caret, caret);
    });
    setEmojiOpen(false);
  };

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((current) => (current === text ? null : current)), 1800);
  };

  const submitThreadReply = () => {
    if (!threadRoot || !threadDraft.trim()) return;
    const reply: MockMessage = {
      id: `thread-${Date.now()}`,
      senderId: 'user-self',
      content: threadDraft.trim(),
      timestamp: Date.now(),
      type: 'text',
      status: 'sent',
    };
    setThreadReplies((prev) => ({
      ...prev,
      [threadRoot.id]: [...(prev[threadRoot.id] ?? []), reply],
    }));
    setThreadDraft('');
  };

  const toggleReaction = (messageId: string, emoji: string) => {
    setReactionsByMessage((prev) => {
      const current = prev[messageId] ?? [];
      const next = current.includes(emoji) ? current.filter((value) => value !== emoji) : [...current, emoji];
      return { ...prev, [messageId]: next };
    });
    setReactionPickerId(null);
  };

  const handleMessageAction = (message: MockMessage, action: MessageActionKey) => {
    setActiveMenuId(null);
    if (action === 'reply') {
      setReplyTo(message);
      return;
    }
    if (action === 'thread') {
      setThreadRoot(message);
      return;
    }
    if (action === 'pin') {
      setPinnedIds((prev) => {
        const next = new Set(prev);
        if (next.has(message.id)) {
          next.delete(message.id);
        } else {
          next.add(message.id);
        }
        return next;
      });
      return;
    }
    if (action === 'edit') {
      setReplyTo(null);
      setEditingId(message.id);
      setInputValue(message.content);
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        resizeTextarea();
      });
      return;
    }
    if (action === 'forward') {
      setForwardMessage(message);
      return;
    }
    if (action === 'copy') {
      const text = message.content || message.attachmentName || '';
      void navigator.clipboard?.writeText(text).catch(() => undefined);
      showToast('Message copied');
      return;
    }
    if (action === 'recall') {
      setRecalledIds((prev) => new Set(prev).add(message.id));
      if (editingId === message.id) cancelEdit();
      if (threadRoot?.id === message.id) setThreadRoot(null);
      showToast('Message recalled');
      return;
    }
    if (action === 'delete') {
      // The confirm modal completes removal; cancel an in-flight edit now so
      // Save can never mutate a message the user chose to delete.
      if (editingId === message.id) cancelEdit();
      setDeleteTarget(message);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setInputValue('');
  };

  // Center the target row and flash a transient highlight (production uses
  // highlightedMessageUlid for 1.8s). Shared by the in-area search and the
  // global SearchMessagesModal jump arriving via externalJumpMessageId.
  const flashMessage = (messageId: string) => {
    setHighlightedId(messageId);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      highlightTimer.current = null;
      setHighlightedId(null);
    }, 1800);
    window.requestAnimationFrame(() => {
      const host = messagesScrollRef.current;
      const target = host?.querySelector(`[data-chat-message-id="${CSS.escape(messageId)}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const jumpToMessage = (message: MockMessage) => {
    setSearchOpen(false);
    setSearchQuery('');
    flashMessage(message.id);
  };
  const [callState, setCallState] = useState<CallState>('idle');
  const [callMedia, setCallMedia] = useState<MediaKind>('video');
  const [callReason, setCallReason] = useState<EndReason>('hangup');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [audioDevice, setAudioDevice] = useState('MacBook Microphone');
  const [videoDevice, setVideoDevice] = useState('FaceTime HD Camera');
  const [duration, setDuration] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const callTimer = useRef<number | null>(null);
  // Reset prototype-local message interaction state on conversation switch.
  useEffect(() => {
    setActiveMenuId(null);
    setReactionPickerId(null);
    setReplyTo(null);
    setForwardMessage(null);
    setDeleteTarget(null);
    setEmojiOpen(false);
    setSearchOpen(false);
    setSearchQuery('');
    setThreadRoot(null);
    setThreadDraft('');
    setPeerTyping(false);
    setPendingAttachment(null);
    setEditingId(null);
    setInputValue('');
    setHighlightedId(null);
    if (typingTimer.current) {
      window.clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    if (highlightTimer.current) {
      window.clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
  }, [conversation?.id]);

  useEffect(() => () => {
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
  }, []);
  const visibleMessages = messages.filter((message) => !deletedIds.has(message.id));
  // Recalled tombstones and system events are never user-searchable content.
  const isSearchableMessage = (message: MockMessage) =>
    !recalledIds.has(message.id) && message.type !== 'system';
  const searchResults = searchQuery.trim()
    ? visibleMessages.filter((message) =>
      isSearchableMessage(message)
        && message.content.toLowerCase().includes(searchQuery.trim().toLowerCase()),
    )
    : [];

  // Global SearchMessagesModal jump: the parent switches conversation first,
  // then hands over the target message id; apply once the target row exists.
  const lastExternalJumpRef = useRef<string | null>(null);
  useEffect(() => {
    if (!externalJumpMessageId || externalJumpMessageId === lastExternalJumpRef.current) return;
    const target = visibleMessages.find((message) => message.id === externalJumpMessageId);
    if (!target) return;
    lastExternalJumpRef.current = externalJumpMessageId;
    flashMessage(target.id);
    onJumpConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalJumpMessageId, messages]);

  useEffect(() => {
    const counting =
      callState === 'active'
      || callState === 'active_here'
      || callState === 'reconnecting';
    if (counting && callTimer.current === null) {
      callTimer.current = window.setInterval(() => setDuration((value) => value + 1), 1000);
    }
    if (!counting && callTimer.current !== null) {
      window.clearInterval(callTimer.current);
      callTimer.current = null;
    }
    if (
      callState === 'idle'
      || callState === 'outgoing'
      || callState === 'incoming'
      || callState === 'ringing_all_devices'
      || callState === 'handled_elsewhere'
    ) {
      setDuration(0);
    }
    return () => {
      if (callTimer.current !== null) {
        window.clearInterval(callTimer.current);
        callTimer.current = null;
      }
    };
  }, [callState]);

  useEffect(() => {
    setCallState('idle');
    setActionsOpen(false);
  }, [conversation?.id]);

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
    // Edit commit takes over the composer: no attachment/typing side effects.
    if (editingId) {
      const editedText = inputValue.trim();
      if (editedText) onEditMessage(conversation.id, editingId, editedText);
      setEditingId(null);
      setInputValue('');
      setPendingAttachment(null);
      return;
    }
    if (pendingAttachment) {
      onSendAttachment(conversation.id, pendingAttachment);
      setPendingAttachment(null);
    }
    if (inputValue.trim()) {
      onSendMessage(conversation.id, inputValue);
    }
    setInputValue('');
    setReplyTo(null);
    // Prototype-only presence feedback: an online peer shows a typing state
    // briefly after a message is sent (production drives this from SSE).
    if (conversation.type === 'friend' && conversation.online) {
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      setPeerTyping(true);
      typingTimer.current = window.setTimeout(() => {
        typingTimer.current = null;
        setPeerTyping(false);
      }, 1800);
    }
  };
  const startCall = (media: MediaKind) => {
    setCallMedia(media);
    setMicOn(true);
    setCamOn(media === 'video');
    setCallReason('hangup');
    setCallState('outgoing');
  };
  // Peer presence tag mirrors ChatMessageArea: station-sourced state rendered
  // explicitly as a dot chip (online / offline / unknown), friend chats only.
  const presenceState: 'online' | 'offline' | 'unknown' = conversation.type === 'friend'
    ? (conversation.online === undefined ? 'unknown' : conversation.online ? 'online' : 'offline')
    : 'unknown';
  const presenceLabel = presenceState === 'online'
    ? 'Online'
    : presenceState === 'offline'
      ? 'Offline'
      : 'Unknown';
  const presenceColor = presenceState === 'online' ? T.success : T.textQuaternary;
  const presenceBackground = presenceState === 'online' ? 'rgba(22,163,74,0.12)' : T.bgMuted;
  // Authority Station pill (production resolves the federation station name).
  const authorityStationName = conversation.station?.trim() || CHAT_JOURNEY.station;
  const callChip =
    callState === 'outgoing'
      ? 'Ringing'
      : callState === 'incoming' || callState === 'ringing_all_devices'
        ? callState === 'ringing_all_devices' ? 'Ringing on your devices' : 'Incoming'
        : callState === 'active' || callState === 'active_here' || callState === 'reconnecting'
          ? `${callState === 'reconnecting' ? 'Reconnecting' : 'In call'} · ${fmtDuration(duration)}`
          : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: compact ? 240 : T.chatReadableMinWidth, position: 'relative' }}>
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
            {conversation.type === 'friend' && (
              <span
                data-chat-presence-tag={presenceState}
                data-chat-presence-source="station"
                aria-label={presenceLabel}
                title={presenceLabel}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 500,
                  color: presenceColor,
                  background: presenceBackground,
                  padding: '1px 6px',
                  borderRadius: 4,
                  lineHeight: '16px',
                  flexShrink: 0,
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: presenceColor }} />
                {presenceLabel}
              </span>
            )}
            <Lock
              size={13}
              aria-label="End-to-end encrypted"
              style={{ color: T.textTertiary, flexShrink: 0 }}
            />
            {!compact && (
              <span
                data-chat-station="authority"
                data-chat-station-name={authorityStationName}
                data-chat-station-state="available"
                title={`Station · ${authorityStationName}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  minWidth: 0,
                  maxWidth: 'min(180px, 24vw)',
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: T.bgMuted,
                  color: T.textTertiary,
                  fontSize: 10,
                  lineHeight: '16px',
                  flexShrink: 1,
                }}
              >
                <Server size={11} style={{ flexShrink: 0 }} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Station · {authorityStationName}
                </span>
              </span>
            )}
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
            {callChip && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  borderRadius: T.radiusFull,
                  background: callState === 'reconnecting' ? '#fff7e6' : 'rgba(107,91,214,0.1)',
                  color: callState === 'reconnecting' ? T.warning : T.primary,
                  fontSize: T.fontXs,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {callState === 'reconnecting' ? <WifiOff size={11} /> : <Phone size={11} />}
                {callChip}
              </span>
            )}
          </div>
          <span data-chat-presence style={{ display: 'block', fontSize: T.fontXs, color: peerTyping ? T.primary : T.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {peerTyping
              ? 'typing…'
              : conversation.type === 'group'
                ? `${conversation.memberCount} members · ${conversation.detailHint}`
                : `${conversation.online === undefined ? 'Presence unavailable' : conversation.online ? 'Online' : 'Offline'} · ${conversation.detailHint}`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: T.space1, position: 'relative' }}>
          <HeaderIconButton icon={Search} title="Search messages" onClick={() => setSearchOpen(true)} />
          <HeaderIconButton icon={Phone} title="Start voice call" onClick={() => startCall('audio')} />
          <HeaderIconButton icon={Video} title="Start video call" onClick={() => startCall('video')} />
          <HeaderIconButton icon={MoreHorizontal} title="Conversation actions" active={actionsOpen} onClick={() => setActionsOpen((value) => !value)} />
          {actionsOpen && (
            <CallDiagnosticsMenu
              state={callState}
              media={callMedia}
              reason={callReason}
              onState={(state) => {
                setCallState(state);
                setActionsOpen(false);
              }}
              onMedia={setCallMedia}
              onReason={setCallReason}
              onOpenDetail={() => {
                setActionsOpen(false);
                window.setTimeout(onToggleDetail, 0);
              }}
            />
          )}
        </div>
      </div>

      {searchOpen && (
        <div
          style={{
            position: 'absolute',
            inset: `${T.headerHeight}px 0 0`,
            zIndex: 24,
            background: 'rgba(15,23,42,0.28)',
            display: 'flex',
            justifyContent: 'center',
            padding: T.space5,
          }}
        >
          <div style={{ width: 'min(620px, 100%)', alignSelf: 'flex-start', background: T.bg, borderRadius: T.radiusLg, boxShadow: T.shadowLg, padding: T.space4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.space3 }}>
              <strong>Search messages</strong>
              <button type="button" aria-label="Close search" onClick={() => setSearchOpen(false)} style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: T.space2, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: `0 ${T.space3}px`, height: 40 }}>
              <Search size={16} color={T.textTertiary} />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search in messages..." style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent' }} />
              {searchQuery && (
                <button type="button" aria-label="Clear search" onClick={() => setSearchQuery('')} style={{ width: 24, height: 24, border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={14} />
                </button>
              )}
            </div>
            <div style={{ marginTop: T.space3, display: 'flex', flexDirection: 'column', gap: T.space1 }}>
              {searchQuery && searchResults.length === 0 && <span style={{ color: T.textTertiary }}>No messages found</span>}
              {searchResults.map((message) => (
                <button
                  key={message.id}
                  type="button"
                  data-chat-search-result={message.id}
                  onClick={() => jumpToMessage(message)}
                  style={{ border: 'none', background: 'transparent', textAlign: 'left', padding: `${T.space2}px ${T.space2}px`, cursor: 'pointer', color: T.text, borderRadius: T.radiusSm, fontSize: T.fontSm }}
                >
                  {message.content}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesScrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: compact ? `${T.space3}px` : `${T.space4}px ${T.space5}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: T.space2,
          background: backgroundImageUrl
            ? `linear-gradient(rgba(255,255,255,0.72), rgba(255,255,255,0.72)), url("${backgroundImageUrl}") center / cover`
            : conversation.background === 'Graphite' ? '#f7f7f8' : T.bg,
        }}
      >
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
            No messages yet.
          </div>
        )}
        {visibleMessages.map((msg) => (
          <MessageRow
            key={msg.id}
            message={msg}
            isOwn={msg.senderId === 'user-self'}
            compact={compact}
            reactions={reactionsByMessage[msg.id] ?? []}
            recalled={recalledIds.has(msg.id)}
            activeMenu={activeMenuId === msg.id}
            reactionOpen={reactionPickerId === msg.id}
            onRetry={msg.status === 'failed'
              ? () => onRetryMessage(conversation.id, msg.id)
              : undefined}
            onToggleMenu={() => setActiveMenuId((current) => (current === msg.id ? null : msg.id))}
            onToggleReactions={() => setReactionPickerId((current) => (current === msg.id ? null : msg.id))}
            onReact={(emoji) => toggleReaction(msg.id, emoji)}
            onAction={(action) => handleMessageAction(msg, action)}
            replyTarget={msg.replyTo ? (visibleMessages.find((candidate) => candidate.id === msg.replyTo) ?? null) : null}
            threadCount={threadReplies[msg.id]?.length ?? 0}
            onOpenThread={() => setThreadRoot(msg)}
            pinned={pinnedIds.has(msg.id)}
            highlighted={highlightedId === msg.id}
          />
        ))}
        {peerTyping && !searchQuery.trim() ? (
          <TypingBubble peerName={conversation.type === 'friend' ? conversation.name : undefined} compact={compact} />
        ) : null}
      </div>

      {/* Input */}
      <div
        style={{
          padding: compact ? `${T.space2}px ${T.space3}px ${T.space3}px` : `${T.space3}px ${T.space5}px ${T.space4}px`,
          borderTop: `1px solid ${T.border}`,
          position: 'relative',
        }}
      >
        {editingId ? (
          <div
            data-chat-edit-banner
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 6, padding: '6px 10px',
              borderLeft: `3px solid ${T.warning}`,
              background: T.bgSubtle, borderRadius: T.radiusSm,
            }}
          >
            <Pencil size={14} color={T.warning} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: T.fontXs, fontWeight: 700, color: T.warning }}>
                Editing message
              </div>
              <div style={{ fontSize: T.fontXs, color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {messages.find((item) => item.id === editingId)?.content ?? inputValue}
              </div>
            </div>
            <button
              type="button"
              aria-label="Cancel edit"
              data-chat-cancel-edit
              onClick={cancelEdit}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: T.textTertiary }}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
        {replyTo && !editingId ? (
          <div
            data-chat-reply-banner
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 6, padding: '6px 10px',
              borderLeft: `3px solid ${T.primary}`,
              background: T.bgSubtle, borderRadius: T.radiusSm,
            }}
          >
            <CornerUpLeft size={14} color={T.primary} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: T.fontXs, fontWeight: 700, color: T.primary }}>
                Replying to {USERS[replyTo.senderId]?.name ?? 'message'}
              </div>
              <div style={{ fontSize: T.fontXs, color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {replyTo.content || replyTo.attachmentName || ''}
              </div>
            </div>
            <button
              type="button"
              aria-label="Cancel reply"
              onClick={() => setReplyTo(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: T.textTertiary }}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
        <div
          style={{
            position: 'relative',
            background: T.bg,
            border: '1px solid transparent',
            borderRadius: 14,
            boxShadow: '0 1px 3px rgba(15,23,42,0.08), 0 4px 16px rgba(15,23,42,0.06)',
            overflow: 'visible',
          }}
        >
          {emojiOpen ? (
            <div
              data-chat-emoji-picker
              style={{
                position: 'absolute',
                left: 0,
                bottom: 46,
                width: 420,
                maxWidth: '70vw',
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                background: T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: 12,
                boxShadow: '0 16px 44px rgba(15,23,42,0.22)',
                zIndex: 30,
              }}
            >
              {recentEmojis.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 13, color: T.textSecondary }}>Recent</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {recentEmojis.map((emoji) => (
                      <button
                        key={`recent-${emoji}`}
                        type="button"
                        aria-label={`Insert ${emoji}`}
                        onClick={() => insertComposerEmoji(emoji)}
                        style={{ width: 32, height: 32, border: 0, borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 21 }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13, color: T.textSecondary }}>All emojis</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {COMPOSER_EMOJI_GROUPS.flat().map((emoji) => (
                    <button
                      key={`all-${emoji}`}
                      type="button"
                      aria-label={`Insert ${emoji}`}
                      data-chat-composer-emoji={emoji}
                      onClick={() => insertComposerEmoji(emoji)}
                      style={{ width: 32, height: 32, border: 0, borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 21 }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  borderTop: `1px solid ${T.borderSubtle}`, paddingTop: 8,
                }}
              >
                <Smile size={18} color={T.textQuaternary} />
                <span style={{ fontSize: 12, color: T.textQuaternary }}>Emoji</span>
              </div>
            </div>
          ) : null}
          {pendingAttachment ? (
            <div
              data-chat-pending-attachment
              style={{
                margin: '8px 12px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px 6px 10px',
                borderRadius: 10,
                background: T.bgSubtle,
                border: `1px solid ${T.borderSubtle}`,
              }}
            >
              {pendingAttachment.type.startsWith('image/')
                ? <ImageIcon size={16} color={T.primary} />
                : <FileText size={16} color={T.primary} />}
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: T.fontSm, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pendingAttachment.name}
                </span>
                <span style={{ display: 'block', fontSize: T.fontXs, color: T.textTertiary }}>
                  {(pendingAttachment.size / 1024).toFixed(1)} KB
                </span>
              </span>
              <button
                type="button"
                aria-label="Remove attachment"
                onClick={() => setPendingAttachment(null)}
                style={{ border: 'none', background: 'transparent', color: T.textTertiary, cursor: 'pointer', display: 'flex', padding: 2 }}
              >
                <X size={15} />
              </button>
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={inputValue}
            rows={3}
            onChange={(event) => setInputValue(event.target.value)}
            onInput={resizeTextarea}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !composingRef.current) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={editingId
              ? 'Edit message…'
              : conversation.type === 'group' ? 'Message the group...' : 'Send a message...'}
            aria-label={editingId ? 'Edit message composer' : 'Message composer'}
            data-chat-composer-mode={editingId ? 'editing' : 'compose'}
            style={{
              display: 'block',
              width: '100%',
              minHeight: 74,
              maxHeight: inputExpanded ? 320 : 180,
              resize: 'none',
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
              padding: '12px 14px 6px',
              background: 'transparent',
              color: T.text,
              caretColor: T.primary,
              font: 'inherit',
              fontSize: T.fontBase,
              lineHeight: 1.55,
              overflowY: 'auto',
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: 40,
              padding: '0 8px 6px',
              background: T.bg,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <ComposerToolButton
                label="Emoji"
                active={emojiOpen}
                onClick={() => setEmojiOpen((value) => !value)}
              >
                <Smile size={20} />
              </ComposerToolButton>
              <ComposerToolButton label="File" onClick={() => fileInputRef.current?.click()}>
                <FolderOpen size={20} />
              </ComposerToolButton>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                data-chat-file-input
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) setPendingAttachment(file);
                  event.target.value = '';
                }}
              />
              <ComposerToolButton label="Screenshot" onClick={() => showToast('Screenshot capture runs in the desktop app')}>
                <Scissors size={20} />
              </ComposerToolButton>
              <ComposerToolButton label="Voice message" onClick={() => showToast('Voice recording runs in the desktop app')}>
                <Mic size={20} />
              </ComposerToolButton>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ComposerToolButton
                label={inputExpanded ? 'Collapse input' : 'Expand input'}
                active={inputExpanded}
                ariaPressed={inputExpanded}
                onClick={() => setInputExpanded((value) => !value)}
              >
                {inputExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </ComposerToolButton>
              <button
                type="button"
                data-chat-send
                data-chat-edit-send={editingId ? 'true' : undefined}
                aria-label={editingId ? 'Save changes' : 'Send'}
                title={editingId
                  ? (inputValue.trim() ? 'Save changes' : 'Message cannot be empty')
                  : (inputValue.trim() || pendingAttachment ? 'Send' : 'Type a message to send')}
                disabled={editingId ? !inputValue.trim() : !inputValue.trim() && !pendingAttachment}
                onClick={send}
                style={{
                  width: 34,
                  height: 34,
                  border: 0,
                  borderRadius: 8,
                  background: inputValue.trim() || (!editingId && pendingAttachment) ? T.primary : T.bgActive,
                  color: inputValue.trim() || (!editingId && pendingAttachment) ? '#fff' : T.textQuaternary,
                  cursor: inputValue.trim() || (!editingId && pendingAttachment) ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {editingId ? <Check size={18} /> : <Send size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>
      {(callState === 'incoming' || callState === 'ringing_all_devices') && (
        <IncomingCallModal
          conversation={conversation}
          media={callMedia}
          multiDevice={callState === 'ringing_all_devices'}
          onAccept={() => setCallState(callState === 'ringing_all_devices' ? 'active_here' : 'active')}
          onReject={() => {
            setCallReason('rejected');
            setCallState('ended');
          }}
          onHandledElsewhere={() => setCallState('handled_elsewhere')}
        />
      )}
      {(callState === 'outgoing' || callState === 'active' || callState === 'active_here' || callState === 'reconnecting') && (
        <CallHud
          conversation={conversation}
          state={callState}
          media={callMedia}
          duration={duration}
          micOn={micOn}
          camOn={camOn}
          audioDevice={audioDevice}
          videoDevice={videoDevice}
          onToggleMic={() => setMicOn((value) => !value)}
          onToggleCam={() => setCamOn((value) => !value)}
          onAudioDevice={setAudioDevice}
          onVideoDevice={setVideoDevice}
          onHangup={() => {
            setCallReason(callState === 'outgoing' ? 'canceled' : 'hangup');
            setCallState('ended');
          }}
          onPeerAccept={() => setCallState('active')}
          onSimWeak={() => setCallState(callState === 'reconnecting' ? 'active_here' : 'reconnecting')}
        />
      )}
      {callState === 'handled_elsewhere' && (
        <HandledElsewhereToast onClose={() => setCallState('idle')} />
      )}
      {callState === 'ended' && (
        <CallResultToast reason={callReason} duration={duration} onClose={() => setCallState('idle')} />
      )}
      {callState === 'failed' && (
        <CallResultToast
          reason={callReason === 'hangup' ? 'network' : callReason}
          duration={duration}
          onClose={() => setCallState('idle')}
        />
      )}

      {/* Thread side panel */}
      {threadRoot ? (
        <div
          role="dialog"
          aria-label="Thread"
          data-chat-thread-panel
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 360,
            maxWidth: '88%', zIndex: 45,
            background: T.bg, borderLeft: `1px solid ${T.border}`,
            boxShadow: '-12px 0 32px rgba(15,23,42,0.14)',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <div
            style={{
              height: T.headerHeight, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: `0 ${T.space4}px`, borderBottom: `1px solid ${T.border}`,
            }}
          >
            <strong style={{ fontSize: T.fontLg }}>Thread</strong>
            <button
              type="button"
              aria-label="Close thread"
              onClick={() => setThreadRoot(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: T.textSecondary, width: 28, height: 28 }}
            >
              <X size={16} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: T.space4 }}>
            <MessageBubble
              message={threadRoot}
              isOwn={threadRoot.senderId === 'user-self'}
              compact
              replyTarget={threadRoot.replyTo ? (visibleMessages.find((candidate) => candidate.id === threadRoot.replyTo) ?? null) : null}
            />
            <div style={{ borderTop: `1px solid ${T.borderSubtle}`, margin: `${T.space3}px 0` }} />
            {(threadReplies[threadRoot.id] ?? []).length === 0 ? (
              <div style={{ color: T.textTertiary, fontSize: T.fontSm, textAlign: 'center', padding: `${T.space4}px 0` }}>
                No replies yet
              </div>
            ) : (
              (threadReplies[threadRoot.id] ?? []).map((reply) => (
                <MessageBubble key={reply.id} message={reply} isOwn compact />
              ))
            )}
          </div>
          <div
            style={{
              flexShrink: 0, padding: `${T.space2}px ${T.space3}px ${T.space3}px`,
              borderTop: `1px solid ${T.border}`,
              display: 'flex', alignItems: 'flex-end', gap: T.space2,
              background: T.bg,
            }}
          >
            <textarea
              value={threadDraft}
              onChange={(event) => setThreadDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitThreadReply();
                }
              }}
              placeholder="Reply in thread…"
              aria-label="Thread reply"
              rows={1}
              style={{
                flex: 1, resize: 'none', border: 'none', outline: 'none',
                background: T.bgMuted, borderRadius: 10, padding: '8px 12px',
                font: 'inherit', fontSize: T.fontBase, color: T.text,
                maxHeight: 100,
              }}
            />
            <button
              type="button"
              aria-label="Send thread reply"
              disabled={!threadDraft.trim()}
              onClick={submitThreadReply}
              style={{
                width: 34, height: 34, border: 0, borderRadius: 8,
                background: threadDraft.trim() ? T.primary : T.bgActive,
                color: threadDraft.trim() ? '#fff' : T.textQuaternary,
                cursor: threadDraft.trim() ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      ) : null}

      {/* Forward picker */}
      {forwardMessage ? (
        <div
          role="presentation"
          onClick={() => setForwardMessage(null)}
          style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(15,23,42,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Forward message"
            onClick={(event) => event.stopPropagation()}
            style={{ width: 360, maxWidth: 'calc(100% - 40px)', background: T.bg, borderRadius: 14, border: `1px solid ${T.border}`, boxShadow: '0 20px 52px rgba(15,23,42,0.28)', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
              <strong style={{ fontSize: 15 }}>Forward to…</strong>
              <button type="button" aria-label="Close forward" onClick={() => setForwardMessage(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: T.textTertiary }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', padding: 6 }}>
              {conversations.filter((item) => item.id !== conversation?.id).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-chat-forward-target={item.id}
                  onClick={() => {
                    setForwardMessage(null);
                    showToast(`Forwarded to ${item.name}`);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', border: 'none', background: 'transparent', borderRadius: 10, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
                >
                  <Avatar identityKey={item.id} name={item.name} size={34} groupIcon={item.type === 'group'} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 13, color: T.text }}>{item.name}</strong>
                    <span style={{ fontSize: 11, color: T.textTertiary }}>{item.type === 'group' ? `${item.memberCount ?? 0} members` : item.online ? 'Online' : 'Offline'}</span>
                  </span>
                  <Forward size={14} color={T.textQuaternary} />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete confirm */}
      {deleteTarget ? (
        <div
          role="presentation"
          onClick={() => setDeleteTarget(null)}
          style={{ position: 'absolute', inset: 0, zIndex: 62, background: 'rgba(15,23,42,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Delete message"
            onClick={(event) => event.stopPropagation()}
            style={{ width: 340, maxWidth: 'calc(100% - 40px)', background: T.bg, borderRadius: 14, border: `1px solid ${T.border}`, padding: 18 }}
          >
            <strong style={{ fontSize: 15, display: 'block', marginBottom: 6 }}>Delete message for me?</strong>
            <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.5, marginBottom: 14 }}>
              This removes the message from this device only. Other participants keep their copy.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setDeleteTarget(null)} style={{ height: 32, padding: '0 14px', border: `1px solid ${T.border}`, borderRadius: 8, background: T.bg, color: T.text, font: 'inherit', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                type="button"
                data-chat-confirm-delete
                onClick={() => {
                  setDeletedIds((prev) => new Set(prev).add(deleteTarget.id));
                  if (threadRoot?.id === deleteTarget.id) setThreadRoot(null);
                  setDeleteTarget(null);
                  showToast('Message deleted on this device');
                }}
                style={{ height: 32, padding: '0 14px', border: 'none', borderRadius: 8, background: T.danger, color: '#fff', font: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Lightweight action toast */}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          style={{ position: 'absolute', bottom: 84, left: '50%', transform: 'translateX(-50%)', zIndex: 70, background: 'rgba(31,35,41,0.92)', color: '#fff', fontSize: 12, padding: '7px 14px', borderRadius: 999, pointerEvents: 'none' }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
