import { create } from 'zustand';
import AppletManager from '../applet/AppletManager';
import type { AppletInfo } from '../applet/types';
import type { AppletDiagnostic } from '../applet/schema';
import { readDesktopPreferenceSync, writeDesktopPreferenceSync } from '../storage/desktopClientStorage';
import { log } from '../utils/logger';

export type RuntimeAppletStatus = 'available' | 'installed' | 'active';

const DEFAULT_INSTALLED_APPLET_IDS = ['peers.note'];
const INSTALLED_APPLETS_KEY = 'pt.applets.installedIds';

export interface RuntimeAppletInfo {
  manifest: AppletInfo;
  status: RuntimeAppletStatus;
  lastOpenedAt?: number;
}

interface AppletsState {
  applets: RuntimeAppletInfo[];
  catalogApplets: RuntimeAppletInfo[];
  installedAppletIds: string[];
  diagnostics: AppletDiagnostic[];
  lastOpenedAtById: Record<string, number>;
  loading: boolean;
  refresh: () => Promise<void>;
  importAppletDirectory: () => Promise<void>;
  installApplet: (id: string) => Promise<void>;
  loadApplet: (id: string) => Promise<void>;
  unloadApplet: (id: string) => Promise<void>;
}

function readInstalledAppletIds(): string[] {
  const stored = readDesktopPreferenceSync<string[]>(INSTALLED_APPLETS_KEY);
  const ids = Array.isArray(stored) ? stored.filter((id) => typeof id === 'string' && id.length > 0) : [];
  return Array.from(new Set([...DEFAULT_INSTALLED_APPLET_IDS, ...ids]));
}

function persistInstalledAppletIds(ids: string[]): string[] {
  const next = Array.from(new Set([...DEFAULT_INSTALLED_APPLET_IDS, ...ids]));
  writeDesktopPreferenceSync(INSTALLED_APPLETS_KEY, next);
  return next;
}

function isUserVisibleCatalogApplet(manifest: AppletInfo): boolean {
  if (manifest.load.desktop?.type !== 'lynx-web') return false;
  if (DEFAULT_INSTALLED_APPLET_IDS.includes(manifest.id)) return true;
  return !manifest.path.startsWith('/applets-dist/');
}

function toRuntimeApplets(
  manager: AppletManager,
  manifests: AppletInfo[],
  lastOpenedAtById: Record<string, number>,
  installedAppletIds: string[],
): RuntimeAppletInfo[] {
  const loaded = new Set(manager.getLoadedApplets());
  const installed = new Set(installedAppletIds);
  return manifests
    .filter(isUserVisibleCatalogApplet)
    .map((manifest) => ({
      manifest,
      status: loaded.has(manifest.id) ? 'active' : installed.has(manifest.id) ? 'installed' : 'available',
      lastOpenedAt: lastOpenedAtById[manifest.id],
    }));
}

export const useAppletsStore = create<AppletsState>((set, get) => ({
  applets: [],
  catalogApplets: [],
  installedAppletIds: readInstalledAppletIds(),
  diagnostics: [],
  lastOpenedAtById: {},
  loading: true,

  refresh: async () => {
    const manager = AppletManager.getInstance();
    set({ loading: true });
    try {
      const manifests = await manager.scanApplets();
      const { lastOpenedAtById, installedAppletIds } = get();
      const runtimeApplets = toRuntimeApplets(manager, manifests, lastOpenedAtById, installedAppletIds);
      set({
        applets: runtimeApplets.filter((info) => info.status !== 'available'),
        catalogApplets: runtimeApplets.filter((info) => info.status === 'available'),
        diagnostics: manager.getDiagnostics(),
        loading: false,
      });
    } catch (error) {
      log.warn('applets', 'Failed to refresh applet projection', error);
      set({
        applets: [],
        catalogApplets: [],
        diagnostics: manager.getDiagnostics(),
        loading: false,
      });
    }
  },

  importAppletDirectory: async () => {
    await AppletManager.getInstance().importAppletDirectory();
    await get().refresh();
  },

  installApplet: async (id) => {
    const installedAppletIds = persistInstalledAppletIds([...get().installedAppletIds, id]);
    set({ installedAppletIds });
    await get().refresh();
  },

  loadApplet: async (id) => {
    if (!get().installedAppletIds.includes(id)) {
      await get().installApplet(id);
    }
    await AppletManager.getInstance().loadApplet(id);
    set((state) => ({
      lastOpenedAtById: {
        ...state.lastOpenedAtById,
        [id]: Date.now(),
      },
    }));
    await get().refresh();
  },

  unloadApplet: async (id) => {
    await AppletManager.getInstance().unloadApplet(id);
    await get().refresh();
  },
}));
