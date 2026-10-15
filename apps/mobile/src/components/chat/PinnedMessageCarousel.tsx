import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pin } from 'lucide-react';
import { useMobileI18n } from '../../app/mobileI18n';
import './message-presentation.css';

export interface PinnedMessagePreview {
  readonly id: string;
  readonly text: string;
  readonly author: string;
}

export function PinnedMessageCarousel({ messages, onJump }: {
  readonly messages: readonly PinnedMessagePreview[];
  readonly onJump: (id: string) => void;
}) {
  const { t } = useMobileI18n();
  const track = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState({ id: messages[0]?.id, index: 0 });
  const found = messages.findIndex((message) => message.id === selection.id);
  const index = found >= 0 ? found : Math.min(selection.index, Math.max(0, messages.length - 1));
  const activeIndex = useRef(index);
  activeIndex.current = index;
  const ids = messages.map((message) => message.id).join('\0');
  useLayoutEffect(() => {
    const element = track.current;
    if (!element || !messages.length) return;
    const align = () => element.scrollTo({ left: activeIndex.current * element.clientWidth, behavior: 'instant' });
    align();
    const observer = new ResizeObserver(align);
    observer.observe(element);
    return () => observer.disconnect();
    // Membership/geometry updates align the selected pin; native swipe owns scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  if (!messages.length) return null;
  const go = (next: number) => track.current?.scrollTo({
    left: next * track.current.clientWidth,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
  return (
    <div className="chat-pins" role="region" aria-label={t('mobile.chat.pinnedMessages')} data-chat-pins
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const next = Math.max(0, Math.min(messages.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
        track.current?.querySelectorAll<HTMLButtonElement>('[data-chat-pin]')[next]?.focus({ preventScroll: true });
        go(next);
      }}>
      <Pin size={16} />
      <div ref={track} className="chat-pins-track" data-chat-pins-track
        onScroll={(event) => {
          const element = event.currentTarget;
          const next = Math.max(0, Math.min(messages.length - 1, Math.round(element.scrollLeft / (element.clientWidth || 1))));
          setSelection({ id: messages[next].id, index: next });
        }}>
        {messages.map((message, slide) => (
          <button type="button" className="chat-pin" key={message.id} data-chat-pin={message.id}
            tabIndex={slide === index ? 0 : -1}
            aria-label={t('mobile.chat.jumpToPinnedMessage', { message: message.text })}
            title={`${message.author}: ${message.text}`} onClick={() => onJump(message.id)}>
            <span className="chat-pin-label">{t('mobile.chat.messagePinned')}</span>
            <span className="chat-pin-text">{message.text}</span>
          </button>
        ))}
      </div>
      {messages.length > 1 ? (
        <>
          <span className="chat-pins-count" data-chat-pin-count aria-live="polite">{index + 1}/{messages.length}</span>
          <button type="button" className="chat-pin-nav" aria-label={t('mobile.chat.previousPinnedMessage')}
            disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft size={16} /></button>
          <button type="button" className="chat-pin-nav" aria-label={t('mobile.chat.nextPinnedMessage')}
            disabled={index === messages.length - 1} onClick={() => go(index + 1)}><ChevronRight size={16} /></button>
        </>
      ) : null}
    </div>
  );
}
