import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  MessagesSquare,
  Music,
  Search,
  Users,
  Video,
  X,
} from 'lucide-react';
import { T } from '../theme';
import type { MockConversation, MockMessage } from '../mock';

type SearchFilter = 'all' | 'messages' | 'threads' | 'files';
type ResultKind = 'message' | 'thread' | 'file' | 'image' | 'audio' | 'video';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi']);

export interface SearchResultItem {
  conversationId: string;
  conversationName: string;
  scope: 'friend' | 'group';
  messageId: string;
  content: string;
  senderId: string;
  timestamp: number;
  kind: ResultKind;
  isThread: boolean;
  threadCount: number;
}

interface SearchMessagesModalProps {
  open: boolean;
  onClose: () => void;
  conversations: MockConversation[];
  messagesByConversation: Record<string, MockMessage[]>;
  senderName: (senderId: string) => string;
  /** Restrict to one conversation; omit for global search. */
  conversationId?: string;
  onJump: (conversationId: string, messageId: string) => void;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function kindForMessage(message: MockMessage): Exclude<ResultKind, 'message' | 'thread'> | null {
  if (message.type === 'image') return 'image';
  if (message.type === 'voice') return 'audio';
  if (message.type === 'file') {
    const ext = extensionOf(message.attachmentName ?? '');
    if (IMAGE_EXT.has(ext)) return 'image';
    if (AUDIO_EXT.has(ext)) return 'audio';
    if (VIDEO_EXT.has(ext)) return 'video';
    return 'file';
  }
  return null;
}

function formatTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(epochMs).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function highlight(content: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return content;
  const lower = content.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx < 0) return content.length > 140 ? `${content.slice(0, 140)}…` : content;
  const start = Math.max(0, idx - 28);
  return (
    <>
      {start > 0 ? '…' : ''}
      {content.slice(start, idx)}
      <mark style={{ background: T.warning, color: '#1f2329', borderRadius: 3, padding: '0 2px' }}>
        {content.slice(idx, idx + q.length)}
      </mark>
      {content.slice(idx + q.length, idx + q.length + 64)}
      {idx + q.length + 64 < content.length ? '…' : ''}
    </>
  );
}

function kindMeta(kind: ResultKind): { label: string; color: string; icon: ReactNode } {
  switch (kind) {
    case 'thread':
      return { label: 'Thread', color: 'blue', icon: <MessagesSquare size={12} /> };
    case 'image':
      return { label: 'Image', color: 'green', icon: <ImageIcon size={12} /> };
    case 'audio':
      return { label: 'Audio', color: 'magenta', icon: <Music size={12} /> };
    case 'video':
      return { label: 'Video', color: 'magenta', icon: <Video size={12} /> };
    case 'file':
      return { label: 'File', color: 'purple', icon: <FileText size={12} /> };
    default:
      return { label: 'Message', color: 'default', icon: <MessageSquare size={12} /> };
  }
}

export function SearchMessagesModal({
  open,
  onClose,
  conversations,
  messagesByConversation,
  senderName,
  conversationId,
  onJump,
}: SearchMessagesModalProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setFilter('all');
      const id = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const scopedConversations = useMemo(
    () => (conversationId ? conversations.filter((c) => c.id === conversationId) : conversations),
    [conversations, conversationId],
  );

  const results = useMemo<SearchResultItem[]>(() => {
    const needle = query.trim().toLowerCase();
    const items: SearchResultItem[] = [];
    scopedConversations.forEach((conversation) => {
      const messages = messagesByConversation[conversation.id] ?? [];
      messages.forEach((message) => {
        if (message.type === 'system') return;
        const haystack = [message.content, message.attachmentName ?? '']
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (needle && !haystack.includes(needle)) return;
        const fileKind = kindForMessage(message);
        const isThread = Boolean(message.replyTo);
        items.push({
          conversationId: conversation.id,
          conversationName: conversation.name,
          scope: conversation.type,
          messageId: message.id,
          content: message.type === 'file' || message.type === 'image'
            ? (message.attachmentName || message.content || '')
            : message.content,
          senderId: message.senderId,
          timestamp: message.timestamp,
          kind: fileKind ?? (isThread ? 'thread' : 'message'),
          isThread,
          threadCount: isThread ? 1 : 0,
        });
      });
    });
    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [query, scopedConversations, messagesByConversation]);

  const counts = useMemo(() => results.reduce(
    (acc, item) => {
      acc.all += 1;
      if (item.kind !== 'message' && item.kind !== 'thread') acc.files += 1;
      else if (item.isThread) acc.threads += 1;
      else acc.messages += 1;
      return acc;
    },
    { all: 0, messages: 0, threads: 0, files: 0 } as Record<SearchFilter, number>,
  ), [results]);

  const filtered = useMemo(() => results.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'files') return item.kind !== 'message' && item.kind !== 'thread';
    if (filter === 'threads') return item.kind === 'thread';
    return item.kind === 'message';
  }), [results, filter]);

  if (!open) return null;

  const hasQuery = query.trim().length > 0;
  const filters: { key: SearchFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'messages', label: 'Messages' },
    { key: 'threads', label: 'Threads' },
    { key: 'files', label: 'Files/Media' },
  ];

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(15,23,42,0.32)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 120,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search Messages"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 640, maxWidth: 'calc(100vw - 48px)',
          background: T.bg, borderRadius: 16,
          boxShadow: '0 24px 64px rgba(15,23,42,0.28)',
          border: `1px solid ${T.border}`,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '16px 18px 12px',
          }}
        >
          <Search size={18} color={T.text} />
          <strong style={{ fontSize: 16, color: T.text, flex: 1 }}>Search Messages</strong>
          <button
            type="button"
            aria-label="Close search"
            onClick={onClose}
            style={{
              width: 28, height: 28, border: 'none', background: 'transparent',
              borderRadius: 8, cursor: 'pointer', color: T.textTertiary,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '0 18px 12px' }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              border: `1px solid ${T.border}`, borderRadius: 10,
              background: T.bgSubtle, padding: '0 12px', height: 40,
            }}
          >
            <Search size={16} color={T.textQuaternary} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search in messages..."
              aria-label="Search in messages"
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 14, color: T.text,
              }}
            />
            {hasQuery ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                style={{
                  width: 22, height: 22, border: 'none', background: 'transparent',
                  color: T.textTertiary, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>

        <div style={{ padding: '0 18px', minHeight: 420, display: 'flex', flexDirection: 'column' }}>
          {hasQuery && results.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {filters.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={filter === option.key}
                  onClick={() => setFilter(option.key)}
                  style={{
                    height: 28, padding: '0 12px', borderRadius: 8,
                    border: `1px solid ${filter === option.key ? T.primary : T.border}`,
                    background: filter === option.key ? T.primary : T.bg,
                    color: filter === option.key ? T.textOnPrimary : T.textSecondary,
                    font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {option.label} {counts[option.key]}
                </button>
              ))}
            </div>
          ) : null}

          <div
            style={{
              flex: 1, overflowY: 'auto',
              border: filtered.length ? `1px solid ${T.border}` : `1px dashed ${T.border}`,
              borderRadius: 10, marginBottom: 18,
            }}
          >
            {!hasQuery ? (
              <div
                style={{
                  minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: T.textTertiary, fontSize: 13,
                }}
              >
                Start typing to search messages.
              </div>
            ) : filtered.length === 0 ? (
              <div
                style={{
                  minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: T.textTertiary, fontSize: 13,
                }}
              >
                No messages found
              </div>
            ) : (
              filtered.map((item) => {
                const meta = kindMeta(item.kind);
                return (
                  <button
                    key={`${item.conversationId}-${item.messageId}`}
                    type="button"
                    data-messaging-search-result
                    data-messaging-search-conversation-id={item.conversationId}
                    data-messaging-search-message-id={item.messageId}
                    onClick={() => onJump(item.conversationId, item.messageId)}
                    style={{
                      display: 'flex', gap: 10, width: '100%', textAlign: 'left',
                      padding: 12, border: 'none', borderBottom: `1px solid ${T.borderSubtle}`,
                      background: 'transparent', cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    <span
                      style={{
                        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                        background: T.bgMuted, color: T.textSecondary,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {item.scope === 'friend' ? <MessageSquare size={16} /> : <Users size={16} />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong style={{ fontSize: 13, color: T.text }}>{item.conversationName}</strong>
                        <span
                          style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                            background: item.scope === 'friend' ? '#eef2ff' : '#ecfdf5',
                            color: item.scope === 'friend' ? '#4338ca' : '#047857',
                          }}
                        >
                          {item.scope === 'friend' ? 'Direct' : 'Group'}
                        </span>
                        <span
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                            background: T.bgMuted, color: T.textSecondary,
                          }}
                        >
                          {meta.icon}
                          {meta.label}
                        </span>
                        <span style={{ flex: 1 }} />
                        <ArrowRight size={13} color={T.primary} />
                      </span>
                      <span style={{ fontSize: 11, color: T.textTertiary }}>
                        {senderName(item.senderId)} · {formatTime(item.timestamp)}
                      </span>
                      <span style={{ fontSize: 13, lineHeight: 1.45, color: T.text, wordBreak: 'break-word' }}>
                        {highlight(item.content, query)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
