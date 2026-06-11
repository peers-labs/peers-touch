import type { RuntimeDescriptor } from '../kernel/runtime';
import { useAppletsStore } from '../store/applets';

const APPLET_CATALOG_RECONCILE_MS = 60_000;

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let reconciliationInFlight = false;

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

export const appletsRuntime: RuntimeDescriptor = {
  id: 'applets',
  scope: 'app',
  install(): void {
    scheduleReconciliation();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleWindowFocus);
    }
  },
  teardown(): void {
    stopReconciliation();
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
};
