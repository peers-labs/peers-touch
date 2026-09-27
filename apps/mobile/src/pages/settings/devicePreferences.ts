/**
 * devicePreferences.ts — Typed device-local preferences
 *
 * Device preferences are stored locally (never sent to Station). Their
 * projection and persistence lifecycle belong to deviceSettingsRuntime;
 * this module keeps settings-facing platform adapters together.
 */

import { getVersion } from '@tauri-apps/api/app';
import type { ClientStorageDomainId } from '@peers-touch/client-storage';

import type { MobileAuthSession } from '../../features/auth/authSession';
import {
  checkAllPermissions,
  requestPermission,
  type PermissionCheckResult,
  type PermissionKind,
  type PermissionRequestResult,
} from '../../runtimes/nativeLifecycleBridge';
import { createMobileClientStorageRuntime } from '../../storage/mobileClientStorage';

export {
  defaultDevicePreferences,
  loadDevicePreferences,
  normalizeDevicePreferences,
  persistDevicePreferences,
} from '../../runtimes/deviceSettingsRuntime';
export type {
  DevicePreferences,
  FontSizePreset,
  ThemeMode,
} from '../../runtimes/deviceSettingsRuntime';

export type DevicePermission = PermissionCheckResult;

const CLEARABLE_CACHE_DOMAINS: readonly ClientStorageDomainId[] = [
  'asset.avatar',
  'profile.peer',
  'runtime.projection',
];

export async function clearMobileCache(
  session: MobileAuthSession | null,
): Promise<void> {
  await createMobileClientStorageRuntime(session).kernel.invalidateDomains(
    CLEARABLE_CACHE_DOMAINS,
  );
}

export async function loadAppVersion(): Promise<string> {
  return getVersion();
}

export async function loadDevicePermissions(): Promise<DevicePermission[]> {
  return checkAllPermissions();
}

export async function requestDevicePermission(
  kind: PermissionKind,
): Promise<PermissionRequestResult> {
  return requestPermission(kind);
}
