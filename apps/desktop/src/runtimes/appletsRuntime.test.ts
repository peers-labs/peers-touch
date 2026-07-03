import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.hoisted(() => vi.fn<() => Promise<void>>());
const loadApplet = vi.hoisted(() => vi.fn<(id: string) => Promise<void>>());
const unloadApplet = vi.hoisted(() => vi.fn<(id: string) => Promise<void>>());

vi.mock('../store/applets', () => ({
  useAppletsStore: {
    getState: () => ({ refresh, loadApplet, unloadApplet }),
  },
}));

vi.mock('../applet/AppletManager', () => ({
  default: {
    getInstance: () => ({
      getAppletInfo: (id: string) => ({ id, version: '1.0.0' }),
    }),
  },
}));

// Fake Applet Kernel seam. It models just enough of the frozen state machine for
// the lifecycle-adapter lease semantics: registry create/get, ready→visible,
// hide/show/pause/resume, and destroy (which reclaims via the same single unload
// path the real Orchestrator drives: sessions.destroy → AppletManager.unloadApplet,
// mirrored here through the store unload mock so no double-unload can appear).
interface FakeInstance {
  appletId: string;
  instanceId: string;
  state: string;
}

const kernelState = vi.hoisted(() => ({ instances: new Map<string, FakeInstance>() }));
const sessionsCreate = vi.hoisted(() => vi.fn(async (_appletId: string, _pageId: string) => 'session-x'));
const runSweep = vi.hoisted(() => vi.fn(async (_now: number) => []));
const handleMemoryPressure = vi.hoisted(() => vi.fn(async (_level: string, _now: number) => []));
const applySurfaceCommand = vi.hoisted(() => vi.fn(async () => undefined));
const signalPause = vi.hoisted(() => vi.fn());
const signalResume = vi.hoisted(() => vi.fn());

const dispatch = vi.hoisted(() =>
  vi.fn(async (event: { type: string; appletId: string; instanceId: string }) => {
    const instance = kernelState.instances.get(event.instanceId);
    if (!instance) return { accepted: false, from: 'cold' };
    const from = instance.state;
    switch (event.type) {
      case 'ready':
      case 'show':
      case 'resume':
        instance.state = 'visible';
        break;
      case 'hide':
        instance.state = 'hidden-warm';
        break;
      case 'pause':
        instance.state = 'paused';
        break;
      case 'destroy':
        kernelState.instances.delete(event.instanceId);
        // Single reclamation path: Orchestrator → sessions.destroy → backend →
        // AppletManager.unloadApplet, modeled here via the store unload mock.
        await unloadApplet(instance.appletId);
        break;
      default:
        break;
    }
    return { accepted: true, from, to: instance.state };
  }),
);

const fakeKernel = vi.hoisted(() => ({
  registry: {
    get: (instanceId: string) => kernelState.instances.get(instanceId),
    create: (input: { appletId: string; instanceId: string }) => {
      const instance: FakeInstance = {
        appletId: input.appletId,
        instanceId: input.instanceId,
        state: 'materializing',
      };
      kernelState.instances.set(input.instanceId, instance);
      return instance;
    },
  },
  sessions: { create: sessionsCreate },
  dispatch,
  runSweep,
  handleMemoryPressure,
}));

const fakeAdapter = vi.hoisted(() => ({
  applySurfaceCommand,
  surfaces: { signalPause, signalResume },
}));

vi.mock('../applet/kernel/desktopKernel', () => ({
  getDesktopAppletKernel: () => fakeKernel,
  getDesktopAppletAdapter: () => fakeAdapter,
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
    kernelState.instances.clear();
    refresh.mockReset();
    loadApplet.mockReset();
    unloadApplet.mockReset();
    dispatch.mockClear();
    sessionsCreate.mockClear();
    runSweep.mockClear();
    handleMemoryPressure.mockClear();
    applySurfaceCommand.mockClear();
    signalPause.mockClear();
    signalResume.mockClear();
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

  it('cold-starts an applet through the kernel: register, ready, first-frame show', async () => {
    const { appletsRuntime } = await import('./appletsRuntime');

    await appletsRuntime.acquirePage?.('applet:peers.note', 'activate');

    expect(loadApplet).toHaveBeenCalledWith('peers.note');
    expect(sessionsCreate).toHaveBeenCalledWith('peers.note', 'applet:peers.note');
    // `ready` flips materializing → visible; the first frame is mounted via the
    // surface command, never an illegal `show` dispatch from visible (§6.2).
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready', instanceId: 'applet:peers.note' }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'show', instanceId: 'applet:peers.note' }));
    expect(applySurfaceCommand).toHaveBeenCalledWith('show', { appletId: 'peers.note', instanceId: 'applet:peers.note' });
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

  it('backgrounds the previous applet and foregrounds the entered one via the active-page bridge', async () => {
    const runtime = await import('./appletsRuntime');
    const { appletsRuntime, notifyActiveAppletPage } = runtime;

    // Enter peers.note as the foreground page, then switch to generic (which
    // backgrounds peers.note to hidden-warm), so a later return can re-show it.
    await appletsRuntime.acquirePage?.('applet:peers.note', 'activate');
    notifyActiveAppletPage('applet:peers.note');
    await appletsRuntime.acquirePage?.('applet:generic-complex-applet', 'activate');
    notifyActiveAppletPage('applet:generic-complex-applet');
    await Promise.resolve();
    dispatch.mockClear();

    // Return to peers.note: generic backgrounds (hide), peers.note foregrounds
    // (show) from hidden-warm — the legal warm-resume transition.
    notifyActiveAppletPage('applet:peers.note');
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'hide', instanceId: 'applet:generic-complex-applet' }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'show', instanceId: 'applet:peers.note' }));
  });

  it('drives the periodic kernel sweep from the install-time timer (§6 TTL authority)', async () => {
    vi.stubGlobal('document', { ...createFakeEventTarget(), visibilityState: 'visible' });
    vi.stubGlobal('window', { ...createFakeEventTarget(), setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });

    const { appletsRuntime } = await import('./appletsRuntime');

    appletsRuntime.install();
    // The Kernel — not the runtime — owns TTL reclamation; the runtime only feeds
    // it `now` on a fixed cadence. Each interval must call runSweep exactly once.
    expect(runSweep).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runSweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runSweep).toHaveBeenCalledTimes(2);
    expect(typeof runSweep.mock.calls[0][0]).toBe('number');

    // teardown stops the timer: no further sweeps after the runtime is torn down.
    appletsRuntime.teardown();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(runSweep).toHaveBeenCalledTimes(2);
  });

  it('routes sampled heap pressure to the kernel at the correct thresholds (§6 memory pressure)', async () => {
    vi.stubGlobal('document', { ...createFakeEventTarget(), visibilityState: 'visible' });
    vi.stubGlobal('window', { ...createFakeEventTarget(), setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });
    const heap = { usedJSHeapSize: 0, jsHeapSizeLimit: 100 };
    vi.stubGlobal('performance', { now: () => 0, memory: heap });

    const { appletsRuntime } = await import('./appletsRuntime');
    appletsRuntime.install();

    // Below the moderate ratio (0.75): the monitor stays silent.
    heap.usedJSHeapSize = 50;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(handleMemoryPressure).not.toHaveBeenCalled();

    // Crossing the moderate ratio routes a 'moderate' signal.
    heap.usedJSHeapSize = 80;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(handleMemoryPressure).toHaveBeenLastCalledWith('moderate', expect.any(Number));

    // Crossing the critical ratio routes a 'critical' signal.
    heap.usedJSHeapSize = 95;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(handleMemoryPressure).toHaveBeenLastCalledWith('critical', expect.any(Number));

    appletsRuntime.teardown();
  });

  it('freezes and thaws the foreground applet on window blur/focus (§6 background pause)', async () => {
    const fakeDocument = { ...createFakeEventTarget(), visibilityState: 'visible' };
    const fakeWindow = { ...createFakeEventTarget(), setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() };
    vi.stubGlobal('document', fakeDocument);
    vi.stubGlobal('window', fakeWindow);

    const runtime = await import('./appletsRuntime');
    const { appletsRuntime, notifyActiveAppletPage } = runtime;

    appletsRuntime.install();
    await appletsRuntime.acquirePage?.('applet:peers.note', 'activate');
    notifyActiveAppletPage('applet:peers.note');
    await Promise.resolve();
    dispatch.mockClear();

    // Backgrounding the window pauses the single foreground instance and the
    // pause carries no surface command, so the freeze is driven via signalPause.
    fakeWindow.emit('blur');
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'pause', instanceId: 'applet:peers.note' }));
    expect(signalPause).toHaveBeenCalledWith({ appletId: 'peers.note', instanceId: 'applet:peers.note' });

    // Refocusing resumes it from paused via signalResume.
    fakeWindow.emit('focus');
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'resume', instanceId: 'applet:peers.note' }));
    expect(signalResume).toHaveBeenCalledWith({ appletId: 'peers.note', instanceId: 'applet:peers.note' });

    appletsRuntime.teardown();
  });
});
