/**
 * Barrel re-exports for the lifecycle kernel module.
 */

export { MobileLifecycleKernel, getMobileLifecycleKernel, destroyMobileLifecycleKernel } from './MobileLifecycleKernel';
export {
  lifecycleReducer,
  initialLifecycleState,
  isValidLaunchStateTransition,
  isValidPhaseTransition,
} from './lifecycleReducer';
export { topologicalSortRuntimes, reverseTeardownOrder } from './topologicalSort';
export type {
  LifecyclePhase,
  LifecycleTransitionReason,
  MobileLaunchState,
  RuntimeBootstrapStatus,
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
  AggregateTeardownResult,
  LifecycleKernelSnapshot,
  LifecycleKernelState,
  LifecycleRuntimeGraphDependencies,
  LifecycleEvent,
  LifecycleEventListener,
  RuntimeLifecycleSnapshot,
  RuntimeEntry,
} from './types';
export { useLifecycleKernel, useLifecyclePhase, useReadyRuntimeIds } from './useLifecycleKernel';
export type { LifecycleAction } from './lifecycleReducer';
export type { TopologicalSortResult } from './topologicalSort';
