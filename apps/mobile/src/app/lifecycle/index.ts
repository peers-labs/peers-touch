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
export { readRuntimeAvailability } from './runtimeAvailability';
export type {
  LifecyclePhase,
  LifecycleTransitionReason,
  DraftDisposition,
  RuntimeTeardownContext,
  MobileLaunchState,
  RuntimeBootstrapStatus,
  MobileRuntimeDescriptor,
  MobileRuntimeContext,
  RuntimeReadiness,
  RuntimeReadinessUpdate,
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
