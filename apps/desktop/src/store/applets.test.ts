import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLET_BRIDGE_PROTOCOL, type AppletInfo } from '../applet/types';

const manager = vi.hoisted(() => ({
  scanApplets: vi.fn<() => Promise<AppletInfo[]>>(),
  getLoadedApplets: vi.fn<() => string[]>(),
  getDiagnostics: vi.fn<() => []>(),
  loadApplet: vi.fn<(id: string) => Promise<AppletInfo>>(),
  unloadApplet: vi.fn<(id: string) => Promise<void>>(),
}));

const desktopApi = vi.hoisted(() => ({
  appletStoreInstall: vi.fn<() => Promise<unknown>>(),
  appletStoreListCatalog: vi.fn<() => Promise<{ items: unknown[]; stationUnavailable?: boolean; stationError?: string }>>(),
  appletStoreListInstalled: vi.fn<() => Promise<{ states: unknown[]; stationUnavailable?: boolean; stationError?: string }>>(),
}));

vi.mock('../applet/AppletManager', () => ({
  default: {
    getInstance: () => manager,
  },
}));

vi.mock('../services/desktop_api', () => ({
  api: desktopApi,
}));

const manifest: AppletInfo = {
  id: 'product-shell-applet',
  name: 'Product Shell Applet',
  version: '1.0.0',
  description: 'Runtime projection fixture',
  author: 'Peers Touch',
  permissions: ['app.getContext', 'network.request', 'tasks.start'],
  targetPlatforms: ['desktop'],
  targets: ['desktop'],
  entries: { lynx: 'main.lynx.bundle' },
  load: {
    desktop: {
      type: 'lynx-web',
      entry: 'main.lynx.bundle',
    },
  },
  bridge: {
    protocol: APPLET_BRIDGE_PROTOCOL,
    version: '1.0.0',
  },
  services: [],
  skills: [],
  integrity: {
    algorithm: 'sha256',
    files: {},
  },
  path: '/tmp/peers-touch-test/product-shell-applet',
};

const atelierManifest: AppletInfo = {
  ...manifest,
  id: 'peers.atelier',
  name: 'Atelier',
  description: 'Personal Agent workbench',
  path: '/applets-dist/peers.atelier',
};

describe('applets runtime store', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    manager.scanApplets.mockResolvedValue([manifest]);
    manager.getLoadedApplets.mockReturnValue([]);
    manager.getDiagnostics.mockReturnValue([]);
    manager.loadApplet.mockResolvedValue(manifest);
    manager.unloadApplet.mockResolvedValue();
    desktopApi.appletStoreInstall.mockResolvedValue({});
    desktopApi.appletStoreListCatalog.mockResolvedValue({ items: [] });
    desktopApi.appletStoreListInstalled.mockResolvedValue({ states: [] });

    const { useAppletsStore } = await import('./applets');
    useAppletsStore.setState({
      applets: [{ manifest, status: 'installed', source: 'bundled-official' }],
      catalogApplets: [],
      diagnostics: [],
      lastOpenedAtById: {},
      loading: true,
    });
  });

  it('projects session-opened applet state into the list', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(12345);
    manager.getLoadedApplets.mockReturnValue(['product-shell-applet']);
    const { useAppletsStore } = await import('./applets');

    await useAppletsStore.getState().loadApplet('product-shell-applet');

    expect(manager.loadApplet).toHaveBeenCalledWith('product-shell-applet');
    expect(nowSpy).toHaveBeenCalled();
    expect(useAppletsStore.getState().applets).toEqual([
      expect.objectContaining({
        manifest,
        status: 'active',
        lastOpenedAt: 12345,
      }),
    ]);
  });

  it('keeps installed local runtime applets out of Station install flow when catalog ids overlap', async () => {
    desktopApi.appletStoreListCatalog.mockResolvedValue({
      items: [{
        info: {
          id: manifest.id,
          name: manifest.name,
        },
        version: {
          appletId: manifest.id,
          version: manifest.version,
          manifestJson: JSON.stringify({ ...manifest, path: '' }),
        },
        installState: {
          appletId: manifest.id,
          status: 0,
        },
      }],
    });
    const { useAppletsStore } = await import('./applets');
    useAppletsStore.setState({
      applets: [],
      catalogApplets: [],
      localDevInstalledAppletIds: [manifest.id],
      loading: true,
    });

    await useAppletsStore.getState().loadApplet(manifest.id);

    expect(desktopApi.appletStoreInstall).not.toHaveBeenCalled();
    expect(manager.loadApplet).toHaveBeenCalledWith(manifest.id);
    expect(useAppletsStore.getState().applets).toEqual([
      expect.objectContaining({
        manifest,
        source: 'local-dev',
        status: 'active',
      }),
    ]);
  });

  it('shows bundled Atelier as an installed official applet', async () => {
    manager.scanApplets.mockResolvedValue([atelierManifest]);
    const { useAppletsStore } = await import('./applets');
    useAppletsStore.setState({
      applets: [],
      catalogApplets: [],
      localDevInstalledAppletIds: [],
      loading: true,
    });

    await useAppletsStore.getState().refresh();

    expect(useAppletsStore.getState().applets).toEqual([
      expect.objectContaining({
        manifest: atelierManifest,
        source: 'bundled-official',
        status: 'installed',
      }),
    ]);
    expect(useAppletsStore.getState().catalogApplets).toEqual([]);
  });
});
