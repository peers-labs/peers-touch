import { useSyncExternalStore } from 'react';

import {
  discoverXConfigSuggestion as discoverNativeSuggestion,
  readXConfigProjection,
  refreshXConfigProjection as refreshNativeProjection,
  type XConfigProjection,
  type StationEndpointDiscovery,
} from '../../services/mobileCommands';

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

export function useXConfigProjection(): XConfigProjection {
  return useSyncExternalStore(
    subscribeXConfigProjection,
    getXConfigProjection,
    getXConfigProjection,
  );
}

export function loadXConfigProjection(): Promise<XConfigProjection> {
  if (loadInFlight) return loadInFlight;
  loadInFlight = readXConfigProjection()
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
  refreshInFlight = refreshNativeProjection(force)
    .then(publish)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export function discoverXConfigSuggestion(
  seedId: string,
): Promise<StationEndpointDiscovery> {
  return discoverNativeSuggestion(seedId);
}

export function resetXConfigProjectionForTests(): void {
  projection = EMPTY_PROJECTION;
  loadInFlight = null;
  refreshInFlight = null;
  listeners.clear();
}
