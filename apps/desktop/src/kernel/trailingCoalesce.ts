// Trailing coalescer — collapse a burst of triggers into one fire after the
// last trigger. Used by runtime realtime handlers so a storm of
// "projection invalidated" events performs a single refresh.

export interface TrailingCoalescer {
  /** Arm (or re-arm) the trailing timer. No-op while cancelled. */
  schedule(): void;
  /** Drop any pending fire without running it. */
  cancel(): void;
  /** Fire immediately when pending, then disarm. */
  flush(): void;
  readonly pending: boolean;
}

export interface CoalescerClock {
  setTimeout: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export function createTrailingCoalescer(
  waitMs: number,
  fire: () => void,
  clock: CoalescerClock = {
    setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): TrailingCoalescer {
  let timer: unknown = null;

  const clear = (): void => {
    if (timer !== null) {
      clock.clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(): void {
      clear();
      timer = clock.setTimeout(() => {
        timer = null;
        fire();
      }, waitMs);
    },
    cancel(): void {
      clear();
    },
    flush(): void {
      if (timer === null) return;
      clear();
      fire();
    },
    get pending(): boolean {
      return timer !== null;
    },
  };
}
