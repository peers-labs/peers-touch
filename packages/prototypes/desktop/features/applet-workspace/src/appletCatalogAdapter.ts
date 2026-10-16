import type { ReactNode } from 'react';

/** Browser projection only. Native directory selection and Store calls are injected. */
export interface CatalogApplet {
  id: string;
  name: string;
  version: string;
  description: string;
  status: 'available' | 'installed' | 'active' | 'disabled' | 'revoked' | 'update-available';
  source: 'station' | 'local-dev' | 'bundled-official';
  compatible: boolean;
  settingsPanel?: () => ReactNode;
}
export interface AppletCatalogProjection {
  installed: readonly CatalogApplet[];
  catalog: readonly CatalogApplet[];
  state: 'ready' | 'loading' | 'error';
  stationUnavailable: boolean;
  error?: string;
  pendingId?: string;
}
export interface AppletCatalogActions {
  refresh?: () => Promise<AppletCatalogProjection>;
  install?: (id: string) => Promise<AppletCatalogProjection>;
  importDirectory?: () => Promise<AppletCatalogProjection>;
}
export interface AppletCatalogAdapter {
  getSnapshot: () => AppletCatalogProjection;
  subscribe: (listener: () => void) => () => void;
  capabilities: { refresh: boolean; install: boolean; importDirectory: boolean };
  refresh: () => Promise<void>;
  install: (id: string) => Promise<void>;
  importDirectory: () => Promise<void>;
}

export function catalogInventory(projection: AppletCatalogProjection): CatalogApplet[] {
  const byId = new Map(projection.catalog.map(item => [item.id, item]));
  for (const item of projection.installed) {
    const policy = byId.get(item.id);
    byId.set(item.id, policy?.status === 'revoked' || policy?.status === 'disabled'
      ? { ...item, status: policy.status, compatible: item.compatible && policy.compatible }
      : item);
  }
  return [...byId.values()];
}

export function canOpenApplet(applet: CatalogApplet): boolean {
  return applet.compatible && applet.status !== 'revoked' && applet.status !== 'disabled';
}

export function createAppletCatalogAdapter(
  initial: AppletCatalogProjection = { installed: [], catalog: [], state: 'ready', stationUnavailable: false },
  actions: AppletCatalogActions = {},
): AppletCatalogAdapter {
  let projection = initial;
  let busy = false;
  const listeners = new Set<() => void>();
  const publish = (next: AppletCatalogProjection) => {
    projection = next;
    for (const listener of listeners) listener();
  };
  const run = async (id: string, action?: () => Promise<AppletCatalogProjection>) => {
    if (!action) throw new Error('This action is unavailable here.');
    if (busy) throw new Error('An applet request is already running.');
    busy = true;
    publish({ ...projection, state: 'loading', error: undefined, pendingId: id });
    try {
      publish({ ...await action(), pendingId: undefined });
    } catch (error) {
      publish({ ...projection, state: 'error', pendingId: undefined,
        error: error instanceof Error ? error.message : 'Unable to complete the applet request.' });
      throw error;
    } finally {
      busy = false;
    }
  };
  return {
    getSnapshot: () => projection,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    capabilities: { refresh: Boolean(actions.refresh), install: Boolean(actions.install), importDirectory: Boolean(actions.importDirectory) },
    refresh: () => run('refresh', actions.refresh),
    importDirectory: () => run('import', actions.importDirectory),
    install: id => {
      const target = catalogInventory(projection).find(item => item.id === id);
      if (!target || !canOpenApplet(target)) return Promise.reject(new Error('This applet cannot be installed.'));
      return run(id, actions.install ? () => actions.install!(id) : undefined);
    },
  };
}
