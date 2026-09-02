import type { AppletLifecycleEvent, SurfaceTarget } from '@peers-touch/applet-contract';
import type { MemoryPressureLevel } from '@peers-touch/applet-kernel';
import type { RuntimeDescriptor } from '../kernel/runtime';
import { ensureLynxWebRuntime } from '../applet/lynx-web-runtime';
import AppletManager from '../applet/AppletManager';
import { getDesktopAppletAdapter, getDesktopAppletKernel } from '../applet/kernel/desktopKernel';
import { useAppletsStore } from '../store/applets';

// This runtime IS the Desktop Lifecycle Adapter (§6.3): it owns the applet page
// lease, translates page/window signals into AppletKernel lifecycle events, and
// runs the periodic sweep + memory monitor that keep the Kernel the single LRU /
// TTL / memory-pressure authority (§6.1). The Kernel — not this runtime — decides
// when to reclaim; here we only feed it signals and drive Desktop surface work
// through the injected DesktopPlatformAdapter.

const APPLET_CATALOG_RECONCILE_MS = 60_000;
const KERNEL_SWEEP_MS = 60_000;
const MEMORY_SAMPLE_MS = 30_000;
const APPLET_PAGE_PREFIX = 'applet:';
const DESKTOP_PLATFORM_ID = 'desktop';
const MODERATE_HEAP_RATIO = 0.75;
const CRITICAL_HEAP_RATIO = 0.9;

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let memoryTimer: ReturnType<typeof setInterval> | null = null;
let reconciliationInFlight = false;
let lynxRuntimePrewarmCancel: (() => void) | null = null;
// pageId → appletId for every page whose runtime lease is currently held.
const activeAppletPageIds = new Map<string, string>();
// The single applet page the Shell currently shows in the foreground; the only
// instance eligible for app-level pause/resume. Owned by the active-page bridge.
let foregroundAppletPageId: string | null = null;

function appletIdFromPageId(pageId: string): string | undefined {
  if (!pageId.startsWith(APPLET_PAGE_PREFIX) || pageId.length <= APPLET_PAGE_PREFIX.length) return undefined;
  return pageId.slice(APPLET_PAGE_PREFIX.length);
}

function surfaceTarget(appletId: string, pageId: string): SurfaceTarget {
  return { appletId, instanceId: pageId };
}

function lifecycleEvent(type: AppletLifecycleEvent['type'], appletId: string, pageId: string): AppletLifecycleEvent {
  return { type, appletId, instanceId: pageId, timestamp: Date.now() };
}

async function refreshAppletProjection(reason: string): Promise<void> {
  void reason;
  if (reconciliationInFlight) return;
  reconciliationInFlight = true;
  try {
    await useAppletsStore.getState().refresh();
  } finally {
    reconciliationInFlight = false;
  }
}

function scheduleReconciliation(): void {
  if (reconcileTimer != null) return;
  reconcileTimer = setInterval(() => {
    void refreshAppletProjection('interval');
  }, APPLET_CATALOG_RECONCILE_MS);
}

function stopReconciliation(): void {
  if (reconcileTimer == null) return;
  clearInterval(reconcileTimer);
  reconcileTimer = null;
}

function scheduleKernelSweep(): void {
  if (sweepTimer != null) return;
  sweepTimer = setInterval(() => {
    void getDesktopAppletKernel().runSweep(Date.now());
  }, KERNEL_SWEEP_MS);
}

function stopKernelSweep(): void {
  if (sweepTimer == null) return;
  clearInterval(sweepTimer);
  sweepTimer = null;
}

interface ChromiumMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function sampleMemoryPressure(): MemoryPressureLevel | null {
  if (typeof performance === 'undefined') return null;
  const memory = (performance as Performance & { memory?: ChromiumMemory }).memory;
  if (!memory || !memory.jsHeapSizeLimit) return null;
  const ratio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
  if (ratio >= CRITICAL_HEAP_RATIO) return 'critical';
  if (ratio >= MODERATE_HEAP_RATIO) return 'moderate';
  return null;
}

function scheduleMemoryMonitor(): void {
  if (memoryTimer != null) return;
  memoryTimer = setInterval(() => {
    const level = sampleMemoryPressure();
    if (!level) return;
    void getDesktopAppletKernel().handleMemoryPressure(level, Date.now());
  }, MEMORY_SAMPLE_MS);
}

function stopMemoryMonitor(): void {
  if (memoryTimer == null) return;
  clearInterval(memoryTimer);
  memoryTimer = null;
}

function handleVisibilityChange(): void {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'visible') {
    void refreshAppletProjection('visibility');
    resumeForegroundApplet();
  } else {
    pauseForegroundApplet();
  }
}

function handleWindowFocus(): void {
  void refreshAppletProjection('focus');
  resumeForegroundApplet();
}

function handleWindowBlur(): void {
  pauseForegroundApplet();
}

/**
 * Freeze the single foreground applet when the window/app backgrounds. pause
 * carries no surface command in the frozen Orchestrator, so the applet-side
 * timer/rAF freeze is driven through SurfaceManager after the Kernel accepts.
 */
function pauseForegroundApplet(): void {
  if (!foregroundAppletPageId) return;
  const kernel = getDesktopAppletKernel();
  const instance = kernel.registry.get(foregroundAppletPageId);
  if (!instance || instance.state !== 'visible') return;
  const target = surfaceTarget(instance.appletId, instance.instanceId);
  void kernel
    .dispatch(lifecycleEvent('pause', instance.appletId, instance.instanceId))
    .then((result) => {
      if (result.accepted) getDesktopAppletAdapter().surfaces.signalPause(target);
    });
}

function resumeForegroundApplet(): void {
  if (!foregroundAppletPageId) return;
  const kernel = getDesktopAppletKernel();
  const instance = kernel.registry.get(foregroundAppletPageId);
  if (!instance || instance.state !== 'paused') return;
  const target = surfaceTarget(instance.appletId, instance.instanceId);
  void kernel
    .dispatch(lifecycleEvent('resume', instance.appletId, instance.instanceId))
    .then((result) => {
      if (result.accepted) getDesktopAppletAdapter().surfaces.signalResume(target);
    });
}

function scheduleLynxRuntimePrewarm(): void {
  if (lynxRuntimePrewarmCancel || typeof window === 'undefined') return;
  let cancelled = false;
  const prewarm = () => {
    if (cancelled) return;
    void ensureLynxWebRuntime();
  };
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(prewarm, { timeout: 2500 });
    lynxRuntimePrewarmCancel = () => {
      cancelled = true;
      idleWindow.cancelIdleCallback?.(handle);
      lynxRuntimePrewarmCancel = null;
    };
    return;
  }
  const handle = window.setTimeout(prewarm, 800);
  lynxRuntimePrewarmCancel = () => {
    cancelled = true;
    window.clearTimeout(handle);
    lynxRuntimePrewarmCancel = null;
  };
}

function cancelLynxRuntimePrewarm(): void {
  lynxRuntimePrewarmCancel?.();
}

/**
 * Acquire the runtime lease for an applet page. First activation cold-starts a
 * Kernel instance (materialize bundle + adopt session → register → `ready` →
 * first-frame surface `show`). `ready` only flips the state to `visible`; the
 * frozen state machine forbids `show` from `visible`, so the first frame is
 * mounted through the surface command directly, not a `show` dispatch (§6.2).
 * A page that already has a warm instance is re-shown by the active-page bridge.
 */
async function acquireAppletPage(pageId: string): Promise<void> {
  const appletId = appletIdFromPageId(pageId);
  if (!appletId) return;
  if (activeAppletPageIds.get(pageId) === appletId) return;

  activeAppletPageIds.set(pageId, appletId);
  try {
    // Materialize bundle + create the AppletManager capability session that the
    // DesktopSessionBackend adopts. This is the single owner of session/manifest.
    await useAppletsStore.getState().loadApplet(appletId);
    if (activeAppletPageIds.get(pageId) !== appletId) {
      // Superseded mid-load: undo the materialization we just triggered.
      await useAppletsStore.getState().unloadApplet(appletId);
      return;
    }

    const kernel = getDesktopAppletKernel();
    if (kernel.registry.get(pageId)) {
      // Warm instance already exists (returning to a backgrounded page): promote
      // it back to the foreground via the legal show transition.
      await kernel.dispatch(lifecycleEvent('show', appletId, pageId));
      return;
    }

    // Cold start: adopt the session (records instanceId→appletId for destroy),
    // register the instance, then `ready` (materializing → visible) + first frame.
    const sessionId = await kernel.sessions.create(appletId, pageId);
    const info = AppletManager.getInstance().getAppletInfo(appletId);
    kernel.registry.create({
      appletId,
      instanceId: pageId,
      sessionId,
      manifestVersion: info?.version ?? '0.0.0',
      platform: DESKTOP_PLATFORM_ID,
    });
    await kernel.dispatch(lifecycleEvent('ready', appletId, pageId));
    await getDesktopAppletAdapter().applySurfaceCommand('show', surfaceTarget(appletId, pageId));
  } catch (error) {
    activeAppletPageIds.delete(pageId);
    throw error;
  }
}

/**
 * Release the runtime lease. Reclamation flows through the single Orchestrator
 * path (`destroy` → surface destroy + `sessions.destroy` → DesktopSessionBackend
 * → AppletManager.unloadApplet), so there is exactly one unload path and no
 * double-unload (§6.1). If no Kernel instance exists (defensive), fall back to a
 * direct store unload.
 */
async function releaseAppletPage(pageId: string): Promise<void> {
  const appletId = activeAppletPageIds.get(pageId) ?? appletIdFromPageId(pageId);
  if (!appletId) return;
  activeAppletPageIds.delete(pageId);
  if (foregroundAppletPageId === pageId) foregroundAppletPageId = null;

  const kernel = getDesktopAppletKernel();
  if (kernel.registry.get(pageId)) {
    await kernel.dispatch(lifecycleEvent('destroy', appletId, pageId));
    return;
  }
  await useAppletsStore.getState().unloadApplet(appletId);
}

/**
 * Active-page bridge (§6.3): the Shell reports the currently shown page whenever
 * it changes. Leaving an applet backgrounds it (`hide` → hidden-warm, kept
 * alive); entering a warm applet foregrounds it (`show`). Because applet page
 * frames are `keepAlive:'forever'`, PageHost never emits a release on switch, so
 * this signal is the sole driver of the hide/show visibility axis.
 */
export function notifyActiveAppletPage(pageId: string | null): void {
  const nextPageId = pageId && pageId.startsWith(APPLET_PAGE_PREFIX) ? pageId : null;
  if (foregroundAppletPageId === nextPageId) return;

  const kernel = getDesktopAppletKernel();

  if (foregroundAppletPageId) {
    const leaving = kernel.registry.get(foregroundAppletPageId);
    if (leaving && leaving.state === 'visible') {
      void kernel.dispatch(lifecycleEvent('hide', leaving.appletId, leaving.instanceId));
    }
  }

  if (nextPageId) {
    const entering = kernel.registry.get(nextPageId);
    if (entering && entering.state !== 'visible') {
      void kernel.dispatch(lifecycleEvent('show', entering.appletId, entering.instanceId));
    }
  }

  foregroundAppletPageId = nextPageId;
}

export const appletsRuntime: RuntimeDescriptor = {
  id: 'applets',
  scope: 'app',
  install(): void {
    scheduleReconciliation();
    scheduleKernelSweep();
    scheduleMemoryMonitor();
    scheduleLynxRuntimePrewarm();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleWindowFocus);
      window.addEventListener('blur', handleWindowBlur);
    }
  },
  teardown(): void {
    for (const [pageId, appletId] of activeAppletPageIds) {
      const kernel = getDesktopAppletKernel();
      if (kernel.registry.get(pageId)) {
        void kernel.dispatch(lifecycleEvent('destroy', appletId, pageId));
      } else {
        void useAppletsStore.getState().unloadApplet(appletId);
      }
    }
    activeAppletPageIds.clear();
    foregroundAppletPageId = null;
    stopReconciliation();
    stopKernelSweep();
    stopMemoryMonitor();
    cancelLynxRuntimePrewarm();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('blur', handleWindowBlur);
    }
  },
  async bootstrap(): Promise<void> {
    await refreshAppletProjection('bootstrap');
  },
  async reconcile(reason: string): Promise<void> {
    await refreshAppletProjection(reason);
  },
  async acquirePage(pageId): Promise<void> {
    await acquireAppletPage(pageId);
  },
  async releasePage(pageId): Promise<void> {
    await releaseAppletPage(pageId);
  },
};
