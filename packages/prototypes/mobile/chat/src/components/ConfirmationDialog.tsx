import { useEffect, useId, useRef, type KeyboardEvent } from 'react';

export function ConfirmationDialog({
  title,
  description,
  cancelLabel = 'Cancel',
  confirmLabel,
  danger = true,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  cancelLabel?: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const backdrop = backdropRef.current;
    const siblings = backdrop?.parentElement
      ? Array.from(backdrop.parentElement.children).filter((element) => element !== backdrop)
      : [];
    const previousInert = siblings.map((element) => element.hasAttribute('inert'));
    siblings.forEach((element) => element.setAttribute('inert', ''));
    cancelRef.current?.focus({ preventScroll: true });

    return () => {
      siblings.forEach((element, index) => {
        if (!previousInert[index]) element.removeAttribute('inert');
      });
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), '
      + 'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div ref={backdropRef} className="mp-confirm-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="mp-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mp-confirm-title" id={titleId}>{title}</div>
        <div className="mp-confirm-desc">{description}</div>
        <div className="mp-confirm-actions">
          <button ref={cancelRef} type="button" className="mp-confirm-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`mp-confirm-btn ${danger ? 'mp-confirm-btn--danger' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
