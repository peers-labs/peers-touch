import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { registerPage, _resetPageRegistryForTests } from './page';
import {
  _resetRuntimeRegistryForTests,
  installRuntime,
  registerRuntime,
} from './runtime';
import {
  acquirePageRuntimeLease,
  releasePageRuntimeLease,
  requestPageRuntimeRelease,
} from './pageRuntimeLease';

describe('page runtime lease dispatch', () => {
  afterEach(() => {
    vi.useRealTimers();
    _resetRuntimeRegistryForTests();
    _resetPageRegistryForTests();
  });

  it('ignores runtimes that do not implement page lease hooks', () => {
    registerRuntime({
      id: 'plain',
      scope: 'app',
      install: vi.fn(),
      teardown: vi.fn(),
      bootstrap: vi.fn(async () => undefined),
    });
    installRuntime('plain');
    registerPage({
      id: 'plain-page',
      factory: () => createElement('div'),
      preload: 'on-visit',
      keepAlive: 'none',
      runtimes: ['plain'],
    });

    expect(() => acquirePageRuntimeLease('plain-page', 'activate')).not.toThrow();
    expect(() => releasePageRuntimeLease('plain-page', 'unmount')).not.toThrow();
  });

  it('dispatches acquire and release to the page owner runtimes', async () => {
    vi.useFakeTimers();
    const acquirePage = vi.fn();
    const releasePage = vi.fn();
    registerRuntime({
      id: 'lease-owner',
      scope: 'app',
      install: vi.fn(),
      teardown: vi.fn(),
      bootstrap: vi.fn(async () => undefined),
      acquirePage,
      releasePage,
    });
    installRuntime('lease-owner');
    registerPage({
      id: 'applet:*',
      match: (pageId) => pageId.startsWith('applet:'),
      factory: () => createElement('div'),
      preload: 'on-visit',
      keepAlive: { lru: 4 },
      runtimes: ['lease-owner'],
    });

    acquirePageRuntimeLease('applet:peers.note', 'activate');
    releasePageRuntimeLease('applet:peers.note', 'evict');
    requestPageRuntimeRelease('applet:peers.note', 'explicit-close');
    expect(releasePage).not.toHaveBeenCalledWith('applet:peers.note', 'explicit-close');
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(acquirePage).toHaveBeenCalledWith('applet:peers.note', 'activate');
    expect(releasePage).toHaveBeenCalledWith('applet:peers.note', 'evict');
    expect(releasePage).toHaveBeenCalledWith('applet:peers.note', 'explicit-close');
  });

  it('replays active page acquire after the runtime installs', async () => {
    vi.useFakeTimers();
    const acquirePage = vi.fn();
    registerPage({
      id: 'applet:*',
      match: (pageId) => pageId.startsWith('applet:'),
      factory: () => createElement('div'),
      preload: 'on-visit',
      keepAlive: 'forever',
      runtimes: ['late-runtime'],
    });

    acquirePageRuntimeLease('applet:peers.atelier', 'activate');

    registerRuntime({
      id: 'late-runtime',
      scope: 'app',
      install: vi.fn(),
      teardown: vi.fn(),
      bootstrap: vi.fn(async () => undefined),
      acquirePage,
    });
    expect(acquirePage).not.toHaveBeenCalled();

    installRuntime('late-runtime');
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(acquirePage).toHaveBeenCalledTimes(1);
    expect(acquirePage).toHaveBeenCalledWith('applet:peers.atelier', 'activate');
  });
});
