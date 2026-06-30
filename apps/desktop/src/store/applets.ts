import { create } from 'zustand';
import { convertFileSrc } from '@tauri-apps/api/core';
import AppletManager from '../applet/AppletManager';
import type { AppletInfo } from '../applet/types';
import type { AppletDiagnostic } from '../applet/schema';
import { api, type AppletStoreCatalogItem, type AppletStoreInstallState } from '../services/desktop_api';
import { readDesktopPreferenceSync, writeDesktopPreferenceSync } from '../storage/desktopClientStorage';
import { log } from '../utils/logger';

export type RuntimeAppletStatus = 'available' | 'installed' | 'active' | 'revoked' | 'disabled' | 'update-available';
export type RuntimeAppletSource = 'station' | 'local-dev' | 'bundled-official';

const DEFAULT_INSTALLED_APPLET_IDS = ['peers.note'];
const LOCAL_DEV_INSTALLED_APPLETS_KEY = 'pt.applets.localDevInstalledIds';

export interface RuntimeAppletInfo {
  manifest: AppletInfo;
  status: RuntimeAppletStatus;
  source: RuntimeAppletSource;
  stationUnavailable?: boolean;
  stationBundleUrl?: string;
  stationBundleSha256?: string;
  stationAssets?: Array<{ path: string; sha256: string }>;
  statusReason?: string;
  lastOpenedAt?: number;
}

interface AppletsState {
  applets: RuntimeAppletInfo[];
  catalogApplets: RuntimeAppletInfo[];
  localDevInstalledAppletIds: string[];
  stationUnavailable: boolean;
  stationError?: string;
  diagnostics: AppletDiagnostic[];
  lastOpenedAtById: Record<string, number>;
  loading: boolean;
  refresh: () => Promise<void>;
  importAppletDirectory: () => Promise<void>;
  installApplet: (id: string) => Promise<void>;
  loadApplet: (id: string) => Promise<void>;
  unloadApplet: (id: string) => Promise<void>;
}

function readLocalDevInstalledAppletIds(): string[] {
  const stored = readDesktopPreferenceSync<string[]>(LOCAL_DEV_INSTALLED_APPLETS_KEY);
  const ids = Array.isArray(stored) ? stored.filter((id) => typeof id === 'string' && id.length > 0) : [];
  return Array.from(new Set(ids));
}

function persistLocalDevInstalledAppletIds(ids: string[]): string[] {
  const next = Array.from(new Set(ids.filter((id) => !DEFAULT_INSTALLED_APPLET_IDS.includes(id))));
  writeDesktopPreferenceSync(LOCAL_DEV_INSTALLED_APPLETS_KEY, next);
  return next;
}

function isDesktopApplet(manifest: AppletInfo): boolean {
  if (manifest.load.desktop?.type !== 'lynx-web') return false;
  return true;
}

function isBundledOfficialApplet(manifest: AppletInfo): boolean {
  return DEFAULT_INSTALLED_APPLET_IDS.includes(manifest.id) || manifest.path.startsWith('/applets-dist/');
}

function isUserVisibleLocalApplet(manifest: AppletInfo): boolean {
  if (!isDesktopApplet(manifest)) return false;
  if (DEFAULT_INSTALLED_APPLET_IDS.includes(manifest.id)) return true;
  return !manifest.path.startsWith('/applets-dist/');
}

function normalizeInstallStatus(state?: AppletStoreInstallState): RuntimeAppletStatus | undefined {
  const raw = state?.status;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0;
  if (value === 1) return 'installed';
  if (value === 3) return 'disabled';
  if (value === 4) return 'revoked';
  if (value === 5) return 'update-available';
  return undefined;
}

function stationText(left?: string, right?: string): string {
  return left || right || '';
}

function stationAppletId(item: AppletStoreCatalogItem): string {
  return stationText(item.info?.id, item.version?.appletId ?? item.version?.applet_id);
}

function manifestJson(item: AppletStoreCatalogItem): string {
  return stationText(item.version?.manifest?.manifestJson, item.version?.manifest?.manifest_json);
}

function parseStationManifest(item: AppletStoreCatalogItem): Partial<AppletInfo> | undefined {
  const raw = manifestJson(item);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Partial<AppletInfo>;
  } catch {
    return undefined;
  }
}

function stationManifest(item: AppletStoreCatalogItem, localManifest?: AppletInfo): AppletInfo {
  if (localManifest) return localManifest;
  const id = stationAppletId(item);
  const name = stationText(item.info?.name, id);
  const stationSnapshot = parseStationManifest(item);
  return {
    ...(stationSnapshot as Record<string, unknown>),
    id,
    name: stationText(stationSnapshot?.name, name),
    version: stationText(stationSnapshot?.version, item.version?.version),
    description: stationText(stationSnapshot?.description, item.info?.description),
    author: stationText(stationSnapshot?.author, stationText(item.info?.developerId, item.info?.developer_id)),
    icon: stationText(stationSnapshot?.icon, stationText(item.info?.iconUrl, item.info?.icon_url)),
    permissions: stationSnapshot?.permissions ?? [],
    targetPlatforms: ['desktop'],
    load: stationSnapshot?.load ?? {
      desktop: { type: 'lynx-web', entry: '' },
    },
    bridge: stationSnapshot?.bridge ?? {
      protocol: 'peers-touch.applet.bridge',
      version: '1.0.0',
    },
    integrity: stationSnapshot?.integrity,
    services: stationSnapshot?.services,
    skills: stationSnapshot?.skills,
    minPlatformVersion: stationSnapshot?.minPlatformVersion,
    path: '',
  };
}

function stationBundleUrl(item: AppletStoreCatalogItem): string {
  return stationText(item.version?.bundleUrl, item.version?.bundle_url);
}

function stationBundleSha256(item: AppletStoreCatalogItem): string {
  return stationText(
    item.version?.bundleHash,
    item.version?.bundle_hash ?? item.version?.bundle?.bundleSha256 ?? item.version?.bundle?.bundle_sha256,
  );
}

function stationAssets(item: AppletStoreCatalogItem): Array<{ path: string; sha256: string }> {
  return (item.version?.bundle?.assets ?? [])
    .filter((asset) => typeof asset.path === 'string' && asset.path.length > 0)
    .map((asset) => ({ path: asset.path, sha256: asset.sha256 }));
}

function toRuntimeLocalApplets(
  manager: AppletManager,
  manifests: AppletInfo[],
  lastOpenedAtById: Record<string, number>,
  localDevInstalledAppletIds: string[],
): RuntimeAppletInfo[] {
  const loaded = new Set(manager.getLoadedApplets());
  const localInstalled = new Set(localDevInstalledAppletIds);
  return manifests
    .filter(isUserVisibleLocalApplet)
    .map((manifest) => ({
      manifest,
      source: isBundledOfficialApplet(manifest) ? 'bundled-official' : 'local-dev',
      status: loaded.has(manifest.id)
        ? 'active'
        : isBundledOfficialApplet(manifest) || localInstalled.has(manifest.id) ? 'installed' : 'available',
      lastOpenedAt: lastOpenedAtById[manifest.id],
    }));
}

function toRuntimeStationApplets(
  catalogItems: AppletStoreCatalogItem[],
  installedStates: AppletStoreInstallState[],
  localById: Map<string, AppletInfo>,
  lastOpenedAtById: Record<string, number>,
  loadedAppletIds: Set<string>,
): RuntimeAppletInfo[] {
  const installedById = new Map<string, AppletStoreInstallState>();
  for (const state of installedStates) {
    const id = stationText(state.appletId, state.applet_id);
    if (id) installedById.set(id, state);
  }
  return catalogItems
    .map((item): RuntimeAppletInfo | null => {
      const id = stationAppletId(item);
      if (!id) return null;
      const installState = item.installState ?? item.install_state ?? installedById.get(id);
      const manifest = stationManifest(item, localById.get(id));
      const installedStatus = normalizeInstallStatus(installState) ?? 'available';
      const status = loadedAppletIds.has(id) && installedStatus === 'installed' ? 'active' : installedStatus;
      return {
        manifest,
        source: 'station' as const,
        status,
        stationBundleUrl: stationBundleUrl(item),
        stationBundleSha256: stationBundleSha256(item),
        stationAssets: stationAssets(item),
        statusReason: stationText(installState?.statusReason, installState?.status_reason),
        lastOpenedAt: lastOpenedAtById[id],
      };
    })
    .filter((item): item is RuntimeAppletInfo => item != null);
}

function mergeRuntimeApplets(stationApplets: RuntimeAppletInfo[], localApplets: RuntimeAppletInfo[]): RuntimeAppletInfo[] {
  const byId = new Map<string, RuntimeAppletInfo>();
  for (const item of stationApplets) {
    byId.set(item.manifest.id, item);
  }
  for (const item of localApplets) {
    if (!byId.has(item.manifest.id)) {
      byId.set(item.manifest.id, item);
      continue;
    }
    const stationItem = byId.get(item.manifest.id);
    if (stationItem && stationItem.manifest.path.length === 0) {
      byId.set(item.manifest.id, { ...stationItem, manifest: item.manifest });
    }
  }
  return Array.from(byId.values());
}

export const useAppletsStore = create<AppletsState>((set, get) => ({
  applets: [],
  catalogApplets: [],
  localDevInstalledAppletIds: readLocalDevInstalledAppletIds(),
  stationUnavailable: false,
  diagnostics: [],
  lastOpenedAtById: {},
  loading: true,

  refresh: async () => {
    const manager = AppletManager.getInstance();
    set({ loading: true });
    try {
      const manifests = await manager.scanApplets();
      const loadedAppletIds = new Set(manager.getLoadedApplets());
      const { lastOpenedAtById, localDevInstalledAppletIds } = get();
      const localApplets = toRuntimeLocalApplets(manager, manifests, lastOpenedAtById, localDevInstalledAppletIds);
      const localById = new Map(manifests.filter(isDesktopApplet).map((manifest) => [manifest.id, manifest]));
      let stationApplets: RuntimeAppletInfo[] = [];
      let stationUnavailable = false;
      let stationError: string | undefined;
      try {
        const [catalog, installed] = await Promise.all([
          api.appletStoreListCatalog(),
          api.appletStoreListInstalled(),
        ]);
        stationUnavailable = Boolean(catalog.stationUnavailable || installed.stationUnavailable);
        stationError = catalog.stationError || installed.stationError;
        stationApplets = toRuntimeStationApplets(catalog.items ?? [], installed.states ?? [], localById, lastOpenedAtById, loadedAppletIds);
      } catch (error) {
        stationUnavailable = true;
        stationError = error instanceof Error ? error.message : undefined;
        log.warn('applets', 'Station applet store projection unavailable', error);
      }
      const runtimeApplets = mergeRuntimeApplets(stationApplets, localApplets);
      set({
        applets: runtimeApplets.filter((info) => info.status !== 'available' && info.status !== 'revoked'),
        catalogApplets: runtimeApplets.filter((info) => info.status === 'available' || info.status === 'revoked'),
        diagnostics: manager.getDiagnostics(),
        stationUnavailable,
        stationError,
        loading: false,
      });
    } catch (error) {
      log.warn('applets', 'Failed to refresh applet projection', error);
      set({
        applets: [],
        catalogApplets: [],
        diagnostics: manager.getDiagnostics(),
        stationUnavailable: true,
        stationError: error instanceof Error ? error.message : undefined,
        loading: false,
      });
    }
  },

  importAppletDirectory: async () => {
    await AppletManager.getInstance().importAppletDirectory();
    await get().refresh();
  },

  installApplet: async (id) => {
    const target = [...get().applets, ...get().catalogApplets].find((info) => info.manifest.id === id);
    if (target?.source === 'local-dev') {
      const localDevInstalledAppletIds = persistLocalDevInstalledAppletIds([...get().localDevInstalledAppletIds, id]);
      set({ localDevInstalledAppletIds });
      await get().refresh();
      return;
    }
    await api.appletStoreInstall(id);
    await get().refresh();
  },

  loadApplet: async (id) => {
    const target = [...get().applets, ...get().catalogApplets].find((info) => info.manifest.id === id);
    if (target?.status === 'revoked') {
      throw new Error('error.applet.revoked');
    }
    if (!target || target.status === 'available') {
      await get().installApplet(id);
    }
    const refreshedTarget = [...get().applets, ...get().catalogApplets].find((info) => info.manifest.id === id) ?? target;
    if (refreshedTarget?.source === 'station' && !refreshedTarget.manifest.path) {
      const entry = refreshedTarget.manifest.load.desktop?.entry;
      if (!entry || !refreshedTarget.stationBundleUrl) {
        throw new Error('error.applet.stationBundleUnavailable');
      }
      const materialized = await api.appletStoreMaterializeBundle({
        appletId: id,
        version: refreshedTarget.manifest.version,
        bundleUrl: refreshedTarget.stationBundleUrl,
        bundleSha256: refreshedTarget.stationBundleSha256,
        entry,
        assets: refreshedTarget.stationAssets,
      });
      const materializedManifest = {
        ...refreshedTarget.manifest,
        path: convertFileSrc(materialized.directory),
      };
      AppletManager.getInstance().registerApplet(materializedManifest);
      set((state) => ({
        applets: state.applets.map((item) => (
          item.manifest.id === id ? { ...item, manifest: materializedManifest } : item
        )),
        catalogApplets: state.catalogApplets.map((item) => (
          item.manifest.id === id ? { ...item, manifest: materializedManifest } : item
        )),
      }));
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
