import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAllPermissions: vi.fn(),
  getVersion: vi.fn(),
  invalidateDomains: vi.fn(),
  readValue: vi.fn(),
  requestPermission: vi.fn(),
  write: vi.fn(),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: mocks.getVersion,
}));

vi.mock('../../runtimes/nativeLifecycleBridge', () => ({
  checkAllPermissions: mocks.checkAllPermissions,
  requestPermission: mocks.requestPermission,
}));

vi.mock('../../storage/mobileClientStorage', () => ({
  createMobileAppStorageRuntime: () => ({
    repositories: {
      chatPreferences: {
        readValue: mocks.readValue,
        write: mocks.write,
      },
    },
  }),
  createMobileClientStorageRuntime: () => ({
    kernel: {
      invalidateDomains: mocks.invalidateDomains,
    },
  }),
}));

import {
  clearMobileCache,
  defaultDevicePreferences,
  loadAppVersion,
  loadDevicePermissions,
  normalizeDevicePreferences,
  requestDevicePermission,
} from './devicePreferences';

describe('device settings runtime adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-exports the runtime default and strict persisted-value decoder', () => {
    const defaults = defaultDevicePreferences();

    expect(normalizeDevicePreferences(defaults)).toEqual(defaults);
    expect(() => normalizeDevicePreferences({
      ...defaults,
      theme: 'invalid',
    })).toThrow('mobile.launch.unavailable');
  });

  it('reads the application version from native build metadata', async () => {
    mocks.getVersion.mockResolvedValue('0.1.0');

    await expect(loadAppVersion()).resolves.toBe('0.1.0');
    expect(mocks.getVersion).toHaveBeenCalledOnce();
  });

  it('delegates permission readback and requests to the native runtime', async () => {
    const permissions = [{
      kind: 'camera',
      status: 'not_determined',
      canRequest: true,
    }];
    mocks.checkAllPermissions.mockResolvedValue(permissions);
    mocks.requestPermission.mockResolvedValue({
      kind: 'camera',
      status: 'granted',
      wasAlreadyGranted: false,
    });

    await expect(loadDevicePermissions()).resolves.toBe(permissions);
    await expect(requestDevicePermission('camera')).resolves.toMatchObject({
      status: 'granted',
    });
    expect(mocks.requestPermission).toHaveBeenCalledWith('camera');
  });

  it('clears only regenerable cache domains through the storage kernel', async () => {
    mocks.invalidateDomains.mockResolvedValue(undefined);

    await clearMobileCache(null);

    expect(mocks.invalidateDomains).toHaveBeenCalledWith([
      'asset.avatar',
      'profile.peer',
      'runtime.projection',
    ]);
  });
});
