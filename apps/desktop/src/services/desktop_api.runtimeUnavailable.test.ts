import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentRuntimeUnavailableError,
} from './desktop_api';

describe('Desktop runtime-unavailable typed error mapping', () => {
  it('maps only the canonical Station contract to runtime selection', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.runtimeUnavailable',
      error_type: 'RUNTIME_UNAVAILABLE',
      locale_key: 'agent.errors.runtimeUnavailable',
      retryable: true,
      terminal: true,
      details: {
        runtime_kind: 'direct_model',
        reason_code: 'provider_disabled',
      },
    });

    expect(isAgentRuntimeUnavailableError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'selectRuntime',
      runtimeKind: 'direct_model',
      reasonCode: 'provider_disabled',
      label: 'agent.recovery.selectRuntime',
    });
  });

  it.each([
    ['wrong type', 'OTHER_ERROR', 'agent.errors.runtimeUnavailable', true, true, {
      runtime_kind: 'direct_model',
      reason_code: 'provider_disabled',
    }],
    ['wrong locale', 'RUNTIME_UNAVAILABLE', 'agent.errors.queueFull', true, true, {
      runtime_kind: 'direct_model',
      reason_code: 'provider_disabled',
    }],
    ['non-retryable', 'RUNTIME_UNAVAILABLE', 'agent.errors.runtimeUnavailable', false, true, {
      runtime_kind: 'direct_model',
      reason_code: 'provider_disabled',
    }],
    ['non-terminal', 'RUNTIME_UNAVAILABLE', 'agent.errors.runtimeUnavailable', true, false, {
      runtime_kind: 'direct_model',
      reason_code: 'provider_disabled',
    }],
    ['empty runtime', 'RUNTIME_UNAVAILABLE', 'agent.errors.runtimeUnavailable', true, true, {
      runtime_kind: ' ',
      reason_code: 'provider_disabled',
    }],
    ['empty reason', 'RUNTIME_UNAVAILABLE', 'agent.errors.runtimeUnavailable', true, true, {
      runtime_kind: 'direct_model',
      reason_code: '',
    }],
    ['extra detail', 'RUNTIME_UNAVAILABLE', 'agent.errors.runtimeUnavailable', true, true, {
      runtime_kind: 'direct_model',
      reason_code: 'provider_disabled',
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

    expect(isAgentRuntimeUnavailableError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });
});
