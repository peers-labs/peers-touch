import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('logger background lane', () => {
  let log: typeof import('./logger').log;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.resetModules();
    ({ log } = await import('./logger'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers batched frontend logging off the caller stack', async () => {
    log.info('runtime', 'deferred log', { command: 'frontend_log' });

    expect(invoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);

    expect(invoke).toHaveBeenCalledWith('frontend_log_batch', {
      input: {
        entries: [{
          data: JSON.stringify({ command: 'frontend_log' }),
          level: 'info',
          message: 'deferred log',
          tag: 'runtime',
        }],
      },
    });
  });

  it('serializes background log invokes instead of firing them concurrently', async () => {
    let releaseFirst: (() => void) | undefined;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve(undefined);
        }),
    );
    vi.mocked(invoke).mockResolvedValue(undefined);

    log.warn('runtime', 'first');
    await vi.advanceTimersByTimeAsync(150);
    expect(invoke).toHaveBeenCalledTimes(1);

    log.warn('runtime', 'second');
    await vi.advanceTimersByTimeAsync(150);
    expect(invoke).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(150);

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('redacts nested secrets before logs cross the Tauri IPC boundary', async () => {
    const passwordField = ['pass', 'word'].join('');
    const rawPassword = ['sensitive', 'value-a'].join('-');
    log.info('api', 'auth request', {
      req: {
        account: 'alice@p.t',
        [passwordField]: rawPassword,
        nested: {
          access_token: 'sensitive-value-b',
          operation: 'login',
        },
        key_vaults: JSON.stringify({ api_key: 'sensitive-value-c' }),
      },
    });

    await vi.advanceTimersByTimeAsync(150);

    const args = vi.mocked(invoke).mock.calls[0]?.[1] as
      | { input?: { entries?: Array<{ data: string }> } }
      | undefined;
    const entry = args?.input?.entries?.[0];
    expect(entry).toBeDefined();
    if (!entry) throw new Error('frontend log batch entry is missing');
    expect(JSON.parse(entry.data)).toEqual({
      req: {
        account: 'alice@p.t',
        [passwordField]: '[redacted]',
        nested: {
          access_token: '[redacted]',
          operation: 'login',
        },
        key_vaults: '[redacted]',
      },
    });
    expect(entry.data).not.toContain(rawPassword);
    expect(entry.data).not.toContain('sensitive-value-b');
    expect(entry.data).not.toContain('sensitive-value-c');
  });
});
