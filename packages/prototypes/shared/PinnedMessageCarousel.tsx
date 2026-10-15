import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pin } from 'lucide-react';
import './pinned-message-carousel.css';

export interface PinnedMessagePreview {
  id: string;
  text: string;
  author: string;
}

export function PinnedMessageCarousel({
  messages, onJump,
}: {
  messages: readonly PinnedMessagePreview[];
  onJump: (id: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState({ id: messages[0]?.id, index: 0 });
  const ids = messages.map((message) => message.id).join('\0');
  const found = messages.findIndex((message) => message.id === selection.id);
  const index = found >= 0 ? found : Math.min(selection.index, Math.max(0, messages.length - 1));
  const activeIndex = useRef(index);
  activeIndex.current = index;

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || !messages.length) return;
    const align = () => track.scrollTo({ left: activeIndex.current * track.clientWidth, behavior: 'instant' });
    align();
    setSelection({ id: messages[index].id, index });
    const observer = new ResizeObserver(align);
    observer.observe(track);
    return () => observer.disconnect();
    // Realign only when membership or pane geometry changes; native swipe owns scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (messages.length === 0) return null;
  const multiple = messages.length > 1;
  const go = (next: number) => {
    const track = trackRef.current;
    if (track) track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
  };
  return (
    <div className="prototype-pins" role="region" aria-label="Pinned messages" data-chat-pins
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const next = Math.max(0, Math.min(messages.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
          trackRef.current?.querySelectorAll<HTMLButtonElement>('[data-chat-pin]')[next]?.focus({ preventScroll: true });
          go(next);
        }
      }}>
      <Pin size={16} aria-hidden="true" />
      <div ref={trackRef} className="prototype-pins-track" data-chat-pins-track
        onScroll={(event) => {
          const track = event.currentTarget;
          const next = Math.max(0, Math.min(messages.length - 1, Math.round(track.scrollLeft / (track.clientWidth || 1))));
          setSelection({ id: messages[next].id, index: next });
        }}>
        {messages.map((message, slide) => (
          <button key={message.id} type="button" className="prototype-pin" data-chat-pin={message.id}
            tabIndex={slide === index ? 0 : -1}
            aria-label={`Jump to pinned message: ${message.text}`} title={`${message.author}: ${message.text}`}
            onClick={() => onJump(message.id)}>
            <span className="prototype-pin-label">Pinned</span>
            <span className="prototype-pin-text">{message.text}</span>
          </button>
        ))}
      </div>
      {multiple && <>
        <span className="prototype-pins-count" data-chat-pin-count aria-live="polite">{index + 1}/{messages.length}</span>
        <button type="button" className="prototype-pin-nav" aria-label="Previous pinned message"
          disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft size={16} /></button>
        <button type="button" className="prototype-pin-nav" aria-label="Next pinned message"
          disabled={index === messages.length - 1} onClick={() => go(index + 1)}><ChevronRight size={16} /></button>
      </>}
    </div>
  );
}
