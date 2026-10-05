// Desktop AuditSink — routes Applet Kernel permission decisions to the unified logger.
//
// Authoritative contract: packages/applet-kernel/src/ports.ts (AuditSink).
// Execution plan: docs/architecture/platform/applet-runtime/execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md §6.2.
//
// Security: never records sessionId, tokens, or PII (AGENTS.md logging security).
// appletId / instanceId / method / granted are safe operational identifiers.

import type { AuditSink } from '@peers-touch/applet-kernel';
import { log } from '../../utils/logger';

const AUDIT_TAG = 'applet-kernel-audit';

export class DesktopAuditSink implements AuditSink {
  record(entry: {
    appletId: string;
    instanceId: string;
    method: string;
    granted: boolean;
    timestamp: number;
    reason?: string;
  }): void {
    log.info(AUDIT_TAG, entry.granted ? 'permission granted' : 'permission denied', {
      appletId: entry.appletId,
      instanceId: entry.instanceId,
      method: entry.method,
      granted: entry.granted,
      timestamp: entry.timestamp,
      reason: entry.reason,
    });
  }
}
