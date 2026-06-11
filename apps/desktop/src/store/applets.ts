import { create } from 'zustand';
import AppletManager from '../applet/AppletManager';
import type { AppletInfo } from '../applet/types';
import type { AppletDiagnostic } from '../applet/schema';
import { log } from '../utils/logger';

export type RuntimeAppletStatus = 'installed' | 'active';

export interface RuntimeAppletInfo {
  manifest: AppletInfo;
  status: RuntimeAppletStatus;
  lastOpenedAt?: number;
}

interface AppletsState {
  applets: RuntimeAppletInfo[];
  diagnostics: AppletDiagnostic[];
  lastOpenedAtById: Record<string, number>;
  loading: boolean;
  refresh: () => Promise<void>;
  loadApplet: (id: string) => Promise<void>;
  unloadApplet: (id: string) => Promise<void>;
}

function toRuntimeApplets(
  manager: AppletManager,
  manifests: AppletInfo[],
  lastOpenedAtById: Record<string, number>,
): RuntimeAppletInfo[] {
  const loaded = new Set(manager.getLoadedApplets());
  return manifests
    .filter((manifest) => manifest.load.desktop?.type === 'lynx-web')
    .map((manifest) => ({
      manifest,
      status: loaded.has(manifest.id) ? 'active' : 'installed',
      lastOpenedAt: lastOpenedAtById[manifest.id],
    }));
}

export const useAppletsStore = create<AppletsState>((set, get) => ({
  applets: [],
  diagnostics: [],
  lastOpenedAtById: {},
  loading: true,

  refresh: async () => {
    const manager = AppletManager.getInstance();
    set({ loading: true });
    try {
      const manifests = await manager.scanApplets();
      const { lastOpenedAtById } = get();
      set({
        applets: toRuntimeApplets(manager, manifests, lastOpenedAtById),
        diagnostics: manager.getDiagnostics(),
        loading: false,
      });
    } catch (error) {
      log.warn('applets', 'Failed to refresh applet projection', error);
      set({
        applets: [],
        diagnostics: manager.getDiagnostics(),
        loading: false,
      });
    }
  },

  loadApplet: async (id) => {
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
