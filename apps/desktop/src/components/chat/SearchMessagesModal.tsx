import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Input } from '@lobehub/ui';
import { Button, Empty, Modal, Spin, Tag, Typography, theme } from 'antd';
import { ArrowRight, FileText, Image as ImageIcon, MessageSquare, MessagesSquare, Music, Search, Users, Video } from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import type { SearchResult } from '../../store/socialChat';
import { log } from '../../utils/logger';

const { Text } = Typography;

type SearchFilter = 'all' | 'messages' | 'threads' | 'files';
type ResultKind = 'message' | 'thread' | 'file' | 'image' | 'audio' | 'video';

interface DecoratedSearchResult {
  fileKind: Exclude<ResultKind, 'message' | 'thread'> | null;
  isThread: boolean;
  result: SearchResult;
  senderLabel: string;
}

const MESSAGE_TYPE_IMAGE = 2;
const MESSAGE_TYPE_FILE = 3;
const MESSAGE_TYPE_AUDIO = 4;
const MESSAGE_TYPE_VIDEO = 5;

const IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mov', 'mp4', 'mpeg', 'webm']);
const STANDALONE_FILENAME_PATTERN = /^[^/\n\r]{1,160}\.[a-z0-9]{2,8}$/i;

function formatSentAt(epochSec: number, t: (key: string, opts?: { count?: number }) => string): string {
  const d = new Date(epochSec * 1000);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return t('chat.social.time.justNow');
  if (minutes < 60) return t('chat.social.time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('chat.social.time.hoursAgo', { count: hours });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function highlightMatch(content: string, query: string, warningBg: string): ReactNode {
  if (!query.trim()) return content;
  const lower = content.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) {
    return content.length > 120 ? `${content.slice(0, 120)}…` : content;
  }
  const start = Math.max(0, idx - 30);
  const prefix = start > 0 ? '…' : '';
  const before = content.slice(start, idx);
  const match = content.slice(idx, idx + query.length);
  const afterRaw = content.slice(idx + query.length);
  const after = afterRaw.length > 60 ? `${afterRaw.slice(0, 60)}…` : afterRaw;
  return (
    <>
      {prefix}
      {before}
      <span style={{ backgroundColor: warningBg, fontWeight: 600 }}>{match}</span>
      {after}
    </>
  );
}

function shortDid(did: string): string {
  if (!did) return '';
  return did.length > 18 ? `${did.slice(0, 8)}...${did.slice(-6)}` : did;
}

function filenameExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function fileKindFromMimeOrFilename(
  mimeType: string | undefined,
  filename: string | undefined,
): Exclude<ResultKind, 'message' | 'thread'> | null {
  const lowerMime = mimeType?.toLowerCase() ?? '';
  if (lowerMime.startsWith('image/')) return 'image';
  if (lowerMime.startsWith('audio/')) return 'audio';
  if (lowerMime.startsWith('video/')) return 'video';
  if (lowerMime) return 'file';

  const ext = filenameExtension(filename ?? '');
  if (!ext) return null;
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return 'file';
}

function fileKindFromMessageType(messageType: number | undefined): Exclude<ResultKind, 'message' | 'thread'> | null {
  switch (messageType) {
    case MESSAGE_TYPE_IMAGE:
      return 'image';
    case MESSAGE_TYPE_FILE:
      return 'file';
    case MESSAGE_TYPE_AUDIO:
      return 'audio';
    case MESSAGE_TYPE_VIDEO:
      return 'video';
    default:
      return null;
  }
}

function fileKindFromContent(content: string): Exclude<ResultKind, 'message' | 'thread'> | null {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();
  if (lower === '[image]' || trimmed === '[图片]') return 'image';
  if (lower === '[audio]' || trimmed === '[语音]') return 'audio';
  if (lower === '[video]' || trimmed === '[视频]') return 'video';
  if (lower === '[file]' || trimmed === '[文件]') return 'file';
  if (!STANDALONE_FILENAME_PATTERN.test(trimmed)) return null;
  return fileKindFromMimeOrFilename(undefined, trimmed);
}

function fileKindForResult(result: SearchResult): Exclude<ResultKind, 'message' | 'thread'> | null {
  const fromType = fileKindFromMessageType(result.messageType);
  if (fromType) return fromType;
  for (const attachment of result.attachments) {
    const fromAttachment = fileKindFromMimeOrFilename(attachment.mimeType, attachment.filename);
    if (fromAttachment) return fromAttachment;
  }
  return fileKindFromContent(result.content);
}

function isThreadResult(result: SearchResult): boolean {
  return Boolean(
    result.threadRootUlid
      || result.replyToUlid
      || (result.threadReplyCount ?? 0) > 0
      || result.hasLoadedThreadReplies,
  );
}

function primaryKindForResult(item: DecoratedSearchResult): ResultKind {
  if (item.fileKind) return item.fileKind;
  return item.isThread ? 'thread' : 'message';
}

function resultKindIcon(kind: ResultKind): ReactNode {
  switch (kind) {
    case 'thread':
      return <MessagesSquare size={13} />;
    case 'image':
      return <ImageIcon size={13} />;
    case 'audio':
      return <Music size={13} />;
    case 'video':
      return <Video size={13} />;
    case 'file':
      return <FileText size={13} />;
    case 'message':
    default:
      return <MessageSquare size={13} />;
  }
}

function resultKindColor(kind: ResultKind): string | undefined {
  switch (kind) {
    case 'thread':
      return 'blue';
    case 'image':
      return 'green';
    case 'audio':
    case 'video':
      return 'magenta';
    case 'file':
      return 'purple';
    default:
      return undefined;
  }
}

export interface SearchMessagesModalProps {
  open: boolean;
  onClose: () => void;
  /** Limit search to friend or group scope; omit to search both. */
  initialScope?: string;
  /** Limit search to this conversation ULID (session or group). */
  conversationId?: string;
}

export function SearchMessagesModal({
  open,
  onClose,
  initialScope,
  conversationId,
}: SearchMessagesModalProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [localQuery, setLocalQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<SearchFilter>('all');
  const {
    currentUserDid,
    groupMembers,
    searchQuery,
    searchResults,
    searchLoading,
    searchMessages,
    clearSearch,
    selectSession,
    selectGroup,
    setActiveTab,
    setScrollToMessageUlid,
  } = useSocialChatStore();

  useEffect(() => {
    if (!open) return;
    setLocalQuery('');
    setActiveFilter('all');
    clearSearch();
  }, [open, clearSearch]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      void searchMessages(localQuery.trim(), initialScope, conversationId).catch((err) => {
        log.error('SearchMessagesModal', 'searchMessages', err);
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [localQuery, open, initialScope, conversationId, searchMessages]);

  const handleClose = useCallback(() => {
    clearSearch();
    setLocalQuery('');
    onClose();
  }, [clearSearch, onClose]);

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      setScrollToMessageUlid(result.messageId);
      if (result.scope === 'friend') {
        selectSession(result.conversationId);
        setActiveTab('friend');
      } else {
        selectGroup(result.conversationId);
        setActiveTab('group');
      }
      handleClose();
    },
    [selectSession, selectGroup, setActiveTab, setScrollToMessageUlid, handleClose],
  );

  const decoratedResults = useMemo<DecoratedSearchResult[]>(
    () => searchResults.map((result) => {
      const member = result.scope === 'group'
        ? groupMembers[result.conversationId]?.find((item) => item.actorDid === result.senderDid)
        : undefined;
      const senderLabel = result.senderDid === currentUserDid
        ? t('chat.social.thread.you')
        : result.scope === 'friend'
          ? result.conversationName
          : member?.nickname || shortDid(result.senderDid) || t('chat.social.search.senderUnknown');
      return {
        fileKind: fileKindForResult(result),
        isThread: isThreadResult(result),
        result,
        senderLabel,
      };
    }),
    [currentUserDid, groupMembers, searchResults, t],
  );

  const filterCounts = useMemo(
    () => decoratedResults.reduce(
      (counts, item) => {
        counts.all += 1;
        if (item.fileKind) {
          counts.files += 1;
        } else if (item.isThread) {
          counts.threads += 1;
        } else {
          counts.messages += 1;
        }
        return counts;
      },
      { all: 0, files: 0, messages: 0, threads: 0 } as Record<SearchFilter, number>,
    ),
    [decoratedResults],
  );

  const filteredResults = useMemo(
    () => decoratedResults.filter((item) => {
      if (activeFilter === 'all') return true;
      if (activeFilter === 'files') return item.fileKind !== null;
      if (activeFilter === 'threads') return item.fileKind === null && item.isThread;
      return item.fileKind === null && !item.isThread;
    }),
    [activeFilter, decoratedResults],
  );

  const filterOptions: Array<{ key: SearchFilter; label: string }> = [
    { key: 'all', label: t('chat.social.search.filter.all') },
    { key: 'messages', label: t('chat.social.search.filter.messages') },
    { key: 'threads', label: t('chat.social.search.filter.threads') },
    { key: 'files', label: t('chat.social.search.filter.files') },
  ];

  const kindLabel = (kind: ResultKind): string => t(`chat.social.search.type.${kind}`);
  const scopeLabel = (r: SearchResult): string =>
    t(r.scope === 'friend' ? 'chat.social.search.scope.friend' : 'chat.social.search.scope.group');

  return (
    <Modal
      title={
        <Flexbox horizontal align="center" gap={8}>
          <Search size={18} />
          {t('chat.social.search.title')}
        </Flexbox>
      }
      open={open}
      onCancel={handleClose}
      footer={null}
      width={640}
      destroyOnClose
    >
      <Flexbox gap={12}>
        <Input
          allowClear
          prefix={<Search size={16} style={{ color: token.colorTextQuaternary }} />}
          placeholder={t('chat.social.search.placeholder')}
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
        />
        {searchLoading ? (
          <Flexbox align="center" justify="center" style={{ minHeight: 200 }}>
            <Spin />
          </Flexbox>
        ) : searchQuery.trim() && searchResults.length === 0 ? (
          <Empty description={t('chat.social.search.noResults')} />
        ) : (
          <>
            {searchResults.length > 0 && (
              <>
                <Flexbox horizontal align="center" justify="space-between" gap={8}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('chat.social.search.resultCount', { count: filteredResults.length })}
                  </Text>
                </Flexbox>
                <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
                  {filterOptions.map((option) => (
                    <Button
                      key={option.key}
                      size="small"
                      type={activeFilter === option.key ? 'primary' : 'default'}
                      onClick={() => setActiveFilter(option.key)}
                    >
                      {option.label} {filterCounts[option.key]}
                    </Button>
                  ))}
                </Flexbox>
              </>
            )}
            {searchResults.length > 0 && filteredResults.length === 0 ? (
              <Empty description={t('chat.social.search.noFilterResults')} />
            ) : searchResults.length > 0 ? (
              <Flexbox
                gap={0}
                style={{
                  maxHeight: 390,
                  overflow: 'auto',
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadius,
                }}
              >
                {filteredResults.map((item) => {
                  const r = item.result;
                  const kind = primaryKindForResult(item);
                  return (
                    <Flexbox
                      key={`${r.scope}-${r.conversationId}-${r.messageId}`}
                      horizontal
                      align="flex-start"
                      gap={10}
                      style={{
                        padding: '12px',
                        cursor: 'pointer',
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                      }}
                      onClick={() => handleResultClick(r)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleResultClick(r);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <Flexbox
                        align="center"
                        justify="center"
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 9,
                          background: token.colorFillTertiary,
                          flexShrink: 0,
                          color: token.colorTextSecondary,
                        }}
                      >
                        {r.scope === 'friend' ? <MessageSquare size={16} /> : <Users size={16} />}
                      </Flexbox>
                      <Flexbox style={{ minWidth: 0, flex: 1 }} gap={5}>
                        <Flexbox horizontal align="center" justify="space-between" gap={8}>
                          <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0, flex: 1 }}>
                            <Text strong ellipsis style={{ fontSize: 13, minWidth: 0 }}>
                              {r.conversationName}
                            </Text>
                            <Tag style={{ marginInlineEnd: 0 }}>{scopeLabel(r)}</Tag>
                            <Tag
                              color={resultKindColor(kind)}
                              icon={resultKindIcon(kind)}
                              style={{ marginInlineEnd: 0 }}
                            >
                              {kindLabel(kind)}
                            </Tag>
                          </Flexbox>
                          <Button
                            size="small"
                            type="link"
                            icon={<ArrowRight size={13} />}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleResultClick(r);
                            }}
                          >
                            {t('chat.social.search.jump')}
                          </Button>
                        </Flexbox>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {item.senderLabel} - {formatSentAt(r.sentAt, t)}
                        </Text>
                        <Text style={{ fontSize: 13, lineHeight: 1.45, wordBreak: 'break-word' }}>
                          {highlightMatch(r.content, searchQuery, token.colorWarningBg)}
                        </Text>
                      </Flexbox>
                    </Flexbox>
                  );
                })}
              </Flexbox>
            ) : (
              <Flexbox
                align="center"
                justify="center"
                style={{
                  minHeight: 120,
                  color: token.colorTextQuaternary,
                  border: `1px dashed ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadius,
                }}
              >
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {t('chat.social.search.startTyping')}
                </Text>
              </Flexbox>
            )}
          </>
        )}
      </Flexbox>
    </Modal>
  );
}
