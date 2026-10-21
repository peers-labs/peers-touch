import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getIdleRuntimeInstallStatus,
  installIdleRuntimes,
  tearDownSessionRuntimes,
} from './boot';
import {
  _resetRuntimeRegistryForTests,
  registerRuntime,
} from './runtime';

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = () => settle();
  });
  return { promise, resolve };
}

describe('idle runtime boot pipeline', () => {
  afterEach(() => {
    tearDownSessionRuntimes();
    _resetRuntimeRegistryForTests();
    vi.useRealTimers();
  });

  it('keeps timed-out native bootstraps serial and joins duplicate installs', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    const firstBootstrap = vi.fn(() => first.promise);
    const secondBootstrap = vi.fn(() => second.promise);
    registerRuntime({
      id: 'first-idle',
      scope: 'session',
      install: vi.fn(),
      teardown: vi.fn(),
      bootstrap: firstBootstrap,
    });
    registerRuntime({
      id: 'second-idle',
      scope: 'session',
      install: vi.fn(),
      teardown: vi.fn(),
      bootstrap: secondBootstrap,
    });

    const install = installIdleRuntimes('actor-a', []);
    expect(installIdleRuntimes('actor-a', [])).toBe(install);
    expect(getIdleRuntimeInstallStatus('actor-a')).toBe('running');
    expect(firstBootstrap).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(getIdleRuntimeInstallStatus('actor-a')).toBe('degraded');
    expect(secondBootstrap).not.toHaveBeenCalled();

    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(secondBootstrap).toHaveBeenCalledTimes(1);

    second.resolve();
    await install;
    expect(getIdleRuntimeInstallStatus('actor-a')).toBe('ready');
  });

  it('fences the remaining idle queue after session teardown', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const secondBootstrap = vi.fn(async () => undefined);
    registerRuntime({
      id: 'first-idle',
      scope: 'session',
      install: vi.fn(),
      teardown: vi.fn(),
      bootstrap: () => first.promise,
    });
    registerRuntime({
      id: 'second-idle',
      scope: 'session',
      install: vi.fn(),
      teardown: vi.fn(),
      bootstrap: secondBootstrap,
    });

    const install = installIdleRuntimes('actor-a', []);
    await vi.advanceTimersByTimeAsync(5_000);
    tearDownSessionRuntimes();
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await install;

    expect(secondBootstrap).not.toHaveBeenCalled();
    expect(getIdleRuntimeInstallStatus('actor-a')).toBe('pending');
  });
});
