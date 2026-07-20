import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { throttleInvoke, markInteractionStart, isInInteractionPhase, _resetThrottler } from './invokeThrottler';

describe('InvokeThrottler', () => {
  beforeEach(() => {
    _resetThrottler();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('outside interaction phase', () => {
    it('executes immediately without deferral', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const { deferred, promise } = throttleInvoke('chat_list_conversations', fn);
      expect(deferred).toBe(false);
      expect(fn).toHaveBeenCalledTimes(1);
      await expect(promise).resolves.toBe('result');
    });
  });

  describe('inside interaction phase', () => {
    it('defers non-allowlist commands', async () => {
      markInteractionStart();
      const fn = vi.fn().mockResolvedValue('deferred-result');
      const { deferred, promise } = throttleInvoke('chat_list_conversations', fn);

      expect(deferred).toBe(true);
      expect(fn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);
      await expect(promise).resolves.toBe('deferred-result');
    });

    it('bypasses allowlisted auth commands immediately', async () => {
      markInteractionStart();
      const fn = vi.fn().mockResolvedValue('auth-result');
      const { deferred, bypassReason, securityClass, promise } = throttleInvoke('auth_login', fn);

      expect(deferred).toBe(false);
      expect(bypassReason).toBeTruthy();
      expect(securityClass).toBe('auth');
      expect(fn).toHaveBeenCalledTimes(1);
      await expect(promise).resolves.toBe('auth-result');
    });

    it('bypasses account_unlock', async () => {
      markInteractionStart();
      const fn = vi.fn().mockResolvedValue('unlocked');
      const { deferred, securityClass } = throttleInvoke('account_unlock', fn);
      expect(deferred).toBe(false);
      expect(securityClass).toBe('auth');
    });
  });

  describe('interaction window expiry', () => {
    it('exits interaction phase after 100ms', async () => {
      markInteractionStart();
      expect(isInInteractionPhase()).toBe(true);

      await vi.advanceTimersByTimeAsync(100);
      expect(isInInteractionPhase()).toBe(false);
    });

    it('extends window on repeated markInteractionStart', async () => {
      markInteractionStart();
      await vi.advanceTimersByTimeAsync(80);
      markInteractionStart();
      await vi.advanceTimersByTimeAsync(80);
      expect(isInInteractionPhase()).toBe(true);

      await vi.advanceTimersByTimeAsync(20);
      expect(isInInteractionPhase()).toBe(false);
    });
  });

  describe('error handling', () => {
    it('propagates errors from deferred invoke', async () => {
      markInteractionStart();
      const fn = vi.fn().mockRejectedValue(new Error('network'));
      const { promise } = throttleInvoke('chat_send_message', fn);

      // Attach handler before advancing timers to prevent unhandled rejection
      const rejection = expect(promise).rejects.toThrow('network');
      await vi.advanceTimersByTimeAsync(0);
      await rejection;
    });
  });
});
