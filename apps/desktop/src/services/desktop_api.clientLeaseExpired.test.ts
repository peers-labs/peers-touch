import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  classifyAgentTurnTerminalEvent,
  isAgentClientLeaseExpiredError,
  projectAgentTurnOutcomeErrorPayload,
} from './desktop_api';

const DETAILS = {
  session_id: 'capability-session-1',
  lease_id: 'capability-lease-1',
  expired_at: '2026-09-15T03:00:00Z',
};

describe('Desktop client lease-expired typed error mapping', () => {
  it('maps only the canonical non-terminal contract to reconcile', () => {
    const error = agentTurnStreamErrorFromData({
      outcome_error: {
        error: 'agent.errors.clientLeaseExpired',
        error_type: 'CLIENT_LEASE_EXPIRED',
        locale_key: 'agent.errors.clientLeaseExpired',
        retryable: true,
        terminal: false,
        details: DETAILS,
      },
    });

    expect(isAgentClientLeaseExpiredError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'reconcile',
      sessionId: DETAILS.session_id,
      leaseId: DETAILS.lease_id,
      expiredAt: DETAILS.expired_at,
      label: 'agent.recovery.reconcile',
    });
  });

  it.each([
    ['wrong type', 'OTHER_ERROR', 'agent.errors.clientLeaseExpired', true, false, DETAILS],
    ['wrong locale', 'CLIENT_LEASE_EXPIRED', 'agent.errors.executorUnavailable', true, false, DETAILS],
    ['not retryable', 'CLIENT_LEASE_EXPIRED', 'agent.errors.clientLeaseExpired', false, false, DETAILS],
    ['terminal', 'CLIENT_LEASE_EXPIRED', 'agent.errors.clientLeaseExpired', true, true, DETAILS],
    ['missing session', 'CLIENT_LEASE_EXPIRED', 'agent.errors.clientLeaseExpired', true, false, {
      lease_id: DETAILS.lease_id,
      expired_at: DETAILS.expired_at,
    }],
    ['invalid expiry', 'CLIENT_LEASE_EXPIRED', 'agent.errors.clientLeaseExpired', true, false, {
      ...DETAILS,
      expired_at: 'not-a-timestamp',
    }],
    ['extra detail', 'CLIENT_LEASE_EXPIRED', 'agent.errors.clientLeaseExpired', true, false, {
      ...DETAILS,
      target_device_id: 'device-1',
    }],
  ])('rejects %s from local recovery mapping', (
    _case,
    errorType,
    localeKey,
    retryable,
    terminal,
    details,
  ) => {
    const error = agentTurnStreamErrorFromData({
      outcome_error: {
        error: localeKey,
        error_type: errorType,
        locale_key: localeKey,
        retryable,
        terminal,
        details,
      },
    });

    expect(error.resolution).toBeUndefined();
  });

  it('projects the canonical payload from a non-terminal progress event', () => {
    const data = {
      outcome_error: {
        error: 'agent.errors.clientLeaseExpired',
        error_type: 'CLIENT_LEASE_EXPIRED',
        locale_key: 'agent.errors.clientLeaseExpired',
        retryable: true,
        terminal: false,
        details: DETAILS,
      },
    };
    expect(projectAgentTurnOutcomeErrorPayload(data)).toMatchObject({
      error_type: 'CLIENT_LEASE_EXPIRED',
      details: DETAILS,
    });
    expect(classifyAgentTurnTerminalEvent({
      event: 'progress',
      data,
    })).toBeNull();
  });
});
