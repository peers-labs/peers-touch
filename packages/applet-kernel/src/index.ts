// Applet Kernel — public API surface.
//
// Authoritative source: docs/architecture/platform/applet-runtime/applet-lifecycle-architecture.md
//   §6 分层架构 (Applet Kernel 分层), §10 数据模型.
// Execution plan: docs/architecture/platform/applet-runtime/execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md §5.
//
// The kernel is render-agnostic (surface work is delegated to an injected
// PlatformAdapter) and platform-agnostic (clock / session backend / audit sink
// are injected). Desktop (Tauri WebView + Lynx for Web) and Mobile (native
// LynxView) construct the same kernel with different adapters/backends.

import type { AppletLifecycleEvent } from '@peers-touch/applet-contract';

import { DefaultInstanceRegistry } from './instance-registry.js';
import { DefaultLifecycleOrchestrator } from './lifecycle-orchestrator.js';
import { DefaultPermissionManager } from './permission-manager.js';
import { DefaultResourceScheduler } from './resource-scheduler.js';
import { DefaultSessionManager } from './session-manager.js';
import type {
  AuditSink,
  Clock,
  DispatchResult,
  InstanceRegistry,
  KernelLogger,
  LifecycleOrchestrator,
  MemoryPressureLevel,
  PermissionManager,
  ResourcePolicy,
  ResourceScheduler,
  SessionBackend,
  SessionManager,
} from './ports.js';
import type { PlatformAdapter } from '@peers-touch/applet-contract';

// --- Module ports and implementations --------------------------------------

export * from './ports.js';
export * from './policy.js';
export { DefaultInstanceRegistry } from './instance-registry.js';
export { DefaultSessionManager } from './session-manager.js';
export { DefaultPermissionManager } from './permission-manager.js';
export { DefaultResourceScheduler } from './resource-scheduler.js';
export { DefaultLifecycleOrchestrator } from './lifecycle-orchestrator.js';

// --- Composition root -------------------------------------------------------

/** Everything the kernel must be constructed with; all collaborators are injected. */
export interface AppletKernelDeps {
  clock: Clock;
  logger: KernelLogger;
  /** Surface carrier (Lynx-for-Web host / native LynxView), platform-specific. */
  adapter: PlatformAdapter;
  /** Resource policy for this platform (see DESKTOP_/MOBILE_RESOURCE_POLICY). */
  policy: ResourcePolicy;
  /** Capability-session backend (Rust Gateway in production). */
  sessionBackend: SessionBackend;
  /** Permission-decision audit sink (Rust audit ingestion in production). */
  auditSink: AuditSink;
}

/**
 * Applet Kernel composition root (architecture §6).
 *
 * Wires the five kernel modules together and exposes the orchestration and
 * scheduling entry points. It owns no rendering and no platform API — those are
 * reached only through the injected {@link PlatformAdapter}. The Orchestrator
 * remains the single writer of instance state; the Scheduler only proposes
 * events, which callers feed back through {@link AppletKernel.dispatch}.
 */
export class AppletKernel {
  readonly registry: InstanceRegistry;
  readonly sessions: SessionManager;
  readonly permissions: PermissionManager;
  readonly scheduler: ResourceScheduler;
  readonly orchestrator: LifecycleOrchestrator;

  constructor(deps: AppletKernelDeps) {
    this.registry = new DefaultInstanceRegistry(deps.clock);
    this.sessions = new DefaultSessionManager(deps.sessionBackend, deps.logger);
    this.permissions = new DefaultPermissionManager({
      audit: deps.auditSink,
      clock: deps.clock,
      logger: deps.logger,
    });
    this.scheduler = new DefaultResourceScheduler({
      registry: this.registry,
      policy: deps.policy,
      clock: deps.clock,
      logger: deps.logger,
    });
    this.orchestrator = new DefaultLifecycleOrchestrator({
      registry: this.registry,
      sessions: this.sessions,
      adapter: deps.adapter,
      clock: deps.clock,
      logger: deps.logger,
    });
  }

  /** Drive one lifecycle transition through the single-writer Orchestrator. */
  dispatch(event: AppletLifecycleEvent): Promise<DispatchResult> {
    return this.orchestrator.dispatch(event);
  }

  /**
   * Run one resource sweep and dispatch every event it proposes in order. The
   * Scheduler proposes; the Orchestrator disposes — this keeps the Orchestrator
   * the single writer of state.
   */
  async runSweep(now: number): Promise<DispatchResult[]> {
    return this.dispatchAll(this.scheduler.sweep(now));
  }

  /** Translate a memory-pressure signal into reclamation transitions. */
  async handleMemoryPressure(level: MemoryPressureLevel, now: number): Promise<DispatchResult[]> {
    return this.dispatchAll(this.scheduler.onMemoryPressure(level, now));
  }

  private async dispatchAll(events: AppletLifecycleEvent[]): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const event of events) {
      results.push(await this.orchestrator.dispatch(event));
    }
    return results;
  }
}
