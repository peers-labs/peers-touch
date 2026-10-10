import { useSyncExternalStore } from 'react';

import type { MobileSettingDetailId } from '../app/navigation';

export const SETTINGS_SURFACE_FIXTURE_IDS = [
  'settings.summary',
  'settings.summary-loading',
  'settings.summary-error',
  'settings.account-info',
  'settings.notifications',
  'settings.privacy-security',
  'settings.safety-number',
  'settings.blocked-users',
  'settings.chat-settings',
  'settings.chat-background',
  'settings.station-connection',
  'settings.encryption',
  'settings.language',
  'settings.about',
  'settings.detail-dirty',
  'settings.detail-saving',
  'settings.detail-saved',
  'settings.detail-conflict',
  'settings.detail-unavailable',
  'settings.permission-loading',
  'settings.permission-denied',
  'settings.detail-failed',
  'settings.storage-manage',
  'settings.storage-confirm',
  'settings.storage-progress',
  'settings.storage-partial-failure',
  'settings.storage-retention',
  'settings.storage-clear-confirm',
  'settings.storage-clear-failed',
  'settings.station-change',
  'settings.unsaved-exit',
  'settings.logout-confirm',
] as const;

export type SettingsSurfaceFixtureId =
  typeof SETTINGS_SURFACE_FIXTURE_IDS[number];

export interface SettingsSurfaceFixtureSnapshot {
  readonly surfaceId: SettingsSurfaceFixtureId | null;
  readonly revision: number;
}

export interface SettingsSurfaceFixtureRoute {
  readonly kind: 'summary' | 'detail';
  readonly settingId?: MobileSettingDetailId;
}

const DIRECT_DETAIL_IDS: Partial<
  Record<SettingsSurfaceFixtureId, MobileSettingDetailId>
> = {
  'settings.account-info': 'account-info',
  'settings.notifications': 'notifications',
  'settings.privacy-security': 'privacy-security',
  'settings.safety-number': 'safety-number',
  'settings.blocked-users': 'blocked-users',
  'settings.chat-settings': 'chat-settings',
  'settings.chat-background': 'chat-background',
  'settings.station-connection': 'station-connection',
  'settings.encryption': 'encryption',
  'settings.language': 'language',
  'settings.about': 'about',
};

const listeners = new Set<() => void>();
let snapshot: SettingsSurfaceFixtureSnapshot = {
  surfaceId: null,
  revision: 0,
};

export function useSettingsSurfaceFixture(): SettingsSurfaceFixtureSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setSettingsSurfaceFixture(
  surfaceId: SettingsSurfaceFixtureId | null,
): SettingsSurfaceFixtureSnapshot {
  if (snapshot.surfaceId === surfaceId) return snapshot;
  snapshot = {
    surfaceId,
    revision: snapshot.revision + 1,
  };
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function isSettingsSurfaceFixtureId(
  value: unknown,
): value is SettingsSurfaceFixtureId {
  return typeof value === 'string'
    && (SETTINGS_SURFACE_FIXTURE_IDS as readonly string[]).includes(value);
}

export function settingsSurfaceFixtureRoute(
  surfaceId: SettingsSurfaceFixtureId | null,
): SettingsSurfaceFixtureRoute {
  if (
    !surfaceId
    || surfaceId.startsWith('settings.summary')
    || surfaceId === 'settings.logout-confirm'
  ) {
    return { kind: 'summary' };
  }
  const directSettingId = DIRECT_DETAIL_IDS[surfaceId];
  if (directSettingId) {
    return { kind: 'detail', settingId: directSettingId };
  }
  if (surfaceId.startsWith('settings.storage-')) {
    return { kind: 'detail', settingId: 'chat-settings' };
  }
  if (surfaceId.startsWith('settings.permission-')) {
    return { kind: 'detail', settingId: 'privacy-security' };
  }
  if (surfaceId === 'settings.station-change') {
    return { kind: 'detail', settingId: 'station-connection' };
  }
  return { kind: 'detail', settingId: 'account-info' };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SettingsSurfaceFixtureSnapshot {
  return snapshot;
}
