import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduler, _resetSchedulerQueues } from './scheduler';

describe('FrontendScheduler', () => {
  beforeEach(() => {
    _resetSchedulerQueues();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('visible', () => {
    it('executes action synchronously', () => {
      const fn = vi.fn();
      scheduler.visible(fn);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('afterFirstPaint', () => {
    it('defers action to next animation frame', async () => {
      const fn = vi.fn();
      scheduler.afterFirstPaint(fn);
      expect(fn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(16);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not starve work when the native window is hidden', async () => {
      const requestAnimationFrame = vi.fn();
      vi.stubGlobal('window', {
        document: { visibilityState: 'hidden' },
        requestAnimationFrame,
        cancelAnimationFrame: vi.fn(),
      });
      const fn = vi.fn();

      scheduler.afterFirstPaint(fn);
      await vi.advanceTimersByTimeAsync(0);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(requestAnimationFrame).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('returns cancel function that prevents execution', async () => {
      const fn = vi.fn();
      const cancel = scheduler.afterFirstPaint(fn);
      cancel();

      await vi.advanceTimersByTimeAsync(16);
      expect(fn).not.toHaveBeenCalled();
    });

    it('cancel is idempotent', async () => {
      const fn = vi.fn();
      const cancel = scheduler.afterFirstPaint(fn);
      cancel();
      cancel();
      await vi.advanceTimersByTimeAsync(16);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('idleChunk', () => {
    it('executes action after idle timeout', async () => {
      const fn = vi.fn();
      scheduler.idleChunk('test-task', fn);
      expect(fn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(250);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('respects custom timeoutMs', async () => {
      const fn = vi.fn();
      scheduler.idleChunk('test-task', fn, 500);

      await vi.advanceTimersByTimeAsync(250);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns cancel function that prevents execution', async () => {
      const fn = vi.fn();
      const cancel = scheduler.idleChunk('test-task', fn);
      cancel();

      await vi.advanceTimersByTimeAsync(2500);
      expect(fn).not.toHaveBeenCalled();
    });

    it('handles async actions gracefully', async () => {
      const fn = vi.fn().mockResolvedValue(undefined);
      scheduler.idleChunk('async-task', fn);

      await vi.advanceTimersByTimeAsync(250);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('background', () => {
    it('executes tasks in FIFO order', async () => {
      const order: number[] = [];
      scheduler.background('t1', () => { order.push(1); });
      scheduler.background('t2', () => { order.push(2); });
      scheduler.background('t3', () => { order.push(3); });

      await vi.advanceTimersByTimeAsync(0);
      expect(order).toEqual([1, 2, 3]);
    });

    it('handles async tasks sequentially', async () => {
      const order: number[] = [];
      scheduler.background('t1', async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      });
      scheduler.background('t2', () => { order.push(2); });

      await vi.advanceTimersByTimeAsync(20);
      expect(order).toEqual([1, 2]);
    });

    it('continues draining after task error', async () => {
      const order: number[] = [];
      scheduler.background('fail', () => { throw new Error('boom'); });
      scheduler.background('ok', () => { order.push(1); });

      await vi.advanceTimersByTimeAsync(0);
      expect(order).toEqual([1]);
    });
  });

  describe('teardown', () => {
    it('executes tasks in FIFO order', async () => {
      const order: number[] = [];
      scheduler.teardown('t1', () => { order.push(1); });
      scheduler.teardown('t2', () => { order.push(2); });

      await vi.advanceTimersByTimeAsync(0);
      expect(order).toEqual([1, 2]);
    });

    it('continues draining after task error', async () => {
      const order: number[] = [];
      scheduler.teardown('fail', () => { throw new Error('boom'); });
      scheduler.teardown('ok', () => { order.push(1); });

      await vi.advanceTimersByTimeAsync(0);
      expect(order).toEqual([1]);
    });
  });

  describe('reset', () => {
    it('clears pending teardown tasks', async () => {
      const fn = vi.fn();
      // Schedule a teardown with a small delay (drain is async)
      scheduler.teardown('t1', async () => {
        await new Promise((r) => setTimeout(r, 50));
        fn();
      });
      // Tasks queued after the currently-draining one are cleared
      scheduler.teardown('t2', fn);
      _resetSchedulerQueues();

      await vi.advanceTimersByTimeAsync(100);
      // t1 was already dequeued before reset, but t2 was cleared
      // At most t1 runs (it was already in-flight)
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
