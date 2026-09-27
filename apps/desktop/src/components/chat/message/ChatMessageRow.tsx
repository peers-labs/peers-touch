import { memo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@lobehub/ui';
import { Popover, Spin, theme, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import {
  Check,
  CheckCheck,
  MessagesSquare,
  Pin,
  RotateCcw,
} from 'lucide-react';
import {
  chatMessageRowMaxWidth,
  chatVisualLayoutForSurface,
} from '@peers-touch/client-chat-core';

import { UserSquareAvatar } from '../../common/UserSquareAvatar';
import {
  CHAT_MESSAGE_METADATA_RAIL_HEIGHT,
  CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
} from '../chatGeometry';
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
import { blocksMessageActionOverlay } from './messageReactionState';

const { Text } = Typography;

interface ChatMessageRowProps {
  activeConversationId: string;
  activeKind: ChatSurfaceKind;
  currentUserPtid: string | null;
  density?: 'regular' | 'compact';
  getSenderProfile: (
    kind: ChatSurfaceKind,
    conversationUlid: string,
    senderPtid: string,
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
  onRetryMessage: (message: ChatMessage) => void;
  onRetryReaction: (message: ChatMessage) => void;
  reactionMutationEmoji?: string;
  reactionMutationPhase?: 'pending' | 'awaiting-projection' | 'error';
  reactions?: { actorPtid: string; emoji: string }[];
  pinned?: boolean;
  showHoverActions?: boolean;
  showThreadSummary?: boolean;
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

function MessageInteractionRail({
  isOwn,
  message,
  onOpenThread,
  onPin,
  onReact,
  onRetryReaction,
  pinned,
  reactionMutationEmoji,
  reactionMutationPhase,
  reactions,
  showThreadSummary,
  threadReplyCount,
  threadUnreadCount,
}: {
  isOwn: boolean;
  message: ChatMessage;
  onOpenThread: () => void;
  onPin: () => void;
  onReact: (emoji: string) => void;
  onRetryReaction: () => void;
  pinned: boolean;
  reactionMutationEmoji?: string;
  reactionMutationPhase?: 'pending' | 'awaiting-projection' | 'error';
  reactions: { actorPtid: string; emoji: string }[];
  showThreadSummary: boolean;
  threadReplyCount: number;
  threadUnreadCount: number;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const reactionCounts = Object.entries(
    reactions.reduce<Record<string, number>>((acc, reaction) => {
      acc[reaction.emoji] = (acc[reaction.emoji] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const visibleReactions = reactionCounts.slice(0, 3);
  const hiddenReactionCount = reactionCounts
    .slice(visibleReactions.length)
    .reduce((total, [, count]) => total + count, 0);
  const threadVisible = showThreadSummary && threadReplyCount > 0;
  const hasContent = pinned
    || reactionCounts.length > 0
    || Boolean(reactionMutationPhase)
    || threadVisible;
  const openLabel = threadUnreadCount > 0
    ? t('chat.social.thread.summaryUnread', {
        count: threadReplyCount,
        unread: threadUnreadCount,
      })
    : t('chat.social.thread.summary', { count: threadReplyCount });

  return (
    <Flexbox
      data-message-metadata-rail={message.ulid}
      data-message-metadata-state={hasContent ? 'populated' : 'reserved'}
      horizontal
      align="center"
      gap={4}
      aria-hidden={hasContent ? undefined : true}
      style={{
        alignSelf: isOwn ? 'flex-end' : 'flex-start',
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '100%',
        height: CHAT_MESSAGE_METADATA_RAIL_HEIGHT,
        minHeight: CHAT_MESSAGE_METADATA_RAIL_HEIGHT,
        maxHeight: CHAT_MESSAGE_METADATA_RAIL_HEIGHT,
        marginTop: 2,
        paddingLeft: isOwn ? 0 : 4,
        paddingRight: isOwn ? 4 : 0,
        overflow: 'hidden',
        visibility: hasContent ? 'visible' : 'hidden',
        pointerEvents: hasContent ? 'auto' : 'none',
      }}
    >
      <Flexbox
        horizontal
        align="center"
        gap={4}
        style={{
          minWidth: 0,
          flex: 1,
          height: CHAT_MESSAGE_METADATA_RAIL_HEIGHT,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {pinned && (
          <Tooltip title={t('chat.social.contextMenu.unpin')}>
            <Button
              data-message-pinned="true"
              aria-label={t('chat.social.contextMenu.unpin')}
              type="text"
              size="small"
              icon={<Pin size={11} />}
              onClick={onPin}
              style={{
                width: CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
                minWidth: CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
                height: CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
                padding: 0,
                color: token.colorTextQuaternary,
              }}
            />
          </Tooltip>
        )}
        {visibleReactions.map(([emoji, count]) => (
          <button
            type="button"
            data-message-reaction={emoji}
            key={emoji}
            aria-label={`${t('chat.social.messageArea.actionReact')} ${emoji}`}
            onClick={() => onReact(emoji)}
            style={{
              boxSizing: 'border-box',
              flexShrink: 0,
              height: CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
              padding: '0 5px',
              border: 0,
              borderRadius: 8,
              background: token.colorFillTertiary,
              color: token.colorTextSecondary,
              cursor: 'pointer',
              fontSize: 11,
              lineHeight: `${CHAT_MESSAGE_REACTION_CHIP_HEIGHT}px`,
              whiteSpace: 'nowrap',
            }}
          >
            {emoji}{count > 1 ? ` ${count}` : ''}
          </button>
        ))}
        {hiddenReactionCount > 0 && (
          <Tooltip title={reactionCounts.slice(3).map(([emoji, count]) => `${emoji} ${count}`).join(' · ')}>
            <span
              data-message-reaction-overflow={hiddenReactionCount}
              style={{
                flexShrink: 0,
                height: CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
                padding: '0 5px',
                borderRadius: 8,
                background: token.colorFillQuaternary,
                color: token.colorTextTertiary,
                fontSize: 11,
                lineHeight: `${CHAT_MESSAGE_REACTION_CHIP_HEIGHT}px`,
              }}
            >
              +{hiddenReactionCount}
            </span>
          </Tooltip>
        )}
        {threadVisible && (
          <button
            type="button"
            data-message-thread-summary={threadReplyCount}
            aria-label={openLabel}
            title={openLabel}
            onClick={onOpenThread}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              boxSizing: 'border-box',
              flexShrink: 0,
              height: CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
              padding: '0 6px',
              border: 0,
              borderRadius: 8,
              background: threadUnreadCount > 0
                ? token.colorErrorBg
                : token.colorFillQuaternary,
              color: threadUnreadCount > 0
                ? token.colorError
                : token.colorTextTertiary,
              cursor: 'pointer',
              fontSize: 11,
              lineHeight: `${CHAT_MESSAGE_REACTION_CHIP_HEIGHT}px`,
              whiteSpace: 'nowrap',
            }}
          >
            <MessagesSquare size={11} aria-hidden />
            <span>{threadReplyCount}</span>
          </button>
        )}
      </Flexbox>
      <span
        data-message-reaction-state={reactionMutationPhase || 'idle'}
        data-message-reaction-emoji={reactionMutationEmoji}
        aria-live="polite"
        aria-busy={Boolean(reactionMutationPhase && reactionMutationPhase !== 'error')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          minWidth: 24,
          height: CHAT_MESSAGE_METADATA_RAIL_HEIGHT,
          overflow: 'hidden',
        }}
      >
        {reactionMutationPhase === 'error' ? (
          <Tooltip title={t('chat.message.resolution.actionFailed')}>
            <Button
              data-message-reaction-retry={message.ulid}
              aria-label={t('chat.message.action.retry')}
              type="text"
              size="small"
              icon={<RotateCcw size={11} />}
              onClick={onRetryReaction}
              style={{ width: 20, minWidth: 20, height: 20, padding: 0 }}
            />
          </Tooltip>
        ) : reactionMutationPhase ? (
          <Spin size="small" />
        ) : (
          <span
            aria-hidden
            style={{ width: CHAT_MESSAGE_REACTION_CHIP_HEIGHT, height: CHAT_MESSAGE_REACTION_CHIP_HEIGHT }}
          />
        )}
      </span>
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
  currentUserPtid,
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
  onRetryMessage,
  onRetryReaction,
  reactionMutationEmoji,
  reactionMutationPhase,
  reactions,
  pinned = false,
  showHoverActions = true,
  showThreadSummary = true,
  threadReplyCount,
  threadReplyIds,
  threadUnreadCount,
  timelineGap,
}: ChatMessageRowProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const isOwn = isOwnMessage(message, currentUserPtid);
  const isGroup = !isFriendMessage(message);
  const senderProfile = getSenderProfile(activeKind, activeConversationId, message.senderPtid);
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
  const messageActionAnchorRef = useRef<HTMLDivElement>(null);
  const messageActionsAvailable = showHoverActions
    && !blocksMessageActionOverlay(reactionMutationPhase);
  const retryableFailure = isOwn
    && message.deliveryState === 'failed'
    && !isRecalled;
  const pendingStateLabel = isOwn && !isRecalled
    ? {
        draft: t('chat.social.messageArea.stateQueued'),
        pending: t('chat.social.messageArea.stateQueued'),
        retry_wait: t('chat.social.messageArea.stateRetrying'),
        submitted: t('chat.social.messageArea.stateSubmitted'),
        failed: t('chat.social.messageArea.stateFailed'),
      }[message.deliveryState]
    : undefined;

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
        if (messageActionsAvailable && messageActionAnchorRef.current) {
          onActionTargetChange(message, messageActionAnchorRef.current, false);
        }
      }}
      onMouseLeave={onActionTargetLeave}
      onFocusCapture={() => {
        if (messageActionsAvailable && messageActionAnchorRef.current) {
          onActionTargetChange(message, messageActionAnchorRef.current, false);
        }
      }}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget instanceof Node
          && event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        onActionTargetLeave();
      }}
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget
          || (event.key !== 'Enter' && event.key !== ' ')
          || !messageActionsAvailable
          || !messageActionAnchorRef.current
        ) {
          return;
        }
        event.preventDefault();
        onActionTargetChange(message, messageActionAnchorRef.current, true);
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
                {message.senderPtid}
              </Text>
            </Flexbox>
          }
          trigger="click"
          placement="rightTop"
        >
          <div
            data-chat-avatar-ptid={message.senderPtid}
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
        ref={messageActionAnchorRef}
        data-message-action-anchor={message.ulid}
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

        <MessageInteractionRail
          isOwn={isOwn}
          message={message}
          onOpenThread={() => onOpenThread(threadRootUlid)}
          onPin={() => onPin(message)}
          onReact={(emoji) => onReact(message, emoji)}
          onRetryReaction={() => onRetryReaction(message)}
          pinned={pinned}
          reactionMutationEmoji={reactionMutationEmoji}
          reactionMutationPhase={reactionMutationPhase}
          reactions={reactions ?? []}
          showThreadSummary={showThreadSummary && !isRecalled}
          threadReplyCount={threadReplyCount}
          threadUnreadCount={threadUnreadCount}
        />

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
            boxSizing: 'border-box',
            height: 16,
            minHeight: 16,
            maxHeight: 16,
            maxWidth: '100%',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
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
          {pendingStateLabel && (
            <Text
              data-message-delivery-state={message.deliveryState}
              type={retryableFailure ? 'danger' : 'secondary'}
              style={{ fontSize: compact ? 10 : 11, lineHeight: 1.2 }}
            >
              {pendingStateLabel}
            </Text>
          )}
          {retryableFailure && (
            <Button
              data-message-retry={message.ulid}
              aria-label={t('chat.message.action.retry')}
              type="text"
              size="small"
              icon={<RotateCcw size={12} />}
              onClick={() => onRetryMessage(message)}
              style={{ height: 24, paddingInline: 5 }}
            >
              {t('chat.message.action.retry')}
            </Button>
          )}
        </Flexbox>
      </Flexbox>

      {isOwn && (
        <span
          data-chat-avatar-ptid={currentUserPtid || message.senderPtid}
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
