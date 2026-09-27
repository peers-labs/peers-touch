import { useSyncExternalStore } from 'react';

import {
  emptyStationRegistry,
  loadStationRegistry,
  persistStationRegistry,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
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

export function bootstrapStationRuntime(): Promise<StoredStationRegistry> {
  return stationRegistryRuntime.bootstrap();
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

export function useStationRegistryProjection(): StoredStationRegistry {
  return useSyncExternalStore(
    stationRegistryRuntime.subscribe,
    stationRegistryRuntime.getSnapshot,
    stationRegistryRuntime.getSnapshot,
  );
}
