// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccessDecision } from '../features/auth/authSession';
import { destroyRecoveryProjection, getRecoveryProjection } from './recoveryProjection';
import { createSessionRuntimeController } from './sessionRuntime';

const NOW = Date.parse('2026-09-17T00:00:00.000Z');
const station = {
  stationPeerId: 'station-a',
  url: 'https://station.example',
  label: 'Station',
  createdAt: 1,
  lastUsedAt: 1,
};
const granted: AccessDecision = {
  state: 'ACCESS_DECISION_STATE_GRANTED',
  attemptId: 'attempt-a',
  gates: [],
};

function runtime(expiresAt = '2026-09-17T01:00:00.000Z') {
  return createSessionRuntimeController({
    native: {
      read: async () => ({
        stationPeerId: 'station-a',
        sessionId: 'session-a',
        actorPtid: 'ptid:alice',
        deviceId: 'device-a',
        lifecycleGeneration: 1,
        expiresAt,
      }),
      refresh: async () => ({
        stationPeerId: 'station-a',
        sessionId: 'session-b',
        actorPtid: 'ptid:alice',
        deviceId: 'device-a',
        lifecycleGeneration: 2,
        expiresAt,
      }),
      revoke: async () => ({
        stationRevocation: 'confirmed',
        secureStorage: {
          activeAttemptIndexAbsent: true,
          attemptSecretRecordAbsent: true,
          currentSessionIndexAbsent: true,
          credentialRecordAbsent: true,
          publicProjectionAbsent: true,
        },
      }),
    },
    clock: {
      now: () => NOW,
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    },
  });
}

describe('authoritative session recovery', () => {
  beforeEach(() => {
    destroyRecoveryProjection();
  });

  afterEach(() => {
    vi.useRealTimers();
    destroyRecoveryProjection();
  });

  it('clears session-expired only after a granted active session', async () => {
    const recovery = getRecoveryProjection();
    recovery.reportDeviceLocalFlag('session-expired');

    const controller = runtime();
    await controller.restore(station, granted);

    expect(controller.getSnapshot().phase).toBe('active');
    expect(recovery.getSnapshot().states).toEqual([]);
    expect(recovery.getSnapshot().isWriteBlocked).toBe(false);
  });

  it.each([
    'ACCESS_DECISION_STATE_ACTION_REQUIRED',
    'ACCESS_DECISION_STATE_DENIED',
  ])('keeps recovery while the access result is %s', async (state) => {
    const recovery = getRecoveryProjection();
    recovery.reportDeviceLocalFlag('session-expired');

    const controller = runtime();
    await controller.restore(station, { ...granted, state });

    expect(controller.getSnapshot().session).toBeNull();
    expect(recovery.getSnapshot().states).toContainEqual(
      expect.objectContaining({ kind: 'device-local-flag', reason: 'session-expired' }),
    );
  });

  it('does not admit an explicitly expired native session', async () => {
    const recovery = getRecoveryProjection();
    recovery.reportDeviceLocalFlag('session-expired');

    const controller = runtime('2026-09-16T23:59:59.000Z');
    await controller.restore(station, granted);

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'expired',
      session: null,
      writesAllowed: false,
    });
    expect(recovery.getSnapshot().isWriteBlocked).toBe(true);
  });

  it.each(['no-network', 'station-unreachable'] as const)(
    'preserves the independent %s recovery state after activation',
    async (reason) => {
      const recovery = getRecoveryProjection();
      recovery.reportDeviceLocalFlag(reason);

      await runtime().restore(station, granted);

      expect(recovery.getSnapshot().states).toContainEqual(
        expect.objectContaining({ kind: 'device-local-flag', reason }),
      );
    },
  );

  it('preserves durable recovery and Station mismatch after activation', async () => {
    const recovery = getRecoveryProjection();
    recovery.reportDeviceLocalFlag('session-expired');
    recovery.reportCapacityReadOnly({
      recordCount: 20,
      recordLimit: 20,
      byteUsage: 1_024,
      byteLimit: 4_096,
      exhaustionCauses: ['record-count'],
    });
    recovery.reportSessionMismatch('station-a', 'station-b');

    await runtime().restore(station, granted);

    expect(recovery.getSnapshot().states.map((entry) => entry.kind)).toEqual([
      'session-mismatch',
      'capacity-read-only',
    ]);
    expect(recovery.getSnapshot().isWriteBlocked).toBe(true);
  });
});
