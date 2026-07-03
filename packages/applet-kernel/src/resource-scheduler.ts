// Resource Scheduler (architecture §5, §6).
//
// Authoritative source: docs/architecture/applet-runtime/applet-lifecycle-architecture.md
//   §5.1 LRU, §5.2 TTL, §5.3 内存压力, §6 分层架构 (ResourceScheduler 职责).
//
// This module decides *what* should be reclaimed, never *how*. It scans the
// registry and emits suspend/destroy lifecycle events for the Orchestrator to
// dispatch; it deliberately performs no registry mutation, so every decision is
// a pure function of the current records plus the injected clock/policy. Keeping
// it side-effect-free is what makes the sweep deterministically testable.

import type { AppletInstance, AppletLifecycleEvent } from '@peers-touch/applet-contract';

import type {
  Clock,
  InstanceRegistry,
  KernelLogger,
  MemoryPressureLevel,
  ResourcePolicy,
  ResourceScheduler,
} from './ports.js';

/** Collaborators the scheduler needs; each is an injected port, never a sibling class. */
interface DefaultResourceSchedulerDeps {
  registry: InstanceRegistry;
  policy: ResourcePolicy;
  clock: Clock;
  logger: KernelLogger;
}

/** The two outcomes a sweep can schedule for a single instance. */
type ScheduledAction = 'suspend' | 'destroy';

export class DefaultResourceScheduler implements ResourceScheduler {
  private readonly registry: InstanceRegistry;
  private readonly policy: ResourcePolicy;
  // Retained for parity with other kernel modules; sweep/onMemoryPressure take an
  // explicit `now` so callers can align time across a whole tick.
  private readonly clock: Clock;
  private readonly logger: KernelLogger;

  constructor(deps: DefaultResourceSchedulerDeps) {
    this.registry = deps.registry;
    this.policy = deps.policy;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  sweep(now: number): AppletLifecycleEvent[] {
    const instances = this.registry.list();
    const events: AppletLifecycleEvent[] = [];
    // One decision per instance per sweep: once an instance is scheduled by an
    // earlier rule, later rules skip it so we never emit two events for it.
    const scheduled = new Map<string, ScheduledAction>();

    const schedule = (instance: AppletInstance, action: ScheduledAction, reason: string): void => {
      if (scheduled.has(instance.instanceId)) {
        return;
      }
      scheduled.set(instance.instanceId, action);
      events.push(this.buildEvent(instance, action, now, reason));
    };

    // --- §5.2 TTL pass (runs first) ----------------------------------------
    // Each instance is in exactly one state, so these branches never collide.
    for (const instance of instances) {
      if (instance.state === 'hidden-warm') {
        if (now - instance.lastHiddenAt > this.policy.hiddenWarmTtlMs) {
          schedule(instance, 'suspend', 'ttl-hidden-warm');
        }
      } else if (instance.state === 'paused') {
        if (now - instance.lastTouchedAt > this.policy.pausedTtlMs) {
          schedule(instance, 'suspend', 'ttl-paused');
        }
      } else if (instance.state === 'suspended') {
        if (now - instance.lastTouchedAt > this.policy.suspendedTtlMs) {
          schedule(instance, 'destroy', 'ttl-suspended');
        }
      }
    }

    // --- §5.1 LRU eviction pass --------------------------------------------
    // Warm = visible + hidden-warm + paused. Instances already scheduled by TTL
    // have projected away from warm, so excluding them applies LRU to the state
    // the sweep will actually produce. Visible instances are never evicted.
    const warm = instances.filter(
      (instance) => isWarmState(instance.state) && !scheduled.has(instance.instanceId),
    );
    if (warm.length > this.policy.lruSize) {
      const overflow = warm.length - this.policy.lruSize;
      const evictable = warm
        .filter((instance) => instance.state !== 'visible')
        .sort(byLastTouchedAsc);
      for (const instance of evictable.slice(0, overflow)) {
        schedule(instance, 'suspend', 'lru-evict');
      }
    }

    // --- §5.1 suspended overflow pass --------------------------------------
    // Projected suspended = pre-existing suspended that survived TTL, plus any
    // instance this sweep just suspended. When that exceeds maxSuspended, the
    // oldest pre-existing suspended instances are destroyed. Instances scheduled
    // earlier this sweep are left alone to honour the one-decision rule.
    const projectedSuspended = instances.filter((instance) => {
      const action = scheduled.get(instance.instanceId);
      if (action !== undefined) {
        return action === 'suspend';
      }
      return instance.state === 'suspended';
    });
    if (projectedSuspended.length > this.policy.maxSuspended) {
      const overflow = projectedSuspended.length - this.policy.maxSuspended;
      const destroyable = projectedSuspended
        .filter((instance) => !scheduled.has(instance.instanceId))
        .sort(byLastTouchedAsc);
      for (const instance of destroyable.slice(0, overflow)) {
        schedule(instance, 'destroy', 'lru-suspended-overflow');
      }
    }

    if (events.length > 0) {
      // Count only — instance identity/PII must never reach the logs.
      this.logger.debug('resource sweep emitted events', { count: events.length });
    }
    return events;
  }

  onMemoryPressure(level: MemoryPressureLevel, now: number): AppletLifecycleEvent[] {
    const instances = this.registry.list();
    let events: AppletLifecycleEvent[] = [];

    switch (level) {
      case 'low':
        // §5.3: low pressure requires no reclamation.
        break;
      case 'moderate': {
        // §5.3: shed a single instance — the oldest suspended one.
        const oldestSuspended = instances
          .filter((instance) => instance.state === 'suspended')
          .sort(byLastTouchedAsc)[0];
        if (oldestSuspended !== undefined) {
          events = [this.buildEvent(oldestSuspended, 'destroy', now, 'memory-pressure-moderate')];
        }
        break;
      }
      case 'critical':
        // §5.3: reclaim everything not on screen; visible stays interactive.
        events = instances
          .filter((instance) => instance.state !== 'visible')
          .map((instance) => this.buildEvent(instance, 'destroy', now, 'memory-pressure-critical'));
        break;
    }

    if (events.length > 0) {
      this.logger.debug('memory pressure emitted events', { level, count: events.length });
    }
    return events;
  }

  /** Assemble a lifecycle event envelope; `now` is the authoritative sweep time. */
  private buildEvent(
    instance: AppletInstance,
    action: ScheduledAction,
    now: number,
    reason: string,
  ): AppletLifecycleEvent {
    return {
      type: action,
      appletId: instance.appletId,
      instanceId: instance.instanceId,
      timestamp: now,
      reason,
    };
  }
}

/** States that keep an instance "warm" for LRU accounting (architecture §5.1). */
function isWarmState(state: AppletInstance['state']): boolean {
  return state === 'visible' || state === 'hidden-warm' || state === 'paused';
}

/** Oldest-first ordering: the least recently touched instance sorts first. */
function byLastTouchedAsc(a: AppletInstance, b: AppletInstance): number {
  return a.lastTouchedAt - b.lastTouchedAt;
}
