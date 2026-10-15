import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMobileI18n } from '../../app/mobileI18n';
import './message-presentation.css';

/** Avatar disclosure exposes actor identity without repeating labels in the timeline. */
export function MessageAuthor({ name, children }: {
  readonly name: string;
  readonly children: ReactNode;
}) {
  const { t } = useMobileI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('blur', blur);
    };
  }, [open]);
  return (
    <span ref={root} className="chat-message-author-root">
      <button type="button" className="chat-message-author" data-chat-author
        title={name} aria-label={t('mobile.chat.viewAuthor', { name })} aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        {children}
      </button>
      {open ? <span role="tooltip" className="chat-message-author-name" data-chat-author-name>{name}</span> : null}
    </span>
  );
}
