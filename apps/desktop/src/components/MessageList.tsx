import { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useChatStore } from '../store/chat';
import { MessageBubble } from './MessageBubble';
import { FollowUpChips } from './chat/FollowUpChips';

interface MessageListProps {
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

export function MessageList({ scrollRef }: MessageListProps) {
  const messages = useChatStore((s) => s.messages);
  const fillComposer = useChatStore((s) => s.fillComposer);
  const isAtBottomRef = useRef(true);
  const prevCountRef = useRef(messages.length);

  const lastMessage = messages[messages.length - 1];
  const showFollowUp = lastMessage?.role === 'assistant'
    && !lastMessage.loading
    && lastMessage.followUpSuggestions
    && lastMessage.followUpSuggestions.length > 0;

  const totalCount = messages.length + (showFollowUp ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => 80,
    overscan: 5,
  });

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

  const handleScroll = useCallback(() => {
    const el = scrollRef?.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < 60;
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [scrollRef, handleScroll]);

  useEffect(() => {
    if (messages.length > prevCountRef.current && isAtBottomRef.current) {
      virtualizer.scrollToIndex(totalCount - 1, { align: 'end', behavior: 'smooth' });
    }
    prevCountRef.current = messages.length;
  }, [messages.length, totalCount, virtualizer]);

  return (
    <div
      style={{
        height: virtualizer.getTotalSize(),
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
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {isFollowUp ? (
              <FollowUpChips
                suggestions={lastMessage.followUpSuggestions!}
                onSelect={fillComposer}
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
