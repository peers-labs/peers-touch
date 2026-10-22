import {
  api,
  type XConfigProjection,
  type StationDiscoveryResult,
} from './desktop_api';

const EMPTY_PROJECTION: XConfigProjection = Object.freeze({
  channel: 'stable',
  freshness: 'unavailable',
  suggestions: [],
  refreshing: false,
});

let projection = EMPTY_PROJECTION;
let loadInFlight: Promise<XConfigProjection> | null = null;
let refreshInFlight: Promise<XConfigProjection> | null = null;
const listeners = new Set<() => void>();

function publish(next: XConfigProjection): XConfigProjection {
  projection = Object.freeze({
    ...next,
    suggestions: [...(next.suggestions ?? [])],
  });
  listeners.forEach((listener) => listener());
  return projection;
}

export function getXConfigProjection(): XConfigProjection {
  return projection;
}

export function subscribeXConfigProjection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadXConfigProjection(): Promise<XConfigProjection> {
  if (loadInFlight) return loadInFlight;
  loadInFlight = api.xConfigProjection()
    .then(publish)
    .finally(() => {
      loadInFlight = null;
    });
  return loadInFlight;
}

export function refreshXConfigProjection(
  force = false,
): Promise<XConfigProjection> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = api.xConfigRefresh(force)
    .then(publish)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export function discoverXConfigSuggestion(
  seedId: string,
): Promise<StationDiscoveryResult> {
  return api.xConfigDiscoverSuggestion(seedId);
}

export function resetXConfigProjectionForTests(): void {
  projection = EMPTY_PROJECTION;
  loadInFlight = null;
  refreshInFlight = null;
  listeners.clear();
}
