import type {
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
} from '../app/lifecycle/types';
import { mobilePersonalizationScope } from './personalizationScope';

export const DEVICE_SETTINGS_RUNTIME_ID = 'device-settings';

const DEVICE_PREFERENCES_KEY = 'peers-touch.mobile.device-preferences.v1';
const DEVICE_SETTINGS_UNAVAILABLE_ERROR = 'mobile.launch.unavailable';
const DEVICE_SETTINGS_WRITE_FAILED_ERROR =
  'mobile.settings.dirty.saveFailed';

export type ThemeMode = 'system' | 'light' | 'dark';
export type FontSizePreset = 'small' | 'medium' | 'large';

export interface DevicePreferences {
  readonly theme: ThemeMode;
  readonly fontSize: FontSizePreset;
  readonly compactMode: boolean;
  readonly mediaAutoDownload: boolean;
}

export interface DeviceSettingsWriteFailure {
  readonly errorKey: typeof DEVICE_SETTINGS_WRITE_FAILED_ERROR;
  readonly attemptedPreferences: DevicePreferences;
}

export type DeviceSettingsRuntimeSnapshot =
  | {
      readonly status: 'loading';
      readonly preferences: null;
      readonly errorKey: null;
      readonly writeFailure: null;
    }
  | {
      readonly status: 'ready';
      readonly preferences: DevicePreferences;
      readonly errorKey: null;
      readonly writeFailure: DeviceSettingsWriteFailure | null;
    }
  | {
      readonly status: 'unavailable';
      readonly preferences: null;
      readonly errorKey: typeof DEVICE_SETTINGS_UNAVAILABLE_ERROR;
      readonly writeFailure: null;
    };

export interface DeviceSettingsPersistence {
  read(): Promise<unknown | null>;
  write(preferences: DevicePreferences): Promise<void>;
}

export type DeviceSettingsApplier = (preferences: DevicePreferences) => void;

export interface DeviceSettingsDocumentRoot {
  readonly dataset: Record<string, string | undefined>;
  readonly style: {
    colorScheme?: string;
  };
}

export interface DeviceSettingsRuntime {
  bootstrap(): Promise<DeviceSettingsRuntimeSnapshot>;
  read(): Promise<DevicePreferences>;
  retry(): Promise<DevicePreferences>;
  replace(preferences: DevicePreferences): Promise<DevicePreferences>;
  retryWrite(): Promise<DevicePreferences>;
  reset(): void;
  getSnapshot(): DeviceSettingsRuntimeSnapshot;
  subscribe(listener: () => void): () => void;
}

const loadingSnapshot: DeviceSettingsRuntimeSnapshot = Object.freeze({
  status: 'loading',
  preferences: null,
  errorKey: null,
  writeFailure: null,
});

export function defaultDevicePreferences(): DevicePreferences {
  return Object.freeze({
    theme: 'system',
    fontSize: 'medium',
    compactMode: false,
    mediaAutoDownload: true,
  });
}

export function normalizeDevicePreferences(raw: unknown): DevicePreferences {
  if (
    !isRecord(raw)
    || !isThemeMode(raw.theme)
    || !isFontSizePreset(raw.fontSize)
    || typeof raw.compactMode !== 'boolean'
    || typeof raw.mediaAutoDownload !== 'boolean'
  ) {
    throw new Error(DEVICE_SETTINGS_UNAVAILABLE_ERROR);
  }

  return Object.freeze({
    theme: raw.theme,
    fontSize: raw.fontSize,
    compactMode: raw.compactMode,
    mediaAutoDownload: raw.mediaAutoDownload,
  });
}

export function createDeviceSettingsRuntime(
  persistence?: DeviceSettingsPersistence,
  applyPreferences: DeviceSettingsApplier = applyDevicePreferences,
): DeviceSettingsRuntime {
  let snapshot = loadingSnapshot;
  let operations = Promise.resolve();
  let generation = 0;
  const listeners = new Set<() => void>();

  const publish = (next: DeviceSettingsRuntimeSnapshot): void => {
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };

  const enqueue = <T>(operation: (storage: DeviceSettingsPersistence, current: () => boolean) => Promise<T>): Promise<T> => {
    const scope = mobilePersonalizationScope.capture();
    const observed = generation;
    const current = () => observed === generation && (persistence !== undefined || scope.current());
    const storage = persistence ?? {
      read: () => scope.read(DEVICE_PREFERENCES_KEY),
      write: (preferences: DevicePreferences) => scope.write(
        DEVICE_PREFERENCES_KEY, { ...preferences },
      ),
    };
    const run = () => {
      if (!current()) throw new Error('mobile.auth.sessionChanged');
      return operation(storage, current);
    };
    const result = persistence
      ? operations.then(run, run)
      : mobilePersonalizationScope.enqueue(run);
    operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const loadFromStorage = async (
    storage: DeviceSettingsPersistence,
    current: () => boolean,
    allowMissingValue = true,
  ): Promise<DeviceSettingsRuntimeSnapshot> => {
    publish(loadingSnapshot);
    try {
      const raw = await storage.read();
      if (!current()) return snapshot;
      if (raw === null && !allowMissingValue) {
        throw new Error(DEVICE_SETTINGS_UNAVAILABLE_ERROR);
      }
      const preferences = raw === null
        ? defaultDevicePreferences()
        : normalizeDevicePreferences(raw);
      const ready: DeviceSettingsRuntimeSnapshot = {
        status: 'ready',
        preferences,
        errorKey: null,
        writeFailure: null,
      };
      applyPreferences(preferences);
      publish(ready);
      return ready;
    } catch {
      if (!current()) return snapshot;
      const unavailable: DeviceSettingsRuntimeSnapshot = {
        status: 'unavailable',
        preferences: null,
        errorKey: DEVICE_SETTINGS_UNAVAILABLE_ERROR,
        writeFailure: null,
      };
      publish(unavailable);
      return unavailable;
    }
  };

  const requireReady = (
    current: DeviceSettingsRuntimeSnapshot,
  ): DevicePreferences => {
    if (current.status === 'ready') return current.preferences;
    throw new Error(current.errorKey ?? DEVICE_SETTINGS_UNAVAILABLE_ERROR);
  };

  const replaceNow = async (
    preferences: DevicePreferences,
    storage: DeviceSettingsPersistence,
    current: () => boolean,
  ): Promise<DevicePreferences> => {
    if (snapshot.status === 'loading') await loadFromStorage(storage, current);
    if (!current()) throw new Error('mobile.auth.sessionChanged');
    const committed = requireReady(snapshot);
    const attemptedPreferences = normalizeDevicePreferences(preferences);

    try {
      await storage.write(attemptedPreferences);
    } catch {
      if (!current()) throw new Error('mobile.auth.sessionChanged');
      publish({
        status: 'ready',
        preferences: committed,
        errorKey: null,
        writeFailure: {
          errorKey: DEVICE_SETTINGS_WRITE_FAILED_ERROR,
          attemptedPreferences,
        },
      });
      throw new Error(DEVICE_SETTINGS_WRITE_FAILED_ERROR);
    }

    if (!current()) throw new Error('mobile.auth.sessionChanged');
    const readback = await loadFromStorage(storage, current, false);
    if (!current()) throw new Error('mobile.auth.sessionChanged');
    if (readback.status !== 'ready' || readback.preferences === null) {
      throw new Error(DEVICE_SETTINGS_UNAVAILABLE_ERROR);
    }
    return readback.preferences;
  };

  return {
    bootstrap: () => enqueue(async (storage, current) => (
      snapshot.status === 'ready' ? snapshot : loadFromStorage(storage, current)
    )),

    read: () => enqueue(async (storage, current) => {
      if (snapshot.status === 'loading') await loadFromStorage(storage, current);
      if (!current()) throw new Error('mobile.auth.sessionChanged');
      return requireReady(snapshot);
    }),

    retry: () => enqueue(async (storage, current) => {
      const next = await loadFromStorage(storage, current);
      if (!current()) throw new Error('mobile.auth.sessionChanged');
      return requireReady(next);
    }),

    replace: (preferences) => enqueue((storage, current) => replaceNow(preferences, storage, current)),

    retryWrite: () => enqueue(async (storage, current) => {
      if (snapshot.status !== 'ready' || !snapshot.writeFailure) {
        return requireReady(snapshot);
      }
      return replaceNow(snapshot.writeFailure.attemptedPreferences, storage, current);
    }),

    reset: () => {
      generation += 1;
      operations = Promise.resolve();
      applyPreferences(defaultDevicePreferences());
      publish(loadingSnapshot);
    },

    getSnapshot: () => snapshot,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function applyDevicePreferences(
  preferences: DevicePreferences,
  root: DeviceSettingsDocumentRoot | null =
    globalThis.document?.documentElement ?? null,
  prefersDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
): void {
  if (!root) return;
  const resolvedTheme = preferences.theme === 'system'
    ? (prefersDark ? 'dark' : 'light')
    : preferences.theme;
  root.dataset.mobileTheme = preferences.theme;
  root.dataset.mobileColorScheme = resolvedTheme;
  root.dataset.mobileFontSize = preferences.fontSize;
  root.dataset.mobileCompact = String(preferences.compactMode);
  root.style.colorScheme = resolvedTheme;
}

const deviceSettingsRuntime = createDeviceSettingsRuntime();
let releaseSystemThemeListener: (() => void) | null = null;

export async function loadDevicePreferences(): Promise<DevicePreferences> {
  if (deviceSettingsRuntime.getSnapshot().status === 'unavailable') {
    return deviceSettingsRuntime.retry();
  }
  await deviceSettingsRuntime.bootstrap();
  return deviceSettingsRuntime.read();
}

export async function persistDevicePreferences(
  preferences: DevicePreferences,
): Promise<void> {
  await deviceSettingsRuntime.replace(preferences);
}

export function readDeviceSettingsRuntimeSnapshot(): DeviceSettingsRuntimeSnapshot {
  return deviceSettingsRuntime.getSnapshot();
}

export function retryDeviceSettingsRuntime(): Promise<DevicePreferences> {
  return deviceSettingsRuntime.retry();
}

export function retryDeviceSettingsWrite(): Promise<DevicePreferences> {
  return deviceSettingsRuntime.retryWrite();
}

export function subscribeDeviceSettingsRuntime(
  listener: () => void,
): () => void {
  return deviceSettingsRuntime.subscribe(listener);
}

export function createDeviceSettingsRuntimeDescriptor(
  runtime: Pick<DeviceSettingsRuntime, 'bootstrap' | 'reset'> = deviceSettingsRuntime,
): MobileRuntimeDescriptor {
  let releaseIdentity: (() => void) | null = null;
  let releaseScope: (() => void) | null = null;

  return {
    id: DEVICE_SETTINGS_RUNTIME_ID,
    title: 'Device Settings Runtime',
    responsibility:
      'Owns identity-scoped preference loading, committed readback, mutation, and retryable local-storage failures.',
    dependsOn: ['session'],

    async bootstrap(): Promise<void> {
      if (!releaseIdentity) {
        releaseIdentity = mobilePersonalizationScope.subscribe(() => {
          runtime.reset();
          void runtime.bootstrap();
        });
        releaseScope = mobilePersonalizationScope.retain();
      }
      installDeviceSettingsSystemThemeListener();
      await runtime.bootstrap();
    },

    async suspend(): Promise<void> {
      // Personalization has no active resource to suspend.
    },

    async resume(): Promise<void> {
      await runtime.bootstrap();
    },

    async teardown(): Promise<RuntimeOperationResult> {
      releaseSystemThemeListener?.();
      releaseSystemThemeListener = null;
      releaseIdentity?.();
      releaseIdentity = null;
      releaseScope?.();
      releaseScope = null;
      runtime.reset();
      return {
        runtimeId: DEVICE_SETTINGS_RUNTIME_ID,
        success: true,
        durationMs: 0,
      };
    },
  };
}

function installDeviceSettingsSystemThemeListener(): void {
  if (releaseSystemThemeListener || !globalThis.matchMedia) return;
  const query = globalThis.matchMedia('(prefers-color-scheme: dark)');
  const applyCurrent = () => {
    const snapshot = deviceSettingsRuntime.getSnapshot();
    if (snapshot.status === 'ready' && snapshot.preferences.theme === 'system') {
      applyDevicePreferences(snapshot.preferences, undefined, query.matches);
    }
  };
  query.addEventListener('change', applyCurrent);
  releaseSystemThemeListener = () => query.removeEventListener('change', applyCurrent);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isFontSizePreset(value: unknown): value is FontSizePreset {
  return value === 'small' || value === 'medium' || value === 'large';
}
