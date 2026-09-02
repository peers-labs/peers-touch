/**
 * Core type definitions for the Mobile Lifecycle Kernel.
 *
 * MobileRuntimeDescriptor is the primary contract: every runtime in the app
 * must implement this interface so the kernel can bootstrap, suspend, resume,
 * and teardown runtimes in correct dependency order.
 */

// --- Lifecycle Phases ---

/**
 * Ordered lifecycle phases for the mobile application.
 *
 * COLD          – App process started, no runtimes initialized.
 * BOOTSTRAPPING – Kernel is bootstrapping runtimes in topological order.
 * ACTIVE        – All runtimes bootstrapped successfully; app is fully operational.
 * SUSPENDING    – App is entering background; runtimes suspending in reverse order.
 * SUSPENDED     – All runtimes suspended; app is in background.
 * RESUMING      – App returning to foreground; runtimes resuming in bootstrap order.
 * TEARDOWN      – App is shutting down; runtimes tearing down in reverse order.
 */
export type LifecyclePhase =
  | 'COLD'
  | 'BOOTSTRAPPING'
  | 'ACTIVE'
  | 'SUSPENDING'
  | 'SUSPENDED'
  | 'RESUMING'
  | 'TEARDOWN';

// --- Runtime Descriptor Status ---

export type RuntimeBootstrapStatus =
  | 'pending'
  | 'bootstrapping'
  | 'ready'
  | 'suspended'
  | 'resuming'
  | 'tearing-down'
  | 'torn-down'
  | 'failed';

// --- Teardown / Bootstrap Result ---

export interface RuntimeOperationResult {
  readonly runtimeId: string;
  readonly success: boolean;
  readonly errorMessage?: string;
  readonly durationMs: number;
}

// --- Aggregate Teardown Results ---

export interface AggregateTeardownResult {
  readonly results: readonly RuntimeOperationResult[];
  readonly allSuccessful: boolean;
  readonly totalDurationMs: number;
}

// --- MobileRuntimeDescriptor ---

/**
 * Contract for every runtime managed by the lifecycle kernel.
 *
 * Each runtime declares its identity, dependency edges, and lifecycle hooks.
 * The kernel uses `dependsOn` for topological ordering: bootstrap runs in
 * dependency order, teardown runs in reverse dependency order.
 */
export interface MobileRuntimeDescriptor {
  /** Unique runtime identifier. Must be stable across sessions. */
  readonly id: string;

  /** Human-readable title for diagnostics. */
  readonly title: string;

  /** Responsibility description for the runtime registry. */
  readonly responsibility: string;

  /**
   * IDs of runtimes that must be bootstrapped before this one.
   * Empty array means no dependencies (can bootstrap first).
   */
  readonly dependsOn: readonly string[];

  /**
   * Initialize the runtime. Called once during BOOTSTRAPPING phase.
   * Must resolve when the runtime is ready to serve requests.
   * Throwing aborts the bootstrap sequence for dependent runtimes.
   */
  bootstrap(): Promise<void>;

  /**
   * Pause runtime activity for background state.
   * Called during SUSPENDING phase in reverse dependency order.
   * Must be idempotent — calling suspend on an already-suspended runtime is a no-op.
   */
  suspend(): Promise<void>;

  /**
   * Restore runtime activity after returning from background.
   * Called during RESUMING phase in bootstrap dependency order.
   * Must reconcile any state that may have changed while suspended.
   */
  resume(): Promise<void>;

  /**
   * Release all resources. Called during TEARDOWN phase in reverse dependency order.
   * Must be safe to call even if bootstrap() was never called or failed.
   * Returns an operation result for aggregate reporting.
   */
  teardown(): Promise<RuntimeOperationResult>;
}

// --- Lifecycle Kernel State ---

export interface RuntimeEntry {
  readonly descriptor: MobileRuntimeDescriptor;
  status: RuntimeBootstrapStatus;
  lastError: string | null;
}

export interface LifecycleKernelState {
  readonly phase: LifecyclePhase;
  readonly runtimes: ReadonlyMap<string, RuntimeEntry>;
  readonly bootOrder: readonly string[];
  readonly error: string | null;
}

// --- Lifecycle Events (for subscribers) ---

export type LifecycleEvent =
  | { kind: 'phase-changed'; phase: LifecyclePhase; previousPhase: LifecyclePhase }
  | { kind: 'runtime-status-changed'; runtimeId: string; status: RuntimeBootstrapStatus }
  | { kind: 'bootstrap-complete'; results: readonly RuntimeOperationResult[] }
  | { kind: 'teardown-complete'; result: AggregateTeardownResult }
  | { kind: 'error'; message: string };

export type LifecycleEventListener = (event: LifecycleEvent) => void;
