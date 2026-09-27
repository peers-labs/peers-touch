import { describe, expect, it, vi } from 'vitest';

import {
  applyDevicePreferences,
  createDeviceSettingsRuntime,
  defaultDevicePreferences,
  type DeviceSettingsDocumentRoot,
  type DevicePreferences,
} from './deviceSettingsRuntime';

const storedPreferences: DevicePreferences = {
  theme: 'dark',
  fontSize: 'large',
  compactMode: true,
  mediaAutoDownload: false,
};

describe('deviceSettingsRuntime', () => {
  it('applies committed theme, font, and density to the document owner', () => {
    const root: DeviceSettingsDocumentRoot = {
      dataset: {},
      style: {},
    };

    applyDevicePreferences(storedPreferences, root, false);

    expect(root.dataset).toEqual({
      mobileTheme: 'dark',
      mobileColorScheme: 'dark',
      mobileFontSize: 'large',
      mobileCompact: 'true',
    });
    expect(root.style.colorScheme).toBe('dark');

    applyDevicePreferences({
      ...storedPreferences,
      theme: 'system',
    }, root, false);
    expect(root.dataset.mobileColorScheme).toBe('light');
  });

  it('commits defaults only after a successful read with no stored value', async () => {
    const runtime = createDeviceSettingsRuntime({
      read: vi.fn(async () => null),
      write: vi.fn(),
    });

    expect(runtime.getSnapshot()).toEqual({
      status: 'loading',
      preferences: null,
      errorKey: null,
      writeFailure: null,
    });

    await runtime.bootstrap();

    expect(runtime.getSnapshot()).toEqual({
      status: 'ready',
      preferences: defaultDevicePreferences(),
      errorKey: null,
      writeFailure: null,
    });
  });

  it('keeps failed and malformed reads unavailable instead of committing defaults', async () => {
    const failedRead = createDeviceSettingsRuntime({
      read: vi.fn(async () => {
        throw new Error('storage unavailable');
      }),
      write: vi.fn(),
    });
    const malformedRead = createDeviceSettingsRuntime({
      read: vi.fn(async () => ({ theme: 'dark' })),
      write: vi.fn(),
    });

    await failedRead.bootstrap();
    await malformedRead.bootstrap();

    expect(failedRead.getSnapshot()).toMatchObject({
      status: 'unavailable',
      preferences: null,
    });
    expect(malformedRead.getSnapshot()).toMatchObject({
      status: 'unavailable',
      preferences: null,
    });
    await expect(failedRead.read()).rejects.toThrow('mobile.launch.unavailable');
  });

  it('retries an unavailable read and publishes the stored value', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(storedPreferences);
    const runtime = createDeviceSettingsRuntime({
      read,
      write: vi.fn(),
    });

    await runtime.bootstrap();
    await expect(runtime.retry()).resolves.toEqual(storedPreferences);

    expect(read).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot()).toEqual({
      status: 'ready',
      preferences: storedPreferences,
      errorKey: null,
      writeFailure: null,
    });
  });

  it('preserves committed preferences and exposes the attempted write on failure', async () => {
    const nextPreferences: DevicePreferences = {
      ...storedPreferences,
      compactMode: false,
    };
    const read = vi.fn()
      .mockResolvedValueOnce(storedPreferences)
      .mockResolvedValueOnce(nextPreferences);
    const write = vi.fn()
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValueOnce(undefined);
    const runtime = createDeviceSettingsRuntime({ read, write });

    await runtime.bootstrap();
    await expect(runtime.replace(nextPreferences)).rejects.toThrow(
      'mobile.settings.dirty.saveFailed',
    );
    expect(runtime.getSnapshot()).toEqual({
      status: 'ready',
      preferences: storedPreferences,
      errorKey: null,
      writeFailure: {
        errorKey: 'mobile.settings.dirty.saveFailed',
        attemptedPreferences: nextPreferences,
      },
    });

    await expect(runtime.retryWrite()).resolves.toEqual(nextPreferences);
    expect(write).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot()).toEqual({
      status: 'ready',
      preferences: nextPreferences,
      errorKey: null,
      writeFailure: null,
    });
  });

  it('applies only successful readback and keeps failed writes unapplied', async () => {
    const apply = vi.fn();
    const nextPreferences: DevicePreferences = {
      ...storedPreferences,
      fontSize: 'small',
    };
    const runtime = createDeviceSettingsRuntime({
      read: vi.fn(async () => storedPreferences),
      write: vi.fn(async () => {
        throw new Error('quota exceeded');
      }),
    }, apply);

    await runtime.bootstrap();
    await expect(runtime.replace(nextPreferences)).rejects.toThrow(
      'mobile.settings.dirty.saveFailed',
    );

    expect(apply).toHaveBeenCalledExactlyOnceWith(storedPreferences);
  });

  it('requires successful post-write readback before publishing a mutation', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(storedPreferences)
      .mockRejectedValueOnce(new Error('readback unavailable'));
    const runtime = createDeviceSettingsRuntime({
      read,
      write: vi.fn(async () => undefined),
    });

    await runtime.bootstrap();
    await expect(runtime.replace({
      ...storedPreferences,
      theme: 'light',
    })).rejects.toThrow('mobile.launch.unavailable');

    expect(runtime.getSnapshot()).toMatchObject({
      status: 'unavailable',
      preferences: null,
    });
  });
});
