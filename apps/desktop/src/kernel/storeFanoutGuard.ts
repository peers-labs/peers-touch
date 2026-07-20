// StoreFanoutGuard — monitors and constrains store dispatch fanout.
//
// Contract: design.md §5 F-5 + execution-plan Phase 1d + D-08/D-12.
// Rule: fanout ≤ 3 components per dispatch. Initial rollout: warn-only.

import { log } from '../utils/logger';

// ── Configuration ─────────────────────────────────────────────────────────

const FANOUT_THRESHOLD = 3;
let blockingEnabled = false;

export function enableBlocking(): void {
  blockingEnabled = true;
}

export function isBlockingEnabled(): boolean {
  return blockingEnabled;
}

// ── Dispatch tracking ─────────────────────────────────────────────────────

interface DispatchRecord {
  store: string;
  action: string;
  fanoutCount: number;
  timestamp: number;
  exceeded: boolean;
}

const recentDispatches: DispatchRecord[] = [];
const MAX_HISTORY = 200;

export function recordDispatch(store: string, action: string, fanoutCount: number): DispatchRecord {
  const record: DispatchRecord = {
    store,
    action,
    fanoutCount,
    timestamp: Date.now(),
    exceeded: fanoutCount > FANOUT_THRESHOLD,
  };

  if (record.exceeded) {
    log.warn('storeFanoutGuard', `fanout exceeded: ${store}.${action} triggered ${fanoutCount} re-renders (threshold: ${FANOUT_THRESHOLD})`, {
      store,
      action,
      fanoutCount,
      threshold: FANOUT_THRESHOLD,
    });
  }

  recentDispatches.push(record);
  if (recentDispatches.length > MAX_HISTORY) {
    recentDispatches.shift();
  }

  return record;
}

// ── Query ─────────────────────────────────────────────────────────────────

export function getRecentDispatches(): ReadonlyArray<DispatchRecord> {
  return recentDispatches;
}

export function getExceededDispatches(): ReadonlyArray<DispatchRecord> {
  return recentDispatches.filter((r) => r.exceeded);
}

export function getFanoutStats(): { total: number; exceeded: number; maxFanout: number } {
  let maxFanout = 0;
  let exceeded = 0;
  for (const r of recentDispatches) {
    if (r.fanoutCount > maxFanout) maxFanout = r.fanoutCount;
    if (r.exceeded) exceeded++;
  }
  return { total: recentDispatches.length, exceeded, maxFanout };
}

// ── Zustand middleware ────────────────────────────────────────────────────

type SetState<T> = (partial: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean) => void;
type GetState<T> = () => T;
type StoreApi<T> = { setState: SetState<T>; getState: GetState<T>; subscribe: (listener: (state: T, prevState: T) => void) => () => void };

export function fanoutGuardMiddleware<T>(storeName: string) {
  return (config: (set: SetState<T>, get: GetState<T>, api: StoreApi<T>) => T) =>
    (set: SetState<T>, get: GetState<T>, api: StoreApi<T>): T => {
      let subscriberCount = 0;

      const originalSubscribe = api.subscribe.bind(api);
      api.subscribe = (listener: (state: T, prevState: T) => void) => {
        subscriberCount++;
        const unsub = originalSubscribe(listener);
        return () => {
          subscriberCount--;
          unsub();
        };
      };

      const guardedSet: SetState<T> = (partial, replace) => {
        set(partial, replace);
        recordDispatch(storeName, 'setState', subscriberCount);
      };

      return config(guardedSet, get, api);
    };
}

// ── Test utilities ────────────────────────────────────────────────────────

export function _resetGuard(): void {
  recentDispatches.length = 0;
  blockingEnabled = false;
}
