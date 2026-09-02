/**
 * recoveryProjection.ts — W6D Recovery and Degraded-State Projection
 *
 * Aggregates failure and degraded states from all runtimes into a single
 * typed projection consumed by recovery overlay components.
 *
 * Design principles:
 * - No recovery surface creates a second retry, persistence, or lifecycle owner.
 * - The projection is read-only; actions are dispatched to the owning runtime.
 * - Each failure state maps to exactly one overlay descriptor.
 */

import type { CommandProjection, DraftProjection } from './commandRuntime';
import type {
  IngressState,
  ProjectionStaleness,
  SocialIngressDomain,
  WriteAdmission,
} from './socialEventIngress';
import type { LifecycleKernelState, RuntimeBootstrapStatus } from '../app/lifecycle/types';

// ---------------------------------------------------------------------------
// Recovery state discriminated union
// ---------------------------------------------------------------------------

/** Draft restoration pending — user must choose whether to restore drafts. */
export interface DraftRestorePending {
  readonly kind: 'draft-restore-pending';
  readonly drafts: readonly DraftProjection[];
  readonly discoveredAtMs: number;
}

/** Commands with unknown outcome — Station never confirmed or denied. */
export interface UnknownOutcomeState {
  readonly kind: 'unknown-outcome';
  readonly commands: readonly CommandProjection[];
}

/** Command ledger is at capacity — write admission closed. */
export interface CapacityReadOnlyState {
  readonly kind: 'capacity-read-only';
  readonly currentDepth: number;
  readonly maxCapacity: number;
}

/** Write admission revoked by ingress due to control-event loss. */
export interface WriteRevocationState {
  readonly kind: 'write-revocation';
  readonly admission: WriteAdmission;
}

/** Station identity changed between sessions. */
export interface SessionMismatchState {
  readonly kind: 'session-mismatch';
  readonly expectedStationPeerId: string;
  readonly actualStationPeerId: string;
  readonly detectedAtMs: number;
}

/** Event ingress overflow triggered reconciliation for one or more domains. */
export interface EventOverflowReconcileState {
  readonly kind: 'event-overflow-reconcile';
  readonly staleDomains: readonly StaleDomainEntry[];
}

export interface StaleDomainEntry {
  readonly domain: SocialIngressDomain;
  readonly staleness: ProjectionStaleness;
}

/** A capability is deferred — not yet available during bootstrap. */
export interface DeferredCapabilityState {
  readonly kind: 'deferred-capability';
  readonly unavailableRuntimes: readonly DeferredRuntimeEntry[];
}

export interface DeferredRuntimeEntry {
  readonly runtimeId: string;
  readonly title: string;
  readonly status: RuntimeBootstrapStatus;
  readonly errorMessage: string | null;
}

/** Device-local flag — app is operating without network or Station. */
export interface DeviceLocalFlagState {
  readonly kind: 'device-local-flag';
  readonly reason: 'no-network' | 'station-unreachable' | 'session-expired';
  readonly since: number;
}

export type RecoveryState =
  | DraftRestorePending
  | UnknownOutcomeState
  | CapacityReadOnlyState
  | WriteRevocationState
  | SessionMismatchState
  | EventOverflowReconcileState
  | DeferredCapabilityState
  | DeviceLocalFlagState;

// ---------------------------------------------------------------------------
// Aggregated recovery projection
// ---------------------------------------------------------------------------

export interface RecoveryProjectionSnapshot {
  /** Active recovery states sorted by severity (highest first). */
  readonly states: readonly RecoveryState[];

  /** True when any recovery state is active. */
  readonly hasActiveRecovery: boolean;

  /** True when write operations are blocked by any recovery state. */
  readonly isWriteBlocked: boolean;

  /** Timestamp of the last projection update. */
  readonly updatedAtMs: number;
}

const EMPTY_SNAPSHOT: RecoveryProjectionSnapshot = {
  states: [],
  hasActiveRecovery: false,
  isWriteBlocked: false,
  updatedAtMs: 0,
};

// ---------------------------------------------------------------------------
// Recovery projection controller
// ---------------------------------------------------------------------------

export type RecoveryProjectionListener = (snapshot: RecoveryProjectionSnapshot) => void;

export interface RecoveryProjectionController {
  /** Current snapshot. */
  getSnapshot(): RecoveryProjectionSnapshot;

  /** Subscribe to snapshot changes. Returns unsubscribe function. */
  subscribe(listener: RecoveryProjectionListener): () => void;

  // --- Input ports: each owning runtime calls these to report state ---

  /** Report pending drafts discovered during bootstrap. */
  reportDraftRestorePending(drafts: readonly DraftProjection[]): void;

  /** Clear draft restore state after user confirms or dismisses. */
  clearDraftRestore(): void;

  /** Report commands with unknown outcome from ledger readback. */
  reportUnknownOutcome(commands: readonly CommandProjection[]): void;

  /** Clear unknown outcome state (commands resolved). */
  clearUnknownOutcome(): void;

  /** Report ledger capacity exhaustion. */
  reportCapacityReadOnly(currentDepth: number, maxCapacity: number): void;

  /** Clear capacity read-only (after purge reclaimed space). */
  clearCapacityReadOnly(): void;

  /** Report ingress write admission state. */
  reportWriteAdmission(admission: WriteAdmission): void;

  /** Report Station identity mismatch. */
  reportSessionMismatch(expected: string, actual: string): void;

  /** Clear session mismatch (user re-authenticated). */
  clearSessionMismatch(): void;

  /** Report stale domains from event overflow. */
  reportEventOverflow(staleDomains: readonly StaleDomainEntry[]): void;

  /** Clear event overflow after reconciliation completes. */
  clearEventOverflow(): void;

  /** Report deferred capabilities from lifecycle kernel state. */
  reportDeferredCapabilities(kernelState: LifecycleKernelState): void;

  /** Report device-local operating mode. */
  reportDeviceLocalFlag(reason: DeviceLocalFlagState['reason']): void;

  /** Clear device-local flag (connection restored). */
  clearDeviceLocalFlag(): void;

  /** Report full ingress state for composite checks. */
  reportIngressState(ingressState: IngressState): void;

  /** Teardown: clear all state and listeners. */
  teardown(): void;
}

// ---------------------------------------------------------------------------
// Severity ordering for recovery states
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<RecoveryState['kind'], number> = {
  'session-mismatch': 0,
  'write-revocation': 1,
  'capacity-read-only': 2,
  'device-local-flag': 3,
  'event-overflow-reconcile': 4,
  'unknown-outcome': 5,
  'draft-restore-pending': 6,
  'deferred-capability': 7,
};

function compareSeverity(a: RecoveryState, b: RecoveryState): number {
  return SEVERITY_ORDER[a.kind] - SEVERITY_ORDER[b.kind];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRecoveryProjection(): RecoveryProjectionController {
  const listeners = new Set<RecoveryProjectionListener>();
  let snapshot = EMPTY_SNAPSHOT;
  let torn = false;

  // Mutable slots for each recovery state
  let draftRestore: DraftRestorePending | null = null;
  let unknownOutcome: UnknownOutcomeState | null = null;
  let capacityReadOnly: CapacityReadOnlyState | null = null;
  let writeRevocation: WriteRevocationState | null = null;
  let sessionMismatch: SessionMismatchState | null = null;
  let eventOverflow: EventOverflowReconcileState | null = null;
  let deferredCapability: DeferredCapabilityState | null = null;
  let deviceLocalFlag: DeviceLocalFlagState | null = null;

  function rebuild(): void {
    if (torn) return;

    const states: RecoveryState[] = [];
    if (draftRestore) states.push(draftRestore);
    if (unknownOutcome) states.push(unknownOutcome);
    if (capacityReadOnly) states.push(capacityReadOnly);
    if (writeRevocation) states.push(writeRevocation);
    if (sessionMismatch) states.push(sessionMismatch);
    if (eventOverflow) states.push(eventOverflow);
    if (deferredCapability) states.push(deferredCapability);
    if (deviceLocalFlag) states.push(deviceLocalFlag);

    states.sort(compareSeverity);

    const isWriteBlocked =
      sessionMismatch !== null ||
      writeRevocation !== null ||
      capacityReadOnly !== null ||
      deviceLocalFlag !== null;

    snapshot = {
      states,
      hasActiveRecovery: states.length > 0,
      isWriteBlocked,
      updatedAtMs: Date.now(),
    };

    listeners.forEach((listener) => listener(snapshot));
  }

  return {
    getSnapshot(): RecoveryProjectionSnapshot {
      return snapshot;
    },

    subscribe(listener: RecoveryProjectionListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    reportDraftRestorePending(drafts: readonly DraftProjection[]): void {
      if (torn || drafts.length === 0) return;
      draftRestore = {
        kind: 'draft-restore-pending',
        drafts,
        discoveredAtMs: Date.now(),
      };
      rebuild();
    },

    clearDraftRestore(): void {
      if (!draftRestore) return;
      draftRestore = null;
      rebuild();
    },

    reportUnknownOutcome(commands: readonly CommandProjection[]): void {
      if (torn) return;
      if (commands.length === 0) {
        if (unknownOutcome) {
          unknownOutcome = null;
          rebuild();
        }
        return;
      }
      unknownOutcome = { kind: 'unknown-outcome', commands };
      rebuild();
    },

    clearUnknownOutcome(): void {
      if (!unknownOutcome) return;
      unknownOutcome = null;
      rebuild();
    },

    reportCapacityReadOnly(currentDepth: number, maxCapacity: number): void {
      if (torn) return;
      capacityReadOnly = { kind: 'capacity-read-only', currentDepth, maxCapacity };
      rebuild();
    },

    clearCapacityReadOnly(): void {
      if (!capacityReadOnly) return;
      capacityReadOnly = null;
      rebuild();
    },

    reportWriteAdmission(admission: WriteAdmission): void {
      if (torn) return;
      if (admission.open) {
        if (writeRevocation) {
          writeRevocation = null;
          rebuild();
        }
        return;
      }
      writeRevocation = { kind: 'write-revocation', admission };
      rebuild();
    },

    reportSessionMismatch(expected: string, actual: string): void {
      if (torn) return;
      sessionMismatch = {
        kind: 'session-mismatch',
        expectedStationPeerId: expected,
        actualStationPeerId: actual,
        detectedAtMs: Date.now(),
      };
      rebuild();
    },

    clearSessionMismatch(): void {
      if (!sessionMismatch) return;
      sessionMismatch = null;
      rebuild();
    },

    reportEventOverflow(staleDomains: readonly StaleDomainEntry[]): void {
      if (torn) return;
      if (staleDomains.length === 0) {
        if (eventOverflow) {
          eventOverflow = null;
          rebuild();
        }
        return;
      }
      eventOverflow = { kind: 'event-overflow-reconcile', staleDomains };
      rebuild();
    },

    clearEventOverflow(): void {
      if (!eventOverflow) return;
      eventOverflow = null;
      rebuild();
    },

    reportDeferredCapabilities(kernelState: LifecycleKernelState): void {
      if (torn) return;

      const unavailable: DeferredRuntimeEntry[] = [];
      kernelState.runtimes.forEach((entry, runtimeId) => {
        if (entry.status === 'failed' || entry.status === 'pending' || entry.status === 'bootstrapping') {
          unavailable.push({
            runtimeId,
            title: entry.descriptor.title,
            status: entry.status,
            errorMessage: entry.lastError,
          });
        }
      });

      if (unavailable.length === 0) {
        if (deferredCapability) {
          deferredCapability = null;
          rebuild();
        }
        return;
      }

      deferredCapability = { kind: 'deferred-capability', unavailableRuntimes: unavailable };
      rebuild();
    },

    reportDeviceLocalFlag(reason: DeviceLocalFlagState['reason']): void {
      if (torn) return;
      deviceLocalFlag = { kind: 'device-local-flag', reason, since: Date.now() };
      rebuild();
    },

    clearDeviceLocalFlag(): void {
      if (!deviceLocalFlag) return;
      deviceLocalFlag = null;
      rebuild();
    },

    reportIngressState(ingressState: IngressState): void {
      if (torn) return;

      // Derive write revocation from ingress admission
      if (!ingressState.writeAdmission.open) {
        writeRevocation = { kind: 'write-revocation', admission: ingressState.writeAdmission };
      } else if (writeRevocation) {
        writeRevocation = null;
      }

      // Derive stale domains from ingress staleness
      const stale: StaleDomainEntry[] = [];
      for (const [domain, staleness] of Object.entries(ingressState.staleness)) {
        if (staleness.stale) {
          stale.push({ domain: domain as SocialIngressDomain, staleness });
        }
      }
      if (stale.length > 0) {
        eventOverflow = { kind: 'event-overflow-reconcile', staleDomains: stale };
      } else if (eventOverflow) {
        eventOverflow = null;
      }

      rebuild();
    },

    teardown(): void {
      torn = true;
      draftRestore = null;
      unknownOutcome = null;
      capacityReadOnly = null;
      writeRevocation = null;
      sessionMismatch = null;
      eventOverflow = null;
      deferredCapability = null;
      deviceLocalFlag = null;
      listeners.clear();
      snapshot = EMPTY_SNAPSHOT;
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let projectionInstance: RecoveryProjectionController | null = null;

export function getRecoveryProjection(): RecoveryProjectionController {
  if (!projectionInstance) {
    projectionInstance = createRecoveryProjection();
  }
  return projectionInstance;
}

export function destroyRecoveryProjection(): void {
  projectionInstance?.teardown();
  projectionInstance = null;
}
