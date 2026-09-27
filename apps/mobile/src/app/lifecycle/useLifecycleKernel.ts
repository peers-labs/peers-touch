/**
 * React hook for observing the MobileLifecycleKernel state.
 *
 * Uses useSyncExternalStore so that lifecycle phase changes
 * trigger re-renders only when the snapshot identity changes.
 */

import { useCallback, useSyncExternalStore } from 'react';

import type { LifecycleKernelState } from './types';
import { getMobileLifecycleKernel } from './MobileLifecycleKernel';
import { readRuntimeAvailability } from './runtimeAvailability';

/**
 * Subscribe to the full lifecycle kernel state.
 * Returns a stable snapshot reference that only changes when the kernel dispatches.
 */
export function useLifecycleKernel(): LifecycleKernelState {
  const kernel = getMobileLifecycleKernel();

  const subscribe = useCallback(
    (listener: () => void) => kernel.subscribe(listener),
    [kernel],
  );

  const getSnapshot = useCallback(
    () => kernel.getState(),
    [kernel],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to only the lifecycle phase.
 * Useful for components that only need to know if the app is active/suspended.
 */
export function useLifecyclePhase(): LifecycleKernelState['phase'] {
  const kernel = getMobileLifecycleKernel();

  const subscribe = useCallback(
    (listener: () => void) => kernel.subscribe(listener),
    [kernel],
  );

  const getSnapshot = useCallback(
    () => kernel.getPhase(),
    [kernel],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Returns the set of runtime IDs that are currently in 'ready' status.
 * Useful for checking route availability.
 */
export function useReadyRuntimeIds(): ReadonlySet<string> {
  const state = useLifecycleKernel();
  const readyIds = new Set<string>();
  for (const id of state.runtimes.keys()) {
    if (readRuntimeAvailability(state, id)?.status === 'ready') {
      readyIds.add(id);
    }
  }
  return readyIds;
}
