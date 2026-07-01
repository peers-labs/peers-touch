import type { RuntimeDescriptor } from '../kernel/runtime';
import { ensureLynxWebRuntime } from '../applet/lynx-web-runtime';
import { useAppletsStore } from '../store/applets';

const APPLET_CATALOG_RECONCILE_MS = 60_000;
const APPLET_PAGE_PREFIX = 'applet:';

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let reconciliationInFlight = false;
let lynxRuntimePrewarmCancel: (() => void) | null = null;
const activeAppletPageIds = new Map<string, string>();

function appletIdFromPageId(pageId: string): string | undefined {
  if (!pageId.startsWith(APPLET_PAGE_PREFIX) || pageId.length <= APPLET_PAGE_PREFIX.length) return undefined;
  return pageId.slice(APPLET_PAGE_PREFIX.length);
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

function handleVisibilityChange(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    void refreshAppletProjection('visibility');
  }
}

function handleWindowFocus(): void {
  void refreshAppletProjection('focus');
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

async function acquireAppletPage(pageId: string): Promise<void> {
  const appletId = appletIdFromPageId(pageId);
  if (!appletId) return;
  if (activeAppletPageIds.get(pageId) === appletId) return;

  activeAppletPageIds.set(pageId, appletId);
  try {
    await useAppletsStore.getState().loadApplet(appletId);
    if (activeAppletPageIds.get(pageId) !== appletId) {
      await useAppletsStore.getState().unloadApplet(appletId);
    }
  } catch (error) {
    activeAppletPageIds.delete(pageId);
    throw error;
  }
}

async function releaseAppletPage(pageId: string): Promise<void> {
  const appletId = activeAppletPageIds.get(pageId) ?? appletIdFromPageId(pageId);
  if (!appletId) return;
  activeAppletPageIds.delete(pageId);
  await useAppletsStore.getState().unloadApplet(appletId);
}

export const appletsRuntime: RuntimeDescriptor = {
  id: 'applets',
  scope: 'app',
  install(): void {
    scheduleReconciliation();
    scheduleLynxRuntimePrewarm();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleWindowFocus);
    }
  },
  teardown(): void {
    for (const appletId of new Set(activeAppletPageIds.values())) {
      void useAppletsStore.getState().unloadApplet(appletId);
    }
    activeAppletPageIds.clear();
    stopReconciliation();
    cancelLynxRuntimePrewarm();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', handleWindowFocus);
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
