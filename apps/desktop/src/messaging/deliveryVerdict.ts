/**
 * MP-D34 delivery verdict projection.
 *
 * The messaging store exposes durable facts only (outbox attempt metadata,
 * authority-accepted state, per-device delivered receipts). This module turns
 * those facts into the sender-facing verdict: durable facts always win, and
 * horizons produce revocable local judgments that never stop outbox retry and
 * are always upgradable by later facts.
 *
 *   queued ──60s without submitted──▶ submit_overdue (judgment)
 *      │
 *      ▼
 *   submitted (authority accepted fact)
 *      ├── delivered ── fully_delivered ── read   (facts)
 *      ├── failed_terminal                         (fact)
 *      └── 24h without a positive receipt
 *             └──▶ undeliverable_suspected (judgment)
 */

/** Command convergence horizon: 60s after admission without submitted. */
export const SUBMIT_CONVERGENCE_HORIZON_MS = 60_000;
/** Delivery horizon: 24h after submitted without a positive delivery fact. */
export const DELIVERY_HORIZON_MS = 24 * 60 * 60_000;

export type DeliveryVerdictKind =
  | 'queued'
  | 'retry_wait'
  | 'submit_overdue'
  | 'submitted'
  | 'delivered'
  | 'fully_delivered'
  | 'read'
  | 'failed_terminal'
  | 'undeliverable_suspected';

export interface DeliveryVerdict {
  kind: DeliveryVerdictKind;
  /** Outbox attempts so far (pre-submit verdicts). */
  attemptCount: number;
  /** Typed transport/authority reason, when one exists. */
  reasonCode?: string;
  /** Scheduled next outbox attempt, when the outbox knows one. */
  nextAttemptAtUnixMs?: number;
  /** Distinct recipient devices with a durable delivered receipt. */
  deliveredDeviceCount: number;
  /** Required recipient devices in the immutable send plan (0 = unknown). */
  requiredDeviceCount: number;
}

export interface DeliveryVerdictFacts {
  /** Local pending state or projected delivery_state. */
  state: string;
  /**
   * Admission time while pending, authority commit time once submitted.
   */
  timestampUnixMs: number;
  attemptCount?: number;
  nextAttemptAtUnixMs?: number;
  lastErrorCode?: string;
  requiredDeviceCount?: number;
  deliveredDeviceCount?: number;
}

function withCounts(
  kind: DeliveryVerdictKind,
  facts: DeliveryVerdictFacts,
  extras?: Pick<DeliveryVerdict, 'reasonCode' | 'nextAttemptAtUnixMs'>,
): DeliveryVerdict {
  return {
    kind,
    attemptCount: facts.attemptCount ?? 0,
    deliveredDeviceCount: facts.deliveredDeviceCount ?? 0,
    requiredDeviceCount: facts.requiredDeviceCount ?? 0,
    ...extras,
  };
}

/**
 * Evaluate the local verdict for one of the actor's own messages. Returns
 * null for incoming messages or unrecognized states so callers render no
 * sender meta at all rather than a fabricated state.
 */
export function evaluateDeliveryVerdict(
  facts: DeliveryVerdictFacts,
  nowUnixMs: number,
): DeliveryVerdict | null {
  const reasonCode = facts.lastErrorCode || undefined;
  const requiredDeviceCount = facts.requiredDeviceCount ?? 0;
  const deliveredDeviceCount = facts.deliveredDeviceCount ?? 0;

  switch (facts.state) {
    // Terminal authority/transport fact; overrides every horizon judgment.
    case 'failed':
      return withCounts('failed_terminal', facts, { reasonCode });
    // Strongest monotonic receipt fact.
    case 'read':
      return withCounts('read', facts);
    case 'delivered':
    case 'fully_delivered':
      if (requiredDeviceCount > 0 && deliveredDeviceCount >= requiredDeviceCount) {
        return withCounts('fully_delivered', facts);
      }
      return withCounts('delivered', facts);
    // Accepted but no positive receipt yet: 24h delivery horizon.
    case 'accepted':
    case 'submitted': {
      if (
        deliveredDeviceCount > 0
        && requiredDeviceCount > 0
        && deliveredDeviceCount >= requiredDeviceCount
      ) {
        return withCounts('fully_delivered', facts);
      }
      if (deliveredDeviceCount > 0) {
        return withCounts('delivered', facts);
      }
      const ageMs = nowUnixMs - facts.timestampUnixMs;
      if (ageMs >= DELIVERY_HORIZON_MS) {
        return withCounts('undeliverable_suspected', facts, { reasonCode });
      }
      return withCounts('submitted', facts);
    }
    // Pre-submission local states: 60s command convergence horizon.
    case 'retry_wait': {
      if (nowUnixMs - facts.timestampUnixMs >= SUBMIT_CONVERGENCE_HORIZON_MS) {
        return withCounts('submit_overdue', facts, {
          reasonCode,
          nextAttemptAtUnixMs: facts.nextAttemptAtUnixMs,
        });
      }
      return withCounts('retry_wait', facts, {
        reasonCode,
        nextAttemptAtUnixMs: facts.nextAttemptAtUnixMs,
      });
    }
    case 'draft':
    case 'pending': {
      if (nowUnixMs - facts.timestampUnixMs >= SUBMIT_CONVERGENCE_HORIZON_MS) {
        return withCounts('submit_overdue', facts, {
          reasonCode,
          nextAttemptAtUnixMs: facts.nextAttemptAtUnixMs,
        });
      }
      return withCounts('queued', facts);
    }
    default:
      return null;
  }
}
