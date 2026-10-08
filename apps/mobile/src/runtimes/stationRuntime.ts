import { useSyncExternalStore } from 'react';

import {
  activeStationEntry,
  activeStationRoute,
  activateStationRoute,
  addStationRoute,
  emptyStationRegistry,
  loadStationRegistry,
  persistStationRegistry,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import { verifyBoundStationRoute } from '../features/station/stationConnection';
import {
  activateStationRouteBinding,
  discoverStationEndpoint,
  restoreStationRouteBinding,
} from '../services/mobileCommands';
import { purgeLegacyMobileIdentityStorage } from '../storage/mobileClientStorage';

interface StationRegistryPersistence {
  load(): Promise<StoredStationRegistry>;
  persist(registry: StoredStationRegistry): Promise<void>;
}

export interface StationRegistryRuntime {
  bootstrap(): Promise<StoredStationRegistry>;
  read(): Promise<StoredStationRegistry>;
  update(
    updater: (current: StoredStationRegistry) => StoredStationRegistry,
  ): Promise<StoredStationRegistry>;
  getSnapshot(): StoredStationRegistry;
  subscribe(listener: () => void): () => void;
}

export function createStationRegistryRuntime(
  persistence: StationRegistryPersistence = {
    load: async () => {
      purgeLegacyMobileIdentityStorage();
      return loadStationRegistry();
    },
    persist: persistStationRegistry,
  },
): StationRegistryRuntime {
  let snapshot = emptyStationRegistry();
  let initialized = false;
  let operations = Promise.resolve();
  const listeners = new Set<() => void>();

  const publish = (next: StoredStationRegistry) => {
    if (next === snapshot) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const ensureInitialized = async () => {
    if (initialized) return;
    const loaded = await persistence.load();
    initialized = true;
    publish(loaded);
  };

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operations.then(operation, operation);
    operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    bootstrap: () => enqueue(async () => {
      await ensureInitialized();
      return snapshot;
    }),

    read: () => enqueue(async () => {
      await ensureInitialized();
      return snapshot;
    }),

    update: (updater) => enqueue(async () => {
      await ensureInitialized();
      const next = updater(snapshot);
      if (next === snapshot) return snapshot;
      await persistence.persist(next);
      publish(next);
      return snapshot;
    }),

    getSnapshot: () => snapshot,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const stationRegistryRuntime = createStationRegistryRuntime();
let nativeRouteBootstrapped = false;

export async function bootstrapStationRuntime(): Promise<StoredStationRegistry> {
  let loaded = await stationRegistryRuntime.bootstrap();
  if (nativeRouteBootstrapped) return loaded;
  nativeRouteBootstrapped = true;
  const station = activeStationEntry(loaded);
  const route = station ? activeStationRoute(station) : null;
  if (!station || !route) return loaded;
  try {
    if (route.sourceRef && !route.routeId.startsWith('legacy-direct:')) {
      await restoreStationRouteBinding({
        stationPeerId: station.stationPeerId,
        routeId: route.routeId,
        routeGeneration: route.routeGeneration,
        routeRevision: station.routeRevision ?? 1,
        sourceRef: route.sourceRef,
        endpointOrigin: route.endpointOrigin,
      });
      return loaded;
    }
    const discovery = await discoverStationEndpoint(route.endpointOrigin);
    const verifiedRoute = discovery.routes.find(
      (candidate) => candidate.stationPeerId === station.stationPeerId,
    );
    if (!verifiedRoute) throw new Error('mobile.launch.stationIdentityMismatch');
    const upgraded = addStationRoute(loaded, {
      identity: {
        stationPeerId: station.stationPeerId,
        url: station.url,
      },
      stationHostPublicKey: verifiedRoute.stationHostPublicKey,
      route: verifiedRoute,
    });
    if (!upgraded.ok) throw new Error(upgraded.error);
    loaded = await stationRegistryRuntime.update(() => upgraded.registry);
    await activateStationRouteBinding({
      stationPeerId: station.stationPeerId,
      routeId: verifiedRoute.routeId,
      routeRevision: activeStationEntry(loaded)?.routeRevision ?? 1,
    });
  } catch {
    loaded = await stationRegistryRuntime.update((current) => ({
      ...current,
      entries: current.entries.map((entry) => (
        entry.stationPeerId === station.stationPeerId
          ? { ...entry, online: false, lastCheckedAt: Date.now() }
          : entry
      )),
    }));
  }
  return loaded;
}

export function readStationRegistryProjection(): Promise<StoredStationRegistry> {
  return stationRegistryRuntime.read();
}

export function replaceStationRegistryProjection(
  registry: StoredStationRegistry,
): Promise<StoredStationRegistry> {
  return stationRegistryRuntime.update(() => registry);
}

export function updateStationRegistryProjection(
  updater: (current: StoredStationRegistry) => StoredStationRegistry,
): Promise<StoredStationRegistry> {
  return stationRegistryRuntime.update(updater);
}

export async function selectStationRouteRuntime(
  stationPeerId: string,
  routeId: string,
): Promise<StoredStationRegistry> {
  const current = await stationRegistryRuntime.read();
  const station = current.entries.find((entry) => entry.stationPeerId === stationPeerId);
  const route = station?.routes?.find((candidate) => candidate.routeId === routeId);
  if (!station || !route) throw new Error('mobile.launch.stationRouteUnavailable');
  const next = activateStationRoute(current, stationPeerId, routeId);
  const nextStation = next.entries.find((entry) => entry.stationPeerId === stationPeerId);
  if (!nextStation || nextStation.activeRouteId !== routeId) {
    throw new Error('mobile.launch.stationRouteUnavailable');
  }
  await verifyBoundStationRoute({
    stationPeerId,
    routeId,
    routeGeneration: route.routeGeneration,
    routeRevision: nextStation.routeRevision ?? 1,
    sourceRef: route.sourceRef,
    endpointOrigin: route.endpointOrigin,
  });
  try {
    return await stationRegistryRuntime.update(() => next);
  } catch (error) {
    const previous = activeStationRoute(station);
    if (previous) {
      await verifyBoundStationRoute({
        stationPeerId,
        routeId: previous.routeId,
        routeGeneration: previous.routeGeneration,
        routeRevision: station.routeRevision ?? 1,
        sourceRef: previous.sourceRef,
        endpointOrigin: previous.endpointOrigin,
      });
    }
    throw error;
  }
}

export function useStationRegistryProjection(): StoredStationRegistry {
  return useSyncExternalStore(
    stationRegistryRuntime.subscribe,
    stationRegistryRuntime.getSnapshot,
    stationRegistryRuntime.getSnapshot,
  );
}
