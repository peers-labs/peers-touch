import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { buildChatMessageSurfaceItems } from '@peers-touch/client-chat-core';

import type { DesktopIMSenderProfileProjection } from '../../../store/socialProjection';
import {
  messageTimestampMs,
  type ChatMessage,
  type ChatSurfaceKind,
} from './chatMessageModel';
import {
  buildChatRowDecoration,
  EMPTY_THREAD_STATS,
  type ChatRowDecoration,
  type ThreadCountSummary,
} from './chatMessageRowDecoration';
import {
  ChatMessageActionOverlay,
  type MessageActionTarget,
} from './ChatMessageActionOverlay';
import { ChatMessageRow, ChatMessageRowInteractionStyle } from './ChatMessageRow';
import {
  aggregateServiceEvents,
  serviceAggregationKey,
} from './serviceEventAggregation';
import {
  blocksMessageActionOverlay,
  type MessageReaction,
  type MessageReactionMutation,
} from './messageReactionState';
import {
  chatMessageTimelineContainerStyle,
  shouldAdjustChatMessageScrollPosition,
  shouldVirtualizeChatMessageTimeline,
} from './chatMessageTimelinePolicy';

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
  scrollToMessageUlid?: string | null;
  onAnchorReached?: () => void;
  /**
   * All projected messages of the active conversation, including thread
   * replies. Thread stats use it to surface inline replies before the thread
   * panel loads. `messages` carries surface roots only.
   */
  conversationMessages: ChatMessage[];
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
  pinnedMessageUlids: ReadonlySet<string>;
  /** Projects the loaded thread slice for one root through the store memo. */
  projectThreadMessages: (rootUlid: string) => ChatMessage[];
  reactions: Record<string, MessageReaction[]>;
  reactionMutations: Record<string, MessageReactionMutation>;
  threadCounts: Record<string, ThreadCountSummary>;
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
  const { i18n } = useTranslation();

  return (
    <div className="sc-msg-date" data-date-separator>
      <span>{formatDateSeparator(date, i18n.language)}</span>
    </div>
  );
}

const ESTIMATED_ROW_HEIGHT = 72;

function ChatMessageTimelineImpl({
  actionOverlayHostRef,
  activeConversationId,
  activeKind,
  currentUserPtid,
  getSenderProfile,
  highlightedMessageUlid,
  scrollToMessageUlid,
  onAnchorReached,
  conversationMessages,
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
  pinnedMessageUlids,
  projectThreadMessages,
  reactions,
  reactionMutations,
  threadCounts,
  scrollContainerRef,
}: ChatMessageTimelineProps) {
  const [expandedServiceGroups, setExpandedServiceGroups] = useState<Set<string>>(new Set());
  useEffect(() => setExpandedServiceGroups(new Set()), [activeConversationId]);
  useEffect(() => {
    const anchor = scrollToMessageUlid || highlightedMessageUlid;
    if (!anchor) return;
    const highlighted = messages.find(message => message.ulid === anchor);
    if (!highlighted) return;
    const key = serviceAggregationKey(highlighted);
    if (!key) return;
    setExpandedServiceGroups(current => current.has(key)
      ? current
      : new Set([...current, key]));
  }, [highlightedMessageUlid, scrollToMessageUlid, messages]);
  const foldedRows = useMemo(
    () => aggregateServiceEvents(messages, expandedServiceGroups),
    [expandedServiceGroups, messages],
  );
  const surfaceMessages = useMemo(
    () => foldedRows.map((row) => row.message),
    [foldedRows],
  );
  const serviceAggregationByUlid = useMemo(() => {
    const aggregations = new Map<string, NonNullable<(typeof foldedRows)[number]['aggregation']>>();
    for (const { message, aggregation } of foldedRows) {
      if (aggregation) aggregations.set(message.ulid, aggregation);
    }
    return aggregations;
  }, [foldedRows]);
  const toggleServiceAggregation = useCallback((key: string) => {
    setExpandedServiceGroups(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const surfaceItems = useMemo(() => buildChatMessageSurfaceItems({
    messages: surfaceMessages,
    resolveTimestampMs: messageTimestampMs,
  }), [surfaceMessages]);

  // Per-row decorations resolve once into identity-stable maps instead of
  // allocating fresh arrays/objects for every visible row on every parent
  // render. Rows whose slice of reactions / thread data is unchanged reuse
  // their previous references so React.memo on ChatMessageRow skips commit
  // work when an unrelated row mutates (e.g. keystroke-driven store fan-out).
  const previousRowDecorationRef = useRef<ChatRowDecoration | null>(null);

  const rowDecoration = useMemo(() => {
    const decoration = buildChatRowDecoration({
      messages,
      conversationMessages,
      previous: previousRowDecorationRef.current,
      reactions,
      reactionMutations,
      currentUserPtid,
      activeKind,
      activeConversationId,
      threadCounts,
      projectThreadMessages,
    });
    previousRowDecorationRef.current = decoration;
    return decoration;
  }, [
    activeConversationId,
    activeKind,
    conversationMessages,
    currentUserPtid,
    messages,
    projectThreadMessages,
    reactionMutations,
    reactions,
    threadCounts,
  ]);

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
    ? rowDecoration.reactionMutationsByUlid.get(actionTarget.message.ulid)?.phase
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

  useLayoutEffect(() => {
    if (!scrollToMessageUlid) return;
    const index = surfaceItems.findIndex(item => item.message.ulid === scrollToMessageUlid);
    if (index < 0) return;
    if (virtualized) virtualizer.scrollToIndex(index, { align: 'center' });
  }, [scrollToMessageUlid, surfaceItems, virtualized, virtualizer]);

  // A virtual row may mount after the requested scroll commits. Focus in the
  // commit that actually contains it; render churn must not cancel one RAF
  // forever while the target is already present in the window.
  useLayoutEffect(() => {
    if (!scrollToMessageUlid) return;
    const element = Array.from(scrollContainerRef.current?.querySelectorAll<HTMLElement>('[data-message-ulid]') ?? [])
      .find(node => node.dataset.messageUlid === scrollToMessageUlid);
    const viewport = scrollContainerRef.current;
    if (!element || !viewport) return;
    const target = element.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    viewport.scrollTop += target.top - bounds.top - (viewport.clientHeight - target.height) / 2;
    element.tabIndex = -1;
    element.dataset.messageAnchorFocused = 'true';
    element.focus({ preventScroll: true });
    onAnchorReached?.();
  });

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
          const threadStats = rowDecoration.threadStatsByUlid.get(message.ulid) ?? EMPTY_THREAD_STATS;
          const reactionMutation = rowDecoration.reactionMutationsByUlid.get(message.ulid);

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
                serviceAggregation={serviceAggregationByUlid.get(message.ulid)}
                onToggleServiceAggregation={toggleServiceAggregation}
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
                pinned={pinnedMessageUlids.has(message.ulid)}
                reactionMutationEmoji={reactionMutation?.emoji}
                reactionMutationPhase={reactionMutation?.phase}
                reactions={rowDecoration.reactionsByUlid.get(message.ulid)}
                threadReplyCount={threadStats.replyCount}
                threadReplyIds={threadStats.replyIds}
                threadPreviewMessages={threadStats.previewMessages}
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

export const ChatMessageTimeline = memo(ChatMessageTimelineImpl);
ChatMessageTimeline.displayName = 'ChatMessageTimeline';
