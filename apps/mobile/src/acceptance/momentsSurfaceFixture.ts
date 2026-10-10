import { useSyncExternalStore } from 'react';

export const MOMENTS_SURFACE_FIXTURE_IDS = [
  'moments.feed',
  'moments.feed-loading',
  'moments.feed-error',
  'moments.feed-empty',
  'moments.filtered-empty',
  'moments.unavailable',
  'moments.feed-loading-more',
  'moments.feed-retained-error',
  'moments.policy-hidden',
  'moments.composer',
  'moments.composer-audience',
  'moments.composer-media-uploading',
  'moments.composer-media-ready',
  'moments.composer-media-error',
  'moments.composer-pending',
  'moments.composer-rollback',
  'moments.composer-draft-restored',
  'moments.composer-draft-failed',
  'moments.reaction-pending',
  'moments.reaction-rollback',
  'moments.detail-comments',
  'moments.detail-loading',
  'moments.detail-unavailable',
  'moments.detail-hidden',
  'moments.detail-deleted',
  'moments.comments-loading',
  'moments.comments-empty',
  'moments.comments-error',
  'moments.comments-loading-more',
  'moments.comments-pending',
  'moments.comments-failed',
] as const;

export type MomentsSurfaceFixtureId =
  typeof MOMENTS_SURFACE_FIXTURE_IDS[number];

export interface MomentsSurfaceFixtureSnapshot {
  readonly surfaceId: MomentsSurfaceFixtureId | null;
  readonly revision: number;
}

export type MomentsSurfaceFixtureRouteKind = 'feed' | 'composer' | 'detail';

const listeners = new Set<() => void>();
let snapshot: MomentsSurfaceFixtureSnapshot = {
  surfaceId: null,
  revision: 0,
};

export function useMomentsSurfaceFixture(): MomentsSurfaceFixtureSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setMomentsSurfaceFixture(
  surfaceId: MomentsSurfaceFixtureId | null,
): MomentsSurfaceFixtureSnapshot {
  if (snapshot.surfaceId === surfaceId) return snapshot;
  snapshot = {
    surfaceId,
    revision: snapshot.revision + 1,
  };
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function isMomentsSurfaceFixtureId(
  value: unknown,
): value is MomentsSurfaceFixtureId {
  return typeof value === 'string'
    && (MOMENTS_SURFACE_FIXTURE_IDS as readonly string[]).includes(value);
}

export function momentsSurfaceFixtureRouteKind(
  surfaceId: MomentsSurfaceFixtureId | null,
): MomentsSurfaceFixtureRouteKind {
  if (surfaceId?.startsWith('moments.composer')) return 'composer';
  if (
    surfaceId?.startsWith('moments.detail')
    || surfaceId?.startsWith('moments.comments')
    || surfaceId?.startsWith('moments.reaction')
  ) {
    return 'detail';
  }
  return 'feed';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): MomentsSurfaceFixtureSnapshot {
  return snapshot;
}
