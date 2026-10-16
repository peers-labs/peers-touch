import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLET_BRIDGE_PROTOCOL, type AppletInfo } from '../applet/types';

const manager = vi.hoisted(() => ({
  scanApplets: vi.fn<() => Promise<AppletInfo[]>>(),
  getLoadedApplets: vi.fn<() => string[]>(),
  getDiagnostics: vi.fn<() => []>(),
  assertSupportedApplet: vi.fn<(manifest: AppletInfo) => void>(),
  loadApplet: vi.fn<(id: string) => Promise<AppletInfo>>(),
  unloadApplet: vi.fn<(id: string) => Promise<void>>(),
}));

const desktopApi = vi.hoisted(() => ({
  appletStoreInstall: vi.fn<() => Promise<unknown>>(),
  appletStoreUninstall: vi.fn<() => Promise<unknown>>(),
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
    vi.clearAllMocks();
    manager.scanApplets.mockResolvedValue([manifest]);
    manager.getLoadedApplets.mockReturnValue([]);
    manager.getDiagnostics.mockReturnValue([]);
    manager.loadApplet.mockResolvedValue(manifest);
    manager.unloadApplet.mockResolvedValue();
    desktopApi.appletStoreInstall.mockResolvedValue({});
    desktopApi.appletStoreUninstall.mockResolvedValue({});
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

  it('uninstalls Station applets through the canonical store command', async () => {
    const { useAppletsStore } = await import('./applets');
    useAppletsStore.setState({
      applets: [{ manifest, status: 'installed', source: 'station' }],
      catalogApplets: [],
      localDevInstalledAppletIds: [],
      loading: false,
    });

    await useAppletsStore.getState().removeAppletInstallation(manifest.id);

    expect(desktopApi.appletStoreUninstall).toHaveBeenCalledWith(manifest.id);
  });

  it('refuses to uninstall bundled official applets', async () => {
    const { useAppletsStore } = await import('./applets');
    useAppletsStore.setState({
      applets: [{ manifest: atelierManifest, status: 'installed', source: 'bundled-official' }],
      catalogApplets: [],
      localDevInstalledAppletIds: [],
      loading: false,
    });

    await expect(
      useAppletsStore.getState().removeAppletInstallation(atelierManifest.id),
    ).rejects.toThrow('error.applet.bundledCannotUninstall');
    expect(desktopApi.appletStoreUninstall).not.toHaveBeenCalled();
  });

  it.each([
    [3, 'disabled'],
    [4, 'revoked'],
  ] as const)('preserves Station policy %s across an installed local identity', async (status, label) => {
    desktopApi.appletStoreListCatalog.mockResolvedValue({
      items: [{ info: { id: manifest.id }, installState: { appletId: manifest.id, status } }],
    });
    const { useAppletsStore } = await import('./applets');
    useAppletsStore.setState({ localDevInstalledAppletIds: [manifest.id] });
    await useAppletsStore.getState().refresh();
    const inventory = [...useAppletsStore.getState().applets, ...useAppletsStore.getState().catalogApplets];
    expect(inventory.find(item => item.manifest.id === manifest.id)?.status).toBe(label);
    await expect(useAppletsStore.getState().installApplet(manifest.id)).rejects.toThrow(`error.applet.${label}`);
    await expect(useAppletsStore.getState().loadApplet(manifest.id)).rejects.toThrow(`error.applet.${label}`);
    expect(desktopApi.appletStoreInstall).not.toHaveBeenCalled();
    expect(manager.loadApplet).not.toHaveBeenCalled();

    desktopApi.appletStoreListCatalog.mockRejectedValueOnce(new Error('Station unavailable'));
    await useAppletsStore.getState().refresh();
    expect(useAppletsStore.getState().stationUnavailable).toBe(true);
    const offlineInventory = [...useAppletsStore.getState().applets, ...useAppletsStore.getState().catalogApplets];
    expect(offlineInventory.find(item => item.manifest.id === manifest.id)?.status).toBe(label);
    await expect(useAppletsStore.getState().loadApplet(manifest.id)).rejects.toThrow(`error.applet.${label}`);
  });

  it('honors revoked package metadata even without an installation policy', async () => {
    manager.scanApplets.mockResolvedValue([atelierManifest]);
    desktopApi.appletStoreListCatalog.mockResolvedValue({
      items: [{ info: { id: atelierManifest.id }, version: { status: 4 } }],
    });
    const { useAppletsStore } = await import('./applets');
    await useAppletsStore.getState().refresh();
    expect(useAppletsStore.getState().applets).toEqual([]);
    expect(useAppletsStore.getState().catalogApplets[0]?.status).toBe('revoked');
  });

  it('refuses an incompatible local install before changing installation preference', async () => {
    const { useAppletsStore } = await import('./applets');
    useAppletsStore.setState({
      applets: [], catalogApplets: [{ manifest, status: 'available', source: 'local-dev' }],
      localDevInstalledAppletIds: [],
    });
    manager.assertSupportedApplet.mockImplementationOnce(() => { throw new Error('error.applet.incompatiblePlatform'); });
    await expect(useAppletsStore.getState().installApplet(manifest.id)).rejects.toThrow('error.applet.incompatiblePlatform');
    expect(useAppletsStore.getState().localDevInstalledAppletIds).toEqual([]);
    expect(desktopApi.appletStoreInstall).not.toHaveBeenCalled();
  });

  it('rejects direct install requests for an identity missing from the catalog', async () => {
    const { useAppletsStore } = await import('./applets');
    await expect(useAppletsStore.getState().installApplet('missing')).rejects.toThrow('error.applet.notFound');
    expect(desktopApi.appletStoreInstall).not.toHaveBeenCalled();
  });

  it('destroys a newly opened session when revocation arrives during loading', async () => {
    const { useAppletsStore } = await import('./applets');
    manager.loadApplet.mockImplementationOnce(async () => {
      useAppletsStore.setState({
        applets: [], catalogApplets: [{ manifest, status: 'revoked', source: 'station' }],
      });
      return manifest;
    });
    await expect(useAppletsStore.getState().loadApplet(manifest.id)).rejects.toThrow('error.applet.revoked');
    expect(manager.unloadApplet).toHaveBeenCalledWith(manifest.id);
    expect(useAppletsStore.getState().catalogApplets[0]?.status).toBe('revoked');
  });
});
