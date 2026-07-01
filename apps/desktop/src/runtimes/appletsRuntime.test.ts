import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.hoisted(() => vi.fn<() => Promise<void>>());
const loadApplet = vi.hoisted(() => vi.fn<(id: string) => Promise<void>>());
const unloadApplet = vi.hoisted(() => vi.fn<(id: string) => Promise<void>>());

vi.mock('../store/applets', () => ({
  useAppletsStore: {
    getState: () => ({ refresh, loadApplet, unloadApplet }),
  },
}));

interface FakeEventTarget {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  emit(type: string): void;
}

function createFakeEventTarget(): FakeEventTarget {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    }),
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

describe('applets runtime projection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    refresh.mockReset();
    loadApplet.mockReset();
    unloadApplet.mockReset();
    refresh.mockResolvedValue(undefined);
    loadApplet.mockResolvedValue(undefined);
    unloadApplet.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reconciles applet catalog from runtime timers and foreground signals', async () => {
    const fakeDocument = {
      ...createFakeEventTarget(),
      visibilityState: 'visible',
    };
    const fakeWindow = {
      ...createFakeEventTarget(),
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    };
    vi.stubGlobal('document', fakeDocument);
    vi.stubGlobal('window', fakeWindow);

    const { appletsRuntime } = await import('./appletsRuntime');

    appletsRuntime.install();
    await appletsRuntime.bootstrap(null);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    fakeWindow.emit('focus');
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(3);

    fakeDocument.emit('visibilitychange');
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(4);

    appletsRuntime.teardown();
    fakeWindow.emit('focus');
    fakeDocument.emit('visibilitychange');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(fakeDocument.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
  });

  it('owns applet page acquire and release as an idempotent runtime lease', async () => {
    const { appletsRuntime } = await import('./appletsRuntime');

    await appletsRuntime.acquirePage?.('applet:peers.note', 'activate');
    await appletsRuntime.acquirePage?.('applet:peers.note', 'activate');
    await appletsRuntime.releasePage?.('applet:peers.note', 'explicit-close');

    expect(loadApplet).toHaveBeenCalledTimes(1);
    expect(loadApplet).toHaveBeenCalledWith('peers.note');
    expect(unloadApplet).toHaveBeenCalledTimes(1);
    expect(unloadApplet).toHaveBeenCalledWith('peers.note');
  });

  it('keeps the previous LRU applet alive while switching to another applet page', async () => {
    const { appletsRuntime } = await import('./appletsRuntime');

    await appletsRuntime.acquirePage?.('applet:peers.note', 'activate');
    await appletsRuntime.acquirePage?.('applet:generic-complex-applet', 'activate');

    expect(loadApplet).toHaveBeenCalledTimes(2);
    expect(loadApplet).toHaveBeenNthCalledWith(1, 'peers.note');
    expect(loadApplet).toHaveBeenNthCalledWith(2, 'generic-complex-applet');
    expect(unloadApplet).not.toHaveBeenCalled();

    await appletsRuntime.releasePage?.('applet:generic-complex-applet', 'explicit-close');
    expect(unloadApplet).toHaveBeenCalledTimes(1);
    expect(unloadApplet).toHaveBeenCalledWith('generic-complex-applet');

    await appletsRuntime.releasePage?.('applet:peers.note', 'evict');
    expect(unloadApplet).toHaveBeenCalledTimes(2);
    expect(unloadApplet).toHaveBeenCalledWith('peers.note');
  });
});
