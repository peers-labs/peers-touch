// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { describe, expect, it } from 'vitest';

import type {
  LifecycleKernelState,
  MobileRuntimeDescriptor,
  RuntimeBootstrapStatus,
} from '../app/lifecycle';
import { MobileDurableCommandState } from '../gen/proto/domain/mobile/reliability_pb';
import type { CommandProjection } from './commandRuntime';
import { createRecoveryProjection } from './recoveryProjection';

describe('recoveryProjection', () => {
  it('reports deferred runtimes only while the shell is visible', () => {
    const projection = createRecoveryProjection();

    projection.reportDeferredCapabilities(lifecycleState(
      'station-selection',
      [['auth', 'failed'], ['recovery-projection', 'bootstrapping']],
    ));
    expect(projection.getSnapshot().states).toEqual([]);

    projection.reportDeferredCapabilities(lifecycleState(
      'shell',
      [['auth', 'failed'], ['recovery-projection', 'bootstrapping']],
    ));
    expect(projection.getSnapshot().states).toMatchObject([
      {
        kind: 'deferred-capability',
        unavailableRuntimes: [
          {
            runtimeId: 'auth',
            status: 'failed',
          },
        ],
      },
    ]);

    projection.reportDeferredCapabilities(lifecycleState(
      'station-selection',
      [['auth', 'failed']],
    ));
    expect(projection.getSnapshot().states).toEqual([]);
  });

  it('clears only the device-local reason confirmed by its owner', () => {
    const projection = createRecoveryProjection();

    projection.reportDeviceLocalFlag('no-network');
    projection.clearDeviceLocalFlag('session-expired');
    expect(projection.getSnapshot()).toMatchObject({
      isWriteBlocked: true,
      states: [
        {
          kind: 'device-local-flag',
          reason: 'no-network',
        },
      ],
    });

    projection.clearDeviceLocalFlag('no-network');
    expect(projection.getSnapshot()).toMatchObject({
      isWriteBlocked: false,
      states: [],
    });
  });

  it('keeps legacy reliability data write-blocking until Rust confirms cleanup', () => {
    const projection = createRecoveryProjection();

    projection.reportLegacyReliabilityRecovery(6);
    expect(projection.getSnapshot()).toMatchObject({
      hasActiveRecovery: true,
      isWriteBlocked: true,
      states: [{
        kind: 'legacy-reliability-recovery',
        archivedLegacyFiles: 6,
        retainedReadOnly: false,
      }],
    });

    projection.reportLegacyReliabilityRecovery(6, true);
    expect(projection.getSnapshot().states).toMatchObject([{
      kind: 'legacy-reliability-recovery',
      retainedReadOnly: true,
    }]);

    projection.clearLegacyReliabilityRecovery();
    expect(projection.getSnapshot()).toMatchObject({
      hasActiveRecovery: false,
      isWriteBlocked: false,
      states: [],
    });
  });

  it('projects every actionable durable command without blocking unrelated writes', () => {
    const projection = createRecoveryProjection();

    projection.reportCommandRecovery([
      commandProjection('unknown', MobileDurableCommandState.UNRESOLVED),
      commandProjection('failed', MobileDurableCommandState.FAILED_TERMINAL),
    ]);

    expect(projection.getSnapshot()).toMatchObject({
      hasActiveRecovery: true,
      isWriteBlocked: false,
      states: [{
        kind: 'command-recovery',
        commands: [
          { commandId: 'unknown' },
          { commandId: 'failed' },
        ],
      }],
    });

    projection.clearCommandRecovery();
    expect(projection.getSnapshot().states).toEqual([]);
  });

  it('projects record or byte exhaustion while preserving command readback', () => {
    const projection = createRecoveryProjection();
    projection.reportCommandRecovery([
      commandProjection('readable', MobileDurableCommandState.UNRESOLVED),
    ]);
    projection.reportCapacityReadOnly({
      recordCount: 64,
      recordLimit: 512,
      byteUsage: 16_700_000,
      byteLimit: 16_777_216,
      exhaustionCauses: ['byte-capacity'],
    });

    expect(projection.getSnapshot()).toMatchObject({
      isWriteBlocked: true,
      states: [
        {
          kind: 'capacity-read-only',
          currentDepth: 64,
          maxCapacity: 512,
          currentBytes: 16_700_000,
          maxBytes: 16_777_216,
          exhaustionCauses: ['byte-capacity'],
        },
        {
          kind: 'command-recovery',
          commands: [{ commandId: 'readable' }],
        },
      ],
    });

    projection.reportCapacityReadOnly({
      recordCount: 512,
      recordLimit: 512,
      byteUsage: 4_096,
      byteLimit: 16_777_216,
      exhaustionCauses: ['record-count'],
    });
    expect(projection.getSnapshot().states[0]).toMatchObject({
      kind: 'capacity-read-only',
      exhaustionCauses: ['record-count'],
    });

    projection.reportCapacityReadOnly({
      recordCount: 63,
      recordLimit: 512,
      byteUsage: 16_400_000,
      byteLimit: 16_777_216,
      exhaustionCauses: [],
    });
    expect(projection.getSnapshot()).toMatchObject({
      isWriteBlocked: false,
      states: [{
        kind: 'command-recovery',
        commands: [{ commandId: 'readable' }],
      }],
    });
  });

  it('keeps an interrupted whole-app reset as the highest-priority blocking state', () => {
    const projection = createRecoveryProjection();
    projection.reportLegacyReliabilityRecovery(2);
    projection.reportReliabilityResetRecovery();

    expect(projection.getSnapshot()).toMatchObject({
      hasActiveRecovery: true,
      isWriteBlocked: true,
      states: [
        { kind: 'reliability-reset-recovery' },
        { kind: 'legacy-reliability-recovery' },
      ],
    });

    projection.clearReliabilityResetRecovery();
    expect(projection.getSnapshot().states).toMatchObject([
      { kind: 'legacy-reliability-recovery' },
    ]);
  });
});

function lifecycleState(
  launchState: LifecycleKernelState['launchState'],
  runtimes: readonly [string, RuntimeBootstrapStatus][],
): LifecycleKernelState {
  return {
    phase: 'ACTIVE',
    launchState,
    generation: 1,
    bootOrder: runtimes.map(([runtimeId]) => runtimeId),
    error: null,
    runtimes: new Map(runtimes.map(([runtimeId, status]) => [
      runtimeId,
      {
        descriptor: runtimeDescriptor(runtimeId),
        status,
        lastError: status === 'failed'
          ? 'mobile.lifecycle.bootstrapFailed'
          : null,
      },
    ])),
  };
}

function runtimeDescriptor(runtimeId: string): MobileRuntimeDescriptor {
  return {
    id: runtimeId,
    title: `${runtimeId} title`,
    responsibility: `${runtimeId} responsibility`,
    dependsOn: [],
    async bootstrap() {},
    async suspend() {},
    async resume() {},
    async teardown() {
      return {
        runtimeId,
        success: true,
        durationMs: 0,
      };
    },
  };
}

function commandProjection(
  commandId: string,
  state: MobileDurableCommandState,
): CommandProjection {
  return {
    commandId,
    orderingKey: 'friend:ptid:bob',
    state: state === MobileDurableCommandState.FAILED_TERMINAL
      ? 'failed-terminal'
      : 'unknown-outcome',
    attemptCount: 1,
    typedLastError: 0,
    createdAtMs: 1,
    updatedAtMs: 2,
    nextAttemptAtMs: null,
    envelope: {
      commandId,
      stationPeerId: 'station-a',
      actorPtid: 'ptid:alice',
      state,
    },
  } as CommandProjection;
}
