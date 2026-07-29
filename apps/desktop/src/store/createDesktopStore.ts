import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';

import { recordStoreUpdate, isStoreUpdateProfilingEnabled } from '../kernel/frontendRuntimeProfiler';
import { log } from '../utils/logger';

const MAX_CHANGED_KEYS = 40;
const FANOUT_WARN_THRESHOLD = 3;

function stateKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.keys(value as Record<string, unknown>);
}

function changedStateKeys<T>(before: T, after: T): string[] {
  const keys = new Set([...stateKeys(before), ...stateKeys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    const prev = (before as Record<string, unknown>)[key];
    const next = (after as Record<string, unknown>)[key];
    if (!Object.is(prev, next)) changed.push(key);
    if (changed.length >= MAX_CHANGED_KEYS) break;
  }
  return changed;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function createDesktopStore<T>(
  storeName: string,
  initializer: StateCreator<T, [], []>,
): UseBoundStore<StoreApi<T>> {
  return create<T>()((set, get, api) => {
    let activeListenerCount = 0;
    const subscribe = api.subscribe;
    api.subscribe = ((...args: Parameters<typeof subscribe>) => {
      activeListenerCount += 1;
      const unsubscribe = subscribe(...args);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        activeListenerCount = Math.max(0, activeListenerCount - 1);
        unsubscribe();
      };
    }) as typeof api.subscribe;

    const profilingEnabled = isStoreUpdateProfilingEnabled();
    const instrumentedSet: typeof set = profilingEnabled
      ? ((...args: Parameters<typeof set>) => {
          const before = get();
          const start = nowMs();
          (set as (...nextArgs: Parameters<typeof set>) => void)(...args);
          const changedKeys = changedStateKeys(before, get());
          if (changedKeys.length === 0) return;
          recordStoreUpdate({
            changedKeys,
            durationMs: nowMs() - start,
            fanout: activeListenerCount,
            listenerCount: activeListenerCount,
            owner: storeName,
            store: storeName,
          });
          if (activeListenerCount > FANOUT_WARN_THRESHOLD) {
            log.warn('storeFanoutGuard', 'dispatch fanout exceeds threshold', {
              store: storeName,
              fanout: activeListenerCount,
              threshold: FANOUT_WARN_THRESHOLD,
              changedKeys,
            });
          }
        }) as typeof set
      : set;
    return initializer(instrumentedSet, get, api);
  });
}
