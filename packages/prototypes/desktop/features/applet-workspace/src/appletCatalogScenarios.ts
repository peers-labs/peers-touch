import note from '../../../../../../apps/applets/note/applet.manifest.json';
import atelier from '../../../../../../apps/applets/atelier/applet.manifest.json';
import webSearch from '../../../../../applets/web-search/applet.json';
import {
  createAppletCatalogAdapter,
  type AppletCatalogProjection,
  type CatalogApplet,
} from './appletCatalogAdapter';

/** Explicit browser harnesses; identity metadata comes from package manifests. */
export function appletCatalogScenario(state: string) {
  if (!state.startsWith('applets-')) return createAppletCatalogAdapter();
  const row = (manifest: typeof note | typeof atelier | typeof webSearch, status: CatalogApplet['status']): CatalogApplet => ({
    id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description,
    status, source: status === 'available' || status === 'revoked' ? 'station' : 'bundled-official',
    compatible: 'desktop' in manifest.load,
  });
  const noteRow = row(note, 'installed');
  const atelierRow = row(atelier, 'installed');
  let projection: AppletCatalogProjection = {
    installed: [noteRow, atelierRow], catalog: [], state: 'ready', stationUnavailable: false,
  };
  if (state === 'applets-empty') projection.installed = [];
  if (state === 'applets-loading') projection = { ...projection, installed: [], state: 'loading' };
  if (state === 'applets-catalog' || state === 'applets-install-error') {
    projection = { ...projection, installed: [atelierRow], catalog: [row(note, 'available'), row(webSearch, 'available')] };
  }
  if (state === 'applets-offline') projection.stationUnavailable = true;
  if (state === 'applets-revoked') {
    projection = { ...projection, installed: [atelierRow], catalog: [row(note, 'revoked')] };
  }
  let failNext = state === 'applets-install-error';
  const delay = () => new Promise(resolve => window.setTimeout(resolve, 120));
  return createAppletCatalogAdapter(projection, {
    refresh: async () => { await delay(); return { ...projection, state: 'ready', error: undefined }; },
    install: async id => {
      await delay();
      if (failNext) { failNext = false; throw new Error('Installation failed. Try again.'); }
      const target = projection.catalog.find(item => item.id === id);
      if (!target?.compatible || target.status === 'revoked') throw new Error('This applet cannot be installed.');
      projection = {
        ...projection, state: 'ready', error: undefined,
        installed: [...projection.installed, { ...target, status: 'installed' }],
        catalog: projection.catalog.filter(item => item.id !== id),
      };
      return projection;
    },
  });
}
