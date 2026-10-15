import { useEffect, type RefObject } from 'react';

export function useDismissableLayer({
  open,
  containerRef,
  insideRefs = [],
  onDismiss,
  dismissOnWindowBlur = false,
  dismissOnScroll = false,
}: {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  insideRefs?: Array<RefObject<HTMLElement | null>>;
  onDismiss: () => void;
  dismissOnWindowBlur?: boolean;
  dismissOnScroll?: boolean;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const outside = (target: EventTarget | null) => target instanceof Node
      && !containerRef.current?.contains(target)
      && !insideRefs.some((ref) => ref.current?.contains(target));
    const handlePointerDown = (event: PointerEvent) => {
      if (outside(event.target)) onDismiss();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) onDismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      }
    };
    const handleWindowBlur = () => onDismiss();
    const handleScroll = (event: Event) => {
      if (outside(event.target)) onDismiss();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('keydown', handleKeyDown);
    if (dismissOnWindowBlur) window.addEventListener('blur', handleWindowBlur);
    if (dismissOnScroll) document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [containerRef, dismissOnScroll, dismissOnWindowBlur, insideRefs, onDismiss, open]);
}
