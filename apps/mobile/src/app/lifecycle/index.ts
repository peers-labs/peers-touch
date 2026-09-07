/**
 * Barrel re-exports for the lifecycle kernel module.
 */

export { MobileLifecycleKernel, getMobileLifecycleKernel, destroyMobileLifecycleKernel } from './MobileLifecycleKernel';
export { lifecycleReducer, initialLifecycleState, isValidPhaseTransition } from './lifecycleReducer';
export { topologicalSortRuntimes, reverseTeardownOrder } from './topologicalSort';
export type {
  LifecyclePhase,
  RuntimeBootstrapStatus,
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
  AggregateTeardownResult,
  LifecycleKernelState,
  LifecycleEvent,
  LifecycleEventListener,
  RuntimeEntry,
} from './types';
export { useLifecycleKernel, useLifecyclePhase, useReadyRuntimeIds } from './useLifecycleKernel';
export type { LifecycleAction } from './lifecycleReducer';
export type { TopologicalSortResult } from './topologicalSort';
