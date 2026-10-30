import { memo, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@lobehub/ui';
import { Popover, Spin, theme, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { countHiddenEarlierChatThreadReplies } from '@peers-touch/client-chat-core';
import {
  Check,
  CheckCheck,
  MessagesSquare,
  Pin,
  RotateCcw,
} from 'lucide-react';

import { UserSquareAvatar } from '../../common/UserSquareAvatar';
import {
  desktopChatLayoutForSurface,
  desktopChatMessageRowMaxWidth,
} from '../chatPresentationPolicy';
import {
  CHAT_MESSAGE_METADATA_RAIL_HEIGHT,
  CHAT_MESSAGE_REACTION_CHIP_HEIGHT,
  CHAT_MESSAGE_SPACING,
} from '../chatGeometry';
import { MessageStatus } from '../../../gen/proto/domain/chat/chat_pb';
import type { DesktopIMSenderProfileProjection } from '../../../store/socialProjection';
import { actorDisplayName } from '../../../store/socialProfileProjection';
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
import type { ServiceEventAggregation } from './serviceEventAggregation';

const { Text } = Typography;

interface ChatMessageRowProps {
  activeConversationId: string;
  activeKind: ChatSurfaceKind;
  serviceAggregation?: ServiceEventAggregation;
  onToggleServiceAggregation?: (key: string) => void;
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
  threadPreviewMessages: ChatMessage[];
  threadUnreadCount: number;
  timelineGap: boolean;
}

function formatMsgTime(sentAtMs: number): string {
  if (sentAtMs <= 0) return '';
  const d = new Date(sentAtMs);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ReadReceipt({ status }: { status: MessageStatus }) {
  const { token } = theme.useToken();
  if (status === MessageStatus.READ) {
    return <CheckCheck size={14} style={{ color: token.colorPrimary }} />;
  }
  if (status === MessageStatus.DELIVERED) {
    return <CheckCheck size={14} style={{ color: token.colorTextQuaternary }} />;
  }
  if (status === MessageStatus.SENT) {
    return <Check size={14} style={{ color: token.colorTextQuaternary }} />;
  }
  return null;
}

function receiptEvidenceStatus(status: MessageStatus): string {
  if (status === MessageStatus.READ) return 'read';
  if (status === MessageStatus.DELIVERED) return 'delivered';
  if (status === MessageStatus.SENT) return 'sent';
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
  onPin,
  onReact,
  onRetryReaction,
  pinned,
  reactionMutationEmoji,
  reactionMutationPhase,
  reactions,
}: {
  isOwn: boolean;
  message: ChatMessage;
  onPin: () => void;
  onReact: (emoji: string) => void;
  onRetryReaction: () => void;
  pinned: boolean;
  reactionMutationEmoji?: string;
  reactionMutationPhase?: 'pending' | 'awaiting-projection' | 'error';
  reactions: { actorPtid: string; emoji: string }[];
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
  const hasContent = pinned
    || reactionCounts.length > 0
    || Boolean(reactionMutationPhase);

  if (!hasContent) return null;
  return (
    <Flexbox
      data-message-metadata-rail={message.ulid}
      data-message-metadata-state="populated"
      horizontal
      align="center"
      gap={4}
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

/**
 * Feishu-style inline thread summary rendered directly under the root
 * bubble. Shows the latest locally-known replies without opening the
 * thread panel; degrades to a count affordance when only the projected
 * reply count is known.
 */
function ThreadReplyPreviewList({
  activeConversationId,
  activeKind,
  currentUserPtid,
  getSenderProfile,
  isOwnRoot,
  messages,
  onOpenThread,
  totalCount,
  unreadCount,
}: {
  activeConversationId: string;
  activeKind: ChatSurfaceKind;
  currentUserPtid: string | null;
  getSenderProfile: (
    kind: ChatSurfaceKind,
    conversationUlid: string,
    senderPtid: string,
  ) => DesktopIMSenderProfileProjection;
  isOwnRoot: boolean;
  messages: ChatMessage[];
  onOpenThread: () => void;
  totalCount: number;
  unreadCount: number;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const hiddenEarlierCount = countHiddenEarlierChatThreadReplies(totalCount, messages.length);
  const hasHiddenEarlierReplies = messages.length > 0 && hiddenEarlierCount > 0;
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
      data-message-thread-summary={totalCount}
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
            minHeight: messages.length > 0 ? '100%' : 18,
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
          {messages.length === 0 ? (
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
              {messages.map((reply) => {
                const profile = getSenderProfile(activeKind, activeConversationId, reply.senderPtid);
                const ownReply = isOwnMessage(reply, currentUserPtid);
                const replySenderName = actorDisplayName(
                  profile.name,
                  t('chat.social.detail.unknownMember'),
                );
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
                      {ownReply ? t('chat.social.thread.you') : replySenderName}
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
    .msg-row[data-message-anchor-focused]:focus {
      outline: none;
    }
    .msg-row[data-message-anchor-focused]:focus .msg-bubble {
      box-shadow: 0 0 0 2px ${token.colorPrimaryBorder}, ${token.boxShadowSecondary} !important;
    }
    .msg-row.highlighted .msg-bubble {
      box-shadow: 0 0 0 2px ${token.colorPrimaryBorder}, ${token.boxShadowSecondary} !important;
    }
  `;

  return <style>{rowInteractionStyle}</style>;
}

export const ChatMessageRow = memo(function ChatMessageRow({
  activeConversationId,
  activeKind,
  serviceAggregation,
  onToggleServiceAggregation,
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
  threadPreviewMessages,
  threadUnreadCount,
  timelineGap,
}: ChatMessageRowProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const isOwn = isOwnMessage(message, currentUserPtid);
  const isGroup = !isFriendMessage(message);
  const senderProfile = getSenderProfile(activeKind, activeConversationId, message.senderPtid);
  const senderName = actorDisplayName(senderProfile.name, t('chat.social.detail.unknownMember'));
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
  const layout = desktopChatLayoutForSurface(
    compact ? 'desktop-thread' : 'desktop-main',
  );
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
        maxWidth: desktopChatMessageRowMaxWidth(layout, {
          own: isOwn,
          groupPeer: isGroup,
        }),
        width: 'fit-content',
        position: 'relative',
        marginTop: timelineGap ? (compact ? 6 : 8) : 0,
        paddingBottom: compact ? CHAT_MESSAGE_SPACING.compactItem : CHAT_MESSAGE_SPACING.item,
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
            serviceAggregation={serviceAggregation}
            onToggleServiceAggregation={onToggleServiceAggregation}
            replyBlock={replyToUlid && !isRecalled ? (
              <ReplyBlock
                replyToUlid={replyToUlid}
                messages={messages}
                isOwn={isOwn}
              />
            ) : undefined}
          />
        </Flexbox>

        {showThreadSummary && threadReplyCount > 0 && !isRecalled && (
          <ThreadReplyPreviewList
            activeConversationId={activeConversationId}
            activeKind={activeKind}
            currentUserPtid={currentUserPtid}
            getSenderProfile={getSenderProfile}
            isOwnRoot={isOwn}
            messages={threadPreviewMessages}
            onOpenThread={() => onOpenThread(threadRootUlid)}
            totalCount={threadReplyCount}
            unreadCount={threadUnreadCount}
          />
        )}

        <Flexbox
          data-message-meta={message.ulid}
          horizontal
          align="center"
          justify={isOwn ? 'flex-end' : 'flex-start'}
          gap={5}
          style={{
            alignSelf: isOwn ? 'flex-end' : 'flex-start',
            marginTop: CHAT_MESSAGE_SPACING.meta,
            paddingLeft: isOwn ? 0 : 4,
            paddingRight: isOwn ? 4 : 0,
            boxSizing: 'border-box',
            minHeight: 16,
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
            <span data-message-receipt={receiptEvidenceStatus(message.status as MessageStatus)}>
              <ReadReceipt status={message.status as MessageStatus} />
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
        <MessageInteractionRail
          isOwn={isOwn}
          message={message}
          onPin={() => onPin(message)}
          onReact={(emoji) => onReact(message, emoji)}
          onRetryReaction={() => onRetryReaction(message)}
          pinned={pinned}
          reactionMutationEmoji={reactionMutationEmoji}
          reactionMutationPhase={reactionMutationPhase}
          reactions={reactions ?? []}
        />
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
