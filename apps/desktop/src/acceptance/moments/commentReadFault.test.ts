import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armCommentRead, clearCommentRead, commentReadFaultStatus,
  holdVerifiedCommentRead, releaseCommentRead,
} from './commentReadFault';

describe('real verified Comment read pause', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_ACCEPTANCE_HARNESS', '1');
  });

  afterEach(() => {
    clearCommentRead();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('pauses exactly one matching completion and releases without replacing its value', async () => {
    const scope = vi.fn();
    const originalResponse = { commentId: 'original', count: 0 };
    armCommentRead('post', scope);
    await holdVerifiedCommentRead('other-post');
    expect(commentReadFaultStatus()).toEqual({ state: 'armed', effectCount: 0 });
    let completed = false;
    const pending = holdVerifiedCommentRead('post').then(() => {
      completed = true;
      return originalResponse;
    });
    await holdVerifiedCommentRead('post');
    expect(completed).toBe(false);
    expect(commentReadFaultStatus()).toEqual({ state: 'held', effectCount: 1 });
    releaseCommentRead();
    expect(await pending).toBe(originalResponse);
    expect(completed).toBe(true);
    expect(commentReadFaultStatus()).toEqual({ state: 'released', effectCount: 1 });
  });

  it('fails closed on an expired or cancelled held response', async () => {
    for (const action of ['expire', 'cancel'] as const) {
      armCommentRead('post', () => {});
      const pending = holdVerifiedCommentRead('post');
      const rejection = expect(pending).rejects.toThrow(
        action === 'expire' ? 'commentReadFaultTimeout' : 'commentReadFaultCancelled',
      );
      if (action === 'expire') await vi.advanceTimersByTimeAsync(30_000);
      else clearCommentRead();
      await rejection;
      expect(() => releaseCommentRead()).toThrow('commentReadFaultNotHeld');
      clearCommentRead();
    }
  });

  it('rejects overlapping controls, scope changes and non-Acceptance arming', async () => {
    let identity = 'initial';
    armCommentRead('post', () => {
      if (identity !== 'initial') throw new Error('scope changed');
    });
    expect(() => armCommentRead('post', () => {})).toThrow('commentReadFaultAlreadyActive');
    identity = 'replacement';
    await expect(holdVerifiedCommentRead('post')).rejects.toThrow('scope changed');
    clearCommentRead();
    vi.stubEnv('VITE_ACCEPTANCE_HARNESS', '0');
    expect(() => armCommentRead('post', () => {})).toThrow('commentReadFaultUnavailable');
  });
});
