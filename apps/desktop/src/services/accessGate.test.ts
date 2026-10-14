import { describe, expect, it } from 'vitest';

import {
  accessGateTypeNumber,
  isGenericSchemaGate,
  isMaintenanceGate,
  isTermsAcceptanceGate,
  parseGateFields,
  STATION_ACCESS_ATTEMPT_EXPIRED,
  STATION_ACCESS_IDENTITY_MISMATCH,
  STATION_ACCESS_UNKNOWN_GATE,
  stationAccessError,
  stationAccessFailureOutcome,
  type AccessDecision,
  type AccessGate,
} from './accessGate';

function gate(gateType: string | number): AccessGate {
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

  it('recognizes schema-driven and maintenance gates in numeric and string form', () => {
    for (const gateType of [8, 'ACCESS_GATE_TYPE_TERMS_ACCEPTANCE']) {
      const accessGate = gate(gateType);
      expect(isTermsAcceptanceGate(accessGate)).toBe(true);
      expect(isGenericSchemaGate(accessGate)).toBe(true);
      expect(accessGateTypeNumber(accessGate)).toBe(8);
    }

    for (const gateType of [7, 'ACCESS_GATE_TYPE_MAINTENANCE']) {
      const accessGate = gate(gateType);
      expect(isMaintenanceGate(accessGate)).toBe(true);
      expect(accessGateTypeNumber(accessGate)).toBe(7);
    }
  });

  it('parses Station-authored scalar field schemas including select options', () => {
    const accessGate = gate('ACCESS_GATE_TYPE_CUSTOM');
    accessGate.inputSchemaJson = JSON.stringify({
      fields: [
        { name: 'accepted', type: 'checkbox', required: true, label: 'Accept' },
        {
          name: 'region',
          type: 'select',
          options: ['earth', { label: 'Moon', value: 'moon' }],
        },
      ],
    });

    expect(parseGateFields(accessGate)).toEqual([
      { name: 'accepted', type: 'checkbox', required: true, label: 'Accept' },
      {
        name: 'region',
        type: 'select',
        options: ['earth', { label: 'Moon', value: 'moon' }],
      },
    ]);
  });
});
