// Applet Kernel — internal ports (frozen interfaces).
//
// Authoritative source: docs/architecture/applet-runtime/applet-lifecycle-architecture.md
//   §5 资源策略, §6 分层架构 (各层职责), §10 数据模型.
// Execution plan: docs/architecture/applet-runtime/execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md §5.
//
// These interfaces are the contract between kernel modules. Each module
// implements exactly one port and depends only on ports declared here — never
// on a sibling module's concrete class. This keeps the kernel render-agnostic
// (surface work is delegated to the injected PlatformAdapter) and
// platform-agnostic (clock/session backends are injected).

import type {
  AppletInstance,
  AppletLifecycleEvent,
  AppletLifecycleState,
  AppletPlatform,
  PlatformAdapter,
} from '@peers-touch/applet-contract';

// --- Shared infrastructure ports -------------------------------------------

/** Injectable monotonic clock so scheduler/TTL logic is deterministically testable. */
export interface Clock {
  now(): number;
}

/** Kernel-scoped logger. Never logs tokens/PII (AGENTS.md logging security). */
export interface KernelLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

// --- Registry port (owned by InstanceRegistry) -----------------------------

/** Identity of an applet instance (registry key dimension, architecture §5.1). */
export interface InstanceKey {
  userId: string;
  workspaceId: string;
  appletId: string;
  instanceId: string;
}

/** Fields required to register a freshly launched instance. */
export interface InstanceCreateInput {
  appletId: string;
  instanceId: string;
  sessionId: string;
  manifestVersion: string;
  platform: AppletPlatform;
}

/**
 * Applet Instance Registry (architecture §6, §10).
 *
 * Owns instance records and their timestamps/memory estimates. It stores state
 * but does NOT decide transitions (that is the Orchestrator) and does NOT decide
 * eviction (that is the ResourceScheduler).
 */
export interface InstanceRegistry {
  create(input: InstanceCreateInput): AppletInstance;
  get(instanceId: string): AppletInstance | undefined;
  list(): AppletInstance[];
  /** Instances currently in a given state. */
  listByState(state: AppletLifecycleState): AppletInstance[];
  /** Persist a state change plus timestamp bookkeeping. */
  setState(instanceId: string, state: AppletLifecycleState, at: number): AppletInstance | undefined;
  /** Update lastTouchedAt on any invoke/event. */
  touch(instanceId: string, at: number): void;
  updateMemoryEstimate(instanceId: string, bytes: number): void;
  incrementCrashCount(instanceId: string): number;
  remove(instanceId: string): void;
}

// --- Session port (owned by SessionManager) --------------------------------

/** Backend that mints/renews/revokes capability sessions (Rust Gateway in prod). */
export interface SessionBackend {
  createSession(appletId: string, instanceId: string): Promise<string>;
  renewSession(sessionId: string): Promise<void>;
  destroySession(sessionId: string): Promise<void>;
}

/**
 * Session Manager (architecture §6). Creates/renews/destroys Gateway sessions.
 * Does not touch business data.
 */
export interface SessionManager {
  create(appletId: string, instanceId: string): Promise<string>;
  renew(sessionId: string): Promise<void>;
  destroy(sessionId: string): Promise<void>;
}

// --- Permission port (owned by PermissionManager) --------------------------

/** Outcome of a capability-method permission check. */
export interface PermissionDecision {
  granted: boolean;
  /** AppletErrorCode-compatible reason when denied ('PERMISSION_DENIED' | 'POLICY_DENIED'). */
  reason?: 'PERMISSION_DENIED' | 'POLICY_DENIED';
}

/** Sink for permission-check audit records (Rust audit ingestion in prod). */
export interface AuditSink {
  record(entry: {
    appletId: string;
    instanceId: string;
    method: string;
    granted: boolean;
    timestamp: number;
    reason?: string;
  }): void;
}

/**
 * Permission Manager (architecture §6). Validates manifest-declared permissions
 * plus runtime grants and records every invoke decision to the audit sink.
 */
export interface PermissionManager {
  /** Register the permissions a manifest declares for an instance. */
  registerGrants(instanceId: string, permissions: string[]): void;
  /** Check whether an instance may call a capability method; records audit. */
  check(instanceId: string, appletId: string, method: string): PermissionDecision;
  revokeAll(instanceId: string): void;
}

// --- Resource scheduling port (owned by ResourceScheduler) -----------------

export type MemoryPressureLevel = 'low' | 'moderate' | 'critical';

/**
 * Resource policy (architecture §5.1/§5.2/§5.3). All values are injected so the
 * same scheduler serves Desktop (lruSize 4) and Mobile (lruSize 3).
 */
export interface ResourcePolicy {
  /** Max non-destroyed instances kept warm before LRU pushes oldest to suspend. */
  lruSize: number;
  /** Max suspended instances before oldest suspended is destroyed. */
  maxSuspended: number;
  /** TTL (ms) hidden-warm → suspended. */
  hiddenWarmTtlMs: number;
  /** TTL (ms) suspended → destroyed. */
  suspendedTtlMs: number;
  /** TTL (ms) paused → suspended. */
  pausedTtlMs: number;
}

/**
 * Resource Scheduler (architecture §5, §6). Scans instances and emits the
 * lifecycle events (suspend/destroy) that policy dictates. It never mutates
 * registry state directly; it asks the Orchestrator to drive the transition.
 */
export interface ResourceScheduler {
  /** Run one LRU + TTL sweep at time `now`, returning events to dispatch. */
  sweep(now: number): AppletLifecycleEvent[];
  /** Translate a memory-pressure level into events to dispatch. */
  onMemoryPressure(level: MemoryPressureLevel, now: number): AppletLifecycleEvent[];
}

// --- Orchestration port (owned by LifecycleOrchestrator) -------------------

export interface DispatchResult {
  accepted: boolean;
  from: AppletLifecycleState;
  to?: AppletLifecycleState;
  /** Set when the transition was rejected as illegal. */
  rejectedReason?: string;
}

/**
 * Lifecycle Orchestrator (architecture §3, §6). The single writer of instance
 * state: validates events against the frozen state machine, updates the
 * registry, drives session/surface side-effects via injected collaborators.
 */
export interface LifecycleOrchestrator {
  dispatch(event: AppletLifecycleEvent): Promise<DispatchResult>;
}

// --- Kernel collaborators bundle (injected into modules) -------------------

/** Everything a module may be constructed with. Modules take only what they need. */
export interface KernelDeps {
  clock: Clock;
  logger: KernelLogger;
  adapter: PlatformAdapter;
  policy: ResourcePolicy;
}
