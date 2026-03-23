/**
 * Module Frontend Registry
 *
 * Every feature module registers itself here. The host UI
 * (App.tsx, SettingsPage.tsx) reads from the registry to
 * render sidebar entries, pages, and settings tabs dynamically.
 *
 * Adding a new module = registerModule() in your module file +
 * import it in modules/index.ts. Zero host code changes.
 */
import type React from 'react';
import type { LucideIcon } from 'lucide-react';

export interface SidebarEntry {
  position: 'top' | 'bottom';
  order: number;
  title?: string;
}

export interface SettingsEntry {
  order: number;
  label?: string;
}

export interface ModuleFrontend {
  id: string;
  name: string;
  icon: LucideIcon;

  /** Standalone page component (optional) */
  page?: React.ComponentType<any>;

  /** Settings tab panel component (optional) */
  settingsPanel?: React.ComponentType<any>;

  /** Sidebar icon entry (optional) */
  sidebarEntry?: SidebarEntry;

  /** Settings tab entry — if settingsPanel is set, this controls ordering */
  settingsEntry?: SettingsEntry;
}

const registry = new Map<string, ModuleFrontend>();

export function registerModule(def: ModuleFrontend) {
  registry.set(def.id, def);
}

export function getModule(id: string): ModuleFrontend | undefined {
  return registry.get(id);
}

export function getAllModules(): ModuleFrontend[] {
  return Array.from(registry.values());
}

export function getModulesWithPages(): ModuleFrontend[] {
  return getAllModules().filter((m) => m.page);
}

export function getModulesWithSettings(): ModuleFrontend[] {
  return getAllModules()
    .filter((m) => m.settingsPanel && m.settingsEntry)
    .sort((a, b) => (a.settingsEntry!.order - b.settingsEntry!.order));
}

export function getModulesWithSidebar(): ModuleFrontend[] {
  return getAllModules()
    .filter((m) => m.sidebarEntry)
    .sort((a, b) => (a.sidebarEntry!.order - b.sidebarEntry!.order));
}
