import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, toast } from '@lobehub/ui';
import { Alert, Empty, Spin, theme, Typography } from 'antd';
import { LocateFixed, Lock, MessageCircle, Paperclip, Reply, X } from 'lucide-react';
import { timestampDate, type Timestamp } from '@bufbuild/protobuf/wkt';

import { useSocialChatStore, peerOfSession, socialThreadKey } from '../../store/socialChat';
import { api, type ChatAttachmentInput } from '../../services/desktop_api';
import { seedLocalMediaProjection } from '../../services/mediaRuntime';
import { log } from '../../utils/logger';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { AttachmentItem, type ChatAttachmentVisibilityHint } from './AttachmentItem';
import { ChatComposer } from './ChatComposer';
import type { FriendChatMessage } from '../../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';

const { Text } = Typography;

type SocialMessage = FriendChatMessage | GroupMessage;
const IMAGE_ATTACHMENT_FILENAME_PATTERN = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;

function isFriendMessage(msg: SocialMessage): msg is FriendChatMessage {
  return 'sessionUlid' in msg;
}

function messageReplyToUlid(msg: SocialMessage): string {
  return isFriendMessage(msg) ? msg.replyToUlid : msg.replyToUlid;
}

function messageThreadRootUlid(msg: SocialMessage): string {
  const threadRoot = (msg as SocialMessage & { threadRootUlid?: string }).threadRootUlid || '';
  return threadRoot || messageReplyToUlid(msg);
}

function normalizeVisibilityHint(v: string | undefined): ChatAttachmentVisibilityHint | undefined {
  switch (v) {
    case 'public':
    case 'chat':
    case 'private':
      return v;
    default:
      return undefined;
  }
}

function isUploadedImage(filename: string | undefined, mimeType: string | undefined): boolean {
  const normalizedMime = mimeType?.toLowerCase() ?? '';
  return normalizedMime.startsWith('image/') || IMAGE_ATTACHMENT_FILENAME_PATTERN.test(filename ?? '');
}

function formatThreadTime(msg: SocialMessage): string {
  const raw: unknown = msg.createdAt ?? msg.sentAt;
  if (!raw) return '';
  if (typeof raw === 'number') return new Date(raw).toLocaleString();
  if (typeof raw === 'string') return new Date(raw).toLocaleString();
  return timestampDate(raw as Timestamp).toLocaleString();
}

function isRecalledMessage(msg: SocialMessage): boolean {
  return (msg as { recalled?: boolean }).recalled === true;
}

interface ThreadMessageProps {
  msg: SocialMessage;
  currentUserDid: string | null;
  senderName: string;
  senderAvatar: string;
  compact?: boolean;
  onReply?: () => void;
}

function ThreadMessage({ msg, currentUserDid, senderName, senderAvatar, compact = false, onReply }: ThreadMessageProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const isOwn = currentUserDid ? msg.senderDid === currentUserDid : false;
  const isRecalled = isRecalledMessage(msg);
  const isEncryptedPlaceholder = msg.content === '[Encrypted Message]';

  return (
    <Flexbox horizontal align="flex-start" gap={10} style={{ minWidth: 0 }}>
      <UserSquareAvatar name={senderName || msg.senderDid} remoteUrl={senderAvatar} size={compact ? 28 : 34} />
      <Flexbox gap={4} style={{ minWidth: 0, flex: 1 }}>
        <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
          <Text strong ellipsis style={{ fontSize: 13, maxWidth: 180 }}>
            {isOwn ? t('chat.social.thread.you') : senderName || msg.senderDid}
          </Text>
          <Text style={{ fontSize: 11, color: token.colorTextQuaternary, flexShrink: 0 }}>
            {formatThreadTime(msg)}
          </Text>
        </Flexbox>

        <Flexbox
          gap={6}
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            background: token.colorFillSecondary,
            color: token.colorText,
            fontSize: 13,
            lineHeight: 1.5,
            wordBreak: 'break-word',
            fontStyle: isRecalled ? 'italic' : 'normal',
          }}
        >
          {isRecalled ? (
            <Text type="secondary" style={{ fontStyle: 'italic', fontSize: 13 }}>
              {isOwn
                ? t('chat.social.messageArea.recalledByYou', 'You recalled a message')
                : t('chat.social.messageArea.recalledByPeer', 'A message was recalled')}
            </Text>
          ) : isEncryptedPlaceholder ? (
            <Flexbox horizontal align="center" gap={4}>
              <Lock size={12} style={{ color: token.colorTextQuaternary }} />
              <Text type="secondary" style={{ fontStyle: 'italic', fontSize: 13 }}>
                {t('chat.social.encryption.encryptedMessage')}
              </Text>
            </Flexbox>
          ) : (
            <Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{msg.content}</Text>
          )}

          {!isRecalled && msg.attachments && msg.attachments.length > 0 && (
            <Flexbox gap={4}>
              {msg.attachments.map((att, index) => (
                <AttachmentItem
                  key={`${att.cid || att.filename}-${index}`}
                  attachment={att}
                  isOwn={isOwn}
                  visibilityHint={normalizeVisibilityHint(att.visibility) ?? (isOwn ? 'chat' : undefined)}
                />
              ))}
            </Flexbox>
          )}
        </Flexbox>
        {onReply && (
          <Button
            type="text"
            size="small"
            icon={<Reply size={12} />}
            onClick={onReply}
            style={{ alignSelf: 'flex-start', height: 22, paddingInline: 6, fontSize: 11 }}
          >
            {t('chat.social.thread.replyToMessage', 'Reply')}
          </Button>
        )}
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
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachmentInput | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<SocialMessage | null>(null);

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
  const fallbackRoot = openThreadRootUlid
    ? currentMessages.find((msg) => msg.ulid === openThreadRootUlid) ?? null
    : null;
  const rootMessage = loadedThreadMessages[0]
    ?? fallbackRoot
    ?? null;
  const replies = useMemo(() => {
    if (!rootMessage) return [];
    if (loadedThreadMessages.length > 0) {
      return loadedThreadMessages.filter((msg) => msg.ulid !== rootMessage.ulid);
    }
    return currentMessages.filter((msg) => messageThreadRootUlid(msg) === rootMessage.ulid);
  }, [currentMessages, loadedThreadMessages, rootMessage]);

  useEffect(() => {
    if (activeTab === 'group' && activeUlid) {
      loadGroupMembers(activeUlid).catch((error) => {
        log.warn('socialChat', 'thread panel loadGroupMembers failed', error);
      });
    }
  }, [activeTab, activeUlid, loadGroupMembers]);

  useEffect(() => {
    if (!activeUlid || !openThreadRootUlid) return;
    loadThreadMessages(activeUlid, openThreadRootUlid, activeKind).catch(() => {});
  }, [activeUlid, activeKind, openThreadRootUlid, loadThreadMessages]);

  useEffect(() => {
    if (!activeUlid || !rootMessage || loadingThread || loadingMoreReplies) return;
    const lastReadUlid = replies.length > 0 ? replies[replies.length - 1].ulid : rootMessage.ulid;
    markThreadRead(activeUlid, rootMessage.ulid, lastReadUlid, activeKind).catch(() => {});
  }, [activeUlid, activeKind, loadingMoreReplies, loadingThread, markThreadRead, replies, rootMessage]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setInputValue('');
      setPendingAttachment(null);
      setReplyTarget(null);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [activeUlid, openThreadRootUlid]);

  const resolveSender = (msg: SocialMessage): { name: string; avatar: string } => {
    if (activeTab === 'friend') {
      const session = sessions.find((s) => s.ulid === activeUlid);
      if (!session) return { name: msg.senderDid, avatar: '' };
      if (currentUserDid && msg.senderDid === currentUserDid) {
        return {
          name: t('chat.social.thread.you'),
          avatar: '',
        };
      }
      const peer = peerOfSession(session, currentUserDid);
      return { name: peer.name || msg.senderDid, avatar: peer.avatar };
    }

    const member = activeUlid ? groupMembers[activeUlid]?.find((m) => m.actorDid === msg.senderDid) : undefined;
    return {
      name: member?.nickname || msg.senderDid,
      avatar: '',
    };
  };

  const handleSend = async () => {
    const content = inputValue.trim();
    const attachment = pendingAttachment;
    const hasAttachment = attachment !== null;
    if ((!content && !hasAttachment) || !activeUlid || !rootMessage || sending || uploadingAttachment) return;

    setSending(true);
    try {
      const attachmentType = attachment?.mime_type?.startsWith('image/') ? 2 : attachment ? 3 : undefined;
      const replyToUlid = replyTarget?.ulid || rootMessage.ulid;
      const rootUlid = rootMessage.ulid;
      if (activeTab === 'friend') {
        const session = sessions.find((s) => s.ulid === activeUlid);
        const receiverDid = session ? peerOfSession(session, currentUserDid).did : '';
        await sendFriendMessage(
          activeUlid,
          receiverDid,
          content,
          attachmentType,
          replyToUlid,
          attachment ? [attachment] : undefined,
          rootUlid,
        );
      } else {
        await sendGroupMessage(
          activeUlid,
          content,
          attachmentType,
          replyToUlid,
          attachment ? [attachment] : undefined,
          rootUlid,
        );
      }
      setInputValue('');
      setPendingAttachment(null);
      setReplyTarget(null);
      void (async () => {
        try {
          await loadThreadMessages(activeUlid, rootUlid, activeKind);
        } catch (error) {
          log.warn('socialChat', 'thread refresh after send failed', error);
        }
        const refreshedThread = useSocialChatStore.getState().threadMessages[threadKey] || [];
        const lastReadUlid = refreshedThread.length > 0
          ? refreshedThread[refreshedThread.length - 1].ulid
          : rootUlid;
        await markThreadRead(activeUlid, rootUlid, lastReadUlid, activeKind).catch((error) => {
          log.warn('socialChat', 'thread mark read after send failed', error);
        });
        await refreshThreadCounts(activeUlid, [rootUlid], activeKind).catch((error) => {
          log.warn('socialChat', 'thread count refresh after send failed', error);
        });
      })();
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

  const handleAttachClick = async () => {
    if (!activeUlid || uploadingAttachment || sending) return;
    let filePath: string;
    try {
      filePath = await api.ossPickAttachmentChat();
    } catch {
      return;
    }
    if (!filePath) return;

    setUploadingAttachment(true);
    try {
      const uploaded = await api.ossUploadAttachmentChat({
        file_path: filePath,
        bucket: 'chat',
        visibility: 'chat',
        chat_session_id: activeUlid,
      });
      if (!uploaded) {
        toast.error(t('chat.social.thread.attachmentUploadFailed'));
        return;
      }
      if (isUploadedImage(uploaded.filename, uploaded.mime_type)) {
        seedLocalMediaProjection({
          cid: uploaded.cid,
          filePath,
          mimeType: uploaded.mime_type,
        });
      }
      setPendingAttachment({
        cid: uploaded.cid,
        filename: uploaded.filename,
        mime_type: uploaded.mime_type,
        size: uploaded.size,
        thumbnail_cid: '',
        visibility: uploaded.visibility ?? 'chat',
      });
    } catch (error) {
      log.error('socialChat', 'thread attachment upload failed', error);
      toast.error(t('chat.social.thread.attachmentUploadFailed'));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!openThreadRootUlid) return null;

  const canSend = (inputValue.trim().length > 0 || pendingAttachment !== null) && !sending && !uploadingAttachment;
  const attachmentButtonDisabled = sending || uploadingAttachment;
  const attachmentButtonTitle = t('chat.social.thread.attach');
  const composerAccessory = (
    <>
      {pendingAttachment && (
        <Flexbox
          horizontal
          align="center"
          justify="space-between"
          gap={8}
          style={{
            padding: '7px 9px',
            borderRadius: 8,
            background: token.colorFillQuaternary,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0, flex: 1 }}>
            <Paperclip size={13} style={{ color: token.colorTextTertiary, flexShrink: 0 }} />
            <Text ellipsis style={{ fontSize: 12 }}>
              {pendingAttachment.filename || t('chat.social.thread.attachment')}
            </Text>
          </Flexbox>
          <Button
            type="text"
            size="small"
            icon={<X size={13} />}
            aria-label={t('chat.social.thread.removeAttachment')}
            onClick={() => setPendingAttachment(null)}
            disabled={sending}
            style={{ width: 24, height: 24, flexShrink: 0 }}
          />
        </Flexbox>
      )}
      {replyTarget && (
        <Flexbox
          horizontal
          align="center"
          justify="space-between"
          gap={8}
          style={{
            padding: '7px 9px',
            borderRadius: 8,
            background: token.colorPrimaryBg,
            border: `1px solid ${token.colorPrimaryBorder}`,
          }}
        >
          <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0, flex: 1 }}>
            <Reply size={13} style={{ color: token.colorPrimary, flexShrink: 0 }} />
            <Text ellipsis style={{ fontSize: 12 }}>
              {t('chat.social.thread.replyingTo', 'Replying to {{name}}', {
                name: resolveSender(replyTarget).name || replyTarget.senderDid,
              })}
            </Text>
          </Flexbox>
          <Button
            type="text"
            size="small"
            icon={<X size={13} />}
            aria-label={t('chat.social.thread.cancelReply', 'Cancel reply target')}
            onClick={() => setReplyTarget(null)}
            disabled={sending}
            style={{ width: 24, height: 24, flexShrink: 0 }}
          />
        </Flexbox>
      )}
    </>
  );

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
          minHeight: 61,
          boxSizing: 'border-box',
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
              <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {t('chat.social.thread.rootMessage')}
              </Text>
              <ThreadMessage
                msg={rootMessage}
                currentUserDid={currentUserDid}
                senderName={resolveSender(rootMessage).name}
                senderAvatar={resolveSender(rootMessage).avatar}
              />
            </Flexbox>

            <Flexbox gap={8}>
              <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
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
                replies.map((reply) => {
                  const sender = resolveSender(reply);
                  return (
                    <ThreadMessage
                      key={reply.ulid}
                      msg={reply}
                      currentUserDid={currentUserDid}
                      senderName={sender.name}
                      senderAvatar={sender.avatar}
                      compact
                      onReply={() => setReplyTarget(reply)}
                    />
                  );
                })
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

          <Flexbox
            style={{
              padding: '10px 12px 12px',
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
              boxShadow: '0 -8px 24px rgba(0,0,0,0.03)',
              flexShrink: 0,
            }}
          >
            <ChatComposer
              value={inputValue}
              onChange={setInputValue}
              onKeyDown={handleKeyDown}
              onSend={handleSend}
              onAttach={handleAttachClick}
              canSend={canSend}
              disabled={sending || uploadingAttachment}
              sending={sending}
              attachDisabled={attachmentButtonDisabled}
              attachLoading={uploadingAttachment}
              layout="stacked"
              placeholder={t('chat.social.thread.placeholder')}
              attachTitle={attachmentButtonTitle}
              emojiTitle={t('chat.social.messageArea.emoji', 'Emoji')}
              sendTitle={t('chat.social.thread.send')}
              enterMessageTitle={t('chat.social.messageArea.enterMessage', 'Enter a message')}
              accessory={composerAccessory}
              minRows={2}
              maxRows={5}
            />
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
}
