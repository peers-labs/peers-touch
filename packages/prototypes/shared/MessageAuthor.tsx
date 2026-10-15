import { useEffect, useRef, useState, type ReactNode } from 'react';
import './message-author.css';

/** Identity is available on the avatar without repeating names in the stream. */
export function MessageAuthor({ name, children }: { name: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <span ref={rootRef} className="prototype-message-author-root"
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="prototype-message-author" data-chat-author
        aria-label={`View ${name}`} aria-expanded={open} title={name}
        onClick={() => setOpen((current) => !current)}>
        {children}
      </button>
      {open && <span role="tooltip" className="prototype-message-author-name" data-chat-author-name>{name}</span>}
    </span>
  );
}
