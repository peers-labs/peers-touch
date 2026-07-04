// Lifecycle Orchestrator (architecture §3, §6).
//
// Authoritative source: docs/architecture/applet-runtime/applet-lifecycle-architecture.md
//   §3 状态机 + 状态转换事件表, §6 分层架构 (Lifecycle Orchestrator 职责).
//
// This module is the SINGLE writer of instance state. It validates every event
// against the frozen state machine in `@peers-touch/applet-contract`, then drives
// surface/session side-effects through injected collaborators and persists the
// resulting state in the registry. It deliberately owns no LRU/TTL policy — that
// lives in the ResourceScheduler, which asks the Orchestrator to drive concrete
// suspend/destroy transitions.

import {
  isValidTransition,
  nextState,
  type AppletLifecycleEvent,
  type AppletLifecycleEventType,
  type AppletLifecycleState,
  type PlatformAdapter,
  type SurfaceTarget,
} from '@peers-touch/applet-contract';

import type {
  Clock,
  DispatchResult,
  InstanceRegistry,
  KernelLogger,
  LifecycleOrchestrator,
  SessionManager,
} from './ports.js';

/** Collaborators the Orchestrator needs; each is an injected port, never a sibling class. */
interface DefaultLifecycleOrchestratorDeps {
  registry: InstanceRegistry;
  sessions: SessionManager;
  adapter: PlatformAdapter;
  clock: Clock;
  logger: KernelLogger;
}

export class DefaultLifecycleOrchestrator implements LifecycleOrchestrator {
  private readonly registry: InstanceRegistry;
  private readonly sessions: SessionManager;
  private readonly adapter: PlatformAdapter;
  // Clock is retained for future scheduler-driven diagnostics; event timestamps
  // are authoritative for state bookkeeping so we prefer them over now().
  private readonly clock: Clock;
  private readonly logger: KernelLogger;

  constructor(deps: DefaultLifecycleOrchestratorDeps) {
    this.registry = deps.registry;
    this.sessions = deps.sessions;
    this.adapter = deps.adapter;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  async dispatch(event: AppletLifecycleEvent): Promise<DispatchResult> {
    const instance = this.registry.get(event.instanceId);

    // Unknown instance: nothing to transition. Reported as a `cold` origin since
    // an absent record is equivalent to "never materialized" from the caller's view.
    if (instance === undefined) {
      this.logger.warn('lifecycle event for unknown instance', {
        instanceId: event.instanceId,
        event: event.type,
      });
      return { accepted: false, from: 'cold', rejectedReason: 'instance-not-found' };
    }

    const from = instance.state;
    const type = event.type;
    const target = this.resolveTarget(from, type);

    // Reject anything the frozen state machine forbids. `target === undefined`
    // covers both unsupported signals (memory-pressure/error) and events illegal
    // from the current state; isValidTransition is the authoritative guard.
    if (target === undefined || !isValidTransition(from, type, target)) {
      const attempted = target ?? 'unsupported';
      this.logger.warn('lifecycle transition rejected', {
        instanceId: event.instanceId,
        from,
        event: type,
        target: attempted,
      });
      return {
        accepted: false,
        from,
        rejectedReason: `illegal-transition:${from}-${type}->${attempted}`,
      };
    }

    const surfaceTarget: SurfaceTarget = {
      appletId: instance.appletId,
      instanceId: instance.instanceId,
    };

    try {
      // `destroy` and `error` both fully reclaim the instance and remove its
      // record, so they must not fall through to setState below. `error` is a
      // crash signal (architecture §3 错误/异常状态): record the crash before
      // reclaiming so crash-count driven unhealthy detection can act on launch.
      if (type === 'destroy' || type === 'error') {
        if (type === 'error') {
          const crashCount = this.registry.incrementCrashCount(event.instanceId);
          this.logger.warn('applet crashed, reclaiming instance', {
            instanceId: event.instanceId,
            from,
            crashCount,
          });
        }
        await this.adapter.applySurfaceCommand('destroy', surfaceTarget);
        await this.sessions.destroy(instance.sessionId);
        this.registry.remove(event.instanceId);
        return { accepted: true, from, to: target };
      }

      await this.applySideEffect(type, surfaceTarget);
    } catch (error) {
      // Side-effect failure leaves state untouched: the Orchestrator only records
      // a transition the platform actually completed.
      this.logger.error('lifecycle side-effect failed', {
        instanceId: event.instanceId,
        from,
        event: type,
        target,
        error: error instanceof Error ? error.message : String(error),
      });
      return { accepted: false, from, rejectedReason: 'side-effect-failed' };
    }

    // Event timestamp is the source of truth for lastVisible/lastHidden bookkeeping.
    this.registry.setState(event.instanceId, target, event.timestamp);
    return { accepted: true, from, to: target };
  }

  /**
   * Resolve the target state for a supported event. `resume` is fixed to
   * `visible` per architecture §3's common case; `error` is a crash signal that
   * resolves to `destroyed` (architecture §3 错误/异常状态); other deterministic
   * events defer to the frozen `nextState`. The `memory-pressure` signal and
   * unknown types resolve to `undefined` so the caller rejects them.
   */
  private resolveTarget(
    from: AppletLifecycleState,
    type: AppletLifecycleEventType,
  ): AppletLifecycleState | undefined {
    switch (type) {
      case 'resume':
        return 'visible';
      case 'error':
        return 'destroyed';
      case 'launch':
      case 'ready':
      case 'show':
      case 'hide':
      case 'pause':
      case 'suspend':
      case 'restore':
      case 'destroy':
        return nextState(from, type);
      default:
        return undefined;
    }
  }

  /**
   * Carry out the surface command a non-destroy transition requires. `ready`,
   * `launch` and `pause` need no surface work; `resume`/`show`/`restore` bring the
   * surface to the foreground, `hide` backgrounds it, `suspend` detaches it.
   */
  private async applySideEffect(
    type: AppletLifecycleEventType,
    surfaceTarget: SurfaceTarget,
  ): Promise<void> {
    switch (type) {
      case 'show':
      case 'restore':
      case 'resume':
        await this.adapter.applySurfaceCommand('show', surfaceTarget);
        return;
      case 'hide':
        await this.adapter.applySurfaceCommand('hide', surfaceTarget);
        return;
      case 'suspend':
        await this.adapter.applySurfaceCommand('detach', surfaceTarget);
        return;
      default:
        // launch / ready / pause carry no surface command.
        return;
    }
  }
}
