import { useCallback, useEffect, useRef, useState } from 'react';
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

const { Text } = Typography;

interface ChatThreadStats {
  replyCount: number;
  replyIds: string[];
  unreadCount: number;
  previewMessages: ChatMessage[];
}

interface ChatMessageTimelineProps {
  activeConversationId: string;
  activeKind: ChatSurfaceKind;
  currentUserDid: string | null;
  getSenderProfile: (
    kind: ChatSurfaceKind,
    conversationUlid: string,
    senderDid: string,
  ) => DesktopIMSenderProfileProjection;
  highlightedMessageUlid: string | null;
  isPinned: (message: ChatMessage) => boolean;
  messages: ChatMessage[];
  onDelete: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  onOpenThread: (rootUlid: string) => void;
  onPin: (message: ChatMessage) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onRecall: (message: ChatMessage) => void;
  onReply: (messageUlid: string) => void;
  onRetryReaction: (message: ChatMessage) => void;
  reactionMutationFor: (message: ChatMessage) => {
    emoji: string;
    phase: 'pending' | 'awaiting-projection' | 'error';
  } | undefined;
  resolveReactions: (message: ChatMessage) => { actorId: string; emoji: string }[];
  resolveThreadStats: (message: ChatMessage) => ChatThreadStats;
  actionOverlayHostRef: React.RefObject<HTMLDivElement | null>;
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
  activeConversationId,
  activeKind,
  currentUserDid,
  getSenderProfile,
  highlightedMessageUlid,
  isPinned,
  messages,
  onDelete,
  onEdit,
  onForward,
  onOpenThread,
  onPin,
  onReact,
  onRecall,
  onReply,
  onRetryReaction,
  reactionMutationFor,
  resolveReactions,
  resolveThreadStats,
  actionOverlayHostRef,
  scrollContainerRef,
}: ChatMessageTimelineProps) {
  const surfaceItems = buildChatMessageSurfaceItems({
    messages,
    resolveTimestampMs: messageTimestampMs,
  });

  const measureRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const closeActionsTimerRef = useRef<number | null>(null);
  const [actionTarget, setActionTarget] = useState<MessageActionTarget | null>(null);

  const cancelActionClose = useCallback(() => {
    if (closeActionsTimerRef.current === null) return;
    // #region debug-point AI:action-close-cancelled
    fetch('http://127.0.0.1:7785/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'chat-native-input-delivery',
        runId: 'pre-fix-transient-toolbar',
        hypothesisId: 'AI',
        location: 'ChatMessageTimeline:cancelActionClose',
        msg: '[DEBUG] Action close timer cancelled',
        ts: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    window.clearTimeout(closeActionsTimerRef.current);
    closeActionsTimerRef.current = null;
  }, []);

  const dismissActions = useCallback(() => {
    cancelActionClose();
    setActionTarget(null);
  }, [cancelActionClose]);

  const scheduleActionClose = useCallback(() => {
    cancelActionClose();
    // #region debug-point D:close-timer-scheduled
    fetch('http://127.0.0.1:7785/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-native-input-delivery', runId: 'pre-fix-transient-toolbar', hypothesisId: 'AI', location: 'ChatMessageTimeline:scheduleActionClose', msg: '[DEBUG] Action close timer scheduled', data: {}, ts: Date.now() }) }).catch(() => {});
    // #endregion
    closeActionsTimerRef.current = window.setTimeout(() => {
      // #region debug-point D:close-timer-fired
      const overlay = actionOverlayHostRef.current?.querySelector<HTMLElement>(
        '[data-message-action-overlay]',
      );
      fetch('http://127.0.0.1:7785/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-native-input-delivery', runId: 'pre-fix-transient-toolbar', hypothesisId: 'AI', location: 'ChatMessageTimeline:closeTimer', msg: '[DEBUG] Action close timer fired', data: { overlayHovered: Boolean(overlay?.matches(':hover')), overlayFocused: Boolean(overlay?.contains(document.activeElement)) }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      setActionTarget(null);
      closeActionsTimerRef.current = null;
    }, 140);
  }, [actionOverlayHostRef, cancelActionClose]);

  const activateActions = useCallback((
    message: ChatMessage,
    anchorElement: HTMLElement,
    requestFocus: boolean,
  ) => {
    cancelActionClose();
    // #region debug-point B:activate-action-target
    fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-hover-overlay', runId: 'post-fix', hypothesisId: 'B', location: 'ChatMessageTimeline:activateActions', msg: '[DEBUG] action target activated', data: { messageId: message.ulid, anchorConnected: anchorElement.isConnected, hostReady: Boolean(actionOverlayHostRef.current), viewportReady: Boolean(scrollContainerRef.current) }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    setActionTarget({
      activatedAtMs: Date.now(),
      message,
      anchorElement,
      requestFocus,
    });
  }, [actionOverlayHostRef, cancelActionClose, scrollContainerRef]);

  useEffect(() => () => cancelActionClose(), [cancelActionClose]);

  useEffect(() => {
    if (!actionTarget) return;
    if (messages.some(message => message.ulid === actionTarget.message.ulid)) return;
    dismissActions();
  }, [actionTarget, dismissActions, messages]);

  const virtualizer = useVirtualizer({
    count: surfaceItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

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

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <>
      <ChatMessageRowInteractionStyle />
      <ChatMessageActionOverlay
        key={actionTarget?.message.ulid ?? 'no-message-action'}
        currentUserDid={currentUserDid}
        hostElement={actionOverlayHostRef.current}
        onDelete={onDelete}
        onDismiss={dismissActions}
        onEdit={onEdit}
        onForward={onForward}
        onOpenThread={onOpenThread}
        onPin={onPin}
        onPointerEnter={cancelActionClose}
        onPointerLeave={scheduleActionClose}
        onReact={onReact}
        onRecall={onRecall}
        onReply={onReply}
        target={actionTarget}
        viewportElement={scrollContainerRef.current}
      />
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const item = surfaceItems[virtualItem.index];
          const message = item.message;
          const messageDate = item.timestampMs > 0 ? new Date(item.timestampMs) : null;
          const threadStats = resolveThreadStats(message);
          const reactionMutation = reactionMutationFor(message);

          return (
            <div
              key={message.ulid}
              ref={measureRef(virtualItem.index)}
              data-index={virtualItem.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
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
                currentUserDid={currentUserDid}
                getSenderProfile={getSenderProfile}
                highlighted={highlightedMessageUlid === message.ulid}
                message={message}
                messages={messages}
                onActionTargetChange={activateActions}
                onActionTargetLeave={scheduleActionClose}
                onOpenThread={onOpenThread}
                onPin={onPin}
                onReact={onReact}
                onRetryReaction={onRetryReaction}
                pinned={isPinned(message)}
                reactionMutationEmoji={reactionMutation?.emoji}
                reactionMutationPhase={reactionMutation?.phase}
                reactions={resolveReactions(message)}
                threadReplyCount={threadStats.replyCount}
                threadReplyIds={threadStats.replyIds}
                threadUnreadCount={threadStats.unreadCount}
                threadPreviewMessages={threadStats.previewMessages}
                timelineGap={item.timelineGap}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
