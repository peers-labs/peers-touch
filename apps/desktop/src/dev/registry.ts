import type { ComponentType } from 'react';
import type { DevSlot } from './slots';

export interface DevOverlayPlugin {
  id: string;
  slot: DevSlot;
  order?: number;
  component: ComponentType;
}

const plugins = new Map<string, DevOverlayPlugin>();

export function registerDevPlugin(plugin: DevOverlayPlugin): void {
  // A plugin module can run again during HMR while this registry survives.
  // Replace its definition, including slot and component, rather than mount
  // another copy under the same React key.
  plugins.set(plugin.id, plugin);
}

export function getPluginsForSlot(slot: DevSlot): DevOverlayPlugin[] {
  return [...plugins.values()]
    .filter((p) => p.slot === slot)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
