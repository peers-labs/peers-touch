import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert as PtAlert,
  Button as PtButton,
  Empty as PtEmpty,
  Spin as PtSpin,
  Tooltip as PtTooltip,
} from '@peers-touch/ui';
import { LocateFixed, MessageSquareReply, MessagesSquare, RotateCcw, Trash2, X } from 'lucide-react';
import {
  buildChatThreadSurface,
  chatThreadReplyTargetUlid,
} from '@peers-touch/client-chat-core';

import {
  useSocialChatStore,
  socialThreadKey,
} from '../../store/socialChat';
import {
  projectDesktopIMMessages,
  type DesktopIMSenderProfileProjection,
  type SocialMessage,
} from '../../store/socialProjection';
import { actorDisplayName } from '../../store/socialProfileProjection';
import { log } from '../../utils/logger';
import { newSendIntentId } from '../../utils/messagingSendIntent';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { ChatComposer, type ChatComposerDraft } from './ChatComposer';
import {
  DESKTOP_CHAT_COMPOSER_CAPABILITIES_THREAD,
} from './chatPresentationPolicy';
import { ChatDeleteConfirmOverlay } from './ChatDeleteConfirmOverlay';
import { ChatMessageContent } from './message/ChatMessageContent';
import {
  isOwnMessage,
  isRecalledMessage,
  messageReplyToUlid,
  messageTimestampDate,
  messageTimestampMs,
  replyPreviewForMessage,
  type ChatMessage,
} from './message/chatMessageModel';
import { useActiveSocialChatSlice } from './useActiveSocialChatStore';
import { notifyError } from '../../ui/feedback';
import { isChatMessageTailPinned } from './message/chatMessageTimelinePolicy';

const EMPTY_SOCIAL_MESSAGES: SocialMessage[] = [];

/**
 * Mirrors `application.DefaultMutationWindow` on the Station side and
 * the same constant in ChatMessageRow. The server is the source of
 * truth; the UI only hides the Recall button when it is guaranteed
 * to fail.
 */
const FRIEND_RECALL_WINDOW_MS = 4 * 60 * 1000 + 30 * 1000;

function formatThreadTime(message: ChatMessage): string {
  return messageTimestampDate(message)?.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  }) ?? '';
}

interface ThreadMessageItemProps {
  activeConversationId: string;
  activeKind: 'friend' | 'group';
  currentUserPtid: string | null;
  getSenderProfile: (
    kind: 'friend' | 'group',
    conversationUlid: string,
    senderPtid: string,
  ) => DesktopIMSenderProfileProjection;
  message: ChatMessage;
  messages: ChatMessage[];
  order: number;
  onDelete?: (message: ChatMessage) => void;
  onRecall?: (message: ChatMessage) => void;
  onReply?: (message: ChatMessage) => void;
  highlighted?: boolean;
  root?: boolean;
  rootUlid: string;
}

function ThreadMessageItem({
  activeConversationId,
  activeKind,
  currentUserPtid,
  getSenderProfile,
  message,
  messages,
  order,
  onDelete,
  onRecall,
  onReply,
  highlighted = false,
  root = false,
  rootUlid,
}: ThreadMessageItemProps) {
  const { t } = useTranslation('chat');
  const senderProfile = getSenderProfile(activeKind, activeConversationId, message.senderPtid);
  const senderName = actorDisplayName(senderProfile.name, t('chat.social.detail.unknownMember'));
  const isOwn = isOwnMessage(message, currentUserPtid);
  const isRecalled = isRecalledMessage(message);
  const sentMs = messageTimestampMs(message);
  const withinWindow = sentMs > 0 && (Date.now() - sentMs) < FRIEND_RECALL_WINDOW_MS;
  const canRecall = Boolean(onRecall) && isOwn && !isRecalled && withinWindow;
  const canDelete = Boolean(onDelete) && !isRecalled;
  const replyToUlid = messageReplyToUlid(message);
  const replyPreview = replyPreviewForMessage(
    replyToUlid && replyToUlid !== rootUlid
      ? messages.find((item) => item.ulid === replyToUlid)
      : null,
    {
      image: t('chat.social.messageArea.attachmentTypeImage'),
      video: t('chat.social.messageArea.attachmentTypeVideo'),
      audio: t('chat.social.messageArea.attachmentTypeAudio'),
      file: t('chat.social.messageArea.attachmentTypeFile'),
    },
  );

  return (
    <div
      className={`thread-comment-row${root ? ' is-root' : ''}${highlighted ? ' is-highlighted' : ''}`}
      data-thread-message-id={message.ulid}
      data-thread-message-order={order}
      data-thread-message-role={root ? 'root' : 'reply'}
    >
      <span
        className="sc-thread__avatar"
        data-chat-avatar-ptid={message.senderPtid}
        data-chat-avatar-src={senderProfile.avatar}
      >
        <UserSquareAvatar
          remoteUrl={senderProfile.avatar}
          actorPtid={message.senderPtid}
          name={senderName}
          size={root ? 30 : 28}
        />
      </span>
      <div className="sc-thread__body">
        <div className="sc-thread__head">
          <span className="sc-thread__head-id">
            <strong className="sc-thread__sender">
              {isOwn ? t('chat.social.thread.you') : senderName}
            </strong>
            <span className="sc-thread__time">{formatThreadTime(message)}</span>
          </span>
          <span className="sc-thread__actions thread-reply-action">
            {!root && onReply && (
              <PtTooltip label={t('chat.social.thread.replyToMessage')}>
                <PtButton
                  actionId={`thread-reply-${message.ulid}`}
                  className="sc-thread__action"
                  emphasis="quiet"
                  density="compact"
                  leading={<MessageSquareReply size={13} />}
                  aria-label={t('chat.social.thread.replyToMessage')}
                  onActivate={() => onReply(message)}
                />
              </PtTooltip>
            )}
            {canRecall && (
              <PtTooltip label={t('chat.social.messageArea.actionRecall')}>
                <PtButton
                  actionId={`thread-recall-${message.ulid}`}
                  className="sc-thread__action"
                  emphasis="quiet"
                  density="compact"
                  leading={<RotateCcw size={13} />}
                  aria-label={t('chat.social.messageArea.actionRecall')}
                  onActivate={() => onRecall?.(message)}
                />
              </PtTooltip>
            )}
            {canDelete && (
              <PtTooltip label={t('chat.social.messageArea.actionDelete')}>
                <PtButton
                  actionId={`thread-delete-${message.ulid}`}
                  className="sc-thread__action sc-thread__action--danger"
                  emphasis="quiet"
                  density="compact"
                  leading={<Trash2 size={13} />}
                  aria-label={t('chat.social.messageArea.actionDelete')}
                  onActivate={() => onDelete?.(message)}
                />
              </PtTooltip>
            )}
          </span>
        </div>
        {replyPreview && (
          <div className="sc-thread__reply-preview">{replyPreview}</div>
        )}
        <div className={`sc-thread__content${root ? ' is-root' : ''}`}>
          <ChatMessageContent message={message} isOwn={isOwn} thread />
        </div>
      </div>
    </div>
  );
}

export function ChatThreadPanel() {
  const { t } = useTranslation('chat');
  const {
    activeTab,
    activeSessionUlid,
    activeGroupUlid,
    threadLoading,
    threadLoadingMore,
    threadError,
    threadHasMore,
    threadNextCursor,
    currentUserPtid,
    openThreadRootUlid,
    closeThread,
    loadThreadMessages,
    refreshThreadCounts,
    markThreadRead,
    setScrollToMessageUlid,
    scrollToMessageUlid,
    sendFriendMessage,
    sendGroupMessage,
    deleteMessage,
    recallFriendMessage,
    recallGroupMessage,
    getIMConversations,
    getIMSenderProfile,
  } = useActiveSocialChatSlice((s) => ({
    activeTab: s.activeTab,
    activeSessionUlid: s.activeSessionUlid,
    activeGroupUlid: s.activeGroupUlid,
    threadLoading: s.threadLoading,
    threadLoadingMore: s.threadLoadingMore,
    threadError: s.threadError,
    threadHasMore: s.threadHasMore,
    threadNextCursor: s.threadNextCursor,
    currentUserPtid: s.currentUserPtid,
    openThreadRootUlid: s.openThreadRootUlid,
    closeThread: s.closeThread,
    loadThreadMessages: s.loadThreadMessages,
    refreshThreadCounts: s.refreshThreadCounts,
    markThreadRead: s.markThreadRead,
    setScrollToMessageUlid: s.setScrollToMessageUlid,
    scrollToMessageUlid: s.scrollToMessageUlid,
    sendFriendMessage: s.sendFriendMessage,
    sendGroupMessage: s.sendGroupMessage,
    deleteMessage: s.deleteMessage,
    recallFriendMessage: s.recallFriendMessage,
    recallGroupMessage: s.recallGroupMessage,
    getIMConversations: s.getIMConversations,
    getIMSenderProfile: s.getIMSenderProfile,
  }));
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [deletingMessage, setDeletingMessage] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Tail-pin state for the thread viewport. Without this, sending a reply
  // appends content below the current scroll position, so the newest message
  // hides behind the composer and the panel visibly jumps. Mirroring the main
  // timeline, we only follow the tail while the user is already at the tail;
  // a manual scroll-up is never overridden.
  const tailPinnedRef = useRef(true);
  const prevThreadKeyRef = useRef('');
  const [highlightedAnchor, setHighlightedAnchor] = useState<string | null>(null);
  // Last thread key for which ephemeral reply/delete state was reset.
  const [resetThreadKey, setResetThreadKey] = useState<string | null>(null);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const activeKind = activeTab === 'friend' ? 'friend' : 'group';
  const threadKey = activeUlid && openThreadRootUlid
    ? socialThreadKey(activeKind, activeUlid, openThreadRootUlid)
    : '';
  // Reset ephemeral reply/delete targets when the thread changes. Guarded
  // render-phase adjustment (React's documented pattern) avoids the cascading
  // render of a synchronous setState-in-effect.
  if (resetThreadKey !== threadKey) {
    setResetThreadKey(threadKey);
    setReplyTarget(null);
    setDeleteTarget(null);
    setDeletingMessage(false);
  }
  const currentMessageProjection = useSocialChatStore((state) => (
    activeUlid ? state.messages[activeUlid] ?? EMPTY_SOCIAL_MESSAGES : EMPTY_SOCIAL_MESSAGES
  ));
  const loadedThreadProjection = useSocialChatStore((state) => (
    threadKey ? state.threadMessages[threadKey] ?? EMPTY_SOCIAL_MESSAGES : EMPTY_SOCIAL_MESSAGES
  ));
  const activeConversation = activeUlid
    ? getIMConversations().find((conversation) => conversation.kind === activeKind && conversation.id === activeUlid)
    : undefined;
  const currentMessages = useMemo(
    () => activeUlid
      ? projectDesktopIMMessages(activeKind, activeUlid, currentMessageProjection)
      : [],
    [activeKind, activeUlid, currentMessageProjection],
  );
  const loadedThreadMessages = useMemo(
    () => activeUlid && openThreadRootUlid
      ? projectDesktopIMMessages(activeKind, activeUlid, loadedThreadProjection)
      : [],
    [activeKind, activeUlid, loadedThreadProjection, openThreadRootUlid],
  );
  const loadingThread = threadKey ? threadLoading[threadKey] === true : false;
  const loadingMoreReplies = threadKey ? threadLoadingMore[threadKey] === true : false;
  const threadLoadError = threadKey ? threadError[threadKey] : null;
  const hasMoreReplies = threadKey ? threadHasMore[threadKey] === true : false;
  const nextReplyCursor = threadKey ? threadNextCursor[threadKey] : null;
  const threadSurface = useMemo(
    () => buildChatThreadSurface({
      rootUlid: openThreadRootUlid,
      currentMessages,
      loadedThreadMessages,
    }),
    [currentMessages, loadedThreadMessages, openThreadRootUlid],
  );
  const { rootMessage, replies, displayMessages } = threadSurface;

  useEffect(() => {
    if (!scrollToMessageUlid || !displayMessages.some(item => item.ulid === scrollToMessageUlid)) return;
    const element = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-thread-message-id]') ?? [])
      .find(node => node.dataset.threadMessageId === scrollToMessageUlid);
    if (!element) return;
    const viewport = scrollRef.current;
    if (!viewport) return;
    const target = element.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    viewport.scrollTop += target.top - bounds.top - (viewport.clientHeight - target.height) / 2;
    element.tabIndex = -1;
    element.focus({ preventScroll: true });
    setHighlightedAnchor(scrollToMessageUlid);
    // An explicit anchor navigation takes over from tail pinning until the
    // user scrolls back to the tail.
    tailPinnedRef.current = false;
    setScrollToMessageUlid(null);
  }, [scrollToMessageUlid, displayMessages, setScrollToMessageUlid]);

  const scrollToThreadTail = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
  }, []);

  const handleThreadScroll = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    tailPinnedRef.current = isChatMessageTailPinned({
      clientHeight: viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    });
  }, []);

  // Keep the newest reply visible. Runs before paint (useLayoutEffect) so the
  // post-send re-render settles already anchored at the tail and never flashes
  // a scrolled/jumped frame — this removes both the "shake" and the last
  // message hiding under the composer. A freshly opened thread starts pinned.
  useLayoutEffect(() => {
    if (scrollToMessageUlid) return; // explicit anchor owns positioning
    if (prevThreadKeyRef.current !== threadKey) {
      prevThreadKeyRef.current = threadKey;
      tailPinnedRef.current = true;
    }
    if (tailPinnedRef.current) scrollToThreadTail();
  }, [displayMessages.length, threadKey, scrollToMessageUlid, scrollToThreadTail]);

  // Re-pin when the content box resizes while pinned (image load, composer
  // auto-grow), matching the main timeline's ResizeObserver behaviour.
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (tailPinnedRef.current) scrollToThreadTail();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [scrollToThreadTail]);

  useEffect(() => {
    if (!highlightedAnchor) return;
    const timer = window.setTimeout(() => setHighlightedAnchor(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightedAnchor]);

  const handleSend = async (draft: ChatComposerDraft): Promise<boolean> => {
    const content = draft.text.trim();
    const hasAttachment = draft.attachments.length > 0;
    if ((!content && !hasAttachment) || !activeUlid || !rootMessage || sending) return false;

    setSending(true);
    try {
      const replyToUlid = chatThreadReplyTargetUlid(rootMessage, replyTarget);
      if (activeTab === 'friend') {
        const receiverPtid = activeConversation?.peerPtid || '';
        await sendFriendMessage(
          activeUlid,
          receiverPtid,
          content,
          draft.messageType,
          replyToUlid,
          hasAttachment ? draft.attachments : undefined,
          rootMessage.ulid,
          newSendIntentId(),
        );
      } else {
        await sendGroupMessage(
          activeUlid,
          content,
          draft.messageType,
          replyToUlid,
          hasAttachment ? draft.attachments : undefined,
          rootMessage.ulid,
          newSendIntentId(),
        );
      }
      await loadThreadMessages(activeUlid, rootMessage.ulid, activeKind);
      const refreshedThread = useSocialChatStore.getState().getIMThreadMessages(activeKind, activeUlid, rootMessage.ulid);
      const lastReadUlid = refreshedThread.length > 0
        ? refreshedThread[refreshedThread.length - 1].ulid
        : rootMessage.ulid;
      await markThreadRead(activeUlid, rootMessage.ulid, lastReadUlid, activeKind);
      await refreshThreadCounts(activeUlid, [rootMessage.ulid], activeKind);
      setReplyTarget(null);
      setSending(false);
      return true;
    } catch (error) {
      log.error('socialChat', 'thread reply send failed', error);
      notifyError(t('chat.social.thread.sendFailed'));
      setSending(false);
      return false;
    }
  };

  const handleLoadMoreReplies = async () => {
    if (!activeUlid || !rootMessage || loadingMoreReplies) return;
    const afterUlid = nextReplyCursor || (replies.length > 0 ? replies[replies.length - 1].ulid : undefined);
    await loadThreadMessages(activeUlid, rootMessage.ulid, activeKind, {
      append: true,
      afterUlid,
    }).catch(() => {});
  };

  const handleJumpToOriginal = () => {
    const rootUlid = rootMessage?.ulid || openThreadRootUlid;
    if (!rootUlid) return;
    setScrollToMessageUlid(rootUlid);
  };

  const handleRecall = async (message: ChatMessage) => {
    if (!activeUlid) return;
    try {
      if (activeKind === 'friend') {
        await recallFriendMessage(activeUlid, message.ulid);
      } else {
        await recallGroupMessage(activeUlid, message.ulid);
      }
    } catch (error) {
      log.error('socialChat', 'thread recall failed', error);
      notifyError(t('chat.social.messageArea.recallFailed'));
    }
  };

  const handleConfirmDelete = async () => {
    if (!activeUlid || !deleteTarget) return;
    setDeletingMessage(true);
    try {
      await deleteMessage(activeUlid, deleteTarget.ulid, activeKind);
      if (replyTarget?.ulid === deleteTarget.ulid) setReplyTarget(null);
      setDeleteTarget(null);
    } catch (error) {
      log.error('socialChat', 'thread deleteMessage failed', error);
      notifyError(t('chat.social.messageArea.deleteFailed'));
    } finally {
      setDeletingMessage(false);
    }
  };

  if (!openThreadRootUlid) return null;

  const replyPreview = replyPreviewForMessage(replyTarget, {
    image: t('chat.social.messageArea.attachmentTypeImage'),
    video: t('chat.social.messageArea.attachmentTypeVideo'),
    audio: t('chat.social.messageArea.attachmentTypeAudio'),
    file: t('chat.social.messageArea.attachmentTypeFile'),
  });

  return (
    <div
      ref={panelRef}
      className="sc-thread"
      data-chat-thread-panel="open"
      data-chat-thread-reply-count={replies.length}
      data-chat-thread-root={openThreadRootUlid}
    >
      <header className="sc-thread__header">
        <span className="sc-thread__title-group">
          <MessagesSquare size={16} className="sc-thread__title-icon" />
          <span className="sc-thread__title-text">
            <strong>{t('chat.social.thread.title')}</strong>
            {rootMessage && (
              <span>{t('chat.social.thread.replies', { count: replies.length })}</span>
            )}
          </span>
        </span>
        <span className="sc-thread__header-actions">
          <PtButton
            actionId="thread-jump-original"
            className="sc-thread__header-action"
            emphasis="quiet"
            leading={<LocateFixed size={15} />}
            aria-label={t('chat.social.thread.jumpToOriginal')}
            onActivate={handleJumpToOriginal}
          />
          <PtButton
            actionId="thread-close"
            className="sc-thread__header-action"
            data-chat-thread-close
            emphasis="quiet"
            leading={<X size={16} />}
            aria-label={t('chat.social.thread.close')}
            onActivate={closeThread}
          />
        </span>
      </header>

      {!rootMessage ? (
        <div className="sc-thread__missing">
          <PtEmpty description={t('chat.social.thread.missingRoot')} />
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="chat-thread-scroll sc-thread__scroll"
            onScroll={handleThreadScroll}
          >
            {loadingThread && (
              <div className="sc-thread__loading">
                <PtSpin size="small" />
                <span>{t('chat.social.thread.loading')}</span>
              </div>
            )}
            {threadLoadError && (
              <PtAlert tone="warning" title={t('chat.social.thread.loadFailed')} description={threadLoadError} />
            )}
            <div className="sc-thread__card">
            <div className="sc-thread__section">
              <span className="sc-thread__section-label">{t('chat.social.thread.rootMessage')}</span>
              <ThreadMessageItem
                activeConversationId={activeUlid || ''}
                activeKind={activeKind}
                currentUserPtid={currentUserPtid}
                getSenderProfile={getIMSenderProfile}
                message={rootMessage}
                messages={displayMessages}
                order={0}
                onDelete={setDeleteTarget}
                onRecall={handleRecall}
                highlighted={highlightedAnchor === rootMessage.ulid}
                root
                rootUlid={rootMessage.ulid}
              />
            </div>

            <div className="sc-thread__section">
              <span className="sc-thread__section-label">
                {t('chat.social.thread.replies', { count: replies.length })}
              </span>
              {replies.length === 0 ? (
                <div className="sc-thread__no-replies">
                  <span>{t('chat.social.thread.noReplies')}</span>
                </div>
              ) : (
                replies.map((reply, index) => (
                  <ThreadMessageItem
                    key={reply.ulid}
                    activeConversationId={activeUlid || ''}
                    activeKind={activeKind}
                    currentUserPtid={currentUserPtid}
                    getSenderProfile={getIMSenderProfile}
                    message={reply}
                    messages={displayMessages}
                    order={index + 1}
                    onDelete={setDeleteTarget}
                    onRecall={handleRecall}
                    onReply={setReplyTarget}
                    highlighted={highlightedAnchor === reply.ulid}
                    rootUlid={rootMessage.ulid}
                  />
                ))
              )}
              {hasMoreReplies && (
                <PtButton
                  actionId="thread-load-more"
                  className="sc-thread__load-more"
                  density="compact"
                  emphasis="quiet"
                  execution={loadingMoreReplies ? 'pending' : 'idle'}
                  onActivate={handleLoadMoreReplies}
                >
                  {t('chat.social.thread.loadMoreReplies')}
                </PtButton>
              )}
            </div>
            </div>
          </div>

          <ChatComposer
            key={`thread-composer:${activeUlid}:${openThreadRootUlid}`}
            activeConversationId={activeUlid || ''}
            disabled={!activeUlid || !rootMessage}
            editing={false}
            surfaceBackground="var(--pt-surface)"
            onBlurInput={() => {}}
            onCancelEdit={() => {}}
            onCancelReply={() => setReplyTarget(null)}
            onSend={handleSend}
            placeholder={t('chat.social.thread.placeholder')}
            replyPreview={replyPreview}
            replyPreviewKey={replyTarget?.ulid ?? null}
            sending={sending}
            capabilities={DESKTOP_CHAT_COMPOSER_CAPABILITIES_THREAD}
            visualSurface="desktop-thread"
          />
        </>
      )}

      {deleteTarget && (
        <ChatDeleteConfirmOverlay
          deleting={deletingMessage}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}
