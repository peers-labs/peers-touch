import { useEffect, type RefObject } from 'react';

export interface MobileTabSwipeOptions<T extends string = string> {
  readonly root: RefObject<HTMLElement | null>;
  readonly enabled: boolean;
  readonly items: readonly T[];
  readonly value: T;
  readonly onValueChange: (value: T) => void;
}

const OWNED_GESTURE_SELECTOR = [
  'input', 'textarea', 'select', '[contenteditable]:not([contenteditable="false"])',
  '[role="slider"]', 'audio', 'video', 'canvas', '.pt-field-frame',
  '[data-mobile-swipe="exclude"]',
].join(',');

function ownsHorizontalGesture(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof Element) || target.closest(OWNED_GESTURE_SELECTOR)) return true;
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    const overflow = root.ownerDocument.defaultView?.getComputedStyle(node).overflowX;
    if (overflow && /auto|scroll/.test(overflow) && node.scrollWidth > node.clientWidth + 1) return true;
  }
  return false;
}

function hasOpenOverlay(root: HTMLElement): boolean {
  return Array.from(root.ownerDocument.querySelectorAll<HTMLElement>(
    '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]',
  )).some(node => !node.closest('[hidden]') && node.getClientRects().length > 0);
}

/**
 * Opt-in touch navigation on an existing page boundary. The caller owns tab
 * ordering, exit admission and retained pages; this hook owns gesture arbitration.
 * Native listeners allow cancelling only a recognized horizontal pan while
 * leaving vertical scrolling, taps, long presses and nested scrollers intact.
 */
export function useMobileTabSwipe<T extends string>({ root: reference, enabled, items, value, onValueChange }: MobileTabSwipeOptions<T>) {
  useEffect(() => {
    const root = reference.current;
    if (!root || !enabled) return;
    let gesture: {
      identifier: number; x: number; y: number; startedAt: number;
      axis: 'pending' | 'horizontal';
    } | null = null;
    const cancel = () => { gesture = null; };
    const start = (event: TouchEvent) => {
      cancel();
      if (event.defaultPrevented || event.touches.length !== 1
        || ownsHorizontalGesture(event.target, root) || hasOpenOverlay(root)) return;
      const touch = event.touches[0];
      gesture = { identifier: touch.identifier, x: touch.clientX, y: touch.clientY,
        startedAt: event.timeStamp, axis: 'pending' };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) {
        cancel(); return;
      }
      const touch = Array.from(event.touches).find(item => item.identifier === gesture!.identifier);
      if (!touch) { cancel(); return; }
      const dx = Math.abs(touch.clientX - gesture.x);
      const dy = Math.abs(touch.clientY - gesture.y);
      if (gesture.axis === 'pending') {
        // A stationary hold belongs to the page's long-press action. Once a
        // horizontal pan has begun, its duration is no longer a hold timeout.
        if (event.timeStamp - gesture.startedAt >= 500) { cancel(); return; }
        if (dx >= 12 && dx > dy * 1.5) gesture.axis = 'horizontal';
        else if (dy >= 12) { cancel(); return; }
      }
      if (gesture.axis === 'horizontal' && event.cancelable) event.preventDefault();
    };
    const end = (event: TouchEvent) => {
      const current = gesture;
      cancel();
      if (!current || event.touches.length !== 0 || current.axis !== 'horizontal'
        || hasOpenOverlay(root)) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === current.identifier);
      if (!touch) return;
      const dx = touch.clientX - current.x;
      if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(touch.clientY - current.y) * 1.5) return;
      const index = items.indexOf(value);
      const next = index < 0 ? undefined : items[index + (dx < 0 ? 1 : -1)];
      // Prevent the consumed swipe from activating a row on the arriving page.
      if (event.cancelable) event.preventDefault();
      if (next !== undefined) onValueChange(next);
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end, { passive: false });
    root.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      cancel();
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', cancel);
    };
  }, [reference, enabled, items, value, onValueChange]);
}
