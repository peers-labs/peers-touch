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
