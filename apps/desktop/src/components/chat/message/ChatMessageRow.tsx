import { memo, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button as PtButton,
  Popover as PtPopover,
  Spin as PtSpin,
  Text as PtText,
  Tooltip as PtTooltip,
} from '@peers-touch/ui';
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
  isBareEmojiOnlyMessage,
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
import { DeliveryVerdictMeta } from './DeliveryVerdictMeta';
import { MessageSenderProfileCard } from './MessageSenderProfileCard';
import type { ServiceEventAggregation } from './serviceEventAggregation';

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
  // North-star .sk-msg-status grammar: 11px ticks, color owned by the
  // .sc-msg-status.is-* wrapper state class, never inline.
  if (status === MessageStatus.READ || status === MessageStatus.DELIVERED) {
    return <CheckCheck size={11} />;
  }
  if (status === MessageStatus.SENT) {
    return <Check size={11} />;
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
  const { t } = useTranslation('chat');
  const replyMsg = messages.find((m) => m.ulid === replyToUlid);

  return (
    <div
      className="sc-reply-quote"
      data-message-reply-target-state={replyMsg ? 'available' : 'unavailable'}
      data-own={isOwn ? 'true' : 'false'}
    >
      <span className="sc-reply-quote__text">
        {replyMsg?.content ?? t('chat.social.messageArea.replyTargetUnavailable')}
      </span>
    </div>
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
  currentUserPtid,
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
  currentUserPtid: string | null;
}) {
  const { t } = useTranslation('chat');
  // Group reaction events by emoji while remembering whether the current
  // viewer reacted, so the chip can take the solid accent "mine" state
  // (prototype .sk-msg-reaction[data-mine="1"] parity).
  const reactionGroups = Object.entries(
    reactions.reduce<Record<string, { count: number; mine: boolean }>>((acc, reaction) => {
      const entry = acc[reaction.emoji] ?? { count: 0, mine: false };
      entry.count += 1;
      if (currentUserPtid && reaction.actorPtid === currentUserPtid) entry.mine = true;
      acc[reaction.emoji] = entry;
      return acc;
    }, {}),
  ).sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]));
  const reactionCounts = reactionGroups.map(([emoji, group]) => [emoji, group.count] as const);
  const mineByEmoji = new Map(reactionGroups.map(([emoji, group]) => [emoji, group.mine]));
  const visibleReactions = reactionCounts.slice(0, 3);
  const hiddenReactionCount = reactionCounts
    .slice(visibleReactions.length)
    .reduce((total, [, count]) => total + count, 0);
  const hasContent = pinned
    || reactionCounts.length > 0
    || Boolean(reactionMutationPhase);

  if (!hasContent) return null;
  return (
    <div
      data-message-metadata-rail={message.ulid}
      data-message-metadata-state="populated"
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
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          minWidth: 0,
          flex: 1,
          height: CHAT_MESSAGE_METADATA_RAIL_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {pinned && (
          <PtTooltip label={t('chat.social.contextMenu.unpin')}>
            <PtButton
              actionId={`message-pin-${message.ulid}`}
              data-message-pinned="true"
              aria-label={t('chat.social.contextMenu.unpin')}
              emphasis="quiet"
              density="compact"
              leading={<Pin size={11} />}
              onActivate={onPin}
              className="sc-reaction-icon"
            />
          </PtTooltip>
        )}
        {visibleReactions.map(([emoji, count]) => (
          <button
            type="button"
            data-message-reaction={emoji}
            data-mine={mineByEmoji.get(emoji) ? 'true' : 'false'}
            aria-pressed={mineByEmoji.get(emoji) ?? false}
            key={emoji}
            aria-label={`${t('chat.social.messageArea.actionReact')} ${emoji}`}
            onClick={() => onReact(emoji)}
            className={`sc-reaction-chip${mineByEmoji.get(emoji) ? ' sc-reaction-chip--mine' : ''}`}
          >
            {emoji}{count > 1 ? ` ${count}` : ''}
          </button>
        ))}
        {hiddenReactionCount > 0 && (
          <PtTooltip label={reactionCounts.slice(3).map(([emoji, count]) => `${emoji} ${count}`).join(' · ')}>
            <span className="sc-reaction-chip sc-reaction-chip--overflow" data-message-reaction-overflow={hiddenReactionCount}>
              +{hiddenReactionCount}
            </span>
          </PtTooltip>
        )}
      </div>
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
          <PtTooltip label={t('chat.message.resolution.actionFailed')}>
            <PtButton
              actionId={`message-reaction-retry-${message.ulid}`}
              data-message-reaction-retry={message.ulid}
              aria-label={t('chat.message.action.retry')}
              emphasis="quiet"
              density="compact"
              leading={<RotateCcw size={11} />}
              onActivate={onRetryReaction}
              className="sc-reaction-icon sc-reaction-icon--retry"
            />
          </PtTooltip>
        ) : reactionMutationPhase ? (
          <PtSpin size="small" />
        ) : (
          <span
            aria-hidden
            style={{ width: CHAT_MESSAGE_REACTION_CHIP_HEIGHT, height: CHAT_MESSAGE_REACTION_CHIP_HEIGHT }}
          />
        )}
      </span>
    </div>
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
    <div
      className={`sc-thread-preview-wrap${isOwnRoot ? ' is-own' : ''}`}
      data-message-thread-summary={totalCount}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenThread}
        onKeyDown={handleKeyDown}
        aria-label={openLabel}
        title={openLabel}
        className="sc-thread-preview"
      >
        <span
          aria-hidden="true"
          className="sc-thread-preview__rail"
          data-unread={unreadCount > 0 ? 'true' : 'false'}
        />
        <div className="sc-thread-preview__body">
          {messages.length === 0 ? (
            <div className="sc-thread-preview__count">
              <MessagesSquare size={11} />
              <PtText
                truncate
                className="sc-thread-preview__label"
                tone={unreadCount > 0 ? 'danger' : 'muted'}
              >
                {openLabel}
              </PtText>
            </div>
          ) : (
            <>
              {hasHiddenEarlierReplies && (
                <PtText truncate className="sc-thread-preview__label" tone={unreadCount > 0 ? 'danger' : 'muted'}>
                  {t('chat.social.thread.loadEarlierPreview', { count: hiddenEarlierCount })}
                </PtText>
              )}
              {messages.map((reply) => {
                const profile = getSenderProfile(activeKind, activeConversationId, reply.senderPtid);
                const ownReply = isOwnMessage(reply, currentUserPtid);
                const replySenderName = actorDisplayName(
                  profile.name,
                  t('chat.social.detail.unknownMember'),
                );
                return (
                  <div key={reply.ulid} className="sc-thread-preview__reply">
                    <PtText truncate className="sc-thread-preview__sender" tone="muted">
                      {ownReply ? t('chat.social.thread.you') : replySenderName}
                    </PtText>
                    <PtText truncate className="sc-thread-preview__snippet" tone="secondary">
                      {reply.content || reply.attachments?.[0]?.filename || t('chat.social.thread.attachment')}
                    </PtText>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatMessageRowInteractionStyle() {
  // North-star focus/highlight ring for message rows; token-driven so it
  // follows light/dark without a runtime antd token lookup.
  const rowInteractionStyle = `
    .msg-row[data-message-anchor-focused]:focus {
      outline: none;
    }
    .msg-row[data-message-anchor-focused]:focus .msg-bubble,
    .msg-row.highlighted .msg-bubble {
      box-shadow: 0 0 0 2px var(--pt-focus), var(--pt-shadow-rest) !important;
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
  const { t } = useTranslation('chat');
  const isOwn = isOwnMessage(message, currentUserPtid);
  const isGroup = !isFriendMessage(message);
  const senderProfile = getSenderProfile(activeKind, activeConversationId, message.senderPtid);
  const senderName = actorDisplayName(senderProfile.name, t('chat.social.detail.unknownMember'));
  const senderAvatar = senderProfile.avatar;
  const replyToUlid = messageReplyToUlid(message);
  const encryptedPlaceholder = isEncryptedPlaceholder(message);
  const isRecalled = isRecalledMessage(message);
  const serviceOnly = !isRecalled && !encryptedPlaceholder && Boolean(message.serviceMessage);
  const editedAtMs = messageEditedAtMs(message);
  const readByPtids = message.readByPtids ?? [];
  const attachments = message.attachments || [];
  const mediaOnlyMessage = !serviceOnly
    && !isRecalled
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
  // Prototype ConversationView: group message avatars use an 8px tile, direct
  // chats use the surface --sk-avatar-radius.
  const avatarRadius = isGroup ? 8 : layout.avatarRadius;
  const messageActionAnchorRef = useRef<HTMLDivElement>(null);
  const messageActionsAvailable = showHoverActions
    && !blocksMessageActionOverlay(reactionMutationPhase);
  const showDeliveryVerdict = isOwn && !isRecalled && !serviceOnly;

  // Prototype parity: a text-only message that is just emoji renders as a
  // bare enlarged glyph (no bubble background/border/padding/shadow).
  const emojiOnlyBare = isBareEmojiOnlyMessage(message);

  const bareCard = mediaOnlyMessage || serviceOnly || emojiOnlyBare;
  const bubbleBg = serviceOnly
    ? 'transparent'
    : mediaOnlyMessage
      ? 'transparent'
      : emojiOnlyBare
        ? 'transparent'
        : isOwn
          ? 'var(--pt-ownBubble)'
          : 'var(--pt-peerBubble)';
  const bubbleColor = isOwn && !bareCard ? 'var(--pt-onPrimary)' : 'var(--pt-text)';
  const bubbleRadius: CSSProperties['borderRadius'] = serviceOnly
    ? 0
    : isOwn
      ? layout.ownBubbleRadius
      : layout.peerBubbleRadius;
  const bubbleBorder = serviceOnly
    ? '1px solid transparent'
    : mediaOnlyMessage
      ? '1px solid transparent'
      : isRecalled
        ? '1px solid var(--pt-border)'
        : isOwn
          ? '1px solid transparent'
          : '1px solid var(--pt-border)';

  return (
    <div
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
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: isOwn ? 'flex-end' : 'flex-start',
        alignSelf: isOwn ? 'flex-end' : 'flex-start',
        gap: avatarGap,
        maxWidth: desktopChatMessageRowMaxWidth(layout, {
          own: isOwn,
          groupPeer: isGroup,
        }),
        width: 'fit-content',
        position: 'relative',
        // Base inter-row rhythm is the prototype .sk-msg-stream gap (14px,
        // owned by CHAT_MESSAGE_SPACING.item); a timeline break adds desktop's
        // own functional emphasis (the prototype has no time-gap grammar).
        marginTop: timelineGap ? (compact ? 6 : 8) : 0,
        paddingBottom: compact ? CHAT_MESSAGE_SPACING.compactItem : CHAT_MESSAGE_SPACING.item,
      }}
    >
      {!isOwn && !serviceOnly && (
        <PtPopover
          content={(
            <MessageSenderProfileCard
              senderPtid={message.senderPtid}
              fallbackName={senderName}
              fallbackAvatar={senderAvatar}
            />
          )}
          placement="right"
          label={senderName}
          className="ds-author-popover"
        >
          <div
            data-chat-avatar-ptid={message.senderPtid}
            data-chat-avatar-src={senderAvatar || ''}
            style={{ cursor: 'pointer', flexShrink: 0 }}
          >
            <UserSquareAvatar
              remoteUrl={senderAvatar}
              actorPtid={message.senderPtid}
              name={senderName}
              size={avatarSize}
              radius={avatarRadius}
            />
          </div>
        </PtPopover>
      )}

      <div
        ref={messageActionAnchorRef}
        data-message-action-anchor={message.ulid}
        style={{
          position: 'relative',
          minWidth: 0,
          width: 'fit-content',
          maxWidth: `calc(100% - ${serviceOnly ? 0 : avatarSize + avatarGap}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: isOwn ? 'flex-end' : 'flex-start',
        }}
      >
        {!isOwn && isGroup && !serviceOnly && (
          <span className="sc-msg-sender">
            {senderName}
          </span>
        )}

        <div
          data-message-content={message.ulid}
          data-emoji-only={emojiOnlyBare || undefined}
          className="msg-bubble"
          style={{
            alignSelf: isOwn ? 'flex-end' : 'flex-start',
            width: bareCard ? 'fit-content' : undefined,
            maxWidth: '100%',
            minWidth: bareCard ? undefined : layout.bubbleMinWidth,
            padding: serviceOnly || emojiOnlyBare || isRecalled
              ? 0
              : mediaOnlyMessage
                ? layout.mediaBubblePadding
                : layout.bubblePadding,
            borderRadius: emojiOnlyBare || isRecalled ? 0 : bubbleRadius,
            background: isRecalled ? 'transparent' : bubbleBg,
            border: emojiOnlyBare || isRecalled ? '1px solid transparent' : bubbleBorder,
            boxShadow: bareCard
              ? 'none'
              : isOwn
                ? 'none'
                : isRecalled
                  ? 'none'
                  : 'var(--pt-shadow-rest)',
            color: isRecalled ? 'var(--pt-secondary)' : bubbleColor,
            // Prototype .sk-msg-bubble p: 13.5px / 1.6 (compact narrow-pane keeps 12px).
            fontSize: compact ? 12 : 13.5,
            lineHeight: compact ? 1.5 : 1.6,
            wordBreak: 'break-word',
            fontStyle: 'normal',
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
        </div>

        {showThreadSummary && threadReplyCount > 0 && !isRecalled && !serviceOnly && (
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

        {!serviceOnly && (
          <div
            data-message-meta={message.ulid}
            className="sc-msg-meta"
            data-own={isOwn ? 'true' : 'false'}
          >
            <span className={`sc-msg-time${compact ? ' sc-msg-time--compact' : ''}`}>
              {formatMsgTime(message.sentAtMs)}
            </span>
            {editedAtMs && !isRecalled && (
              <PtTooltip label={
                t('chat.social.messageArea.editedAtTooltip', {
                  time: new Date(editedAtMs).toLocaleString(),
                })
              }>
                <span className="sc-msg-edited">
                  {t('chat.social.messageArea.editedTag')}
                </span>
              </PtTooltip>
            )}
            {isOwn && isGroup && readByPtids.length > 0 && !isRecalled && (
              <span data-message-read-state="read" className="sc-msg-readby">
                {t('chat.social.messageArea.readByCount', { count: readByPtids.length })}
              </span>
            )}
            {isOwn && isFriendMessage(message) && !isRecalled && (
              <span
                className={`sc-msg-status is-${receiptEvidenceStatus(message.status as MessageStatus)}`}
                data-message-receipt={receiptEvidenceStatus(message.status as MessageStatus)}
              >
                <ReadReceipt status={message.status as MessageStatus} />
              </span>
            )}
            {showDeliveryVerdict && (
              <DeliveryVerdictMeta
                message={message}
                isGroup={isGroup}
                compact={compact}
                onRetryMessage={onRetryMessage}
              />
            )}
          </div>
        )}
        {!serviceOnly && (
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
            currentUserPtid={currentUserPtid}
          />
        )}
      </div>

      {isOwn && !serviceOnly && (
        <span
          data-chat-avatar-ptid={currentUserPtid || message.senderPtid}
          data-chat-avatar-src={senderAvatar || ''}
          style={{ display: 'contents' }}
        >
          <UserSquareAvatar
            remoteUrl={senderAvatar}
            actorPtid={currentUserPtid || message.senderPtid}
            name={senderName}
            size={avatarSize}
            radius={avatarRadius}
            style={{ flexShrink: 0 }}
          />
        </span>
      )}
    </div>
  );
});
