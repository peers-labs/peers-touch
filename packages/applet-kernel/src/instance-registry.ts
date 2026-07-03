// Applet Instance Registry — in-memory implementation.
//
// Authoritative source: docs/architecture/applet-runtime/applet-lifecycle-architecture.md
//   §6 分层架构 (registry owns records, not policy), §10 数据模型.
//
// This module is a pure store of instance records and their bookkeeping fields.
// Transition legality is the Orchestrator's concern and eviction is the
// ResourceScheduler's; the registry only records what it is told.

import type { AppletInstance, AppletLifecycleState } from '@peers-touch/applet-contract';

import type { Clock, InstanceCreateInput, InstanceRegistry } from './ports.js';

export class DefaultInstanceRegistry implements InstanceRegistry {
  // Keyed by instanceId so lookups on the identity dimension used everywhere
  // else in the kernel are O(1).
  private readonly instances = new Map<string, AppletInstance>();

  constructor(private readonly clock: Clock) {}

  create(input: InstanceCreateInput): AppletInstance {
    if (this.instances.has(input.instanceId)) {
      throw new Error(`instance already registered: ${input.instanceId}`);
    }

    const now = this.clock.now();
    const instance: AppletInstance = {
      appletId: input.appletId,
      instanceId: input.instanceId,
      sessionId: input.sessionId,
      // A freshly launched instance is registered right after `launch`, so its
      // initial state is 'materializing'.
      state: 'materializing',
      createdAt: now,
      // Visibility timestamps stay 0 until the instance actually becomes
      // visible/hidden; only creation and touch times are known at register.
      lastVisibleAt: 0,
      lastHiddenAt: 0,
      lastTouchedAt: now,
      memoryEstimate: 0,
      crashCount: 0,
      manifestVersion: input.manifestVersion,
      platform: input.platform,
    };

    this.instances.set(instance.instanceId, instance);
    return instance;
  }

  get(instanceId: string): AppletInstance | undefined {
    return this.instances.get(instanceId);
  }

  list(): AppletInstance[] {
    return Array.from(this.instances.values());
  }

  listByState(state: AppletLifecycleState): AppletInstance[] {
    return this.list().filter((instance) => instance.state === state);
  }

  setState(instanceId: string, state: AppletLifecycleState, at: number): AppletInstance | undefined {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return undefined;
    }

    instance.state = state;
    if (state === 'visible') {
      instance.lastVisibleAt = at;
    } else if (state === 'hidden-warm') {
      instance.lastHiddenAt = at;
    }
    // Any state change also counts as activity on the instance.
    instance.lastTouchedAt = at;
    return instance;
  }

  touch(instanceId: string, at: number): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.lastTouchedAt = at;
    }
  }

  updateMemoryEstimate(instanceId: string, bytes: number): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.memoryEstimate = bytes;
    }
  }

  incrementCrashCount(instanceId: string): number {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return 0;
    }
    instance.crashCount += 1;
    return instance.crashCount;
  }

  remove(instanceId: string): void {
    this.instances.delete(instanceId);
  }
}
