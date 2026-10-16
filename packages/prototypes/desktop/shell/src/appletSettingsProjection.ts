import { catalogInventory, type AppletCatalogAdapter, type AppletCatalogProjection } from '../../features/applet-workspace/src/appletCatalogAdapter';
import type { AdvancedSettingsAdapter, AdvancedSettingsProjection } from './advancedSettingsAdapter';

/** Settings reads the launcher owner, retaining its own unrelated command boundary. */
export function bindAppletSettings(base: AdvancedSettingsAdapter, catalog: AppletCatalogAdapter): AdvancedSettingsAdapter {
  let previousBase: AdvancedSettingsProjection | undefined;
  let previousCatalog: AppletCatalogProjection | undefined;
  let snapshot: AdvancedSettingsProjection;
  return {
    getSnapshot: () => {
      const source = base.getSnapshot();
      const inventory = catalog.getSnapshot();
      if (source !== previousBase || inventory !== previousCatalog) {
        previousBase = source;
        previousCatalog = inventory;
        snapshot = {
          ...source,
          states: { ...source.states, applets: inventory.state },
          applets: catalogInventory(inventory).filter(item => item.status !== 'available' && item.status !== 'revoked')
            .map(item => ({ id: item.id, name: item.name, version: item.version, status: item.status, settingsPanel: item.settingsPanel })),
        };
      }
      return snapshot;
    },
    subscribe: listener => {
      const offBase = base.subscribe(listener);
      const offCatalog = catalog.subscribe(listener);
      return () => { offBase(); offCatalog(); };
    },
    execute: async command => {
      if (command.kind === 'refresh' && command.section === 'applets') {
        await catalog.refresh();
        return { message: 'Applet catalog refreshed.' };
      }
      return base.execute(command);
    },
  };
}
