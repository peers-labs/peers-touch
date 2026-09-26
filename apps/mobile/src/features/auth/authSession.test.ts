import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACCESS_GATE_TYPE_AUTH_LOGIN,
  advertisedCredentialChoices,
  cancelStationAccessAttempt,
  getStationAccessDecision,
  isCustomGate,
  isDeviceTrustGate,
  isSchemaDrivenGate,
  isTermsAcceptanceGate,
  normalizeDecision,
  parseGateFields,
  registerOAuthAccessGrantFinalizer,
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

  it('recognizes numeric and string terms, device, and custom gate types', () => {
    expect(isTermsAcceptanceGate(gate(8))).toBe(true);
    expect(isTermsAcceptanceGate(gate('ACCESS_GATE_TYPE_TERMS_ACCEPTANCE'))).toBe(true);
    expect(isDeviceTrustGate(gate(6))).toBe(true);
    expect(isDeviceTrustGate(gate('ACCESS_GATE_TYPE_DEVICE_TRUST'))).toBe(true);
    expect(isCustomGate(gate(100))).toBe(true);
    expect(isCustomGate(gate('ACCESS_GATE_TYPE_CUSTOM'))).toBe(true);
    expect(isSchemaDrivenGate(gate('ACCESS_GATE_TYPE_AUTH_LOGIN'))).toBe(false);
  });
});

describe('Station-advertised credential actions', () => {
  it('normalizes snake_case Station actions and camelCase Rust projections', () => {
    const decision = normalizeDecision({
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
      attempt_id: 'attempt-1',
      current_gate_id: 'auth.login',
      gates: [
        {
          gate_id: 'auth.login',
          type: 'ACCESS_GATE_TYPE_AUTH_LOGIN',
          state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
          alternative_actions: [
            {
              action_id: 'auth.password',
              type: 2,
              submit_action: 'submit_login',
              schema_revision: 1,
              schema_digest: 'a'.repeat(64),
            },
            {
              action_id: 'future.credential',
              type: 100,
              submit_action: 'future_action',
              schema_revision: 1,
              schema_digest: 'b'.repeat(64),
            },
          ],
        },
        {
          gateId: 'auth.login.camel',
          gateType: 2,
          state: 2,
          alternativeActions: [{
            actionId: 'auth.oauth',
            actionType: 'ACCESS_GATE_TYPE_AUTH_OAUTH',
            submitAction: 'start_oauth',
            schemaRevision: 1,
            schemaDigest: 'c'.repeat(64),
          }],
        },
      ],
    });

    expect(decision.gates[0].alternativeActions).toEqual([
      {
        actionId: 'auth.password',
        type: 2,
        submitAction: 'submit_login',
        schemaRevision: 1,
        schemaDigest: 'a'.repeat(64),
      },
      {
        actionId: 'future.credential',
        type: 100,
        submitAction: 'future_action',
        schemaRevision: 1,
        schemaDigest: 'b'.repeat(64),
      },
    ]);
    expect(decision.gates[1].type).toBe(2);
    expect(decision.gates[1].alternativeActions).toEqual([{
      actionId: 'auth.oauth',
      type: 'ACCESS_GATE_TYPE_AUTH_OAUTH',
      submitAction: 'start_oauth',
      schemaRevision: 1,
      schemaDigest: 'c'.repeat(64),
    }]);
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
      password: 'secret',
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
        password: 'secret',
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
          currentGateId: 'terms.acceptance',
          accessGrantId: '',
          gates: [],
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
      password: 'secret',
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
        action('auth.oauth', 9, 'start_oauth'),
        action('future.credential', 100, 'future_action'),
      ],
    ))).toEqual({ emailPassword: true, oauth: true });

    expect(advertisedCredentialChoices(gate(
      2,
      [
        action('auth.oauth', 9, 'wrong_transport'),
        action('future.credential', 100, 'future_action'),
      ],
    ))).toEqual({ emailPassword: false, oauth: false });
    expect(advertisedCredentialChoices(gate(2))).toEqual({
      emailPassword: false,
      oauth: false,
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
    actionId: type === 2 || type === 'ACCESS_GATE_TYPE_AUTH_LOGIN'
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
