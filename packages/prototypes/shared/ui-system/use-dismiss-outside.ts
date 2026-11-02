import { useEffect, type RefObject } from 'react';

/**
 * Click-outside dismissal for local (non-ported) transient surfaces such as
 * the in-canvas detail/thread sheets. Library Popover/Menu/Dialog already
 * own this behavior; this hook is for surfaces rendered inline that still
 * must obey the platform convention "press outside the scope hides it".
 *
 * Listens on pointerdown capture so the surface closes before the outside
 * control's click fires; opener nodes are explicitly ignored so toggling
 * via the trigger does not immediately dismiss-and-reopen.
 */
export function useDismissOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
  ignore?: string | string[],
) {
  const ignores = ignore ? (Array.isArray(ignore) ? ignore : [ignore]) : [];
  useEffect(() => {
    if (!active) return;
    const doc = ref.current?.ownerDocument ?? document;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      if (ignores.some(selector => {
        try { return !!(target instanceof Element && target.closest(selector)); }
        catch { return false; }
      })) return;
      onDismiss();
    };
    doc.addEventListener('pointerdown', onPointerDown, true);
    return () => doc.removeEventListener('pointerdown', onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, active, onDismiss, ignores.join('|')]);
}
