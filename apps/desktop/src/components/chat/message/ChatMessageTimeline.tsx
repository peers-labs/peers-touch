import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography } from 'antd';
import { useVirtualizer } from '@tanstack/react-virtual';
import { buildChatMessageSurfaceItems } from '@peers-touch/client-chat-core';

import type { DesktopIMSenderProfileProjection } from '../../../store/socialProjection';
import {
  messageTimestampMs,
  type ChatMessage,
  type ChatSurfaceKind,
} from './chatMessageModel';
import {
  ChatMessageActionOverlay,
  type MessageActionTarget,
} from './ChatMessageActionOverlay';
import { ChatMessageRow, ChatMessageRowInteractionStyle } from './ChatMessageRow';
import { blocksMessageActionOverlay } from './messageReactionState';
import {
  chatMessageTimelineContainerStyle,
  shouldAdjustChatMessageScrollPosition,
  shouldVirtualizeChatMessageTimeline,
} from './chatMessageTimelinePolicy';

const { Text } = Typography;

interface ChatThreadStats {
  replyCount: number;
  replyIds: string[];
  unreadCount: number;
}

interface ChatMessageTimelineProps {
  actionOverlayHostRef: React.RefObject<HTMLDivElement | null>;
  activeConversationId: string;
  activeKind: ChatSurfaceKind;
  currentUserPtid: string | null;
  getSenderProfile: (
    kind: ChatSurfaceKind,
    conversationUlid: string,
    senderPtid: string,
  ) => DesktopIMSenderProfileProjection;
  highlightedMessageUlid: string | null;
  isPinned: (message: ChatMessage) => boolean;
  messages: ChatMessage[];
  onTimelineMeasured: () => void;
  onDelete: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  onOpenThread: (rootUlid: string) => void;
  onPin: (message: ChatMessage) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onRecall: (message: ChatMessage) => void;
  onReply: (messageUlid: string) => void;
  onRetryMessage: (message: ChatMessage) => void;
  onRetryReaction: (message: ChatMessage) => void;
  reactionMutationFor: (message: ChatMessage) => {
    emoji: string;
    phase: 'pending' | 'awaiting-projection' | 'error';
  } | undefined;
  resolveReactions: (message: ChatMessage) => { actorPtid: string; emoji: string }[];
  resolveThreadStats: (message: ChatMessage) => ChatThreadStats;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

function formatDateSeparator(date: Date, locale: string): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = date.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return date.toLocaleDateString(locale, options);
}

function DateSeparator({ date }: { date: Date }) {
  const { token } = theme.useToken();
  const { i18n } = useTranslation();

  return (
    <Flexbox
      horizontal
      align="center"
      gap={10}
      style={{
        alignSelf: 'stretch',
        margin: '8px 0 6px',
        padding: '0 4px',
      }}
    >
      <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
      <Text
        type="secondary"
        style={{
          padding: '3px 10px',
          borderRadius: 999,
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
          color: token.colorTextTertiary,
          fontSize: 11,
          fontWeight: 500,
        }}
      >
        {formatDateSeparator(date, i18n.language)}
      </Text>
      <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
    </Flexbox>
  );
}

const ESTIMATED_ROW_HEIGHT = 72;

export function ChatMessageTimeline({
  actionOverlayHostRef,
  activeConversationId,
  activeKind,
  currentUserPtid,
  getSenderProfile,
  highlightedMessageUlid,
  isPinned,
  messages,
  onTimelineMeasured,
  onDelete,
  onEdit,
  onForward,
  onOpenThread,
  onPin,
  onReact,
  onRecall,
  onReply,
  onRetryMessage,
  onRetryReaction,
  reactionMutationFor,
  resolveReactions,
  resolveThreadStats,
  scrollContainerRef,
}: ChatMessageTimelineProps) {
  const surfaceItems = buildChatMessageSurfaceItems({
    messages,
    resolveTimestampMs: messageTimestampMs,
  });

  const measureRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const closeActionsTimerRef = useRef<number | null>(null);
  const [actionTarget, setActionTarget] = useState<MessageActionTarget | null>(null);
  const virtualized = shouldVirtualizeChatMessageTimeline(surfaceItems.length);

  const cancelActionClose = useCallback(() => {
    if (closeActionsTimerRef.current === null) return;
    window.clearTimeout(closeActionsTimerRef.current);
    closeActionsTimerRef.current = null;
  }, []);

  const dismissActions = useCallback(() => {
    cancelActionClose();
    setActionTarget(null);
  }, [cancelActionClose]);

  const activeReactionMutationPhase = actionTarget
    ? reactionMutationFor(actionTarget.message)?.phase
    : undefined;

  useEffect(() => {
    if (blocksMessageActionOverlay(activeReactionMutationPhase)) {
      dismissActions();
    }
  }, [activeReactionMutationPhase, dismissActions]);

  const scheduleActionClose = useCallback(() => {
    cancelActionClose();
    closeActionsTimerRef.current = window.setTimeout(() => {
      setActionTarget(null);
      closeActionsTimerRef.current = null;
    }, 140);
  }, [cancelActionClose]);

  const activateActions = useCallback((
    message: ChatMessage,
    anchorElement: HTMLElement,
    requestFocus: boolean,
  ) => {
    cancelActionClose();
    setActionTarget({
      activatedAtMs: Date.now(),
      message,
      anchorElement,
      requestFocus,
    });
  }, [cancelActionClose]);

  useEffect(() => () => cancelActionClose(), [cancelActionClose]);

  useEffect(() => {
    if (!actionTarget) return;
    if (messages.some(message => message.ulid === actionTarget.message.ulid)) return;
    dismissActions();
  }, [actionTarget, dismissActions, messages]);

  const virtualizer = useVirtualizer({
    count: surfaceItems.length,
    enabled: virtualized,
    getScrollElement: () => scrollContainerRef.current,
    getItemKey: (index) => surfaceItems[index]?.message.ulid ?? index,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
    item,
    delta,
    instance,
  ) => shouldAdjustChatMessageScrollPosition(
    item.start,
    instance.scrollOffset ?? 0,
    delta,
  );

  const measureRef = useCallback(
    (index: number) => (node: HTMLDivElement | null) => {
      if (node) {
        measureRefs.current.set(index, node);
        virtualizer.measureElement(node);
      } else {
        measureRefs.current.delete(index);
      }
    },
    [virtualizer],
  );

  const renderedItems = virtualized
    ? virtualizer.getVirtualItems().map((item) => ({
        index: item.index,
        start: item.start,
      }))
    : surfaceItems.map((_, index) => ({ index, start: 0 }));
  const totalSize = virtualized ? virtualizer.getTotalSize() : 0;

  useLayoutEffect(() => {
    onTimelineMeasured();
  }, [onTimelineMeasured, surfaceItems, totalSize]);

  return (
    <>
      <ChatMessageRowInteractionStyle />
      <ChatMessageActionOverlay
        key={actionTarget?.message.ulid ?? 'no-message-action'}
        currentUserPtid={currentUserPtid}
        hostElement={actionOverlayHostRef.current}
        onDelete={onDelete}
        onDismiss={dismissActions}
        onEdit={onEdit}
        onForward={onForward}
        onHoverEnter={cancelActionClose}
        onHoverLeave={scheduleActionClose}
        onOpenThread={onOpenThread}
        onPin={onPin}
        onReact={onReact}
        onRecall={onRecall}
        onReply={onReply}
        target={actionTarget}
        viewportElement={scrollContainerRef.current}
      />
      <div
        data-chat-message-timeline
        data-chat-message-timeline-mode={virtualized ? 'virtualized' : 'flow'}
        style={chatMessageTimelineContainerStyle(totalSize, virtualized)}
      >
        {renderedItems.map((virtualItem) => {
          const item = surfaceItems[virtualItem.index];
          const message = item.message;
          const messageDate = item.timestampMs > 0 ? new Date(item.timestampMs) : null;
          const threadStats = resolveThreadStats(message);
          const reactionMutation = reactionMutationFor(message);

          return (
            <div
              key={message.ulid}
              ref={virtualized ? measureRef(virtualItem.index) : undefined}
              data-index={virtualItem.index}
              style={{
                position: virtualized ? 'absolute' : 'relative',
                top: virtualized ? 0 : undefined,
                left: virtualized ? 0 : undefined,
                width: '100%',
                transform: virtualized ? `translateY(${virtualItem.start}px)` : undefined,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {item.showDateSeparator && messageDate && (
                <DateSeparator date={messageDate} />
              )}
              <ChatMessageRow
                activeConversationId={activeConversationId}
                activeKind={activeKind}
                currentUserPtid={currentUserPtid}
                getSenderProfile={getSenderProfile}
                highlighted={highlightedMessageUlid === message.ulid}
                message={message}
                messages={messages}
                onActionTargetChange={activateActions}
                onActionTargetLeave={scheduleActionClose}
                onOpenThread={onOpenThread}
                onPin={onPin}
                onReact={onReact}
                onRetryMessage={onRetryMessage}
                onRetryReaction={onRetryReaction}
                pinned={isPinned(message)}
                reactionMutationEmoji={reactionMutation?.emoji}
                reactionMutationPhase={reactionMutation?.phase}
                reactions={resolveReactions(message)}
                threadReplyCount={threadStats.replyCount}
                threadReplyIds={threadStats.replyIds}
                threadUnreadCount={threadStats.unreadCount}
                timelineGap={item.timelineGap}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
