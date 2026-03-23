/**
 * Applet Frontend Registry
 *
 * Each applet can register its own frontend extensions:
 * - Settings panel (injected into Settings → Applets tab)
 * - Dedicated page (mounted as a routable page)
 * - Sidebar entry (icon + label for SideNav when pinned)
 *
 * Applets self-register by importing this registry and calling `registerApplet()`.
 * The host UI reads from the registry — zero hardcoded applet references.
 */
import type React from 'react';
import type { LucideIcon } from 'lucide-react';

export interface AppletFrontend {
  id: string;

  /** Settings panel component, rendered inside Settings → Applets → [this applet] */
  settingsPanel?: React.FC;

  /** Dedicated page component for the applet */
  page?: React.FC<AppletPageProps>;

  /** Sidebar icon for pinning */
  sidebarIcon?: LucideIcon;
}

export interface AppletPageProps {
  onBack: () => void;
  onPin?: () => void;
  pinned?: boolean;
}

const registry = new Map<string, AppletFrontend>();

export function registerApplet(def: AppletFrontend) {
  registry.set(def.id, def);
}

export function getAppletFrontend(id: string): AppletFrontend | undefined {
  return registry.get(id);
}

export function getAllAppletFrontends(): AppletFrontend[] {
  return Array.from(registry.values());
}

export function hasSettingsPanel(id: string): boolean {
  return !!registry.get(id)?.settingsPanel;
}

export function hasPage(id: string): boolean {
  return !!registry.get(id)?.page;
}
