import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetPageRegistryForTests,
  getPage,
  listIdlePreloadPages,
  registerPage,
  resolvePage,
} from './page';

describe('page registry', () => {
  afterEach(() => {
    _resetPageRegistryForTests();
  });

  it('resolves dynamic descriptors without prewarming them as static pages', () => {
    registerPage({
      id: 'applet:*',
      match: (pageId) => pageId.startsWith('applet:'),
      factory: () => createElement('div'),
      preload: 'idle',
      keepAlive: { lru: 4 },
      runtimes: ['applets'],
    });

    const resolved = resolvePage('applet:hello-lynx');

    expect(resolved?.descriptor.id).toBe('applet:*');
    expect(resolved?.pageId).toBe('applet:hello-lynx');
    expect(resolved?.pageKey).toBe('applet:hello-lynx');
    expect(resolved?.dynamic).toBe(true);
    expect(getPage('applet:hello-lynx')?.id).toBe('applet:*');
    expect(listIdlePreloadPages()).toEqual([]);
  });

  it('prefers exact descriptors over dynamic descriptors', () => {
    registerPage({
      id: 'applet:*',
      match: (pageId) => pageId.startsWith('applet:'),
      factory: () => createElement('div'),
      preload: 'on-visit',
      keepAlive: { lru: 4 },
      runtimes: ['applets'],
    });
    registerPage({
      id: 'applet:settings',
      factory: () => createElement('div'),
      preload: 'on-visit',
      keepAlive: 'none',
      runtimes: ['settings'],
    });

    const resolved = resolvePage('applet:settings');

    expect(resolved?.descriptor.id).toBe('applet:settings');
    expect(resolved?.pageKey).toBe('applet:settings');
    expect(resolved?.dynamic).toBe(false);
  });
});
