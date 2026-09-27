import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentClientPermissionDeniedError,
  normalizeAgentTurnStreamError,
} from './desktop_api';

const DETAILS = {
  capability_id: 'filesystem.read',
  permission_kind: 'filesystem',
};

describe('Desktop client permission-denied typed error mapping', () => {
  it('maps only the canonical terminal contract to capability settings', () => {
    const error = agentTurnStreamErrorFromData({
      outcome_error: {
        error: 'agent.errors.clientPermissionDenied',
        error_type: 'CLIENT_PERMISSION_DENIED',
        locale_key: 'agent.errors.clientPermissionDenied',
        retryable: false,
        terminal: true,
        details: DETAILS,
      },
    });

    expect(isAgentClientPermissionDeniedError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'openPermissionSettings',
      capabilityId: DETAILS.capability_id,
      permissionKind: DETAILS.permission_kind,
      label: 'agent.recovery.openPermissionSettings',
    });
  });

  it.each([
    ['wrong type', 'OTHER_ERROR', 'agent.errors.clientPermissionDenied', false, true, DETAILS],
    ['wrong locale', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientLeaseExpired', false, true, DETAILS],
    ['retryable', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientPermissionDenied', true, true, DETAILS],
    ['non-terminal', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientPermissionDenied', false, false, DETAILS],
    ['empty capability', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientPermissionDenied', false, true, {
      ...DETAILS,
      capability_id: ' ',
    }],
    ['unknown permission', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientPermissionDenied', false, true, {
      ...DETAILS,
      permission_kind: 'location',
    }],
    ['extra detail', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientPermissionDenied', false, true, {
      ...DETAILS,
      device_id: 'private-device',
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

  it('normalizes only the allowlisted permission fields from native errors', () => {
    const error = normalizeAgentTurnStreamError(Object.assign(
      new Error('Agent turn rejected'),
      {
        details: {
          error_code: 'CLIENT_PERMISSION_DENIED',
          locale_key: 'agent.errors.clientPermissionDenied',
          retryable: 'false',
          terminal: 'true',
          capability_id: DETAILS.capability_id,
          permission_kind: DETAILS.permission_kind,
          device_id: 'private-device',
        },
      },
    ));

    expect(error.typedError).toEqual({
      error: 'Agent turn rejected',
      error_type: 'CLIENT_PERMISSION_DENIED',
      locale_key: 'agent.errors.clientPermissionDenied',
      retryable: false,
      terminal: true,
      details: DETAILS,
    });
    expect(error.resolution?.type).toBe('openPermissionSettings');
  });
});
