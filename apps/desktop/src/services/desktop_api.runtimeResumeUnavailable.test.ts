import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentRuntimeResumeUnavailableError,
} from './desktop_api';

describe('Desktop runtime-resume-unavailable typed error mapping', () => {
  it('maps only the canonical Station contract to confirmed reset', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.resumeUnavailable',
      error_type: 'RUNTIME_RESUME_UNAVAILABLE',
      locale_key: 'agent.errors.resumeUnavailable',
      retryable: true,
      terminal: true,
      details: {
        runtime_profile_id: 'external-agent',
        reason_code: 'session_not_found',
      },
    });

    expect(isAgentRuntimeResumeUnavailableError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'confirmReset',
      runtimeProfileId: 'external-agent',
      reasonCode: 'session_not_found',
      label: 'agent.recovery.confirmReset',
    });
  });

  it.each([
    ['wrong type', 'OTHER_ERROR', 'agent.errors.resumeUnavailable', true, true, {
      runtime_profile_id: 'external-agent',
      reason_code: 'session_not_found',
    }],
    ['wrong locale', 'RUNTIME_RESUME_UNAVAILABLE', 'agent.errors.runtimeUnavailable', true, true, {
      runtime_profile_id: 'external-agent',
      reason_code: 'session_not_found',
    }],
    ['non-retryable', 'RUNTIME_RESUME_UNAVAILABLE', 'agent.errors.resumeUnavailable', false, true, {
      runtime_profile_id: 'external-agent',
      reason_code: 'session_not_found',
    }],
    ['non-terminal', 'RUNTIME_RESUME_UNAVAILABLE', 'agent.errors.resumeUnavailable', true, false, {
      runtime_profile_id: 'external-agent',
      reason_code: 'session_not_found',
    }],
    ['empty profile', 'RUNTIME_RESUME_UNAVAILABLE', 'agent.errors.resumeUnavailable', true, true, {
      runtime_profile_id: ' ',
      reason_code: 'session_not_found',
    }],
    ['empty reason', 'RUNTIME_RESUME_UNAVAILABLE', 'agent.errors.resumeUnavailable', true, true, {
      runtime_profile_id: 'external-agent',
      reason_code: '',
    }],
    ['extra detail', 'RUNTIME_RESUME_UNAVAILABLE', 'agent.errors.resumeUnavailable', true, true, {
      runtime_profile_id: 'external-agent',
      reason_code: 'session_not_found',
      provider_id: 'provider-1',
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
      error: localeKey,
      error_type: errorType,
      locale_key: localeKey,
      retryable,
      terminal,
      details,
    });

    expect(isAgentRuntimeResumeUnavailableError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });
});
