import type { RuntimeDescriptor } from '../kernel/runtime';
import {
  loadXConfigProjection,
  refreshXConfigProjection,
} from '../services/xConfig';
import { log } from '../utils/logger';

let installed = false;

function refreshOnForeground(): void {
  if (document.visibilityState !== 'visible') return;
  void refreshXConfigProjection(false).catch((error) => {
    log.warn('xConfigRuntime', 'foreground refresh failed', { error });
  });
}

export const xConfigRuntime: RuntimeDescriptor = {
  id: 'x-config',
  scope: 'app',

  install(): void {
    if (installed) return;
    installed = true;
    document.addEventListener('visibilitychange', refreshOnForeground);
    window.addEventListener('focus', refreshOnForeground);
  },

  teardown(): void {
    if (!installed) return;
    installed = false;
    document.removeEventListener('visibilitychange', refreshOnForeground);
    window.removeEventListener('focus', refreshOnForeground);
  },

  async bootstrap(): Promise<void> {
    await loadXConfigProjection();
    void refreshXConfigProjection(false).catch((error) => {
      log.warn('xConfigRuntime', 'startup refresh failed', { error });
    });
  },

  async reconcile(): Promise<void> {
    await refreshXConfigProjection(false);
  },
};
