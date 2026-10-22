import { describe, expect, it } from 'vitest';

import {
  projectCapabilityAdmission,
  type CapabilityFact,
  type SystemAction,
} from './platformContracts';

const evaluatedAt = '2026-10-17T00:00:00.000Z';

function fact(
  state: CapabilityFact['state'],
  capability = 'push',
): CapabilityFact {
  return {
    capability,
    releaseTarget: 'android',
    state,
    observedAt: evaluatedAt,
    source: 'native-observer',
  };
}

describe('projectCapabilityAdmission', () => {
  it('admits only an observed capability with ready runtime and policy', () => {
    expect(projectCapabilityAdmission({
      capability: 'push',
      facts: [fact('available')],
      runtimeReadiness: 'ready',
      stationPolicy: 'allowed',
      productPolicy: 'required',
      runtimeRevision: 'runtime-1',
      evaluatedAt,
    })).toMatchObject({
      capability: 'push',
      state: 'available',
      reasons: [],
    });
  });

  it('fails closed when the host observation is absent or unknown', () => {
    for (const facts of [[], [fact('unknown')]]) {
      expect(projectCapabilityAdmission({
        capability: 'push',
        facts,
        runtimeReadiness: 'ready',
        stationPolicy: 'allowed',
        productPolicy: 'required',
        runtimeRevision: 'runtime-1',
        evaluatedAt,
      }).state).toBe('unknown');
    }
  });

  it('keeps host, runtime, Station and product reasons distinguishable', () => {
    const projection = projectCapabilityAdmission({
      capability: 'push',
      facts: [fact('denied')],
      runtimeReadiness: 'degraded',
      stationPolicy: 'denied',
      productPolicy: 'required',
      stationPolicyRevision: 'station-policy-7',
      runtimeRevision: 'runtime-2',
      evaluatedAt,
    });

    expect(projection.state).toBe('blocked');
    expect(projection.reasons).toEqual([
      'station-policy-denied',
      'runtime-degraded',
      'capability-denied',
    ]);
    expect(projection.stationPolicyRevision).toBe('station-policy-7');
  });

  it('degrades optional capabilities instead of manufacturing success', () => {
    expect(projectCapabilityAdmission({
      capability: 'share',
      facts: [fact('unsupported', 'share')],
      runtimeReadiness: 'ready',
      stationPolicy: 'allowed',
      productPolicy: 'optional',
      runtimeRevision: 'runtime-3',
      evaluatedAt,
    })).toMatchObject({
      state: 'degraded',
      reasons: ['capability-unsupported'],
    });
  });

  it('keeps root back handoff inside the closed system-action contract', () => {
    const action: SystemAction = { kind: 'return_to_system' };

    expect(action).toEqual({ kind: 'return_to_system' });
  });
});
