import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, toast } from '@lobehub/ui';
import { Alert, Empty, Spin, theme, Typography } from 'antd';
import { LocateFixed, MessageCircle, X } from 'lucide-react';
import {
  CHAT_COMPOSER_CAPABILITIES_DESKTOP_THREAD,
  buildChatThreadSurface,
  chatThreadReplyTargetUlid,
} from '@peers-touch/client-chat-core';

import {
  useSocialChatStore,
  peerOfSession,
  socialThreadKey,
} from '../../store/socialChat';
import { log } from '../../utils/logger';
import { ChatComposer, type ChatComposerDraft } from './ChatComposer';
import {
  replyPreviewForMessage,
  type ChatMessage,
} from './message/chatMessageModel';
import {
  ChatMessageRow,
  ChatMessageRowInteractionStyle,
} from './message/ChatMessageRow';

const { Text } = Typography;

const disabledThreadRowActions = {
  delete: false,
  edit: false,
  recall: false,
  thread: false,
} as const;

const disabledRootRowActions = {
  ...disabledThreadRowActions,
  reply: false,
} as const;

function ignoreThreadRowAction(): void {}

export function ChatThreadPanel() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    activeTab,
    activeSessionUlid,
    activeGroupUlid,
    sessions,
    groupMembers,
    messages,
    threadMessages,
    threadLoading,
    threadLoadingMore,
    threadError,
    threadHasMore,
    threadNextCursor,
    currentUserDid,
    currentUserProfile,
    openThreadRootUlid,
    closeThread,
    loadThreadMessages,
    refreshThreadCounts,
    markThreadRead,
    setScrollToMessageUlid,
    sendFriendMessage,
    sendGroupMessage,
    loadGroupMembers,
  } = useSocialChatStore();
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const activeKind = activeTab === 'friend' ? 'friend' : 'group';
  const currentMessages = useMemo(
    () => (activeUlid ? messages[activeUlid] || [] : []),
    [activeUlid, messages],
  );
  const threadKey = activeUlid && openThreadRootUlid
    ? socialThreadKey(activeKind, activeUlid, openThreadRootUlid)
    : '';
  const loadedThreadMessages = useMemo(
    () => (threadKey ? threadMessages[threadKey] || [] : []),
    [threadKey, threadMessages],
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
  const { rootMessage, replies, displayMessages: threadDisplayMessages } = threadSurface;

  useEffect(() => {
    if (activeTab === 'group' && activeUlid) {
      loadGroupMembers(activeUlid).catch((error) => {
        log.warn('socialChat', 'thread panel loadGroupMembers failed', error);
      });
    }
  }, [activeTab, activeUlid, loadGroupMembers]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setInputValue('');
      setReplyTarget(null);
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
        const session = sessions.find((s) => s.ulid === activeUlid);
        const receiverDid = session ? peerOfSession(session, currentUserDid).did : '';
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
      const refreshedThread = useSocialChatStore.getState().threadMessages[threadKey] || [];
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
    closeThread();
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
      style={{
        width: 360,
        height: '100%',
        background: token.colorBgContainer,
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
        flexShrink: 0,
      }}
    >
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Flexbox horizontal align="center" gap={8}>
          <MessageCircle size={16} style={{ color: token.colorPrimary }} />
          <Text strong style={{ fontSize: 15 }}>
            {t('chat.social.thread.title')}
          </Text>
        </Flexbox>
        <Flexbox horizontal align="center" gap={4}>
          <Button
            type="text"
            title={t('chat.social.thread.jumpToOriginal')}
            icon={<LocateFixed size={15} />}
            onClick={handleJumpToOriginal}
            style={{ width: 28, height: 28 }}
          />
          <Button
            type="text"
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
          <Flexbox flex={1} gap={14} style={{ overflow: 'auto', padding: 16 }}>
            <ChatMessageRowInteractionStyle />
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
            <Flexbox gap={8}>
              <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0 }}>
                {t('chat.social.thread.rootMessage')}
              </Text>
              <ChatMessageRow
                actionVisibility={disabledRootRowActions}
                activeConversationId={activeUlid || ''}
                activeKind={activeKind}
                currentUserDid={currentUserDid}
                currentUserProfile={currentUserProfile}
                density="compact"
                groupMembers={groupMembers}
                highlighted={false}
                message={rootMessage}
                messages={threadDisplayMessages}
                onDelete={ignoreThreadRowAction}
                onEdit={ignoreThreadRowAction}
                onOpenThread={ignoreThreadRowAction}
                onRecall={ignoreThreadRowAction}
                onReply={ignoreThreadRowAction}
                sessions={sessions}
                showHoverActions={false}
                showThreadSummary={false}
                threadReplyCount={0}
                threadUnreadCount={0}
                timelineGap={false}
              />
            </Flexbox>

            <Flexbox gap={8}>
              <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0 }}>
                {t('chat.social.thread.replies', { count: replies.length })}
              </Text>
              {replies.length === 0 ? (
                <Flexbox
                  align="center"
                  justify="center"
                  style={{
                    padding: '18px 12px',
                    borderRadius: 8,
                    background: token.colorFillQuaternary,
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {t('chat.social.thread.noReplies')}
                  </Text>
                </Flexbox>
              ) : (
                replies.map((reply) => (
                  <ChatMessageRow
                    key={reply.ulid}
                    actionVisibility={disabledThreadRowActions}
                    activeConversationId={activeUlid || ''}
                    activeKind={activeKind}
                    currentUserDid={currentUserDid}
                    currentUserProfile={currentUserProfile}
                    density="compact"
                    groupMembers={groupMembers}
                    highlighted={false}
                    message={reply}
                    messages={threadDisplayMessages}
                    onDelete={ignoreThreadRowAction}
                    onEdit={ignoreThreadRowAction}
                    onOpenThread={ignoreThreadRowAction}
                    onRecall={ignoreThreadRowAction}
                    onReply={() => setReplyTarget(reply)}
                    sessions={sessions}
                    showThreadSummary={false}
                    threadReplyCount={0}
                    threadUnreadCount={0}
                    timelineGap={false}
                  />
                ))
              )}
              {hasMoreReplies && (
                <Button
                  size="small"
                  type="text"
                  loading={loadingMoreReplies}
                  onClick={handleLoadMoreReplies}
                  style={{ alignSelf: 'center', fontSize: 12 }}
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
    </Flexbox>
  );
}
