/**
 * Sole owner of the Mobile runtime graph and its lifecycle transitions.
 *
 * All graph operations are serialized here. React, native event adapters, and
 * Acceptance may request transitions, but none of them register, bootstrap,
 * restart, or tear down runtimes directly.
 */

import type {
  AggregateTeardownResult,
  LifecycleEvent,
  LifecycleEventListener,
  LifecycleKernelSnapshot,
  LifecycleKernelState,
  LifecyclePhase,
  LifecycleRuntimeGraphDependencies,
  LifecycleTransitionReason,
  MobileLaunchState,
  MobileRuntimeDescriptor,
  MobileRuntimeContext,
  RuntimeReadinessUpdate,
  RuntimeTeardownContext,
  DraftDisposition,
  RuntimeOperationResult,
} from './types';
import {
  initialLifecycleState,
  isValidLaunchStateTransition,
  isValidPhaseTransition,
  lifecycleReducer,
  type LifecycleAction,
} from './lifecycleReducer';
import { reverseTeardownOrder, topologicalSortRuntimes } from './topologicalSort';
import { publicRuntimeErrorKey, readRuntimeAvailability } from './runtimeAvailability';

type RuntimeOperation = 'bootstrap' | 'suspend' | 'resume' | 'teardown';

const RUNTIME_OPERATION_TIMEOUT_MS: Readonly<Record<RuntimeOperation, number>> = {
  bootstrap: 5_000,
  suspend: 2_000,
  resume: 5_000,
  teardown: 5_000,
};

const GENERATION_OPERATION_TIMEOUT_MS = 5_000;

export class MobileLifecycleKernel {
  private state: LifecycleKernelState;
  private readonly stateListeners = new Set<() => void>();
  private readonly eventListeners = new Set<LifecycleEventListener>();
  private graphDependencies: LifecycleRuntimeGraphDependencies | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private graphIncarnation = 0;
  private readinessRevision = 0;
  private readonly readinessUpdates = new Map<string, number>();
  private readonly readinessTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

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

  getSnapshot(): LifecycleKernelSnapshot {
    const runtimes = this.state.bootOrder.map((runtimeId) => {
      const entry = this.state.runtimes.get(runtimeId);
      if (!entry) {
        throw new Error(`mobile.lifecycle.runtimeMissing:${runtimeId}`);
      }
      return Object.freeze(readRuntimeAvailability(this.state, runtimeId)!);
    });

    return Object.freeze({
      phase: this.state.phase,
      launchState: this.state.launchState,
      generation: this.state.generation,
      bootOrder: Object.freeze([...this.state.bootOrder]),
      runtimes: Object.freeze(runtimes),
      errorKey: publicLifecycleErrorKey(this.state.error),
    });
  }

  subscribe(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onEvent(listener: LifecycleEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  transitionLaunchState(launchState: MobileLaunchState): void {
    const previousLaunchState = this.state.launchState;
    if (previousLaunchState === launchState) return;
    if (!isValidLaunchStateTransition(previousLaunchState, launchState)) {
      throw new Error(
        `mobile.lifecycle.invalidLaunchTransition:${previousLaunchState}->${launchState}`,
      );
    }
    this.dispatch({ type: 'SET_LAUNCH_STATE', launchState });
    this.emitEvent({
      kind: 'launch-state-changed',
      launchState,
      previousLaunchState,
    });
  }

  // --- Runtime Graph Ownership ---

  configureRuntimeGraph(dependencies: LifecycleRuntimeGraphDependencies): void {
    if (
      this.graphDependencies
      && this.state.phase !== 'COLD'
      && !sameGraphDependencies(this.graphDependencies, dependencies)
    ) {
      throw new Error('mobile.lifecycle.graphAlreadyConfigured');
    }
    this.graphDependencies = dependencies;
  }

  startRuntimeGraph(
    reason: LifecycleTransitionReason = 'app-start',
  ): Promise<LifecycleKernelSnapshot> {
    return this.enqueueOperation(async () => {
      if (this.state.phase === 'ACTIVE' || this.state.phase === 'SUSPENDED') {
        return this.getSnapshot();
      }
      if (this.state.phase !== 'COLD') {
        throw new Error(`mobile.lifecycle.startInvalidPhase:${this.state.phase}`);
      }

      const dependencies = this.requireGraphDependencies();
      const generation = await withTimeout(
        dependencies.readGeneration(),
        GENERATION_OPERATION_TIMEOUT_MS,
        'mobile.lifecycle.readGenerationTimedOut',
      );
      this.applyGeneration(generation, reason, false);
      await this.startRuntimeGraphNow();
      await this.reconcileLaunchStateAfterRuntime(reason);
      return this.getSnapshot();
    });
  }

  stopRuntimeGraph(
    reason: LifecycleTransitionReason = 'app-unmount',
  ): Promise<AggregateTeardownResult> {
    return this.enqueueOperation(async () => {
      if (this.state.phase === 'COLD') return emptyTeardownResult();
      return this.teardownRuntimes({ reason });
    });
  }

  restartRuntimeGraph(
    reason: LifecycleTransitionReason = 'acceptance-restart',
  ): Promise<LifecycleKernelSnapshot> {
    return this.enqueueOperation(async () => {
      const teardown = await this.fenceAndTeardown({ reason });
      if (!teardown.allSuccessful) {
        throw new Error('mobile.lifecycle.teardownIncomplete');
      }
      this.reset();
      await this.startRuntimeGraphNow();
      await this.reconcileLaunchStateAfterRuntime(reason);
      return this.getSnapshot();
    });
  }

  /**
   * Fence an actor/Station generation before the supplied owner mutation can
   * remove credentials, caches, or projections.
   */
  transitionScope<T>(
    reason: Extract<
      LifecycleTransitionReason,
      'station-replace' | 'actor-replace' | 'logout' | 'revocation'
    >,
    transition: () => Promise<T>,
    options: {
      readonly restart?: boolean;
      readonly draftDisposition?: DraftDisposition;
    } = {},
  ): Promise<T> {
    return this.enqueueOperation(async () => {
      this.enterScopeLaunchTransition(reason);
      const teardown = await this.fenceAndTeardown(
        options.draftDisposition
          ? { reason, draftDisposition: options.draftDisposition }
          : { reason },
      );
      if (!teardown.allSuccessful) {
        throw new Error('mobile.lifecycle.teardownIncomplete');
      }
      const result = await transition();
      if (options.restart !== false) {
        this.reset();
        await this.startRuntimeGraphNow();
      }
      await this.reconcileLaunchStateAfterRuntime(reason);
      return result;
    });
  }

  suspend(
    _reason: LifecycleTransitionReason = 'app-background',
  ): Promise<LifecycleKernelSnapshot> {
    return this.enqueueOperation(async () => {
      if (this.state.phase === 'SUSPENDED') return this.getSnapshot();
      if (this.state.launchState === 'shell') {
        this.transitionLaunchState('background');
      }
      await this.suspendRuntimes();
      return this.getSnapshot();
    });
  }

  resume(
    reason: LifecycleTransitionReason = 'app-resume',
  ): Promise<LifecycleKernelSnapshot> {
    return this.enqueueOperation(async () => {
      if (this.state.phase === 'ACTIVE') return this.getSnapshot();
      if (this.state.launchState === 'background') {
        this.transitionLaunchState('resume');
      }
      const dependencies = this.requireGraphDependencies();
      const observedGeneration = await withTimeout(
        dependencies.readGeneration(),
        GENERATION_OPERATION_TIMEOUT_MS,
        'mobile.lifecycle.readGenerationTimedOut',
      );
      const generation = observedGeneration > this.state.generation
        ? observedGeneration
        : await withTimeout(
          dependencies.advanceGeneration(),
          GENERATION_OPERATION_TIMEOUT_MS,
          'mobile.lifecycle.advanceGenerationTimedOut',
        );
      this.applyGeneration(generation, reason, true);
      dependencies.fenceProjections(generation, reason);
      if ([...this.state.runtimes.values()].some(
        (entry) => entry.status === 'failed' || entry.readiness?.status === 'failed',
      )) {
        const teardown = await this.teardownRuntimes({ reason });
        if (!teardown.allSuccessful) {
          throw new Error('mobile.lifecycle.teardownIncomplete');
        }
        this.reset();
        await this.startRuntimeGraphNow();
      } else {
        await this.resumeRuntimes();
      }
      await this.reconcileLaunchStateAfterRuntime(reason);
      return this.getSnapshot();
    });
  }

  reconcileLaunchState(
    reason: LifecycleTransitionReason = 'access-granted',
  ): Promise<LifecycleKernelSnapshot> {
    return this.enqueueOperation(async () => {
      await this.reconcileLaunchStateAfterRuntime(reason);
      return this.getSnapshot();
    });
  }

  /**
   * Reset graph registration while preserving the monotonic generation.
   */
  reset(): void {
    if (this.state.phase !== 'COLD') {
      throw new Error(`mobile.lifecycle.resetInvalidPhase:${this.state.phase}`);
    }
    this.invalidateReadinessUpdates();
    this.state = initialLifecycleState(
      this.state.generation,
      this.state.launchState,
    );
    this.notifyStateListeners();
  }

  // --- Runtime Graph Internals ---

  private invalidateReadinessUpdates(runtimeId?: string): void {
    if (runtimeId !== undefined) {
      clearTimeout(this.readinessTimeouts.get(runtimeId));
      this.readinessTimeouts.delete(runtimeId);
      this.readinessUpdates.delete(runtimeId);
      return;
    }
    this.readinessTimeouts.forEach(clearTimeout);
    this.readinessTimeouts.clear();
    this.readinessUpdates.clear();
  }

  private runtimeContext(descriptor: MobileRuntimeDescriptor): MobileRuntimeContext {
    const generation = this.state.generation;
    const incarnation = this.graphIncarnation;
    const isContextCurrent = () => (
      this.state.generation === generation
      && this.graphIncarnation === incarnation
      && this.state.runtimes.get(descriptor.id)?.descriptor === descriptor
      && ['bootstrapping', 'ready', 'resuming'].includes(
        this.state.runtimes.get(descriptor.id)?.status ?? '',
      )
      && ['BOOTSTRAPPING', 'ACTIVE', 'RESUMING'].includes(this.state.phase)
    );
    return Object.freeze({
      generation,
      beginReadinessUpdate: (): RuntimeReadinessUpdate => {
        const revision = ++this.readinessRevision;
        let settled = false;
        if (isContextCurrent()) {
          this.invalidateReadinessUpdates(descriptor.id);
          this.readinessUpdates.set(descriptor.id, revision);
          this.dispatch({
            type: 'RUNTIME_READINESS',
            runtimeId: descriptor.id,
            readiness: { status: 'pending', errorKey: null },
          });
        }
        const isCurrent = () => !settled
          && isContextCurrent()
          && this.readinessUpdates.get(descriptor.id) === revision;
        const settle = (error: unknown, failed: boolean) => {
          if (!isCurrent()) return;
          settled = true;
          clearTimeout(this.readinessTimeouts.get(descriptor.id));
          this.readinessTimeouts.delete(descriptor.id);
          this.dispatch({
            type: 'RUNTIME_READINESS',
            runtimeId: descriptor.id,
            readiness: {
              status: failed ? 'failed' : 'ready',
              errorKey: failed
                ? publicRuntimeErrorKey(error instanceof Error ? error.message : String(error))
                : null,
            },
          });
        };
        if (isCurrent()) {
          this.readinessTimeouts.set(descriptor.id, setTimeout(
            () => settle(new Error('mobile.lifecycle.runtimeTimedOut'), true),
            RUNTIME_OPERATION_TIMEOUT_MS.bootstrap,
          ));
        }
        return {
          isCurrent,
          waitForDependencies: () => new Promise<boolean>((resolve, reject) => {
            const check = () => {
              if (!isCurrent()) {
                unsubscribe();
                resolve(false);
                return;
              }
              const dependencies = descriptor.dependsOn.map(
                (id) => readRuntimeAvailability(this.state, id),
              );
              const failedIndex = dependencies.findIndex(
                (dependency) => !dependency || dependency.status === 'failed',
              );
              if (failedIndex !== -1) {
                unsubscribe();
                reject(new Error(
                  `mobile.lifecycle.dependencyFailed:${descriptor.dependsOn[failedIndex]}`,
                ));
                return;
              }
              if (dependencies.every((dependency) => dependency?.status === 'ready')) {
                unsubscribe();
                resolve(true);
              }
            };
            const unsubscribe = this.subscribe(check);
            check();
          }),
          ready: () => settle(undefined, false),
          fail: (error) => settle(error, true),
        };
      },
    });
  }

  private async startRuntimeGraphNow(): Promise<void> {
    if (this.state.phase !== 'COLD') {
      throw new Error(`mobile.lifecycle.startInvalidPhase:${this.state.phase}`);
    }
    if (this.state.runtimes.size > 0) this.reset();

    const descriptors = this.requireGraphDependencies().createDescriptors();
    this.registerRuntimes(descriptors);
    await this.bootstrapRuntimes();
  }

  private registerRuntimes(
    descriptors: readonly MobileRuntimeDescriptor[],
  ): void {
    this.graphIncarnation += 1;
    const ids = descriptors.map((descriptor) => descriptor.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error('mobile.lifecycle.duplicateRuntime');
    }

    const sortResult = topologicalSortRuntimes(descriptors);
    if (sortResult.missingDependencies.length > 0) {
      const missing = sortResult.missingDependencies
        .map(({ runtimeId, dependencyId }) => `${runtimeId}->${dependencyId}`)
        .join(',');
      throw new Error(`mobile.lifecycle.missingDependency:${missing}`);
    }
    if (sortResult.hasCycle) {
      throw new Error(
        `mobile.lifecycle.dependencyCycle:${sortResult.cycleParticipants.join('->')}`,
      );
    }

    this.dispatch({
      type: 'REGISTER_RUNTIMES',
      descriptors,
      bootOrder: sortResult.order,
    });
  }

  private async bootstrapRuntimes(): Promise<readonly RuntimeOperationResult[]> {
    this.assertPhaseTransition('BOOTSTRAPPING');
    this.dispatch({ type: 'BEGIN_BOOTSTRAP' });

    const results: RuntimeOperationResult[] = [];
    const failed = new Set<string>();

    for (const runtimeId of this.state.bootOrder) {
      const entry = this.state.runtimes.get(runtimeId);
      if (!entry) continue;

      const failedDependency = entry.descriptor.dependsOn.find(
        (dependencyId) => failed.has(dependencyId),
      );
      if (failedDependency) {
        const errorMessage =
          `mobile.lifecycle.dependencyFailed:${failedDependency}`;
        results.push({
          runtimeId,
          success: false,
          errorMessage,
          durationMs: 0,
        });
        failed.add(runtimeId);
        this.dispatch({
          type: 'RUNTIME_FAILED',
          runtimeId,
          error: errorMessage,
        });
        continue;
      }

      this.dispatch({ type: 'RUNTIME_BOOTSTRAPPING', runtimeId });
      const result = await runVoidRuntimeOperation(
        runtimeId,
        'bootstrap',
        () => entry.descriptor.bootstrap(this.runtimeContext(entry.descriptor)),
      );
      results.push(result);
      if (result.success) {
        this.dispatch({ type: 'RUNTIME_READY', runtimeId });
        this.emitEvent({
          kind: 'runtime-status-changed',
          runtimeId,
          status: 'ready',
        });
      } else {
        this.invalidateReadinessUpdates(runtimeId);
        failed.add(runtimeId);
        this.dispatch({
          type: 'RUNTIME_FAILED',
          runtimeId,
          error: result.errorMessage ?? 'mobile.lifecycle.bootstrapFailed',
        });
        this.emitEvent({
          kind: 'runtime-status-changed',
          runtimeId,
          status: 'failed',
        });
      }
    }

    this.dispatch({ type: 'BOOTSTRAP_COMPLETE', results });
    this.emitEvent({
      kind: 'phase-changed',
      phase: 'ACTIVE',
      previousPhase: 'BOOTSTRAPPING',
    });
    this.emitEvent({ kind: 'bootstrap-complete', results });
    return results;
  }

  private async suspendRuntimes(): Promise<void> {
    this.assertPhaseTransition('SUSPENDING');
    this.invalidateReadinessUpdates();
    this.dispatch({ type: 'BEGIN_SUSPEND' });

    const failures: RuntimeOperationResult[] = [];
    for (const runtimeId of reverseTeardownOrder(this.state.bootOrder)) {
      const entry = this.state.runtimes.get(runtimeId);
      if (!entry || entry.status !== 'ready') continue;

      const result = await runVoidRuntimeOperation(
        runtimeId,
        'suspend',
        () => entry.descriptor.suspend(),
      );
      if (result.success) {
        this.dispatch({ type: 'RUNTIME_SUSPENDED', runtimeId });
      } else {
        failures.push(result);
        this.dispatch({
          type: 'RUNTIME_SUSPEND_FAILED',
          runtimeId,
          error: result.errorMessage ?? 'mobile.lifecycle.suspendFailed',
        });
      }
    }

    const error = aggregateFailureKey('suspend', failures);
    this.dispatch({ type: 'SUSPEND_COMPLETE', error });
    this.emitEvent({
      kind: 'phase-changed',
      phase: 'SUSPENDED',
      previousPhase: 'SUSPENDING',
    });
    if (error) {
      this.emitEvent({ kind: 'error', message: error });
      throw new Error(error);
    }
  }

  private async resumeRuntimes(): Promise<void> {
    this.assertPhaseTransition('RESUMING');
    this.dispatch({ type: 'BEGIN_RESUME' });

    const failures: RuntimeOperationResult[] = [];
    const failed = new Set<string>();
    for (const runtimeId of this.state.bootOrder) {
      const entry = this.state.runtimes.get(runtimeId);
      if (!entry || entry.status !== 'suspended') continue;

      const failedDependency = entry.descriptor.dependsOn.find(
        (dependencyId) => failed.has(dependencyId),
      );
      if (failedDependency) {
        const errorMessage =
          `mobile.lifecycle.dependencyFailed:${failedDependency}`;
        failures.push({
          runtimeId,
          success: false,
          errorMessage,
          durationMs: 0,
        });
        failed.add(runtimeId);
        this.dispatch({
          type: 'RUNTIME_RESUME_FAILED',
          runtimeId,
          error: errorMessage,
        });
        continue;
      }

      this.dispatch({ type: 'RUNTIME_RESUMING', runtimeId });
      const result = await runVoidRuntimeOperation(
        runtimeId,
        'resume',
        () => entry.descriptor.resume(this.runtimeContext(entry.descriptor)),
      );
      if (result.success) {
        this.dispatch({ type: 'RUNTIME_RESUMED', runtimeId });
      } else {
        this.invalidateReadinessUpdates(runtimeId);
        failures.push(result);
        failed.add(runtimeId);
        this.dispatch({
          type: 'RUNTIME_RESUME_FAILED',
          runtimeId,
          error: result.errorMessage ?? 'mobile.lifecycle.resumeFailed',
        });
      }
    }

    const error = aggregateFailureKey('resume', failures);
    this.dispatch({ type: 'RESUME_COMPLETE', error });
    const phase = error ? 'SUSPENDED' : 'ACTIVE';
    this.emitEvent({
      kind: 'phase-changed',
      phase,
      previousPhase: 'RESUMING',
    });
    if (error) {
      this.emitEvent({ kind: 'error', message: error });
      throw new Error(error);
    }
  }

  private async teardownRuntimes(
    context: RuntimeTeardownContext,
  ): Promise<AggregateTeardownResult> {
    const previousPhase = this.state.phase;
    this.assertPhaseTransition('TEARDOWN');
    this.invalidateReadinessUpdates();
    this.dispatch({ type: 'BEGIN_TEARDOWN' });

    const results: RuntimeOperationResult[] = [];
    const totalStart = performance.now();

    for (const runtimeId of reverseTeardownOrder(this.state.bootOrder)) {
      const entry = this.state.runtimes.get(runtimeId);
      if (!entry || entry.status === 'pending' || entry.status === 'torn-down') continue;

      this.dispatch({ type: 'RUNTIME_TEARING_DOWN', runtimeId });
      const result = await runTeardownOperation(
        runtimeId,
        () => entry.descriptor.teardown(context),
      );
      results.push(result);
      this.dispatch(result.success
        ? { type: 'RUNTIME_TORN_DOWN', runtimeId }
        : {
            type: 'RUNTIME_TEARDOWN_FAILED',
            runtimeId,
            error: result.errorMessage ?? 'mobile.lifecycle.teardownFailed',
          });
    }

    const aggregateResult: AggregateTeardownResult = {
      results,
      allSuccessful: results.every((result) => result.success),
      totalDurationMs: performance.now() - totalStart,
    };

    this.dispatch({ type: 'TEARDOWN_COMPLETE', result: aggregateResult });
    this.emitEvent({
      kind: 'phase-changed',
      phase: this.state.phase,
      previousPhase,
    });
    this.emitEvent({ kind: 'teardown-complete', result: aggregateResult });
    return aggregateResult;
  }

  private async fenceAndTeardown(
    context: RuntimeTeardownContext,
  ): Promise<AggregateTeardownResult> {
    const { reason } = context;
    const dependencies = this.requireGraphDependencies();
    const generation = await withTimeout(
      dependencies.advanceGeneration(),
      GENERATION_OPERATION_TIMEOUT_MS,
      'mobile.lifecycle.advanceGenerationTimedOut',
    );
    this.applyGeneration(generation, reason, true);
    dependencies.fenceProjections(generation, reason);

    if (this.state.phase === 'COLD') return emptyTeardownResult();
    return this.teardownRuntimes(context);
  }

  private applyGeneration(
    generation: number,
    reason: LifecycleTransitionReason,
    requireAdvance: boolean,
  ): void {
    if (
      !Number.isSafeInteger(generation)
      || generation < 0
      || generation < this.state.generation
      || (requireAdvance && generation === this.state.generation)
    ) {
      throw new Error('mobile.lifecycle.invalidGeneration');
    }
    this.invalidateReadinessUpdates();
    this.dispatch({ type: 'SET_GENERATION', generation });
    this.emitEvent({ kind: 'generation-advanced', generation, reason });
  }

  private requireGraphDependencies(): LifecycleRuntimeGraphDependencies {
    if (!this.graphDependencies) {
      throw new Error('mobile.lifecycle.graphNotConfigured');
    }
    return this.graphDependencies;
  }

  private enterScopeLaunchTransition(
    reason: Extract<
      LifecycleTransitionReason,
      'station-replace' | 'actor-replace' | 'logout' | 'revocation'
    >,
  ): void {
    if (this.state.launchState !== 'shell') return;
    this.transitionLaunchState(
      reason === 'station-replace' ? 'station-change' : 'logout',
    );
  }

  private async reconcileLaunchStateAfterRuntime(
    reason: LifecycleTransitionReason,
  ): Promise<void> {
    const target = await withTimeout(
      this.requireGraphDependencies().resolveLaunchState(),
      GENERATION_OPERATION_TIMEOUT_MS,
      'mobile.lifecycle.resolveLaunchStateTimedOut',
    );
    this.transitionToResolvedLaunchState(target, reason);
  }

  private transitionToResolvedLaunchState(
    target: MobileLaunchState,
    reason: LifecycleTransitionReason,
  ): void {
    const current = this.state.launchState;
    if (current === target) return;

    if (current === 'shell') {
      this.transitionLaunchState(
        target === 'station-selection' ? 'station-change' : 'logout',
      );
    }

    if (
      this.state.launchState === 'station-change'
      && target !== 'station-selection'
    ) {
      this.transitionLaunchState('station-selection');
    }

    if (this.state.launchState === 'app-boot'
      || (this.state.launchState === 'logout' && target === 'shell')) {
      this.transitionLaunchState('station-selection');
    }

    if (
      this.state.launchState === 'station-selection'
      && target === 'access-gate-chain'
    ) {
      this.transitionLaunchState('station-handshake');
    }

    if (
      target === 'shell'
      && this.state.launchState !== 'runtime-critical'
    ) {
      if (
        this.state.launchState === 'station-selection'
        || this.state.launchState === 'access-gate-chain'
        || this.state.launchState === 'station-handshake'
        || this.state.launchState === 'resume'
      ) {
        this.transitionLaunchState('runtime-critical');
      }
    }

    if (!isValidLaunchStateTransition(this.state.launchState, target)) {
      throw new Error(
        `mobile.lifecycle.unresolvedLaunchTransition:${reason}:`
        + `${this.state.launchState}->${target}`,
      );
    }
    this.transitionLaunchState(target);
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.operationQueue.then(operation, operation);
    this.operationQueue = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

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
        `mobile.lifecycle.invalidTransition:${this.state.phase}->${target}`,
      );
    }
  }
}

async function runVoidRuntimeOperation(
  runtimeId: string,
  operation: Exclude<RuntimeOperation, 'teardown'>,
  run: () => Promise<void>,
): Promise<RuntimeOperationResult> {
  const start = performance.now();
  try {
    await withTimeout(
      run(),
      RUNTIME_OPERATION_TIMEOUT_MS[operation],
      `mobile.lifecycle.runtimeTimedOut:${runtimeId}:${operation}`,
    );
    return {
      runtimeId,
      success: true,
      durationMs: performance.now() - start,
    };
  } catch (error) {
    return {
      runtimeId,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: performance.now() - start,
    };
  }
}

async function runTeardownOperation(
  runtimeId: string,
  run: () => Promise<RuntimeOperationResult>,
): Promise<RuntimeOperationResult> {
  const start = performance.now();
  try {
    const result = await withTimeout(
      run(),
      RUNTIME_OPERATION_TIMEOUT_MS.teardown,
      `mobile.lifecycle.runtimeTimedOut:${runtimeId}:teardown`,
    );
    return {
      ...result,
      runtimeId,
      durationMs: performance.now() - start,
    };
  } catch (error) {
    return {
      runtimeId,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: performance.now() - start,
    };
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  errorKey: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = globalThis.setTimeout(() => reject(new Error(errorKey)), timeoutMs);
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
}

function aggregateFailureKey(
  operation: 'suspend' | 'resume',
  failures: readonly RuntimeOperationResult[],
): string | undefined {
  if (failures.length === 0) return undefined;
  return `mobile.lifecycle.${operation}Incomplete:${failures
    .map((failure) => failure.runtimeId)
    .join(',')}`;
}

function publicLifecycleErrorKey(error: string | null): string | null {
  if (!error) return null;
  return publicRuntimeErrorKey(error);
}

function emptyTeardownResult(): AggregateTeardownResult {
  return {
    results: [],
    allSuccessful: true,
    totalDurationMs: 0,
  };
}

function sameGraphDependencies(
  left: LifecycleRuntimeGraphDependencies,
  right: LifecycleRuntimeGraphDependencies,
): boolean {
  return (
    left.createDescriptors === right.createDescriptors
    && left.readGeneration === right.readGeneration
    && left.advanceGeneration === right.advanceGeneration
    && left.resolveLaunchState === right.resolveLaunchState
    && left.fenceProjections === right.fenceProjections
  );
}

let kernelInstance: MobileLifecycleKernel | null = null;

export function getMobileLifecycleKernel(): MobileLifecycleKernel {
  if (!kernelInstance) kernelInstance = new MobileLifecycleKernel();
  return kernelInstance;
}

export function destroyMobileLifecycleKernel(): void {
  kernelInstance = null;
}
