/**
 * Scroll and focus restoration externalized from page lifetime.
 *
 * Pages are pure renderers — they do not own scroll position.
 * Instead, this module stores and restores scroll positions keyed by route ID,
 * allowing the shell to manage restoration during tab switches.
 */

interface ScrollPosition {
  scrollTop: number;
  scrollLeft: number;
  timestamp: number;
}

const scrollPositions = new Map<string, ScrollPosition>();

/** Maximum age (ms) before a stored scroll position is considered stale. */
const MAX_SCROLL_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Save the current scroll position for a route.
 * Call this when navigating away from a tab or detail view.
 */
export function saveScrollPosition(routeId: string, element: Element | null): void {
  if (!element) return;

  scrollPositions.set(routeId, {
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
    timestamp: Date.now(),
  });
}

/**
 * Restore a previously saved scroll position for a route.
 * Call this when returning to a tab or detail view.
 * Returns true if a position was restored, false if none was found or it was stale.
 */
export function restoreScrollPosition(routeId: string, element: Element | null): boolean {
  if (!element) return false;

  const saved = scrollPositions.get(routeId);
  if (!saved) return false;

  // Discard stale positions
  if (Date.now() - saved.timestamp > MAX_SCROLL_AGE_MS) {
    scrollPositions.delete(routeId);
    return false;
  }

  element.scrollTop = saved.scrollTop;
  element.scrollLeft = saved.scrollLeft;
  return true;
}

/**
 * Clear saved scroll position for a route (e.g. on data refresh).
 */
export function clearScrollPosition(routeId: string): void {
  scrollPositions.delete(routeId);
}

/**
 * Clear all saved scroll positions (e.g. on logout or session change).
 */
export function clearAllScrollPositions(): void {
  scrollPositions.clear();
}

/**
 * Save the currently focused element's identity for a route.
 * Focus restoration is best-effort via a data-focus-id attribute.
 */
export function saveFocusTarget(routeId: string): string | null {
  const active = document.activeElement;
  if (!active || active === document.body) return null;

  const focusId = active.getAttribute('data-focus-id');
  if (focusId) {
    focusTargets.set(routeId, focusId);
  }
  return focusId;
}

/**
 * Restore focus to the element with the saved data-focus-id within a container.
 */
export function restoreFocusTarget(routeId: string, container: Element | null): boolean {
  if (!container) return false;

  const focusId = focusTargets.get(routeId);
  if (!focusId) return false;

  const target = container.querySelector(`[data-focus-id="${CSS.escape(focusId)}"]`);
  if (target instanceof HTMLElement) {
    target.focus({ preventScroll: true });
    return true;
  }
  return false;
}

const focusTargets = new Map<string, string>();
