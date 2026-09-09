// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { describe, expect, it } from 'vitest';

import type {
  LifecycleKernelState,
  MobileRuntimeDescriptor,
  RuntimeBootstrapStatus,
} from '../app/lifecycle';
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

    projection.reportDeviceLocalFlag('station-unreachable');
    projection.clearDeviceLocalFlag('session-expired');
    expect(projection.getSnapshot().states).toMatchObject([
      {
        kind: 'device-local-flag',
        reason: 'station-unreachable',
      },
    ]);

    projection.clearDeviceLocalFlag('station-unreachable');
    expect(projection.getSnapshot().states).toEqual([]);
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
