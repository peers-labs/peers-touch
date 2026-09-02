/**
 * MobileLifecycleKernel — the central lifecycle state machine for the mobile app.
 *
 * Orchestrates all MobileRuntimeDescriptors through ordered lifecycle phases:
 * COLD → BOOTSTRAPPING → ACTIVE → SUSPENDING → SUSPENDED → RESUMING → TEARDOWN
 *
 * Bootstrap order is computed from descriptor `dependsOn` edges via topological sort.
 * Teardown and suspend run in reverse order. Resume runs in bootstrap order.
 *
 * The kernel is a singleton per app process. React components observe it through
 * useSyncExternalStore via the exported hook.
 */

import type {
  AggregateTeardownResult,
  LifecycleEvent,
  LifecycleEventListener,
  LifecycleKernelState,
  LifecyclePhase,
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
} from './types';
import {
  initialLifecycleState,
  isValidPhaseTransition,
  lifecycleReducer,
  type LifecycleAction,
} from './lifecycleReducer';
import { reverseTeardownOrder, topologicalSortRuntimes } from './topologicalSort';

export class MobileLifecycleKernel {
  private state: LifecycleKernelState;
  private readonly stateListeners = new Set<() => void>();
  private readonly eventListeners = new Set<LifecycleEventListener>();
  private descriptors: readonly MobileRuntimeDescriptor[] = [];

  constructor() {
    this.state = initialLifecycleState();
  }

  // --- Public Read API ---

  getState(): LifecycleKernelState {
    return this.state;
  }

  getPhase(): LifecyclePhase {
    return this.state.phase;
  }

  /**
   * Subscribe to state snapshot changes (for useSyncExternalStore).
   */
  subscribe(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * Subscribe to structured lifecycle events (for diagnostics / logging).
   */
  onEvent(listener: LifecycleEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // --- Lifecycle Operations ---

  /**
   * Register runtime descriptors and compute bootstrap order.
   * Must be called before bootstrap(). Can only be called in COLD phase.
   */
  register(descriptors: readonly MobileRuntimeDescriptor[]): void {
    if (this.state.phase !== 'COLD') {
      throw new Error(
        `Cannot register runtimes in phase ${this.state.phase}; expected COLD`,
      );
    }

    const sortResult = topologicalSortRuntimes(descriptors);
    if (sortResult.hasCycle) {
      const participants = sortResult.cycleParticipants.join(' → ');
      throw new Error(
        `Dependency cycle detected among runtimes: ${participants}`,
      );
    }

    this.descriptors = descriptors;
    this.dispatch({
      type: 'REGISTER_RUNTIMES',
      descriptors,
      bootOrder: sortResult.order,
    });
  }

  /**
   * Bootstrap all registered runtimes in topological order.
   * Transitions: COLD → BOOTSTRAPPING → ACTIVE.
   *
   * If a runtime fails, its dependents are skipped (marked failed).
   * The kernel still transitions to ACTIVE so the app can render
   * a degraded UI.
   */
  async bootstrap(): Promise<readonly RuntimeOperationResult[]> {
    this.assertPhaseTransition('BOOTSTRAPPING');
    this.dispatch({ type: 'BEGIN_BOOTSTRAP' });

    const results: RuntimeOperationResult[] = [];
    const failed = new Set<string>();

    for (const runtimeId of this.state.bootOrder) {
      const entry = this.state.runtimes.get(runtimeId);
      if (!entry) continue;

      // Skip if any dependency failed
      const hasFailed = entry.descriptor.dependsOn.some((dep) => failed.has(dep));
      if (hasFailed) {
        const result: RuntimeOperationResult = {
          runtimeId,
          success: false,
          errorMessage: 'Skipped: dependency failed',
          durationMs: 0,
        };
        results.push(result);
        failed.add(runtimeId);
        this.dispatch({
          type: 'RUNTIME_FAILED',
          runtimeId,
          error: 'Skipped: dependency failed',
        });
        continue;
      }

      this.dispatch({ type: 'RUNTIME_BOOTSTRAPPING', runtimeId });
      const start = performance.now();

      try {
        await entry.descriptor.bootstrap();
        const durationMs = performance.now() - start;
        results.push({ runtimeId, success: true, durationMs });
        this.dispatch({ type: 'RUNTIME_READY', runtimeId });
        this.emitEvent({ kind: 'runtime-status-changed', runtimeId, status: 'ready' });
      } catch (error) {
        const durationMs = performance.now() - start;
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({ runtimeId, success: false, errorMessage, durationMs });
        failed.add(runtimeId);
        this.dispatch({ type: 'RUNTIME_FAILED', runtimeId, error: errorMessage });
        this.emitEvent({ kind: 'runtime-status-changed', runtimeId, status: 'failed' });
      }
    }

    this.dispatch({ type: 'BOOTSTRAP_COMPLETE', results });
    this.emitEvent({ kind: 'phase-changed', phase: 'ACTIVE', previousPhase: 'BOOTSTRAPPING' });
    this.emitEvent({ kind: 'bootstrap-complete', results });

    return results;
  }

  /**
   * Suspend all active runtimes in reverse bootstrap order.
   * Transitions: ACTIVE → SUSPENDING → SUSPENDED.
   */
  async suspend(): Promise<void> {
    this.assertPhaseTransition('SUSPENDING');
    this.dispatch({ type: 'BEGIN_SUSPEND' });

    const teardownOrder = reverseTeardownOrder(this.state.bootOrder);

    for (const runtimeId of teardownOrder) {
      const entry = this.state.runtimes.get(runtimeId);
      if (!entry || entry.status !== 'ready') continue;

      try {
        await entry.descriptor.suspend();
        this.dispatch({ type: 'RUNTIME_SUSPENDED', runtimeId });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.dispatch({ type: 'RUNTIME_FAILED', runtimeId, error: errorMessage });
      }
    }

    this.dispatch({ type: 'SUSPEND_COMPLETE' });
    this.emitEvent({ kind: 'phase-changed', phase: 'SUSPENDED', previousPhase: 'SUSPENDING' });
  }

  /**
   * Resume all suspended runtimes in bootstrap order.
   * Transitions: SUSPENDED → RESUMING → ACTIVE.
   */
  async resume(): Promise<void> {
    this.assertPhaseTransition('RESUMING');
    this.dispatch({ type: 'BEGIN_RESUME' });

    for (const runtimeId of this.state.bootOrder) {
      const entry = this.state.runtimes.get(runtimeId);
      if (!entry || entry.status !== 'suspended') continue;

      this.dispatch({ type: 'RUNTIME_RESUMING', runtimeId });

      try {
        await entry.descriptor.resume();
        this.dispatch({ type: 'RUNTIME_RESUMED', runtimeId });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.dispatch({ type: 'RUNTIME_FAILED', runtimeId, error: errorMessage });
      }
    }

    this.dispatch({ type: 'RESUME_COMPLETE' });
    this.emitEvent({ kind: 'phase-changed', phase: 'ACTIVE', previousPhase: 'RESUMING' });
  }

  /**
   * Teardown all runtimes in reverse bootstrap order.
   * Can be called from ACTIVE, SUSPENDED, or BOOTSTRAPPING.
   * Transitions: current → TEARDOWN → COLD.
   *
   * Collects and aggregates all teardown results.
   */
  async teardown(): Promise<AggregateTeardownResult> {
    const previousPhase = this.state.phase;
    this.assertPhaseTransition('TEARDOWN');
    this.dispatch({ type: 'BEGIN_TEARDOWN' });

    const teardownOrder = reverseTeardownOrder(this.state.bootOrder);
    const results: RuntimeOperationResult[] = [];
    const totalStart = performance.now();

    for (const runtimeId of teardownOrder) {
      const entry = this.state.runtimes.get(runtimeId);
      if (!entry) continue;
      // Skip runtimes that were never bootstrapped
      if (entry.status === 'pending') continue;

      this.dispatch({ type: 'RUNTIME_TEARING_DOWN', runtimeId });

      try {
        const result = await entry.descriptor.teardown();
        results.push(result);
        this.dispatch({ type: 'RUNTIME_TORN_DOWN', runtimeId });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({
          runtimeId,
          success: false,
          errorMessage,
          durationMs: 0,
        });
        this.dispatch({ type: 'RUNTIME_TORN_DOWN', runtimeId });
      }
    }

    const aggregateResult: AggregateTeardownResult = {
      results,
      allSuccessful: results.every((r) => r.success),
      totalDurationMs: performance.now() - totalStart,
    };

    this.dispatch({ type: 'TEARDOWN_COMPLETE', result: aggregateResult });
    this.emitEvent({ kind: 'phase-changed', phase: 'COLD', previousPhase });
    this.emitEvent({ kind: 'teardown-complete', result: aggregateResult });

    return aggregateResult;
  }

  /**
   * Reset the kernel to COLD state. Only valid after teardown completes.
   * Allows re-registration and re-bootstrap (e.g. after logout → re-login).
   */
  reset(): void {
    if (this.state.phase !== 'COLD') {
      throw new Error(
        `Cannot reset kernel in phase ${this.state.phase}; teardown first`,
      );
    }
    this.descriptors = [];
    this.state = initialLifecycleState();
    this.notifyStateListeners();
  }

  // --- Internal ---

  private dispatch(action: LifecycleAction): void {
    this.state = lifecycleReducer(this.state, action);
    this.notifyStateListeners();
  }

  private notifyStateListeners(): void {
    this.stateListeners.forEach((listener) => listener());
  }

  private emitEvent(event: LifecycleEvent): void {
    this.eventListeners.forEach((listener) => listener(event));
  }

  private assertPhaseTransition(target: LifecyclePhase): void {
    if (!isValidPhaseTransition(this.state.phase, target)) {
      throw new Error(
        `Invalid phase transition: ${this.state.phase} → ${target}`,
      );
    }
  }
}

// --- Singleton ---

let kernelInstance: MobileLifecycleKernel | null = null;

/**
 * Get or create the singleton MobileLifecycleKernel.
 * The kernel persists for the lifetime of the app process.
 */
export function getMobileLifecycleKernel(): MobileLifecycleKernel {
  if (!kernelInstance) {
    kernelInstance = new MobileLifecycleKernel();
  }
  return kernelInstance;
}

/**
 * Destroy the singleton kernel (for testing or full app teardown).
 */
export function destroyMobileLifecycleKernel(): void {
  kernelInstance = null;
}
