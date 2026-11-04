import type { ActionExecution, Availability, DismissReason, Tone, ActionTone } from '@peers-touch/ui-contracts';

/** Commands express risk only as danger; feedback tones (success/warning/info)
 *  are not command tones and normalize to neutral. */
export function asActionTone(tone?: Tone): ActionTone {
  return tone === 'danger' ? 'danger' : 'neutral';
}

export function activationAllowed(availability: Availability | undefined, execution: ActionExecution = 'idle'): boolean {
  return availability?.kind !== 'disabled' && execution !== 'pending' && execution !== 'recovering';
}
export function disabledReason(availability?: Availability): string | undefined {
  if (availability?.kind !== 'disabled') return undefined;
  if (!availability.reason.trim()) throw new Error('Disabled actions require an explanation.');
  return availability.reason;
}
export function nextEnabledIndex(
  current: number, direction: 1 | -1, count: number, disabled: (index: number) => boolean,
): number {
  if (!count) return -1;
  for (let step = 1; step <= count; step++) {
    const candidate = (current + direction * step + count * 2) % count;
    if (!disabled(candidate)) return candidate;
  }
  return -1;
}
export function canDismiss(dirty: boolean, reason: DismissReason): 'request-owner' | 'dismiss' {
  return dirty && reason !== 'selection' ? 'request-owner' : 'dismiss';
}
/** A query owner's stale-result guard, not a second query cache or transport. */
export function createQueryEpoch() {
  let current = 0;
  return {
    begin: () => ++current,
    isCurrent: (epoch: number) => epoch === current,
    invalidate: () => { current++; },
  };
}
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
export function visibleRange(
  scrollTop: number, viewportHeight: number, rowHeight: number, total: number, overscan = 3,
): { start: number; end: number } {
  if (rowHeight <= 0 || !Number.isFinite(rowHeight)) throw new Error('VirtualList rowHeight must be positive.');
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  return { start, end: Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan) };
}
