import { describe, expect, it } from 'vitest';

import {
  DELIVERY_HORIZON_MS,
  SUBMIT_CONVERGENCE_HORIZON_MS,
  evaluateDeliveryVerdict,
} from './deliveryVerdict';

const T0 = 2_000_000_000_000;

function facts(overrides: {
  state: string;
  timestampUnixMs?: number;
  attemptCount?: number;
  nextAttemptAtUnixMs?: number;
  lastErrorCode?: string;
  requiredDeviceCount?: number;
  deliveredDeviceCount?: number;
}) {
  return {
    timestampUnixMs: T0,
    ...overrides,
  };
}

describe('evaluateDeliveryVerdict', () => {
  it('keeps a fresh queued message inside the convergence horizon', () => {
    const verdict = evaluateDeliveryVerdict(
      facts({ state: 'pending' }),
      T0 + 30_000,
    );
    expect(verdict?.kind).toBe('queued');
  });

  it('flips a queued message to submit_overdue after 60s without losing reason data', () => {
    const verdict = evaluateDeliveryVerdict(
      facts({
        state: 'retry_wait',
        attemptCount: 3,
        lastErrorCode: 'transport',
        nextAttemptAtUnixMs: T0 + 61_000,
      }),
      T0 + SUBMIT_CONVERGENCE_HORIZON_MS,
    );
    expect(verdict).toMatchObject({
      kind: 'submit_overdue',
      attemptCount: 3,
      reasonCode: 'transport',
      nextAttemptAtUnixMs: T0 + 61_000,
    });
  });

  it('projects retry_wait with typed reason and next attempt before the horizon', () => {
    const verdict = evaluateDeliveryVerdict(
      facts({
        state: 'retry_wait',
        attemptCount: 1,
        lastErrorCode: 'no_route',
        nextAttemptAtUnixMs: T0 + 2_000,
      }),
      T0 + 1_000,
    );
    expect(verdict).toMatchObject({
      kind: 'retry_wait',
      reasonCode: 'no_route',
      nextAttemptAtUnixMs: T0 + 2_000,
    });
  });

  it('terminal failure always overrides horizon judgments', () => {
    const verdict = evaluateDeliveryVerdict(
      facts({ state: 'failed', lastErrorCode: 'rejected' }),
      T0 + DELIVERY_HORIZON_MS + 1,
    );
    expect(verdict).toMatchObject({
      kind: 'failed_terminal',
      reasonCode: 'rejected',
    });
  });

  it('submitted stays submitted within 24h and becomes suspected past it', () => {
    const within = evaluateDeliveryVerdict(
      facts({ state: 'accepted' }),
      T0 + DELIVERY_HORIZON_MS - 1,
    );
    expect(within?.kind).toBe('submitted');

    const overdue = evaluateDeliveryVerdict(
      facts({ state: 'accepted', lastErrorCode: 'transport' }),
      T0 + DELIVERY_HORIZON_MS,
    );
    expect(overdue).toMatchObject({
      kind: 'undeliverable_suspected',
      reasonCode: 'transport',
    });
  });

  it('upgrades suspected to delivered when a late receipt arrives', () => {
    const delivered = evaluateDeliveryVerdict(
      facts({ state: 'delivered', deliveredDeviceCount: 1, requiredDeviceCount: 2 }),
      T0 + DELIVERY_HORIZON_MS + 1,
    );
    expect(delivered).toMatchObject({
      kind: 'delivered',
      deliveredDeviceCount: 1,
      requiredDeviceCount: 2,
    });

    const fully = evaluateDeliveryVerdict(
      facts({ state: 'delivered', deliveredDeviceCount: 2, requiredDeviceCount: 2 }),
      T0 + DELIVERY_HORIZON_MS + 1,
    );
    expect(fully?.kind).toBe('fully_delivered');
  });

  it('treats read as the strongest fact', () => {
    const verdict = evaluateDeliveryVerdict(
      facts({ state: 'read', deliveredDeviceCount: 1, requiredDeviceCount: 3 }),
      T0 + DELIVERY_HORIZON_MS + 1,
    );
    expect(verdict?.kind).toBe('read');
  });

  it('hides the x/N fraction when the required denominator is unknown', () => {
    const verdict = evaluateDeliveryVerdict(
      facts({ state: 'delivered', deliveredDeviceCount: 4 }),
      T0,
    );
    expect(verdict).toMatchObject({
      kind: 'delivered',
      requiredDeviceCount: 0,
      deliveredDeviceCount: 4,
    });
  });

  it('returns null for unrecognized states', () => {
    expect(evaluateDeliveryVerdict(facts({ state: 'something-else' }), T0)).toBeNull();
  });
});
