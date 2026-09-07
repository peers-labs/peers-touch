/**
 * Lifecycle reducer — pure state transitions for the mobile lifecycle kernel.
 *
 * All state mutations flow through this reducer so the kernel remains
 * predictable and inspectable.
 */

import type {
  LifecycleKernelState,
  LifecyclePhase,
  MobileRuntimeDescriptor,
  RuntimeBootstrapStatus,
  RuntimeEntry,
  RuntimeOperationResult,
  AggregateTeardownResult,
} from './types';

// --- Actions ---

export type LifecycleAction =
  | { type: 'REGISTER_RUNTIMES'; descriptors: readonly MobileRuntimeDescriptor[]; bootOrder: readonly string[] }
  | { type: 'BEGIN_BOOTSTRAP' }
  | { type: 'RUNTIME_BOOTSTRAPPING'; runtimeId: string }
  | { type: 'RUNTIME_READY'; runtimeId: string }
  | { type: 'RUNTIME_FAILED'; runtimeId: string; error: string }
  | { type: 'BOOTSTRAP_COMPLETE'; results: readonly RuntimeOperationResult[] }
  | { type: 'BEGIN_SUSPEND' }
  | { type: 'RUNTIME_SUSPENDED'; runtimeId: string }
  | { type: 'SUSPEND_COMPLETE' }
  | { type: 'BEGIN_RESUME' }
  | { type: 'RUNTIME_RESUMING'; runtimeId: string }
  | { type: 'RUNTIME_RESUMED'; runtimeId: string }
  | { type: 'RESUME_COMPLETE' }
  | { type: 'BEGIN_TEARDOWN' }
  | { type: 'RUNTIME_TEARING_DOWN'; runtimeId: string }
  | { type: 'RUNTIME_TORN_DOWN'; runtimeId: string }
  | { type: 'TEARDOWN_COMPLETE'; result: AggregateTeardownResult }
  | { type: 'SET_ERROR'; error: string };

// --- Initial State ---

export function initialLifecycleState(): LifecycleKernelState {
  return {
    phase: 'COLD',
    runtimes: new Map(),
    bootOrder: [],
    error: null,
  };
}

// --- Reducer ---

export function lifecycleReducer(
  state: LifecycleKernelState,
  action: LifecycleAction,
): LifecycleKernelState {
  switch (action.type) {
    case 'REGISTER_RUNTIMES': {
      const runtimes = new Map<string, RuntimeEntry>();
      for (const descriptor of action.descriptors) {
        runtimes.set(descriptor.id, {
          descriptor,
          status: 'pending',
          lastError: null,
        });
      }
      return {
        ...state,
        runtimes,
        bootOrder: [...action.bootOrder],
        error: null,
      };
    }

    case 'BEGIN_BOOTSTRAP':
      return { ...state, phase: 'BOOTSTRAPPING', error: null };

    case 'RUNTIME_BOOTSTRAPPING':
      return updateRuntimeStatus(state, action.runtimeId, 'bootstrapping');

    case 'RUNTIME_READY':
      return updateRuntimeStatus(state, action.runtimeId, 'ready');

    case 'RUNTIME_FAILED':
      return updateRuntimeEntry(state, action.runtimeId, {
        status: 'failed',
        lastError: action.error,
      });

    case 'BOOTSTRAP_COMPLETE':
      return {
        ...state,
        phase: 'ACTIVE',
      };

    case 'BEGIN_SUSPEND':
      return { ...state, phase: 'SUSPENDING' };

    case 'RUNTIME_SUSPENDED':
      return updateRuntimeStatus(state, action.runtimeId, 'suspended');

    case 'SUSPEND_COMPLETE':
      return { ...state, phase: 'SUSPENDED' };

    case 'BEGIN_RESUME':
      return { ...state, phase: 'RESUMING' };

    case 'RUNTIME_RESUMING':
      return updateRuntimeStatus(state, action.runtimeId, 'resuming');

    case 'RUNTIME_RESUMED':
      return updateRuntimeStatus(state, action.runtimeId, 'ready');

    case 'RESUME_COMPLETE':
      return { ...state, phase: 'ACTIVE' };

    case 'BEGIN_TEARDOWN':
      return { ...state, phase: 'TEARDOWN' };

    case 'RUNTIME_TEARING_DOWN':
      return updateRuntimeStatus(state, action.runtimeId, 'tearing-down');

    case 'RUNTIME_TORN_DOWN':
      return updateRuntimeStatus(state, action.runtimeId, 'torn-down');

    case 'TEARDOWN_COMPLETE':
      return {
        ...state,
        phase: 'COLD',
      };

    case 'SET_ERROR':
      return { ...state, error: action.error };

    default:
      return state;
  }
}

// --- Helpers ---

function updateRuntimeStatus(
  state: LifecycleKernelState,
  runtimeId: string,
  status: RuntimeBootstrapStatus,
): LifecycleKernelState {
  return updateRuntimeEntry(state, runtimeId, { status, lastError: null });
}

function updateRuntimeEntry(
  state: LifecycleKernelState,
  runtimeId: string,
  patch: Partial<Pick<RuntimeEntry, 'status' | 'lastError'>>,
): LifecycleKernelState {
  const existing = state.runtimes.get(runtimeId);
  if (!existing) return state;

  const runtimes = new Map(state.runtimes);
  runtimes.set(runtimeId, {
    ...existing,
    status: patch.status ?? existing.status,
    lastError: patch.lastError !== undefined ? patch.lastError : existing.lastError,
  });
  return { ...state, runtimes };
}

// --- Phase Transition Validation ---

const VALID_TRANSITIONS: ReadonlyMap<LifecyclePhase, readonly LifecyclePhase[]> = new Map([
  ['COLD', ['BOOTSTRAPPING']],
  ['BOOTSTRAPPING', ['ACTIVE', 'TEARDOWN']],
  ['ACTIVE', ['SUSPENDING', 'TEARDOWN']],
  ['SUSPENDING', ['SUSPENDED', 'TEARDOWN']],
  ['SUSPENDED', ['RESUMING', 'TEARDOWN']],
  ['RESUMING', ['ACTIVE', 'TEARDOWN']],
  ['TEARDOWN', ['COLD']],
]);

export function isValidPhaseTransition(from: LifecyclePhase, to: LifecyclePhase): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed !== undefined && allowed.includes(to);
}
