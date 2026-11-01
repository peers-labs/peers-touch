// Shared renderer-visibility gate for runtime polling loops.
//
// Timers keep their normal cadence while hidden, but their work body skips
// via isDocumentHidden(). Polls that were skipped in the background must be
// caught up by an onDocumentForeground() listener so returning to the tab
// never waits a full interval for fresh data.

export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

/**
 * Runs `handler` once each time the document transitions into the visible
 * state. Returns the unsubscribe function (a no-op outside renderer envs).
 */
export function onDocumentForeground(handler: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const listener = () => {
    if (!document.hidden) handler();
  };
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}
