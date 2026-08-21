import { memo, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@lobehub/ui';
import { Popover, Spin, theme, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import {
  Check,
  CheckCheck,
  MessagesSquare,
  Pin,
} from 'lucide-react';
import {
  chatMessageRowMaxWidth,
  chatVisualLayoutForSurface,
  countHiddenEarlierChatThreadReplies,
} from '@peers-touch/client-chat-core';

import { UserSquareAvatar } from '../../common/UserSquareAvatar';
import type { FriendMessageStatus } from '../../../gen/proto/domain/chat/friend_chat_pb';
import { FriendMessageStatus as FMS } from '../../../gen/proto/domain/chat/friend_chat_pb';
import type { DesktopIMSenderProfileProjection } from '../../../store/socialProjection';
import { ChatMessageContent } from './ChatMessageContent';
import {
  isEncryptedPlaceholder,
  isFriendMessage,
  isOwnMessage,
  isRecalledMessage,
  isVisualMessageAttachment,
  messageEditedAtMs,
  messageReplyToUlid,
  messageThreadRootUlid,
  type ChatMessage,
  type ChatSurfaceKind,
} from './chatMessageModel';

const { Text } = Typography;

interface ChatMessageRowProps {
  activeConversationId: string;
  activeKind: ChatSurfaceKind;
  currentUserDid: string | null;
  density?: 'regular' | 'compact';
  getSenderProfile: (
    kind: ChatSurfaceKind,
    conversationUlid: string,
    senderId: string,
  ) => DesktopIMSenderProfileProjection;
  highlighted: boolean;
  message: ChatMessage;
  messages: ChatMessage[];
  onActionTargetChange: (
    message: ChatMessage,
    anchorElement: HTMLElement,
    requestFocus: boolean,
  ) => void;
  onActionTargetLeave: () => void;
  onOpenThread: (rootUlid: string) => void;
  onPin: (message: ChatMessage) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onRetryReaction: (message: ChatMessage) => void;
  reactionMutationEmoji?: string;
  reactionMutationPhase?: 'pending' | 'awaiting-projection' | 'error';
  reactions?: { actorId: string; emoji: string }[];
  pinned?: boolean;
  showHoverActions?: boolean;
  showThreadSummary?: boolean;
  threadPreviewMessages: ChatMessage[];
  threadReplyCount: number;
  threadReplyIds: string[];
  threadUnreadCount: number;
  timelineGap: boolean;
}

function formatMsgTime(sentAtMs: number): string {
  if (sentAtMs <= 0) return '';
  const d = new Date(sentAtMs);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ReadReceipt({ status }: { status: FriendMessageStatus }) {
  const { token } = theme.useToken();
  if (status === FMS.READ) {
    return <CheckCheck size={14} style={{ color: token.colorPrimary }} />;
  }
  if (status === FMS.DELIVERED) {
    return <CheckCheck size={14} style={{ color: token.colorTextQuaternary }} />;
  }
  if (status === FMS.SENT) {
    return <Check size={14} style={{ color: token.colorTextQuaternary }} />;
  }
  return null;
}

function receiptEvidenceStatus(status: FriendMessageStatus): string {
  if (status === FMS.READ) return 'read';
  if (status === FMS.DELIVERED) return 'delivered';
  if (status === FMS.SENT) return 'sent';
  return 'unknown';
}

function ReplyBlock({
  isOwn,
  messages,
  replyToUlid,
}: {
  isOwn: boolean;
  messages: ChatMessage[];
  replyToUlid: string;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const replyMsg = messages.find((m) => m.ulid === replyToUlid);

  return (
    <Flexbox
      data-message-reply-target-state={replyMsg ? 'available' : 'unavailable'}
      style={{
        padding: '6px 9px',
        marginBottom: 8,
        borderLeft: `3px solid ${isOwn ? 'rgba(255,255,255,0.55)' : token.colorPrimary}`,
        borderRadius: 8,
        background: isOwn ? 'rgba(255,255,255,0.14)' : token.colorFillTertiary,
        fontSize: 11,
        color: isOwn ? 'rgba(255,255,255,0.8)' : token.colorTextSecondary,
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <Text
        ellipsis
        style={{
          fontSize: 11,
          color: isOwn ? 'rgba(255,255,255,0.8)' : token.colorTextSecondary,
        }}
      >
        {replyMsg?.content ?? t('chat.social.messageArea.replyTargetUnavailable')}
      </Text>
    </Flexbox>
  );
}

function ThreadReplyPreviewList({
  activeConversationId,
  activeKind,
  currentUserDid,
  getSenderProfile,
  isOwnRoot,
  messages,
  onOpenThread,
  totalCount,
  unreadCount,
}: {
  activeConversationId: string;
  activeKind: ChatSurfaceKind;
  currentUserDid: string | null;
  getSenderProfile: (
    kind: ChatSurfaceKind,
    conversationUlid: string,
    senderId: string,
  ) => DesktopIMSenderProfileProjection;
  isOwnRoot: boolean;
  messages: ChatMessage[];
  onOpenThread: () => void;
  totalCount: number;
  unreadCount: number;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const previewMessages = messages;
  const hiddenEarlierCount = countHiddenEarlierChatThreadReplies(totalCount, previewMessages.length);
  const hasHiddenEarlierReplies = previewMessages.length > 0 && hiddenEarlierCount > 0;
  const openLabel = unreadCount > 0
    ? t('chat.social.thread.summaryUnread', { count: totalCount, unread: unreadCount })
    : t('chat.social.thread.summary', { count: totalCount });
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpenThread();
  };

  return (
    <Flexbox
      align="flex-start"
      style={{
        alignSelf: isOwnRoot ? 'flex-end' : 'flex-start',
        marginTop: 5,
        maxWidth: '100%',
        paddingLeft: isOwnRoot ? 0 : 4,
        paddingRight: isOwnRoot ? 4 : 0,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenThread}
        onKeyDown={handleKeyDown}
        aria-label={openLabel}
        title={openLabel}
        style={{
          display: 'grid',
          gridTemplateColumns: '9px minmax(0, 1fr)',
          columnGap: 7,
          maxWidth: 'min(320px, 100%)',
          padding: '1px 0 0',
          border: 0,
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 1,
            minHeight: previewMessages.length > 0 ? '100%' : 18,
            marginLeft: 4,
            background: unreadCount > 0 ? token.colorErrorBorder : token.colorBorderSecondary,
            opacity: unreadCount > 0 ? 0.9 : 0.72,
          }}
        />
        <Flexbox
          gap={3}
          style={{
            maxWidth: '100%',
            minWidth: 0,
          }}
        >
          {previewMessages.length === 0 ? (
            <Flexbox
              horizontal
              align="center"
              gap={5}
              style={{
                height: 18,
                color: token.colorTextQuaternary,
                fontSize: 11,
                lineHeight: '18px',
              }}
            >
              <MessagesSquare size={11} />
              <Text
                ellipsis
                style={{
                  color: unreadCount > 0 ? token.colorError : token.colorTextTertiary,
                  fontSize: 11,
                  lineHeight: '18px',
                  maxWidth: 220,
                }}
              >
                {openLabel}
              </Text>
            </Flexbox>
          ) : (
            <>
              {hasHiddenEarlierReplies && (
                <Text
                  ellipsis
                  style={{
                    maxWidth: '100%',
                    color: unreadCount > 0 ? token.colorError : token.colorTextTertiary,
                    fontSize: 11,
                    lineHeight: '18px',
                  }}
                >
                  {t('chat.social.thread.loadEarlierPreview', { count: hiddenEarlierCount })}
                </Text>
              )}
              {previewMessages.map((reply) => {
                const profile = getSenderProfile(activeKind, activeConversationId, reply.senderId);
                const ownReply = isOwnMessage(reply, currentUserDid);
                return (
                  <div
                    key={reply.ulid}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'max-content minmax(0, 1fr)',
                      alignItems: 'baseline',
                      columnGap: 5,
                      width: '100%',
                      minHeight: 18,
                      color: token.colorTextSecondary,
                      textAlign: 'left',
                    }}
                  >
                    <Text
                      ellipsis
                      style={{
                        maxWidth: 92,
                        fontSize: 11,
                        color: token.colorTextTertiary,
                        fontWeight: 500,
                        lineHeight: 1.35,
                      }}
                    >
                      {ownReply ? t('chat.social.thread.you') : profile.name}
                    </Text>
                    <Text
                      ellipsis
                      style={{
                        minWidth: 0,
                        fontSize: 11,
                        color: token.colorTextSecondary,
                        lineHeight: 1.35,
                      }}
                    >
                      {reply.content || reply.attachments?.[0]?.filename || t('chat.social.thread.attachment')}
                    </Text>
                  </div>
                );
              })}
            </>
          )}
        </Flexbox>
      </div>
    </Flexbox>
  );
}

export function ChatMessageRowInteractionStyle() {
  const { token } = theme.useToken();
  const rowInteractionStyle = `
    .msg-row.highlighted .msg-bubble {
      box-shadow: 0 0 0 2px ${token.colorPrimaryBorder}, ${token.boxShadowSecondary} !important;
    }
    .msg-row:focus-visible {
      outline: 2px solid ${token.colorPrimaryBorder};
      outline-offset: 3px;
      border-radius: 12px;
    }
  `;

  return <style>{rowInteractionStyle}</style>;
}

export const ChatMessageRow = memo(function ChatMessageRow({
  activeConversationId,
  activeKind,
  currentUserDid,
  density = 'regular',
  getSenderProfile,
  highlighted,
  message,
  messages,
  onActionTargetChange,
  onActionTargetLeave,
  onOpenThread,
  onPin,
  onReact,
  onRetryReaction,
  reactionMutationEmoji,
  reactionMutationPhase,
  reactions,
  pinned = false,
  showHoverActions = true,
  showThreadSummary = true,
  threadPreviewMessages,
  threadReplyCount,
  threadReplyIds,
  threadUnreadCount,
  timelineGap,
}: ChatMessageRowProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const isOwn = isOwnMessage(message, currentUserDid);
  const isGroup = !isFriendMessage(message);
  const senderProfile = getSenderProfile(activeKind, activeConversationId, message.senderId);
  const senderName = senderProfile.name;
  const senderAvatar = senderProfile.avatar;
  const replyToUlid = messageReplyToUlid(message);
  const encryptedPlaceholder = isEncryptedPlaceholder(message);
  const isRecalled = isRecalledMessage(message);
  const editedAtMs = messageEditedAtMs(message);
  const readByPtids = message.readByPtids ?? [];
  const attachments = message.attachments || [];
  const mediaOnlyMessage = !isRecalled
    && !encryptedPlaceholder
    && message.content.trim().length === 0
    && attachments.length > 0
    && attachments.every(isVisualMessageAttachment);
  const threadRootUlid = messageThreadRootUlid(message) || message.ulid;
  const compact = density === 'compact';
  const layout = chatVisualLayoutForSurface(compact ? 'desktop-thread' : 'desktop-main');
  const avatarSize = layout.avatarSize;
  const avatarGap = layout.avatarGap;
  const messageContentRef = useRef<HTMLDivElement>(null);

  const bubbleBg = mediaOnlyMessage
    ? 'transparent'
    : isOwn
      ? token.colorPrimary
      : token.colorBgContainer;
  const bubbleColor = isOwn && !mediaOnlyMessage ? '#fff' : token.colorText;
  const bubbleRadius: CSSProperties['borderRadius'] = isOwn
    ? layout.ownBubbleRadius
    : layout.peerBubbleRadius;
  const bubbleBorder = mediaOnlyMessage
    ? '1px solid transparent'
    : isOwn
      ? '1px solid transparent'
      : `1px solid ${token.colorBorderSecondary}`;

  return (
    <Flexbox
      data-message-ulid={message.ulid}
      data-pt-message-item={message.ulid}
      data-message-edited={editedAtMs ? 'true' : 'false'}
      data-message-retracted={isRecalled ? 'true' : 'false'}
      data-message-reply-to={replyToUlid || ''}
      data-message-thread-root={messageThreadRootUlid(message) || ''}
      data-message-thread-reply-count={threadReplyCount}
      data-message-thread-reply-ids={threadReplyIds.join(',')}
      data-message-read-by={readByPtids.join(',')}
      data-message-authority-sequence={message.eventSequence}
      data-message-attachment-count={attachments.length}
      className={`msg-row ${highlighted ? 'highlighted' : ''}`}
      tabIndex={0}
      onMouseEnter={() => {
        if (showHoverActions && messageContentRef.current) {
          onActionTargetChange(message, messageContentRef.current, false);
        }
      }}
      onMouseLeave={onActionTargetLeave}
      onFocusCapture={() => {
        if (showHoverActions && messageContentRef.current) {
          onActionTargetChange(message, messageContentRef.current, false);
        }
      }}
      onBlurCapture={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        onActionTargetLeave();
      }}
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget
          || (event.key !== 'Enter' && event.key !== ' ')
          || !showHoverActions
          || !messageContentRef.current
        ) {
          return;
        }
        event.preventDefault();
        onActionTargetChange(message, messageContentRef.current, true);
      }}
      horizontal
      align="flex-start"
      justify={isOwn ? 'flex-end' : 'flex-start'}
      style={{
        alignSelf: isOwn ? 'flex-end' : 'flex-start',
        maxWidth: chatMessageRowMaxWidth(layout, { own: isOwn, groupPeer: isGroup }),
        width: 'fit-content',
        position: 'relative',
        marginTop: timelineGap ? (compact ? 6 : 8) : 0,
      }}
      gap={avatarGap}
    >
      {!isOwn && (
        <Popover
          content={
            <Flexbox gap={4} style={{ minWidth: 120 }}>
              <Text strong style={{ fontSize: 13 }}>{senderName}</Text>
              <Text type="secondary" ellipsis style={{ fontSize: 11, maxWidth: 180 }}>
                {message.senderId}
              </Text>
            </Flexbox>
          }
          trigger="click"
          placement="rightTop"
        >
          <div
            data-chat-avatar-ptid={message.senderId}
            data-chat-avatar-src={senderAvatar || ''}
            style={{ cursor: 'pointer', flexShrink: 0 }}
          >
            <UserSquareAvatar
              remoteUrl={senderAvatar}
              name={senderName}
              size={avatarSize}
            />
          </div>
        </Popover>
      )}

      <Flexbox
        align={isOwn ? 'flex-end' : 'flex-start'}
        style={{
          position: 'relative',
          minWidth: 0,
          width: 'fit-content',
          maxWidth: `calc(100% - ${avatarSize + avatarGap}px)`,
        }}
      >
        {!isOwn && isGroup && (
          <Text
            type="secondary"
            style={{
              fontSize: compact ? 10 : 11,
              marginBottom: compact ? 3 : 4,
              paddingLeft: 4,
              color: token.colorTextTertiary,
              fontWeight: 500,
            }}
          >
            {senderName}
          </Text>
        )}

        <Flexbox
          ref={messageContentRef}
          data-message-content={message.ulid}
          className="msg-bubble"
          style={{
            alignSelf: isOwn ? 'flex-end' : 'flex-start',
            width: mediaOnlyMessage ? 'fit-content' : undefined,
            maxWidth: '100%',
            minWidth: mediaOnlyMessage ? undefined : layout.bubbleMinWidth,
            padding: mediaOnlyMessage ? layout.mediaBubblePadding : layout.bubblePadding,
            borderRadius: bubbleRadius,
            background: isRecalled ? token.colorFillQuaternary : bubbleBg,
            border: isRecalled ? `1px solid ${token.colorBorderSecondary}` : bubbleBorder,
            boxShadow: mediaOnlyMessage ? 'none' : isOwn ? token.boxShadowTertiary : token.boxShadowSecondary,
            color: isRecalled ? token.colorTextSecondary : bubbleColor,
            fontSize: compact ? 12 : 13,
            lineHeight: 1.5,
            wordBreak: 'break-word',
            fontStyle: isRecalled ? 'italic' : 'normal',
          }}
        >
          <ChatMessageContent
            message={message}
            isOwn={isOwn}
            replyBlock={replyToUlid && !isRecalled ? (
              <ReplyBlock
                replyToUlid={replyToUlid}
                messages={messages}
                isOwn={isOwn}
              />
            ) : undefined}
          />
        </Flexbox>

        {pinned && (
          <Tooltip title={t('chat.social.contextMenu.unpin')}>
            <Pin
              data-message-pinned="true"
              size={12}
              style={{
                marginTop: 3,
                color: token.colorTextTertiary,
                cursor: 'pointer',
              }}
              onClick={() => onPin(message)}
            />
          </Tooltip>
        )}

        {reactions && reactions.length > 0 && (
          <Flexbox
            horizontal
            wrap="wrap"
            gap={4}
            style={{ marginTop: 2, paddingLeft: isOwn ? 0 : 4, paddingRight: isOwn ? 4 : 0 }}
          >
            {Object.entries(
              reactions.reduce<Record<string, number>>((acc, r) => {
                acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
                return acc;
              }, {}),
            ).map(([emoji, count]) => (
              <button
                type="button"
                data-message-reaction={emoji}
                key={emoji}
                style={{
                  fontSize: 12,
                  padding: '1px 5px',
                  border: 0,
                  borderRadius: 10,
                  background: token.colorFillTertiary,
                  cursor: 'pointer',
                }}
                aria-label={`${t('chat.social.messageArea.actionReact')} ${emoji}`}
                onClick={() => onReact(message, emoji)}
              >
                {emoji} {count > 1 ? count : ''}
              </button>
            ))}
          </Flexbox>
        )}

        {reactionMutationPhase && (
          <Flexbox
            data-message-reaction-state={reactionMutationPhase}
            data-message-reaction-emoji={reactionMutationEmoji}
            horizontal
            align="center"
            gap={6}
            aria-live="polite"
            aria-busy={reactionMutationPhase !== 'error'}
            style={{
              alignSelf: isOwn ? 'flex-end' : 'flex-start',
              marginTop: 3,
              paddingLeft: isOwn ? 0 : 4,
              paddingRight: isOwn ? 4 : 0,
              color: reactionMutationPhase === 'error'
                ? token.colorError
                : token.colorTextTertiary,
              fontSize: 11,
            }}
          >
            {reactionMutationPhase === 'error' ? (
              <>
                <Text type="danger" style={{ fontSize: 11 }}>
                  {t('chat.message.resolution.actionFailed')}
                </Text>
                <Button
                  data-message-reaction-retry={message.ulid}
                  type="text"
                  size="small"
                  onClick={() => onRetryReaction(message)}
                  style={{ height: 24, paddingInline: 6 }}
                >
                  {t('chat.message.action.retry')}
                </Button>
              </>
            ) : (
              <Spin size="small" />
            )}
          </Flexbox>
        )}

        {showThreadSummary && threadReplyCount > 0 && !isRecalled && (
          <ThreadReplyPreviewList
            activeConversationId={activeConversationId}
            activeKind={activeKind}
            currentUserDid={currentUserDid}
            getSenderProfile={getSenderProfile}
            isOwnRoot={isOwn}
            messages={threadPreviewMessages}
            onOpenThread={() => onOpenThread(threadRootUlid)}
            totalCount={threadReplyCount}
            unreadCount={threadUnreadCount}
          />
        )}

        <Flexbox
          horizontal
          align="center"
          justify={isOwn ? 'flex-end' : 'flex-start'}
          gap={5}
          style={{
            alignSelf: isOwn ? 'flex-end' : 'flex-start',
            marginTop: compact ? 3 : 4,
            paddingLeft: isOwn ? 0 : 4,
            paddingRight: isOwn ? 4 : 0,
            maxWidth: '100%',
          }}
        >
          <Text
            style={{
              fontSize: compact ? 10 : 11,
              color: token.colorTextTertiary,
              lineHeight: 1.2,
            }}
          >
            {formatMsgTime(message.sentAtMs)}
          </Text>
          {editedAtMs && !isRecalled && (
            <Tooltip title={
              t('chat.social.messageArea.editedAtTooltip', {
                time: new Date(editedAtMs).toLocaleString(),
              })
            }>
              <Text
                style={{
                  fontSize: 11,
                  color: token.colorTextTertiary,
                  fontStyle: 'italic',
                  lineHeight: 1.2,
                }}
              >
                {t('chat.social.messageArea.editedTag')}
              </Text>
            </Tooltip>
          )}
          {isOwn && isGroup && readByPtids.length > 0 && !isRecalled && (
            <Text
              data-message-read-state="read"
              style={{
                fontSize: 11,
                color: token.colorTextTertiary,
                lineHeight: 1.2,
              }}
            >
              {t('chat.social.messageArea.readByCount', { count: readByPtids.length })}
            </Text>
          )}
          {isOwn && isFriendMessage(message) && !isRecalled && (
            <span data-message-receipt={receiptEvidenceStatus(message.status as FriendMessageStatus)}>
              <ReadReceipt status={message.status as FriendMessageStatus} />
            </span>
          )}
        </Flexbox>
      </Flexbox>

      {isOwn && (
        <span
          data-chat-avatar-ptid={currentUserDid || message.senderId}
          data-chat-avatar-src={senderAvatar || ''}
          style={{ display: 'contents' }}
        >
          <UserSquareAvatar
            remoteUrl={senderAvatar}
            name={senderName}
            size={avatarSize}
            style={{ flexShrink: 0 }}
          />
        </span>
      )}
    </Flexbox>
  );
});
