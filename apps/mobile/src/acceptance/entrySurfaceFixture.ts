import { useSyncExternalStore } from 'react';

export const ENTRY_SURFACE_FIXTURE_IDS = [
  'entry.app-boot',
  'entry.station-selection',
  'entry.station-empty',
  'entry.station-address',
  'entry.station-address-invalid',
  'entry.station-verifying',
  'entry.station-unavailable',
  'entry.station-identity-mismatch',
  'entry.station-remove-confirm',
  'entry.station-handshake',
  'entry.access-login',
  'entry.login-failed',
  'entry.session-expired',
  'entry.access-oauth',
  'entry.oauth-progress',
  'entry.oauth-failed',
  'entry.access-schema',
  'entry.access-pending',
  'entry.access-failed',
  'entry.access-unavailable',
  'entry.runtime-critical',
  'entry.runtime-preparing',
] as const;

export type EntrySurfaceFixtureId = typeof ENTRY_SURFACE_FIXTURE_IDS[number];

export interface EntrySurfaceFixtureSnapshot {
  readonly surfaceId: EntrySurfaceFixtureId | null;
  readonly revision: number;
}

const listeners = new Set<() => void>();
let snapshot: EntrySurfaceFixtureSnapshot = {
  surfaceId: null,
  revision: 0,
};

export function useEntrySurfaceFixture(): EntrySurfaceFixtureSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setEntrySurfaceFixture(
  surfaceId: EntrySurfaceFixtureId | null,
): EntrySurfaceFixtureSnapshot {
  if (snapshot.surfaceId === surfaceId) return snapshot;
  snapshot = {
    surfaceId,
    revision: snapshot.revision + 1,
  };
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function isEntrySurfaceFixtureId(
  value: unknown,
): value is EntrySurfaceFixtureId {
  return typeof value === 'string'
    && (ENTRY_SURFACE_FIXTURE_IDS as readonly string[]).includes(value);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): EntrySurfaceFixtureSnapshot {
  return snapshot;
}
