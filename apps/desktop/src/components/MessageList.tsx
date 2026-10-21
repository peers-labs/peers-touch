import { useRef, useEffect, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useChatStore } from '../store/chat';
import { MessageBubble } from './MessageBubble';
import { FollowUpChips } from './chat/FollowUpChips';

interface MessageListProps {
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  highlightedMessageId?: string | null;
}

export function MessageList({ scrollRef, highlightedMessageId }: MessageListProps) {
  const messages = useChatStore((s) => s.messages);
  const appendComposer = useChatStore((s) => s.appendComposer);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const streaming = useChatStore((s) => s.isStreaming);

  const lastMessage = messages[messages.length - 1];
  const showFollowUp = lastMessage?.role === 'assistant'
    && !lastMessage.loading
    && lastMessage.followUpSuggestions
    && lastMessage.followUpSuggestions.length > 0;

  const totalCount = messages.length + (showFollowUp ? 1 : 0);

  // TanStack Virtual owns imperative measurement state and is intentionally not compiler-memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => 80,
    overscan: 5,
  });
  const totalSize = virtualizer.getTotalSize();
  const previousScrollHeightRef = useRef<number | null>(null);

  // #region debug-point S-U:lease-expired-list-commit
  useEffect(() => {
    if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;
    const messageIndex = messages.findIndex((message) => (
      message.typedError?.error_type === 'CLIENT_LEASE_EXPIRED'
      || message.toolCalls?.some(
        (toolCall) => toolCall.name === 'local_clipboard_read',
      )
    ));
    if (messageIndex < 0) return;
    const message = messages[messageIndex];
    const virtualItem = virtualizer.getVirtualItems().find(
      (item) => item.index === messageIndex,
    );
    const selector = `[data-pt-agent-message-id="${message.id}"]`;
    const rendered = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    );
    void fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'lease-approval-stall',
        runId: 'post-ui-projection-fix',
        hypothesisId: 'S-U',
        location: 'components/MessageList.tsx:messages-commit',
        msg: '[DEBUG] Message list commit observed',
        data: {
          messageId: message.id,
          role: message.role,
          turnId: message.turnId ?? null,
          messageIndex,
          error: message.error ?? null,
          errorType: message.typedError?.error_type ?? null,
          resolution: message.resolution?.type ?? null,
          loading: message.loading === true,
          virtualItemPresent: Boolean(virtualItem),
          virtualItemKey: virtualItem?.key ?? null,
          renderedCount: rendered.length,
          renderedErrorTypes: rendered.map(
            (element) => element.getAttribute('data-pt-agent-error-type'),
          ),
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
  }, [messages, virtualizer]);
  // #endregion

  useLayoutEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    const previousScrollHeight = previousScrollHeightRef.current;
    if (
      previousScrollHeight !== null
      && el.scrollHeight > previousScrollHeight
      && previousScrollHeight - el.scrollTop - el.clientHeight < 60
    ) {
      el.scrollTop = el.scrollHeight;
    }
    previousScrollHeightRef.current = el.scrollHeight;
  }, [scrollRef, totalSize]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const messageIndex = messages.findIndex((message) => message.id === highlightedMessageId);
    if (messageIndex < 0) return;
    virtualizer.scrollToIndex(messageIndex, { align: 'center', behavior: 'smooth' });
  }, [highlightedMessageId, messages, virtualizer]);

  return (
    <div
      style={{
        height: totalSize,
        width: '100%',
        position: 'relative',
      }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const isFollowUp = virtualItem.index === messages.length;
        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            data-pt-agent-search-match={
              !isFollowUp && messages[virtualItem.index]?.id === highlightedMessageId
                ? 'active'
                : undefined
            }
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
              borderRadius: 8,
              outline:
                !isFollowUp && messages[virtualItem.index]?.id === highlightedMessageId
                  ? '2px solid rgba(107, 91, 214, 0.22)'
                  : 'none',
              outlineOffset: 2,
            }}
          >
            {isFollowUp ? (
              <FollowUpChips
                suggestions={lastMessage.followUpSuggestions!}
                onInsert={appendComposer}
                onSend={sendMessage}
                disabled={streaming}
              />
            ) : (
              <MessageBubble message={messages[virtualItem.index]} />
            )}
          </div>
        );
      })}
    </div>
  );
}
