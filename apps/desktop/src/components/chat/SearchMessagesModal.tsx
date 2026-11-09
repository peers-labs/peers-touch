import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  Empty as PtEmpty,
  IconButton,
  Segmented as PtSegmented,
  Spin as PtSpin,
  Tag as PtTag,
  TextField as PtTextField,
  type Tone,
} from '@peers-touch/ui';
import {
  ArrowRight, FileText, Image as ImageIcon, MessageSquare, MessagesSquare, Music, Search, SearchX, Users, Video,
} from 'lucide-react';
import { useActiveSocialChatSlice } from './useActiveSocialChatStore';
import type { SearchResult } from '../../store/socialChat';
import { actorDisplayName, resolveActorIdentity } from '../../store/socialProfileProjection';
import { log } from '../../utils/logger';

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

function formatSentAt(epochMsOrSec: number, t: (key: string, opts?: { count?: number }) => string): string {
  const epochMs = epochMsOrSec > 10_000_000_000 ? epochMsOrSec : epochMsOrSec * 1000;
  const d = new Date(epochMs);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return t('chat.social.time.justNow');
  if (minutes < 60) return t('chat.social.time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('chat.social.time.hoursAgo', { count: hours });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function highlightMatch(content: string, query: string): ReactNode {
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
      <mark className="sc-search__highlight">{match}</mark>
      {after}
    </>
  );
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

function resultKindTone(kind: ResultKind): Tone {
  switch (kind) {
    case 'thread':
      return 'info';
    case 'image':
      return 'success';
    case 'audio':
    case 'video':
      return 'danger';
    default:
      return 'neutral';
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
  const { t } = useTranslation('chat');
  const [localQuery, setLocalQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<SearchFilter>('all');
  const {
    currentUserPtid,
    groupMembers,
    currentUserProfile,
    peerProfiles,
    sessions,
    searchQuery,
    searchResults,
    searchLoading,
    searchMessages,
    clearSearch,
    selectSession,
    selectGroup,
    setActiveTab,
    setScrollToMessageUlid,
    openThread,
  } = useActiveSocialChatSlice((state) => ({
    currentUserPtid: state.currentUserPtid,
    groupMembers: state.groupMembers,
    currentUserProfile: state.currentUserProfile,
    peerProfiles: state.peerProfiles,
    sessions: state.sessions,
    searchQuery: state.searchQuery,
    searchResults: state.searchResults,
    searchLoading: state.searchLoading,
    searchMessages: state.searchMessages,
    clearSearch: state.clearSearch,
    selectSession: state.selectSession,
    selectGroup: state.selectGroup,
    setActiveTab: state.setActiveTab,
    setScrollToMessageUlid: state.setScrollToMessageUlid,
    openThread: state.openThread,
  }));

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
      if (result.scope === 'friend') {
        setActiveTab('friend');
        selectSession(result.conversationId);
      } else {
        setActiveTab('group');
        selectGroup(result.conversationId);
      }
      if (result.threadRootUlid) {
        openThread(result.threadRootUlid);
        setScrollToMessageUlid(result.threadRootUlid);
      } else {
        setScrollToMessageUlid(result.messageId);
      }
      handleClose();
    },
    [selectSession, selectGroup, setActiveTab, setScrollToMessageUlid, openThread, handleClose],
  );

  const decoratedResults = useMemo<DecoratedSearchResult[]>(
    () => searchResults.map((result) => {
      const member = result.scope === 'group'
        ? groupMembers[result.conversationId]?.find((item) => item.ptid === result.senderPtid)
        : undefined;
      const sender = resolveActorIdentity({
        ptid: result.senderPtid,
        currentUserPtid,
        currentUserProfile,
        peerProfiles,
        sessions,
        nickname: member?.nickname,
        fallbackName: result.conversationName,
      });
      const senderLabel = result.senderPtid === currentUserPtid
        ? t('chat.social.thread.you')
        : actorDisplayName(sender.displayName, t('chat.social.search.senderUnknown'));
      return {
        fileKind: fileKindForResult(result),
        isThread: isThreadResult(result),
        result,
        senderLabel,
      };
    }),
    [currentUserProfile, currentUserPtid, groupMembers, peerProfiles, searchResults, sessions, t],
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

  const filterOptions = useMemo(
    () => ([
      { label: t('chat.social.search.filter.all'), value: 'all' as SearchFilter },
      { label: t('chat.social.search.filter.messages'), value: 'messages' as SearchFilter },
      { label: t('chat.social.search.filter.threads'), value: 'threads' as SearchFilter },
      { label: t('chat.social.search.filter.files'), value: 'files' as SearchFilter },
    ]),
    [t],
  );

  const kindLabel = (kind: ResultKind): string => t(`chat.social.search.type.${kind}`);
  const scopeLabel = (r: SearchResult): string =>
    t(r.scope === 'friend' ? 'chat.social.search.scope.friend' : 'chat.social.search.scope.group');
  const hasSearched = searchQuery.trim().length > 0;

  return (
    <Dialog
      open={open}
      onDismiss={handleClose}
      title={
        <span className="sc-search__title">
          <Search size={18} />
          {t('chat.social.search.title')}
        </span>
      }
      width={640}
      closeLabel={t('chat.social.messageArea.cancel')}
    >
      <div className="sc-search">
        <PtTextField
          data-chat-message-search-input
          leading={<Search size={16} />}
          trailing={(searchLoading || localQuery) ? (
            <span className="sc-search__trailing">
              {searchLoading && <PtSpin size="small" />}
              {localQuery && (
                <IconButton
                  actionId="chat-message-search-clear"
                  iconId="close"
                  iconSize={14}
                  density="compact"
                  emphasis="quiet"
                  className="sc-search__clear"
                  label={t('chat.social.search.clear')}
                  aria-label={t('chat.social.search.clear')}
                  data-chat-message-search-clear
                  onActivate={() => setLocalQuery('')}
                />
              )}
            </span>
          ) : undefined}
          placeholder={t('chat.social.search.placeholder')}
          value={localQuery}
          onValueChange={setLocalQuery}
          aria-label={t('chat.social.search.title')}
        />
        <div className="sc-search__body">
          {searchResults.length > 0 && (
            <>
              <div className="sc-search__count">
                {t('chat.social.search.resultCount', { count: filteredResults.length })}
              </div>
              <PtSegmented
                options={filterOptions.map((option) => ({
                  ...option,
                  label: `${option.label} ${filterCounts[option.value]}`,
                }))}
                value={activeFilter}
                onValueChange={(value) => setActiveFilter(value as SearchFilter)}
              />
            </>
          )}
          {searchResults.length > 0 && filteredResults.length === 0 ? (
            <PtEmpty
              className="sc-search__empty"
              icon={<SearchX size={28} />}
              description={t('chat.social.search.noFilterResults')}
            />
          ) : searchResults.length > 0 ? (
            <div className="sc-search__list">
              {filteredResults.map((item) => {
                const r = item.result;
                const kind = primaryKindForResult(item);
                return (
                  <button
                    type="button"
                    key={`${r.scope}-${r.conversationId}-${r.messageId}`}
                    className="sc-search__result"
                    data-messaging-search-result
                    data-messaging-search-conversation-id={r.conversationId}
                    data-messaging-search-message-id={r.messageId}
                    data-messaging-search-scope={r.scope}
                    data-messaging-search-kind={kind}
                    onClick={() => handleResultClick(r)}
                  >
                    <span className="sc-search__result-glyph">
                      {r.scope === 'friend' ? <MessageSquare size={16} /> : <Users size={16} />}
                    </span>
                    <span className="sc-search__result-body">
                      <span className="sc-search__result-line">
                        <span className="sc-search__result-head">
                          <strong className="sc-search__conversation">{r.conversationName}</strong>
                          <PtTag>{scopeLabel(r)}</PtTag>
                          <PtTag tone={resultKindTone(kind)} leading={resultKindIcon(kind)}>
                            {kindLabel(kind)}
                          </PtTag>
                        </span>
                        <span className="sc-search__result-jump">
                          <ArrowRight size={13} />
                          {t('chat.social.search.jump')}
                        </span>
                      </span>
                      <span className="sc-search__result-meta">
                        {item.senderLabel} - {formatSentAt(r.sentAt, t)}
                      </span>
                      <span className="sc-search__result-text">
                        {highlightMatch(r.content, searchQuery)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="sc-search__placeholder">
              {hasSearched && !searchLoading ? (
                <PtEmpty description={t('chat.social.search.noResults')} />
              ) : (
                <span>{t('chat.social.search.startTyping')}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
