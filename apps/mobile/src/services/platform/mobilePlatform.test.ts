import { describe, expect, it, vi } from 'vitest';

import { createTauriMobilePlatform } from './mobilePlatform';

const iosHealth = {
  clientForm: 'mobile',
  releaseTarget: 'ios',
  processModel: 'tauri-mobile',
  shell: 'tauri-mobile',
  kernel: 'rust-capability-kernel',
} as const;

describe('createTauriMobilePlatform', () => {
  it('reads release identity from Rust diagnostics', async () => {
    const invokeCommand = vi.fn().mockResolvedValue(iosHealth);
    const platform = createTauriMobilePlatform({ invokeCommand });

    await expect(platform.readReleaseIdentity()).resolves.toEqual({
      clientForm: 'mobile',
      releaseTarget: 'ios',
      processModel: 'tauri-mobile',
    });
    expect(invokeCommand).toHaveBeenCalledWith('mobile_health');
  });

  it('rejects a static or malformed platform identity', async () => {
    for (const health of [
      { ...iosHealth, releaseTarget: 'desktop' },
      { ...iosHealth, shell: 'tauri-ios' },
      { ...iosHealth, extra: true },
    ]) {
      const platform = createTauriMobilePlatform({
        invokeCommand: vi.fn().mockResolvedValue(health),
      });
      await expect(platform.readReleaseIdentity()).rejects.toThrow(
        'mobile.platform.identityInvalid',
      );
    }
  });

  it('binds capability facts and system actions to typed Rust commands', async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === 'capability_observe') {
        return {
          capability: 'push',
          releaseTarget: 'android',
          state: 'unavailable',
          observedAt: 'unix-ms:1792267200000',
          source: 'android.firebase',
          detail: 'provider-config-missing',
        };
      }
      if (command === 'system_action_execute') {
        return {
          releaseTarget: 'android',
          state: 'completed',
        };
      }
      return {
        ...iosHealth,
        releaseTarget: 'android',
      };
    });
    const platform = createTauriMobilePlatform({ invokeCommand });

    await expect(platform.capabilityFacts.observe('push')).resolves.toEqual({
      capability: 'push',
      releaseTarget: 'android',
      state: 'unavailable',
      observedAt: 'unix-ms:1792267200000',
      source: 'android.firebase',
      detail: 'provider-config-missing',
    });
    await expect(platform.systemActions.execute({
      kind: 'open_app_settings',
    })).resolves.toEqual({
      releaseTarget: 'android',
      state: 'completed',
    });
    expect(invokeCommand).toHaveBeenCalledWith('capability_observe', {
      input: { capability: 'push' },
    });
    expect(invokeCommand).toHaveBeenCalledWith('system_action_execute', {
      action: { kind: 'open_app_settings' },
    });
  });

  it('rejects malformed host projections', async () => {
    const capabilityPlatform = createTauriMobilePlatform({
      invokeCommand: vi.fn().mockResolvedValue({
        capability: 'push',
        releaseTarget: 'android',
        state: 'ready',
        observedAt: '',
        source: '',
      }),
    });
    await expect(capabilityPlatform.capabilityFacts.observe('push'))
      .rejects.toThrow('mobile.platform.capabilityFactInvalid');

    const actionPlatform = createTauriMobilePlatform({
      invokeCommand: vi.fn().mockResolvedValue({
        releaseTarget: 'ios',
        state: 'opened',
      }),
    });
    await expect(actionPlatform.systemActions.execute({
      kind: 'open_app_settings',
    })).rejects.toThrow('mobile.platform.systemActionOutcomeInvalid');
  });

  it('accepts Rust projections with absent optional fields', async () => {
    const capabilityPlatform = createTauriMobilePlatform({
      invokeCommand: vi.fn().mockResolvedValue({
        capability: 'push',
        releaseTarget: 'ios',
        state: 'available',
        observedAt: 'unix-ms:1792267200000',
        source: 'ios.user-notifications',
      }),
    });
    await expect(capabilityPlatform.capabilityFacts.observe('push'))
      .resolves.toEqual({
        capability: 'push',
        releaseTarget: 'ios',
        state: 'available',
        observedAt: 'unix-ms:1792267200000',
        source: 'ios.user-notifications',
      });

    const actionPlatform = createTauriMobilePlatform({
      invokeCommand: vi.fn().mockResolvedValue({
        releaseTarget: 'android',
        state: 'completed',
      }),
    });
    await expect(actionPlatform.systemActions.execute({
      kind: 'open_app_settings',
    })).resolves.toEqual({
      releaseTarget: 'android',
      state: 'completed',
    });
  });

  it('subscribes to system back only for the Android host', async () => {
    const unregister = vi.fn(async () => undefined);
    const subscribeBackButton = vi.fn(async () => ({ unregister })) as never;
    const handler = vi.fn();
    const android = createTauriMobilePlatform({
      invokeCommand: vi.fn().mockResolvedValue({
        ...iosHealth,
        releaseTarget: 'android',
      }),
      subscribeBackButton,
    });
    const unsubscribe = await android.subscribeSystemBack(handler);
    expect(subscribeBackButton).toHaveBeenCalledTimes(1);
    await unsubscribe();
    expect(unregister).toHaveBeenCalledTimes(1);

    const iosSubscribe = vi.fn();
    const ios = createTauriMobilePlatform({
      invokeCommand: vi.fn().mockResolvedValue(iosHealth),
      subscribeBackButton: iosSubscribe as never,
    });
    await ios.subscribeSystemBack(handler);
    expect(iosSubscribe).not.toHaveBeenCalled();
  });
});
