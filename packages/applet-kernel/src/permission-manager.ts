// Permission Manager — validates manifest-declared grants against runtime
// invokes and records every decision to the audit sink.
//
// Authoritative source: docs/architecture/platform/applet-runtime/applet-lifecycle-architecture.md
//   §6 分层架构 (Permission Manager 职责: validate manifest permissions + runtime
//   grant, record invoke audit).
//
// The manager holds only the granted method set per instance; it never persists
// business data. Capability identifiers are validated through the contract's
// `isCapabilityMethod` guard so unknown/typo'd methods can never be granted.

import {
  isCapabilityMethod,
} from '@peers-touch/applet-contract';

import type {
  AuditSink,
  Clock,
  KernelLogger,
  PermissionDecision,
  PermissionManager,
} from './ports.js';

export class DefaultPermissionManager implements PermissionManager {
  // instanceId → set of granted capability-method identifiers.
  private readonly grants = new Map<string, Set<string>>();

  private readonly audit: AuditSink;
  private readonly clock: Clock;
  private readonly logger: KernelLogger;

  constructor(deps: { audit: AuditSink; clock: Clock; logger: KernelLogger }) {
    this.audit = deps.audit;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  registerGrants(instanceId: string, permissions: string[]): void {
    const granted = new Set<string>();
    const invalid: string[] = [];

    for (const permission of permissions) {
      if (isCapabilityMethod(permission)) {
        granted.add(permission);
      } else {
        invalid.push(permission);
      }
    }

    // Register the valid subset even when some entries are rejected, so a single
    // bad manifest entry cannot strip an instance of its legitimate grants.
    this.grants.set(instanceId, granted);

    if (invalid.length > 0) {
      // Warn once per registration listing only the offending identifiers; the
      // full grant list is intentionally omitted to avoid noise.
      this.logger.warn('ignored unknown permission identifiers', { instanceId, invalid });
    }

    this.logger.debug('registered grants', { instanceId, grantedCount: granted.size });
  }

  check(instanceId: string, appletId: string, method: string): PermissionDecision {
    const decision = this.evaluate(instanceId, method);

    // Every invoke decision is audited, whether allowed or denied, so the
    // Gateway/audit pipeline has a complete trail.
    this.audit.record({
      appletId,
      instanceId,
      method,
      granted: decision.granted,
      timestamp: this.clock.now(),
      reason: decision.reason,
    });

    return decision;
  }

  revokeAll(instanceId: string): void {
    this.grants.delete(instanceId);
    this.logger.debug('revoked all grants', { instanceId });
  }

  // Decision precedence: an unknown method is a policy violation (POLICY_DENIED)
  // before we ever consult grants; a known-but-ungranted method is a permission
  // denial (PERMISSION_DENIED); otherwise the call is allowed.
  private evaluate(instanceId: string, method: string): PermissionDecision {
    if (!isCapabilityMethod(method)) {
      return { granted: false, reason: 'POLICY_DENIED' };
    }

    const granted = this.grants.get(instanceId);
    if (granted === undefined || !granted.has(method)) {
      return { granted: false, reason: 'PERMISSION_DENIED' };
    }

    return { granted: true };
  }
}
