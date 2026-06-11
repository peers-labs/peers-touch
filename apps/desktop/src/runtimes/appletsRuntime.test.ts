import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock('../store/applets', () => ({
  useAppletsStore: {
    getState: () => ({ refresh }),
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
    refresh.mockResolvedValue(undefined);
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
    const fakeWindow = createFakeEventTarget();
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
});
