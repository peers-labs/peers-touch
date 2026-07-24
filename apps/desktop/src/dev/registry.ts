import type { ComponentType } from 'react';
import type { DevSlot } from './slots';

export interface DevOverlayPlugin {
  id: string;
  slot: DevSlot;
  order?: number;
  component: ComponentType;
}

const plugins: DevOverlayPlugin[] = [];

export function registerDevPlugin(plugin: DevOverlayPlugin): void {
  plugins.push(plugin);
  plugins.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getPluginsForSlot(slot: DevSlot): DevOverlayPlugin[] {
  return plugins.filter((p) => p.slot === slot);
}
