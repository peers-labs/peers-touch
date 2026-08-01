const FLAG_KEYS: Record<keyof FeatureFlags, string> = {
  cryptoDrEnabled: 'peers-touch:feature-flag:crypto.dr_enabled',
  cryptoDrTelemetryEnabled: 'peers-touch:feature-flag:crypto.dr_telemetry_enabled',
};

export interface FeatureFlags {
  cryptoDrEnabled: boolean;
  cryptoDrTelemetryEnabled: boolean;
}

function readBoolFromStorage(key: string, defaultValue: boolean): boolean {
  try {
    const raw = readDesktopPreferenceSync<string>(key);
    if (raw === null) return defaultValue;
    const v = raw.trim().toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  } catch {
    /* private mode / SSR */
  }
  return defaultValue;
}

export function readFeatureFlags(): FeatureFlags {
  return {
    cryptoDrEnabled: readBoolFromStorage(FLAG_KEYS.cryptoDrEnabled, true),
    cryptoDrTelemetryEnabled: readBoolFromStorage(FLAG_KEYS.cryptoDrTelemetryEnabled, true),
  };
}

export function setFeatureFlag(key: keyof FeatureFlags, value: boolean): void {
  try {
    writeDesktopPreferenceSync(FLAG_KEYS[key], value ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export function resetFeatureFlag(key: keyof FeatureFlags): void {
  try {
    removeDesktopPreferenceSync(FLAG_KEYS[key]);
  } catch {
    /* ignore */
  }
}
import {
  readDesktopPreferenceSync,
  removeDesktopPreferenceSync,
  writeDesktopPreferenceSync,
} from '../../storage/desktopClientStorage';
