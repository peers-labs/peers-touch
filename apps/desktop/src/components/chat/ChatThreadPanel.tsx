import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Tooltip, toast } from '@lobehub/ui';
import { Alert, Empty, Spin, theme, Typography } from 'antd';
import { LocateFixed, MessageSquareReply, MessagesSquare, RotateCcw, Trash2, X } from 'lucide-react';
import {
  CHAT_COMPOSER_CAPABILITIES_DESKTOP_THREAD,
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
import { log } from '../../utils/logger';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { ChatComposer, type ChatComposerDraft } from './ChatComposer';
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

const { Text } = Typography;
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
  currentUserDid: string | null;
  getSenderProfile: (
    kind: 'friend' | 'group',
    conversationUlid: string,
    senderId: string,
  ) => DesktopIMSenderProfileProjection;
  message: ChatMessage;
  messages: ChatMessage[];
  order: number;
  onDelete?: (message: ChatMessage) => void;
  onRecall?: (message: ChatMessage) => void;
  onReply?: (message: ChatMessage) => void;
  root?: boolean;
  rootUlid: string;
}

function ThreadMessageItem({
  activeConversationId,
  activeKind,
  currentUserDid,
  getSenderProfile,
  message,
  messages,
  order,
  onDelete,
  onRecall,
  onReply,
  root = false,
  rootUlid,
}: ThreadMessageItemProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const senderProfile = getSenderProfile(activeKind, activeConversationId, message.senderId);
  const isOwn = isOwnMessage(message, currentUserDid);
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
    <Flexbox
      data-thread-message-id={message.ulid}
      data-thread-message-order={order}
      data-thread-message-role={root ? 'root' : 'reply'}
      horizontal
      align="flex-start"
      gap={10}
      style={{
        padding: root ? '12px 12px 13px' : '10px 0',
        borderRadius: root ? 8 : 0,
        background: root ? token.colorFillQuaternary : 'transparent',
        borderBottom: root ? 'none' : `1px solid ${token.colorBorderSecondary}`,
        position: 'relative',
      }}
      className="thread-comment-row"
    >
      <span
        data-chat-avatar-ptid={message.senderId}
        data-chat-avatar-src={senderProfile.avatar}
        style={{ display: 'inline-flex', flexShrink: 0 }}
      >
        <UserSquareAvatar
          remoteUrl={senderProfile.avatar}
          name={senderProfile.name}
          size={root ? 30 : 28}
        />
      </span>
      <Flexbox gap={5} style={{ flex: 1, minWidth: 0 }}>
        <Flexbox horizontal align="center" justify="space-between" gap={8}>
          <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
            <Text ellipsis strong style={{ fontSize: 12, maxWidth: 150 }}>
              {isOwn ? t('chat.social.thread.you') : senderProfile.name}
            </Text>
            <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
              {formatThreadTime(message)}
            </Text>
          </Flexbox>
          <Flexbox horizontal align="center" gap={2} className="thread-reply-action" style={{ flexShrink: 0 }}>
            {!root && onReply && (
              <Tooltip title={t('chat.social.thread.replyToMessage')}>
                <Button
                  type="text"
                  size="small"
                  icon={<MessageSquareReply size={13} />}
                  aria-label={t('chat.social.thread.replyToMessage')}
                  onClick={() => onReply(message)}
                  style={{ width: 24, height: 24 }}
                />
              </Tooltip>
            )}
            {canRecall && (
              <Tooltip title={t('chat.social.messageArea.actionRecall')}>
                <Button
                  type="text"
                  size="small"
                  icon={<RotateCcw size={13} />}
                  aria-label={t('chat.social.messageArea.actionRecall')}
                  onClick={() => onRecall?.(message)}
                  style={{ width: 24, height: 24 }}
                />
              </Tooltip>
            )}
            {canDelete && (
              <Tooltip title={t('chat.social.messageArea.actionDelete')}>
                <Button
                  type="text"
                  size="small"
                  icon={<Trash2 size={13} />}
                  aria-label={t('chat.social.messageArea.actionDelete')}
                  onClick={() => onDelete?.(message)}
                  style={{ width: 24, height: 24, color: token.colorError }}
                />
              </Tooltip>
            )}
          </Flexbox>
        </Flexbox>
        {replyPreview && (
          <Text
            type="secondary"
            ellipsis
            style={{
              fontSize: 11,
              padding: '3px 6px',
              borderLeft: `2px solid ${token.colorPrimaryBorder}`,
              background: token.colorFillQuaternary,
              borderRadius: 4,
            }}
          >
            {replyPreview}
          </Text>
        )}
        <Flexbox
          style={{
            color: token.colorText,
            fontSize: root ? 13 : 12,
            lineHeight: 1.55,
            wordBreak: 'break-word',
          }}
        >
          <ChatMessageContent message={message} isOwn={isOwn} attachmentGap={5} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}

export function ChatThreadPanel() {
  const { token } = theme.useToken();
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
    currentUserDid,
    currentUserProfile,
    peerProfiles,
    sessions,
    groupMembers,
    openThreadRootUlid,
    closeThread,
    loadThreadMessages,
    refreshThreadCounts,
    markThreadRead,
    setScrollToMessageUlid,
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
    currentUserDid: s.currentUserDid,
    currentUserProfile: s.currentUserProfile,
    peerProfiles: s.peerProfiles,
    sessions: s.sessions,
    groupMembers: s.groupMembers,
    openThreadRootUlid: s.openThreadRootUlid,
    closeThread: s.closeThread,
    loadThreadMessages: s.loadThreadMessages,
    refreshThreadCounts: s.refreshThreadCounts,
    markThreadRead: s.markThreadRead,
    setScrollToMessageUlid: s.setScrollToMessageUlid,
    sendFriendMessage: s.sendFriendMessage,
    sendGroupMessage: s.sendGroupMessage,
    deleteMessage: s.deleteMessage,
    recallFriendMessage: s.recallFriendMessage,
    recallGroupMessage: s.recallGroupMessage,
    getIMConversations: s.getIMConversations,
    getIMSenderProfile: s.getIMSenderProfile,
  }));
  void currentUserProfile;
  void peerProfiles;
  void sessions;
  void groupMembers;
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [deletingMessage, setDeletingMessage] = useState(false);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const activeKind = activeTab === 'friend' ? 'friend' : 'group';
  const threadKey = activeUlid && openThreadRootUlid
    ? socialThreadKey(activeKind, activeUlid, openThreadRootUlid)
    : '';
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
    const handle = window.setTimeout(() => {
      setInputValue('');
      setReplyTarget(null);
      setDeleteTarget(null);
      setDeletingMessage(false);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [activeUlid, openThreadRootUlid]);

  const handleSend = async (draft: ChatComposerDraft) => {
    const content = draft.text.trim();
    const hasAttachment = draft.attachments.length > 0;
    if ((!content && !hasAttachment) || !activeUlid || !rootMessage || sending) return;

    setSending(true);
    try {
      const replyToUlid = chatThreadReplyTargetUlid(rootMessage, replyTarget);
      if (activeTab === 'friend') {
        const receiverDid = activeConversation?.peerDid || '';
        await sendFriendMessage(
          activeUlid,
          receiverDid,
          content,
          draft.messageType,
          replyToUlid,
          hasAttachment ? draft.attachments : undefined,
          rootMessage.ulid,
        );
      } else {
        await sendGroupMessage(
          activeUlid,
          content,
          draft.messageType,
          replyToUlid,
          hasAttachment ? draft.attachments : undefined,
          rootMessage.ulid,
        );
      }
      await loadThreadMessages(activeUlid, rootMessage.ulid, activeKind);
      const refreshedThread = useSocialChatStore.getState().getIMThreadMessages(activeKind, activeUlid, rootMessage.ulid);
      const lastReadUlid = refreshedThread.length > 0
        ? refreshedThread[refreshedThread.length - 1].ulid
        : rootMessage.ulid;
      await markThreadRead(activeUlid, rootMessage.ulid, lastReadUlid, activeKind);
      await refreshThreadCounts(activeUlid, [rootMessage.ulid], activeKind);
      setInputValue('');
      setReplyTarget(null);
    } catch (error) {
      log.error('socialChat', 'thread reply send failed', error);
      toast.error(t('chat.social.thread.sendFailed'));
    } finally {
      setSending(false);
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
      toast.error(t('chat.social.messageArea.recallFailed'));
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
      toast.error(t('chat.social.messageArea.deleteFailed'));
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
    <Flexbox
      data-chat-thread-panel="open"
      data-chat-thread-reply-count={replies.length}
      data-chat-thread-root={openThreadRootUlid}
      style={{
        width: 360,
        height: '100%',
        background: token.colorBgContainer,
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
        flexShrink: 0,
        position: 'relative',
      }}
    >
      <style>
        {`
          .chat-thread-scroll {
            scrollbar-width: thin;
            scrollbar-color: ${token.colorFillSecondary} transparent;
          }
          .chat-thread-scroll::-webkit-scrollbar {
            width: 6px;
            height: 0;
          }
          .chat-thread-scroll::-webkit-scrollbar-thumb {
            background: ${token.colorFillSecondary};
            border-radius: 999px;
          }
          .chat-thread-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .thread-reply-action {
            opacity: 0;
            transition: opacity 0.14s ease;
          }
          .thread-comment-row:hover .thread-reply-action,
          .thread-comment-row:focus-within .thread-reply-action {
            opacity: 1;
          }
        `}
      </style>
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{
          height: 64,
          padding: '0 18px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Flexbox horizontal align="center" gap={8}>
          <MessagesSquare size={16} style={{ color: token.colorPrimary }} />
          <Flexbox>
            <Text strong style={{ fontSize: 14 }}>
              {t('chat.social.thread.title')}
            </Text>
            {rootMessage && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('chat.social.thread.replies', { count: replies.length })}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={4}>
          <Button
            type="text"
            title={t('chat.social.thread.jumpToOriginal')}
            aria-label={t('chat.social.thread.jumpToOriginal')}
            icon={<LocateFixed size={15} />}
            onClick={handleJumpToOriginal}
            style={{ width: 28, height: 28 }}
          />
          <Button
            data-chat-thread-close
            type="text"
            title={t('chat.social.thread.close')}
            aria-label={t('chat.social.thread.close')}
            icon={<X size={16} />}
            onClick={closeThread}
            style={{ width: 28, height: 28 }}
          />
        </Flexbox>
      </Flexbox>

      {!rootMessage ? (
        <Flexbox flex={1} align="center" justify="center" style={{ padding: 16 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.thread.missingRoot')} />
        </Flexbox>
      ) : (
        <>
          <Flexbox
            className="chat-thread-scroll"
            flex={1}
            gap={12}
            style={{ overflowY: 'auto', overflowX: 'hidden', padding: '14px 16px 12px' }}
          >
            {loadingThread && (
              <Flexbox horizontal align="center" gap={8} style={{ color: token.colorTextSecondary }}>
                <Spin size="small" />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('chat.social.thread.loading')}
                </Text>
              </Flexbox>
            )}
            {threadLoadError && (
              <Alert
                type="warning"
                showIcon
                message={t('chat.social.thread.loadFailed')}
                description={threadLoadError}
              />
            )}
            <Flexbox gap={7}>
              <Text type="secondary" style={{ fontSize: 11, letterSpacing: 0 }}>
                {t('chat.social.thread.rootMessage')}
              </Text>
              <ThreadMessageItem
                activeConversationId={activeUlid || ''}
                activeKind={activeKind}
                currentUserDid={currentUserDid}
                getSenderProfile={getIMSenderProfile}
                message={rootMessage}
                messages={displayMessages}
                order={0}
                onDelete={setDeleteTarget}
                onRecall={handleRecall}
                root
                rootUlid={rootMessage.ulid}
              />
            </Flexbox>

            <Flexbox gap={4}>
              <Text type="secondary" style={{ fontSize: 11, letterSpacing: 0 }}>
                {t('chat.social.thread.replies', { count: replies.length })}
              </Text>
              {replies.length === 0 ? (
                <Flexbox
                  align="center"
                  justify="center"
                  style={{
                    padding: '16px 12px',
                    borderRadius: 8,
                    background: token.colorFillQuaternary,
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('chat.social.thread.noReplies')}
                  </Text>
                </Flexbox>
              ) : (
                replies.map((reply, index) => (
                  <ThreadMessageItem
                    key={reply.ulid}
                    activeConversationId={activeUlid || ''}
                    activeKind={activeKind}
                    currentUserDid={currentUserDid}
                    getSenderProfile={getIMSenderProfile}
                    message={reply}
                    messages={displayMessages}
                    order={index + 1}
                    onDelete={setDeleteTarget}
                    onRecall={handleRecall}
                    onReply={setReplyTarget}
                    rootUlid={rootMessage.ulid}
                  />
                ))
              )}
              {hasMoreReplies && (
                <Button
                  size="small"
                  type="text"
                  loading={loadingMoreReplies}
                  onClick={handleLoadMoreReplies}
                  style={{ alignSelf: 'center', fontSize: 12, marginTop: 8 }}
                >
                  {t('chat.social.thread.loadMoreReplies')}
                </Button>
              )}
            </Flexbox>
          </Flexbox>

          <ChatComposer
            activeConversationId={activeUlid || ''}
            disabled={!activeUlid || !rootMessage}
            editing={false}
            surfaceBackground={token.colorBgContainer}
            value={inputValue}
            onChange={setInputValue}
            onBlurInput={() => {}}
            onCancelEdit={() => {}}
            onCancelReply={() => setReplyTarget(null)}
            onSend={handleSend}
            placeholder={t('chat.social.thread.placeholder')}
            replyPreview={replyPreview}
            replyPreviewKey={replyTarget?.ulid ?? null}
            sending={sending}
            capabilities={CHAT_COMPOSER_CAPABILITIES_DESKTOP_THREAD}
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
    </Flexbox>
  );
}
