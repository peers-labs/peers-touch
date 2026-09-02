/**
 * devicePreferences.ts — Typed device-local preferences
 *
 * Device preferences are stored locally (never sent to Station).
 * This module owns the type, default factory, persistence key,
 * and typed local readback.
 */

import { createMobileAppStorageRuntime } from '../../storage/mobileClientStorage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemeMode = 'system' | 'light' | 'dark';
export type FontSizePreset = 'small' | 'medium' | 'large';

export interface DevicePreferences {
  readonly theme: ThemeMode;
  readonly fontSize: FontSizePreset;
  readonly compactMode: boolean;
  readonly mediaAutoDownload: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultDevicePreferences(): DevicePreferences {
  return {
    theme: 'system',
    fontSize: 'medium',
    compactMode: false,
    mediaAutoDownload: true,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const DEVICE_PREFS_KEY = 'peers-touch.mobile.device-preferences.v1';

export async function loadDevicePreferences(): Promise<DevicePreferences> {
  try {
    const repository = createMobileAppStorageRuntime().repositories.chatPreferences;
    const raw = await repository.readValue(DEVICE_PREFS_KEY) as Partial<DevicePreferences> | null;
    if (!raw) return defaultDevicePreferences();
    return normalizeDevicePreferences(raw);
  } catch {
    return defaultDevicePreferences();
  }
}

export async function persistDevicePreferences(prefs: DevicePreferences): Promise<void> {
  const repository = createMobileAppStorageRuntime().repositories.chatPreferences;
  await repository.write(DEVICE_PREFS_KEY, prefs as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Normalizer (JSON quarantine)
// ---------------------------------------------------------------------------

function normalizeDevicePreferences(raw: Partial<DevicePreferences>): DevicePreferences {
  const defaults = defaultDevicePreferences();
  return {
    theme: isThemeMode(raw.theme) ? raw.theme : defaults.theme,
    fontSize: isFontSizePreset(raw.fontSize) ? raw.fontSize : defaults.fontSize,
    compactMode: typeof raw.compactMode === 'boolean' ? raw.compactMode : defaults.compactMode,
    mediaAutoDownload: typeof raw.mediaAutoDownload === 'boolean' ? raw.mediaAutoDownload : defaults.mediaAutoDownload,
  };
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isFontSizePreset(value: unknown): value is FontSizePreset {
  return value === 'small' || value === 'medium' || value === 'large';
}
