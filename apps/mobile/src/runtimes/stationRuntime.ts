import { useSyncExternalStore } from 'react';

import {
  activeStationEntry,
  activeStationRoute,
  activateStationRoute,
  emptyStationRegistry,
  loadStationRegistry,
  persistStationRegistry,
  type MobileStationEntry,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import {
  verifyBoundStationRoute,
  type StationIdentityResult,
} from '../features/station/stationConnection';
import {
  readStationRouteBinding,
  refreshStationRouteBinding,
  restoreStationRouteBinding,
  type StationRouteRefreshProjection,
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
let routeBootstrapInFlight: Promise<StoredStationRegistry> | null = null;
let routeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let routeRefreshUnsubscribe: (() => void) | null = null;
let routeRefreshInFlight: Promise<void> | null = null;
let routeRenewalEpoch = 0;

export function startStationRouteRenewal(): void {
  if (routeRefreshUnsubscribe) return;
  const epoch = ++routeRenewalEpoch;
  const schedule = () => {
    if (epoch !== routeRenewalEpoch) return;
    if (routeRefreshTimer !== null) clearTimeout(routeRefreshTimer);
    routeRefreshTimer = null;
    const station = activeStationEntry(stationRegistryRuntime.getSnapshot());
    const expiry = station && activeStationRoute(station)?.attestationExpiresAtUnixMs;
    if (!expiry) return;
    routeRefreshTimer = setTimeout(() => {
      routeRefreshTimer = null;
      void refreshActiveStationRoute().then(schedule, () => {
        if (epoch === routeRenewalEpoch) {
          routeRefreshTimer = setTimeout(schedule, 10_000);
        }
      });
    }, Math.max(1000, expiry - Date.now() - 60_000));
  };
  routeRefreshUnsubscribe = stationRegistryRuntime.subscribe(schedule);
  schedule();
}

export function stopStationRouteRenewal(): void {
  ++routeRenewalEpoch;
  routeRefreshUnsubscribe?.();
  routeRefreshUnsubscribe = null;
  if (routeRefreshTimer !== null) clearTimeout(routeRefreshTimer);
  routeRefreshTimer = null;
}

async function persistBoundRoute(
  stationPeerId: string,
  routeId: string,
  revision: number,
  refreshed: StationRouteRefreshProjection,
): Promise<StoredStationRegistry> {
  if (
    refreshed.binding.stationPeerId !== stationPeerId
    || refreshed.binding.routeId !== routeId
    || refreshed.route.stationPeerId !== stationPeerId
    || refreshed.route.routeId !== routeId
    || refreshed.binding.routeGeneration !== refreshed.route.routeGeneration
    || refreshed.binding.routeRevision < revision
  ) throw new Error('mobile.launch.stationIdentityInvalid');
  return stationRegistryRuntime.update((current) => {
    const selected = activeStationEntry(current);
    if (
      selected?.stationPeerId !== stationPeerId
      || selected.activeRouteId !== routeId
      || (selected.routeRevision ?? 1) !== revision
    ) throw new Error('mobile.launch.stationRouteChanged');
    const previous = activeStationRoute(selected);
    if (
      !previous
      || previous.routeGeneration !== refreshed.route.routeGeneration
      || previous.nodePeerId !== refreshed.route.nodePeerId
      || previous.authorizationEpoch !== refreshed.route.authorizationEpoch
      || (selected.pinnedStationRootPublicKey
        && selected.pinnedStationRootPublicKey.join(',')
          !== refreshed.route.stationRootPublicKey.join(','))
    ) throw new Error('mobile.launch.stationIdentityInvalid');
    return {
      ...current,
      entries: current.entries.map((entry) => entry !== selected ? entry : ({
        ...entry,
        online: true,
        lastCheckedAt: Date.now(),
        routeRevision: refreshed.binding.routeRevision,
        routes: entry.routes?.map((candidate) => candidate.routeId !== routeId
          ? candidate
          : {
            ...candidate,
            ...refreshed.route,
            lastVerifiedAt: Date.now(),
            health: 'available' as const,
          }),
      })),
    };
  });
}

export function refreshActiveStationRoute(): Promise<void> {
  if (routeRefreshInFlight) return routeRefreshInFlight;
  const operation = (async () => {
    const registry = await stationRegistryRuntime.read();
    const station = activeStationEntry(registry);
    const route = station && activeStationRoute(station);
    if (!station || !route) return;
    const revision = station.routeRevision ?? 1;
    const current = await readStationRouteBinding();
    const refreshed = current?.stationPeerId === station.stationPeerId
      && current.routeId === route.routeId
      && current.routeRevision === revision
      ? await refreshStationRouteBinding({
        stationPeerId: station.stationPeerId,
        routeId: route.routeId,
        routeRevision: revision,
      })
      : await restoreStationRouteBinding({
        stationPeerId: station.stationPeerId,
        routeId: route.routeId,
        routeGeneration: route.routeGeneration,
        routeRevision: revision,
        sourceRef: route.sourceRef,
        endpointOrigin: route.endpointOrigin,
      });
    await persistBoundRoute(station.stationPeerId, route.routeId, revision, refreshed);
  })();
  routeRefreshInFlight = operation.finally(() => {
    if (routeRefreshInFlight === pending) routeRefreshInFlight = null;
  });
  const pending = routeRefreshInFlight;
  return pending;
}

export function bootstrapStationRuntime(): Promise<StoredStationRegistry> {
  if (routeBootstrapInFlight) return routeBootstrapInFlight;
  const pending = restoreActiveStationRoute().finally(() => {
    if (routeBootstrapInFlight === pending) routeBootstrapInFlight = null;
  });
  routeBootstrapInFlight = pending;
  return pending;
}

async function restoreActiveStationRoute(): Promise<StoredStationRegistry> {
  if (routeRefreshInFlight) await routeRefreshInFlight.catch(() => undefined);
  let loaded = await stationRegistryRuntime.bootstrap();
  // A pre-login link owns its native route until commit or cancellation.
  const { hasPendingDeviceLink } = await import('./deviceLinkRuntime');
  if (hasPendingDeviceLink()) return loaded;
  const station = activeStationEntry(loaded);
  const route = station ? activeStationRoute(station) : null;
  if (!station || !route) return loaded;
  try {
    const revision = station.routeRevision ?? 1;
    const restored = await restoreStationRouteBinding({
      stationPeerId: station.stationPeerId,
      routeId: route.routeId,
      routeGeneration: route.routeGeneration,
      routeRevision: revision,
      sourceRef: route.sourceRef,
      endpointOrigin: route.endpointOrigin,
    });
    return await persistBoundRoute(station.stationPeerId, route.routeId, revision, restored);
  } catch (error) {
    loaded = await stationRegistryRuntime.update((current) => ({
      ...current,
      entries: current.entries.map((entry) => (
        entry.stationPeerId === station.stationPeerId
          ? { ...entry, online: false, lastCheckedAt: Date.now() }
          : entry
      )),
    }));
    throw error;
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

export function verifyStationEntryRuntime(
  station: MobileStationEntry,
  verifyRoute: typeof verifyBoundStationRoute = verifyBoundStationRoute,
): Promise<StationIdentityResult> {
  const route = activeStationRoute(station);
  if (!route) throw new Error('mobile.launch.stationRouteUnavailable');
  return verifyRoute({
    stationPeerId: station.stationPeerId,
    routeId: route.routeId,
    routeGeneration: route.routeGeneration,
    routeRevision: station.routeRevision ?? 1,
    sourceRef: route.sourceRef,
    endpointOrigin: route.endpointOrigin,
  });
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
