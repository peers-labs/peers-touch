import { useSyncExternalStore } from 'react';

export const CONTACTS_SURFACE_FIXTURE_IDS = [
  'contacts.list',
  'contacts.list-loading',
  'contacts.list-empty',
  'contacts.list-error',
  'contacts.local-search',
  'contacts.local-search-empty',
  'contacts.requests',
  'contacts.request-pending',
  'contacts.request-unknown',
  'contacts.request-failed',
  'contacts.profile',
  'contacts.profile-unavailable',
  'contacts.block-confirm',
  'contacts.add-friend',
  'contacts.add-friend-empty',
  'contacts.search-loading',
  'contacts.search-unavailable',
  'contacts.search-duplicate',
  'contacts.search-pending',
  'contacts.search-failed',
  'contacts.search-permission-denied',
  'contacts.create-group',
  'contacts.group-pending',
  'contacts.group-failed',
  'contacts.group-role-denied',
] as const;

export type ContactsSurfaceFixtureId =
  typeof CONTACTS_SURFACE_FIXTURE_IDS[number];

export interface ContactsSurfaceFixtureSnapshot {
  readonly surfaceId: ContactsSurfaceFixtureId | null;
  readonly revision: number;
}

export type ContactsSurfaceFixtureRouteKind = 'list' | 'profile' | 'people' | 'group';

const listeners = new Set<() => void>();
let snapshot: ContactsSurfaceFixtureSnapshot = {
  surfaceId: null,
  revision: 0,
};

export function useContactsSurfaceFixture(): ContactsSurfaceFixtureSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setContactsSurfaceFixture(
  surfaceId: ContactsSurfaceFixtureId | null,
): ContactsSurfaceFixtureSnapshot {
  if (snapshot.surfaceId === surfaceId) return snapshot;
  snapshot = {
    surfaceId,
    revision: snapshot.revision + 1,
  };
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function isContactsSurfaceFixtureId(
  value: unknown,
): value is ContactsSurfaceFixtureId {
  return typeof value === 'string'
    && (CONTACTS_SURFACE_FIXTURE_IDS as readonly string[]).includes(value);
}

export function contactsSurfaceFixtureRouteKind(
  surfaceId: ContactsSurfaceFixtureId | null,
): ContactsSurfaceFixtureRouteKind {
  if (!surfaceId || surfaceId.startsWith('contacts.list')
    || surfaceId.startsWith('contacts.local-search')
    || surfaceId.startsWith('contacts.request')) {
    return 'list';
  }
  if (surfaceId === 'contacts.profile'
    || surfaceId === 'contacts.profile-unavailable'
    || surfaceId === 'contacts.block-confirm') {
    return 'profile';
  }
  if (surfaceId === 'contacts.create-group'
    || surfaceId.startsWith('contacts.group-')) {
    return 'group';
  }
  return 'people';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ContactsSurfaceFixtureSnapshot {
  return snapshot;
}
