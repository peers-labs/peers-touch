import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLET_BRIDGE_PROTOCOL, type AppletInfo } from '../applet/types';

const manager = vi.hoisted(() => ({
  scanApplets: vi.fn<() => Promise<AppletInfo[]>>(),
  getLoadedApplets: vi.fn<() => string[]>(),
  getDiagnostics: vi.fn<() => []>(),
  loadApplet: vi.fn<(id: string) => Promise<AppletInfo>>(),
  unloadApplet: vi.fn<(id: string) => Promise<void>>(),
}));

vi.mock('../applet/AppletManager', () => ({
  default: {
    getInstance: () => manager,
  },
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
  path: '/applets-dist/product-shell-applet',
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

    const { useAppletsStore } = await import('./applets');
    useAppletsStore.setState({
      applets: [],
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
});
