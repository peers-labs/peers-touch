import { describe, expect, it } from 'vitest';

import {
  STATION_ACCESS_ATTEMPT_EXPIRED,
  STATION_ACCESS_IDENTITY_MISMATCH,
  STATION_ACCESS_UNKNOWN_GATE,
  stationAccessError,
  stationAccessFailureOutcome,
  type AccessDecision,
  type AccessGate,
} from './accessGate';

function gate(gateType: string): AccessGate {
  return {
    gateId: 'gate-1',
    gateType,
    state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
    title: '',
    description: '',
    blockingReason: '',
    submitAction: '',
    inputSchemaJson: '',
    alternativeActions: [],
    actionId: 'action-1',
    schemaRevision: 1,
    schemaDigest: 'a'.repeat(64),
  };
}

function decision(accessGate: AccessGate): AccessDecision {
  return {
    state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
    attemptId: 'attempt-1',
    currentGateId: accessGate.gateId,
    gates: [accessGate],
    accessGrantId: '',
    message: '',
  };
}

describe('canonical Station access failure outcomes', () => {
  it('classifies unknown gates, identity mismatch, and expiry', () => {
    expect(stationAccessFailureOutcome(decision(
      gate('ACCESS_GATE_TYPE_FUTURE'),
    ), 100)).toBe(STATION_ACCESS_UNKNOWN_GATE);

    expect(stationAccessFailureOutcome({
      ...decision(gate('ACCESS_GATE_TYPE_AUTH_LOGIN')),
      expiresAtUnixMs: 100,
    }, 100)).toBe(STATION_ACCESS_ATTEMPT_EXPIRED);

    expect(stationAccessError(new Error('station_identity_mismatch'))).toMatchObject({
      code: STATION_ACCESS_IDENTITY_MISMATCH,
      message: STATION_ACCESS_IDENTITY_MISMATCH,
    });
  });
});
