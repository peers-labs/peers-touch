import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTrailingCoalescer } from './trailingCoalesce';

describe('createTrailingCoalescer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses a burst into one trailing fire', () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const coalescer = createTrailingCoalescer(1_800, fire);

    coalescer.schedule();
    vi.advanceTimersByTime(1_000);
    coalescer.schedule();
    vi.advanceTimersByTime(1_000);
    coalescer.schedule();
    expect(fire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_800);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending fire', () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const coalescer = createTrailingCoalescer(100, fire);

    coalescer.schedule();
    expect(coalescer.pending).toBe(true);
    coalescer.cancel();
    vi.advanceTimersByTime(500);
    expect(fire).not.toHaveBeenCalled();
    expect(coalescer.pending).toBe(false);
  });

  it('flushes immediately on demand', () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const coalescer = createTrailingCoalescer(100, fire);

    coalescer.schedule();
    coalescer.flush();
    expect(fire).toHaveBeenCalledTimes(1);
    coalescer.flush();
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
