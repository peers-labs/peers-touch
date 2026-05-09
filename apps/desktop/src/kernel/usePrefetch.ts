// usePrefetch — opt-in prefetch hook for "deep section" data that is
// too heavy to bootstrap eagerly but still benefits from being warm by
// the time the user clicks into it.
//
// Use case: the Settings page has many sections (statistics, applets,
// tools, help). We don't want to fetch them all at boot, but we also
// don't want the first click to wait. `usePrefetch` queues the loader
// onto an idle window and exposes a small in-memory cache so the
// section can render synchronously when warm.
//
// This is NOT a replacement for runtimes — runtimes own *long-lived*
// projection state. usePrefetch is for *one-shot, page-local* data.

import { useEffect, useState } from 'react';

import { scheduleIdle } from './boot';
import { log } from '../utils/logger';

type PrefetchEntry<T> =
  | { state: 'pending'; promise: Promise<T> }
  | { state: 'fulfilled'; value: T }
  | { state: 'rejected'; error: unknown };

const cache = new Map<string, PrefetchEntry<unknown>>();
const subscribers = new Map<string, Set<() => void>>();

function notify(key: string): void {
  const subs = subscribers.get(key);
  if (!subs) return;
  for (const cb of subs) {
    try {
      cb();
    } catch {
      // Subscriber errors must not break the prefetch loop.
    }
  }
}

function subscribe(key: string, cb: () => void): () => void {
  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(cb);
  return () => {
    const s = subscribers.get(key);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) subscribers.delete(key);
  };
}

/**
 * Schedule `loader` onto an idle window if the cache is empty for `key`.
 * Returns a cancel function that aborts the idle scheduler — it does NOT
 * cancel an in-flight promise (intentional: the result still warms the
 * cache for the next caller).
 */
export function prefetch<T>(key: string, loader: () => Promise<T>): () => void {
  if (cache.has(key)) return () => undefined;
  return scheduleIdle(() => {
    if (cache.has(key)) return;
    const promise = (async () => {
      try {
        const value = await loader();
        cache.set(key, { state: 'fulfilled', value });
        notify(key);
        return value;
      } catch (error) {
        cache.set(key, { state: 'rejected', error });
        notify(key);
        log.warn('prefetch', `${key} failed`, error);
        throw error;
      }
    })();
    cache.set(key, { state: 'pending', promise });
  });
}

export interface PrefetchedValue<T> {
  /** Fulfilled value, if any. */
  value: T | undefined;
  /** Whether the loader is in-flight. */
  loading: boolean;
  /** Error from the most recent attempt, if any. */
  error: unknown;
  /** Force-reload (bypasses cache). */
  reload(): void;
}

/**
 * Read the prefetched value for `key`. If the cache is empty, schedule
 * the loader onto an idle window and return `loading: true`. Re-renders
 * when the cache fulfills.
 */
export function usePrefetch<T>(
  key: string,
  loader: () => Promise<T>,
): PrefetchedValue<T> {
  const [, force] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribe(key, () => force((n) => n + 1));
    if (!cache.has(key)) prefetch(key, loader);
    return unsubscribe;
    // We intentionally exclude `loader` from deps: the caller is
    // expected to memoize it, and the cache key is the contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const entry = cache.get(key) as PrefetchEntry<T> | undefined;
  return {
    value: entry?.state === 'fulfilled' ? entry.value : undefined,
    loading: entry?.state === 'pending' || entry === undefined,
    error: entry?.state === 'rejected' ? entry.error : undefined,
    reload: () => {
      cache.delete(key);
      prefetch(key, loader);
    },
  };
}

export function _resetPrefetchCacheForTests(): void {
  cache.clear();
  subscribers.clear();
}
