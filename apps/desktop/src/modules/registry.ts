/**
 * Settings Module Registry
 *
 * Feature modules register Settings sections here. Primary navigation and
 * pages are owned explicitly by AppSideNav and the kernel page registry so a
 * feature import cannot silently change the Desktop information architecture.
 *
 * Adding a Settings module = registerModule() in your module file + import it
 * in modules/index.ts.
 */
import type React from 'react';
import type { LucideIcon } from 'lucide-react';
import type { SectionHostPolicy } from '../kernel/section';

export interface SettingsEntry {
  order: number;
  label?: string;
  sectionHostPolicy?: SectionHostPolicy;
  tooltip?: string;
}

export interface ModuleFrontend {
  id: string;
  name: string;
  icon: LucideIcon;

  /** Settings section panel */
  settingsPanel: React.ComponentType;

  /** Settings section ordering and lifetime policy */
  settingsEntry: SettingsEntry;
}

const registry = new Map<string, ModuleFrontend>();

export function registerModule(def: ModuleFrontend) {
  registry.set(def.id, def);
}

export function getAllModules(): ModuleFrontend[] {
  return Array.from(registry.values());
}

export function getModulesWithSettings(): ModuleFrontend[] {
  return getAllModules()
    .sort((a, b) => a.settingsEntry.order - b.settingsEntry.order);
}
