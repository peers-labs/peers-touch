import { memo, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@lobehub/ui';
import { Popover, theme, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import {
  Check,
  CheckCheck,
  CornerUpRight,
  LoaderCircle,
  MessageSquareReply,
  MessagesSquare,
  Pencil,
  RotateCcw,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import {
  chatMessageRowMaxWidth,
  chatVisualLayoutForSurface,
  countHiddenEarlierChatThreadReplies,
  type ChatVisualLayoutContract,
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
  messageTimestampMs,
  type ChatMessage,
  type ChatSurfaceKind,
} from './chatMessageModel';

const { Text } = Typography;

/**
 * Mirrors `application.DefaultMutationWindow` on the Station side.
 * The server is still the source of truth; the UI only hides buttons
 * that are guaranteed to fail.
 */
const FRIEND_RECALL_WINDOW_MS = 4 * 60 * 1000 + 30 * 1000;

interface ChatMessageRowProps {
  actionVisibility?: Partial<Record<'delete' | 'edit' | 'recall' | 'reply' | 'thread', boolean>>;
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
  onDelete: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  onOpenThread: (rootUlid: string) => void;
  onReact: (message: ChatMessage) => void;
  onRecall: (message: ChatMessage) => void;
  onReply: (messageUlid: string) => void;
  onRetry: (message: ChatMessage) => void;
  reactions?: { actorId: string; emoji: string }[];
  showHoverActions?: boolean;
  showThreadSummary?: boolean;
  threadPreviewMessages: ChatMessage[];
  threadReplyCount: number;
  threadUnreadCount: number;
  timelineGap: boolean;
}

function formatMsgTime(sentAtMs: number): string {
  if (sentAtMs <= 0) return '';
  const d = new Date(sentAtMs);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ReadReceipt({
  status,
  onRetry,
}: {
  status: FriendMessageStatus;
  onRetry: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('common');
  if (status === FMS.SENDING) {
    return <LoaderCircle size={14} className="chat-composer-spin" style={{ color: token.colorTextQuaternary }} />;
  }
  if (status === FMS.FAILED) {
    return (
      <Tooltip title={t('common.action.retry')}>
        <button
          type="button"
          aria-label={t('common.action.retry')}
          onClick={onRetry}
          style={{
            display: 'inline-flex',
            padding: 0,
            border: 0,
            background: 'transparent',
            color: token.colorError,
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={14} />
        </button>
      </Tooltip>
    );
  }
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

interface HoverActionsProps {
  canEdit: boolean;
  canDelete: boolean;
  canOpenThread: boolean;
  canRecall: boolean;
  canReply: boolean;
  isOwn: boolean;
  layout: ChatVisualLayoutContract;
  onDelete: () => void;
  onEdit: () => void;
  onForward: () => void;
  onOpenThread: () => void;
  onReact: () => void;
  onRecall: () => void;
  onReply: () => void;
}

function HoverActions({
  canEdit,
  canDelete,
  canOpenThread,
  canRecall,
  canReply,
  isOwn,
  layout,
  onDelete,
  onEdit,
  onForward,
  onOpenThread,
  onReact,
  onRecall,
  onReply,
}: HoverActionsProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const actionButtonStyle: CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 8,
  };

  return (
    <Flexbox
      horizontal
      gap={3}
      style={{
        position: 'absolute',
        top: '100%',
        left: isOwn ? 'auto' : 0,
        right: isOwn ? 0 : 'auto',
        marginTop: 4,
        opacity: 0,
        transition: 'opacity 0.15s ease',
        pointerEvents: 'none',
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 10,
        padding: 3,
        boxShadow: token.boxShadowSecondary,
        zIndex: 2,
      }}
      className="msg-hover-actions"
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -layout.hoverActionBridgeHeight,
          left: 0,
          right: 0,
          height: layout.hoverActionBridgeHeight,
        }}
      />
      {canOpenThread && (
        <Tooltip title={t('chat.social.thread.open')}>
          <Button
            type="text"
            size="small"
            icon={<MessagesSquare size={14} />}
            onClick={onOpenThread}
            style={actionButtonStyle}
          />
        </Tooltip>
      )}
      <Tooltip title={t('chat.social.messageArea.actionReact')}>
        <Button
          type="text"
          size="small"
          icon={<SmilePlus size={14} />}
          onClick={onReact}
          style={actionButtonStyle}
        />
      </Tooltip>
      {canReply && (
        <Tooltip title={t('chat.social.messageArea.actionReply')}>
          <Button
            type="text"
            size="small"
            icon={<MessageSquareReply size={14} />}
            onClick={onReply}
            style={actionButtonStyle}
          />
        </Tooltip>
      )}
      <Tooltip title={t('chat.social.messageArea.actionForward')}>
        <Button
          type="text"
          size="small"
          icon={<CornerUpRight size={14} />}
          onClick={onForward}
          style={actionButtonStyle}
        />
      </Tooltip>
      {canEdit && (
        <Tooltip title={t('chat.social.messageArea.actionEdit')}>
          <Button
            type="text"
            size="small"
            icon={<Pencil size={14} />}
            onClick={onEdit}
            style={actionButtonStyle}
          />
        </Tooltip>
      )}
      {canRecall && (
        <Tooltip title={t('chat.social.messageArea.actionRecall')}>
          <Button
            type="text"
            size="small"
            icon={<RotateCcw size={14} />}
            onClick={onRecall}
            style={actionButtonStyle}
          />
        </Tooltip>
      )}
      {canDelete && (
        <Tooltip title={t('chat.social.messageArea.actionDelete')}>
          <Button
            type="text"
            size="small"
            icon={<Trash2 size={14} />}
            onClick={onDelete}
            style={{ ...actionButtonStyle, color: token.colorError }}
          />
        </Tooltip>
      )}
    </Flexbox>
  );
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
  const replyMsg = messages.find((m) => m.ulid === replyToUlid);
  if (!replyMsg) return null;

  return (
    <Flexbox
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
        {replyMsg.content}
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
    .msg-row:hover .msg-hover-actions,
    .msg-row:focus-within .msg-hover-actions {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    .msg-row.highlighted .msg-bubble {
      box-shadow: 0 0 0 2px ${token.colorPrimaryBorder}, ${token.boxShadowSecondary} !important;
    }
  `;

  return <style>{rowInteractionStyle}</style>;
}

export const ChatMessageRow = memo(function ChatMessageRow({
  actionVisibility,
  activeConversationId,
  activeKind,
  currentUserDid,
  density = 'regular',
  getSenderProfile,
  highlighted,
  message,
  messages,
  onDelete,
  onEdit,
  onForward,
  onOpenThread,
  onReact,
  onRecall,
  onReply,
  onRetry,
  reactions,
  showHoverActions = true,
  showThreadSummary = true,
  threadPreviewMessages,
  threadReplyCount,
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
  const attachments = message.attachments || [];
  const mediaOnlyMessage = !isRecalled
    && !encryptedPlaceholder
    && message.content.trim().length === 0
    && attachments.length > 0
    && attachments.every(isVisualMessageAttachment);
  const sentMs = messageTimestampMs(message);
  const withinWindow = sentMs > 0 && (Date.now() - sentMs) < FRIEND_RECALL_WINDOW_MS;
  const canOpenThread = actionVisibility?.thread !== false;
  const canReply = actionVisibility?.reply !== false;
  const canDelete = actionVisibility?.delete !== false;
  const canRecall = actionVisibility?.recall !== false && isOwn && !isRecalled && withinWindow;
  const canEdit = actionVisibility?.edit !== false && isOwn && !isRecalled && withinWindow && !encryptedPlaceholder;
  const threadRootUlid = messageThreadRootUlid(message) || message.ulid;
  const compact = density === 'compact';
  const layout = chatVisualLayoutForSurface(compact ? 'desktop-thread' : 'desktop-main');
  const avatarSize = layout.avatarSize;
  const avatarGap = layout.avatarGap;

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
      className={`msg-row ${highlighted ? 'highlighted' : ''}`}
      horizontal
      align="flex-start"
      justify={isOwn ? 'flex-end' : 'flex-start'}
      style={{
        alignSelf: isOwn ? 'flex-end' : 'flex-start',
        maxWidth: chatMessageRowMaxWidth(layout, { own: isOwn, groupPeer: isGroup }),
        width: 'fit-content',
        position: 'relative',
        marginTop: timelineGap ? (compact ? 6 : 8) : 0,
        paddingBottom: 38,
        marginBottom: -38,
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
          <div style={{ cursor: 'pointer', flexShrink: 0 }}>
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
        {showHoverActions && (
          <HoverActions
            isOwn={isOwn}
            canDelete={canDelete}
            canOpenThread={canOpenThread}
            canRecall={canRecall}
            canReply={canReply}
            canEdit={canEdit}
            layout={layout}
            onOpenThread={() => onOpenThread(threadRootUlid)}
            onReact={() => onReact(message)}
            onForward={() => onForward(message)}
            onReply={() => onReply(message.ulid)}
            onDelete={() => onDelete(message)}
            onRecall={() => onRecall(message)}
            onEdit={() => onEdit(message)}
          />
        )}

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
              <span
                key={emoji}
                style={{
                  fontSize: 12,
                  padding: '1px 5px',
                  borderRadius: 10,
                  background: token.colorFillTertiary,
                  cursor: 'pointer',
                }}
                onClick={() => onReact(message)}
              >
                {emoji} {count > 1 ? count : ''}
              </span>
            ))}
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
          {isOwn && isFriendMessage(message) && !isRecalled && (
            <ReadReceipt
              status={message.status as FriendMessageStatus}
              onRetry={() => onRetry(message)}
            />
          )}
        </Flexbox>
      </Flexbox>

      {isOwn && (
        <UserSquareAvatar
          remoteUrl={senderAvatar}
          name={senderName}
          size={avatarSize}
          style={{ flexShrink: 0 }}
        />
      )}
    </Flexbox>
  );
});
