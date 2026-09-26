import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACCESS_GATE_TYPE_AUTH_LOGIN,
  STATION_ACCESS_ATTEMPT_EXPIRED,
  STATION_ACCESS_IDENTITY_MISMATCH,
  STATION_ACCESS_UNKNOWN_GATE,
  accessDecisionFromProjection,
  advertisedCredentialChoices,
  cancelStationAccessAttempt,
  getStationAccessDecision,
  isCustomGate,
  isDeviceTrustGate,
  isSchemaDrivenGate,
  isTermsAcceptanceGate,
  parseGateFields,
  registerOAuthAccessGrantFinalizer,
  stationAccessError,
  stationAccessFailureOutcome,
  submitStationInviteCodeGate,
  submitStationLoginGate,
  type AccessGate,
  type AccessGateAction,
} from './authSession';
import {
  accessCancel,
  accessDecision,
  accessSubmit,
} from '../../services/mobileCommands';

vi.mock('../../services/mobileCommands', () => ({
  accessCancel: vi.fn(),
  accessDecision: vi.fn(),
  accessStart: vi.fn(),
  accessSubmit: vi.fn(),
  getSecureStorageValue: vi.fn(),
  removeSecureStorageValue: vi.fn(),
  setSecureStorageValue: vi.fn(),
}));

const TEST_CREDENTIAL = 'test-only-credential';

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('schema-driven Station access gates', () => {
  it('normalizes only valid Station-authored field descriptors', () => {
    expect(parseGateFields({
      gateId: 'terms',
      type: 'ACCESS_GATE_TYPE_TERMS_ACCEPTANCE',
      state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
      alternativeActions: [],
      actionId: 'terms.accept',
      schemaRevision: 1,
      schemaDigest: 'a'.repeat(64),
      inputSchemaJson: JSON.stringify({
        fields: [
          {
            name: 'accepted',
            type: 'CHECKBOX',
            label: 'Accept policy',
            required: true,
          },
          {
            name: 'region',
            type: 'select',
            options: ['us', { value: 'eu', label: 'Europe' }, { label: 'invalid' }],
          },
          { name: '', type: 'text' },
          null,
        ],
      }),
    })).toEqual([
      {
        name: 'accepted',
        type: 'checkbox',
        label: 'Accept policy',
        required: true,
      },
      {
        name: 'region',
        type: 'select',
        options: [{ value: 'us' }, { value: 'eu', label: 'Europe' }],
      },
    ]);
  });

  it('recognizes canonical terms, device, and custom gate types', () => {
    expect(isTermsAcceptanceGate(gate('ACCESS_GATE_TYPE_TERMS_ACCEPTANCE'))).toBe(true);
    expect(isDeviceTrustGate(gate('ACCESS_GATE_TYPE_DEVICE_TRUST'))).toBe(true);
    expect(isCustomGate(gate('ACCESS_GATE_TYPE_CUSTOM'))).toBe(true);
    expect(isSchemaDrivenGate(gate('ACCESS_GATE_TYPE_AUTH_LOGIN'))).toBe(false);
  });
});

describe('Station-advertised credential actions', () => {
  it('projects the canonical native Access decision', () => {
    const decision = accessDecisionFromProjection({
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
      attemptId: 'attempt-1',
      currentGateId: 'auth.login',
      accessGrantId: '',
      message: '',
      gates: [
        {
          gateId: 'auth.login',
          gateType: 'ACCESS_GATE_TYPE_AUTH_LOGIN',
          state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
          title: '',
          description: '',
          blockingReason: '',
          submitAction: 'submit_login',
          inputSchemaJson: '',
          actionId: 'auth.password',
          schemaRevision: 1,
          schemaDigest: 'a'.repeat(64),
          alternativeActions: [
            {
              actionId: 'auth.password',
              actionType: 'ACCESS_GATE_TYPE_AUTH_LOGIN',
              submitAction: 'submit_login',
              schemaRevision: 1,
              schemaDigest: 'a'.repeat(64),
            },
            {
              actionId: 'future.credential',
              actionType: 'ACCESS_GATE_TYPE_CUSTOM',
              submitAction: 'future_action',
              schemaRevision: 1,
              schemaDigest: 'b'.repeat(64),
            },
          ],
        },
      ],
    });

    expect(decision.gates[0].alternativeActions).toEqual([
      {
        actionId: 'auth.password',
        type: 'ACCESS_GATE_TYPE_AUTH_LOGIN',
        submitAction: 'submit_login',
        schemaRevision: 1,
        schemaDigest: 'a'.repeat(64),
      },
      {
        actionId: 'future.credential',
        type: 'ACCESS_GATE_TYPE_CUSTOM',
        submitAction: 'future_action',
        schemaRevision: 1,
        schemaDigest: 'b'.repeat(64),
      },
    ]);
  });

  it('submits password credentials through the native schema-bound action', async () => {
    vi.mocked(accessSubmit).mockResolvedValue({
      decision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        currentGateId: '',
        accessGrantId: 'grant-1',
        gates: [],
        message: '',
      },
      session: {
        sessionId: 'session-1',
        actorPtid: 'ptid:alice',
        deviceId: 'device-1',
        lifecycleGeneration: 1,
        expiresAt: '2030-01-01T00:00:00Z',
      },
    });
    const loginGate = gate('ACCESS_GATE_TYPE_AUTH_LOGIN');
    loginGate.gateId = 'auth.login';
    loginGate.actionId = 'auth.password';

    await expect(submitStationLoginGate({
      stationPeerId: 'station-peer',
      stationUrl: 'https://station.example/',
      attemptId: 'attempt-1',
      gate: loginGate,
      email: 'alice@example.test',
      password: TEST_CREDENTIAL,
      submissionId: 'submission-1',
    })).resolves.toMatchObject({
      decision: { state: 'ACCESS_DECISION_STATE_GRANTED' },
      session: { actorPtid: 'ptid:alice' },
    });

    expect(accessSubmit).toHaveBeenCalledWith({
      stationOrigin: 'https://station.example',
      stationPeerId: 'station-peer',
      attemptId: 'attempt-1',
      gateId: 'auth.login',
      gateType: ACCESS_GATE_TYPE_AUTH_LOGIN,
      actionId: 'auth.password',
      schemaRevision: 1,
      schemaDigest: 'a'.repeat(64),
      submissionId: 'submission-1',
      input: {
        kind: 'login',
        email: 'alice@example.test',
        password: TEST_CREDENTIAL,
      },
    });
    expect(JSON.stringify((await vi.mocked(accessSubmit).mock.results[0].value))).not.toContain(
      'accessToken',
    );
  });

  it('reuses a generated submission identity after a lost response', async () => {
    vi.mocked(accessSubmit)
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({
        decision: {
          state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
          attemptId: 'attempt-retry',
          currentGateId: 'auth.login',
          accessGrantId: '',
          gates: [{
            gateId: 'auth.login',
            gateType: 'ACCESS_GATE_TYPE_AUTH_LOGIN',
            state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
            title: '',
            description: '',
            blockingReason: '',
            submitAction: 'submit_login',
            inputSchemaJson: '',
            alternativeActions: [],
            actionId: 'auth.password',
            schemaRevision: 1,
            schemaDigest: 'a'.repeat(64),
          }],
          message: '',
        },
      });
    const loginGate = gate('ACCESS_GATE_TYPE_AUTH_LOGIN');
    loginGate.gateId = 'auth.login';
    loginGate.actionId = 'auth.password';
    const input = {
      stationPeerId: 'station-peer',
      stationUrl: 'https://station.example',
      attemptId: 'attempt-retry',
      gate: loginGate,
      email: 'alice@example.test',
      password: TEST_CREDENTIAL,
    };

    await expect(submitStationLoginGate(input)).rejects.toThrow('response lost');
    await expect(submitStationLoginGate(input)).resolves.toMatchObject({
      decision: {
        state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
        attemptId: 'attempt-retry',
      },
      session: null,
    });

    const firstSubmissionId = vi.mocked(accessSubmit).mock.calls[0][0].submissionId;
    const secondSubmissionId = vi.mocked(accessSubmit).mock.calls[1][0].submissionId;
    expect(firstSubmissionId).toBeTruthy();
    expect(secondSubmissionId).toBe(firstSubmissionId);
  });

  it('projects only exact supported advertisements into credential choices', () => {
    expect(advertisedCredentialChoices(gate(
      'ACCESS_GATE_TYPE_AUTH_LOGIN',
      [
        action('auth.password', 'ACCESS_GATE_TYPE_AUTH_LOGIN', 'submit_login'),
        action('auth.oauth', 'ACCESS_GATE_TYPE_AUTH_OAUTH', 'start_oauth'),
        action('future.credential', 'ACCESS_GATE_TYPE_CUSTOM', 'future_action'),
      ],
    ))).toEqual({ emailPassword: true, oauth: true });

    expect(advertisedCredentialChoices(gate(
      'ACCESS_GATE_TYPE_AUTH_LOGIN',
      [
        action('auth.oauth', 'ACCESS_GATE_TYPE_AUTH_OAUTH', 'wrong_transport'),
        action('future.credential', 'ACCESS_GATE_TYPE_CUSTOM', 'future_action'),
      ],
    ))).toEqual({ emailPassword: false, oauth: false });
    expect(advertisedCredentialChoices(gate('ACCESS_GATE_TYPE_AUTH_LOGIN'))).toEqual({
      emailPassword: false,
      oauth: false,
    });
  });
});

describe('canonical Station access failure outcomes', () => {
  it('classifies unknown gates, identity mismatch, and expiry consistently', () => {
    const unknownGate = {
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
      attemptId: 'attempt-1',
      currentGateId: 'future.gate',
      gates: [gate('ACCESS_GATE_TYPE_FUTURE')],
    };
    unknownGate.gates[0].gateId = 'future.gate';

    expect(stationAccessFailureOutcome(unknownGate, 100)).toBe(STATION_ACCESS_UNKNOWN_GATE);
    expect(stationAccessFailureOutcome({
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
      attemptId: 'attempt-1',
      currentGateId: 'auth.login',
      gates: [gate('ACCESS_GATE_TYPE_AUTH_LOGIN')],
      expiresAtUnixMs: 100,
    }, 100)).toBe(STATION_ACCESS_ATTEMPT_EXPIRED);
    expect(stationAccessError(new Error('Station identity mismatch'))).toMatchObject({
      code: STATION_ACCESS_IDENTITY_MISMATCH,
      message: STATION_ACCESS_IDENTITY_MISMATCH,
    });
  });
});

describe('Station access-attempt recovery transport', () => {
  it('refreshes the same attempt and preserves canonical snake_case decoding', async () => {
    vi.mocked(accessDecision).mockResolvedValue({
      decision: {
        state: 'ACCESS_DECISION_STATE_BLOCKED',
        attemptId: 'attempt-1',
        currentGateId: 'station.policy',
        accessGrantId: '',
        gates: [],
        message: '',
      },
    });

    await expect(getStationAccessDecision({
      stationPeerId: 'station-peer',
      stationUrl: 'https://station.example/',
      attemptId: 'attempt-1',
    })).resolves.toMatchObject({
      state: 'ACCESS_DECISION_STATE_BLOCKED',
      attemptId: 'attempt-1',
      currentGateId: 'station.policy',
    });
    expect(accessDecision).toHaveBeenCalledWith({
      stationOrigin: 'https://station.example',
      stationPeerId: 'station-peer',
      attemptId: 'attempt-1',
    });
  });

  it('rejects a refresh that returns a different Station attempt', async () => {
    vi.mocked(accessDecision).mockResolvedValue({
      decision: {
        state: 'ACCESS_DECISION_STATE_PENDING',
        attemptId: 'attempt-other',
        currentGateId: '',
        accessGrantId: '',
        gates: [],
        message: '',
      },
    });

    await expect(getStationAccessDecision({
      stationPeerId: 'station-peer',
      stationUrl: 'https://station.example',
      attemptId: 'attempt-1',
    })).rejects.toThrow('mobile.auth.gateAttemptMismatch');
  });

  it('finalizes native OAuth state when a refreshed decision becomes granted', async () => {
    const finalize = vi.fn().mockResolvedValue(undefined);
    const unregister = registerOAuthAccessGrantFinalizer(finalize);
    vi.mocked(accessDecision).mockResolvedValue({
      decision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        currentGateId: '',
        accessGrantId: 'grant-1',
        gates: [],
        message: '',
      },
    });

    try {
      await expect(getStationAccessDecision({
        stationPeerId: 'station-peer',
        stationUrl: 'https://station.example',
        attemptId: 'attempt-1',
      })).resolves.toMatchObject({
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
      });
      expect(finalize).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });

  it('cancels by exact attempt ID and accepts an idempotent false result', async () => {
    vi.mocked(accessCancel).mockResolvedValue(false);

    await expect(cancelStationAccessAttempt({
      stationPeerId: 'station-peer',
      stationUrl: 'https://station.example/',
      attemptId: 'attempt-1',
    })).resolves.toBe(false);
    expect(accessCancel).toHaveBeenCalledWith({
      stationOrigin: 'https://station.example',
      stationPeerId: 'station-peer',
      attemptId: 'attempt-1',
    });
  });
});

function gate(
  type: AccessGate['type'],
  alternativeActions: AccessGateAction[] = [],
): AccessGate {
  return {
    gateId: 'gate-id',
    type,
    state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
    alternativeActions,
    actionId: type === 'ACCESS_GATE_TYPE_AUTH_LOGIN'
      ? 'auth.password'
      : 'gate.action',
    schemaRevision: 1,
    schemaDigest: 'a'.repeat(64),
  };
}

function action(
  actionId: string,
  type: AccessGateAction['type'],
  submitAction: string,
): AccessGateAction {
  return {
    actionId,
    type,
    submitAction,
    schemaRevision: 1,
    schemaDigest: 'a'.repeat(64),
  };
}
