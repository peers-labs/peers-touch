import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('defers frontend_log invoke off the caller stack', async () => {
    log.info('runtime', 'deferred log', { command: 'frontend_log' });

    expect(invoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(16);

    expect(invoke).toHaveBeenCalledWith('frontend_log', {
      input: {
        data: JSON.stringify({ command: 'frontend_log' }),
        level: 'info',
        message: 'deferred log',
        tag: 'runtime',
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
    log.warn('runtime', 'second');

    await vi.advanceTimersByTimeAsync(16);
    expect(invoke).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
