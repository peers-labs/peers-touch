import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentProviderTimeoutError,
} from './desktop_api';

const deadline = '2026-09-16T01:02:03.456000000Z';

describe('Desktop provider-timeout typed error mapping', () => {
  it('maps the canonical Station payload to explicit retry', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.providerTimeout',
      error_type: 'PROVIDER_TIMEOUT',
      locale_key: 'agent.errors.providerTimeout',
      retryable: true,
      terminal: true,
      details: {
        provider_id: 'provider-1',
        model_id: 'model-1',
        deadline,
      },
    });

    expect(isAgentProviderTimeoutError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'retry',
      providerId: 'provider-1',
      modelId: 'model-1',
      deadline,
      label: 'agent.recovery.retry',
    });
  });

  it('preserves the flat transport deadline detail', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.providerTimeout',
      error_type: 'PROVIDER_TIMEOUT',
      locale_key: 'agent.errors.providerTimeout',
      retryable: true,
      terminal: true,
      provider_id: 'provider-1',
      model_id: 'model-1',
      deadline,
    });

    expect(error.typedError?.details).toEqual({
      provider_id: 'provider-1',
      model_id: 'model-1',
      deadline,
    });
    expect(isAgentProviderTimeoutError(error.typedError)).toBe(true);
  });

  it('rejects a supplied retry action when the typed payload is invalid', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.providerTimeout',
      error_type: 'PROVIDER_TIMEOUT',
      locale_key: 'agent.errors.providerTimeout',
      retryable: true,
      terminal: true,
      details: {
        provider_id: 'provider-1',
        model_id: 'model-1',
        deadline: 'not-rfc3339',
      },
      resolution: {
        type: 'retry',
        providerId: 'provider-1',
        modelId: 'model-1',
        deadline: 'not-rfc3339',
        label: 'agent.recovery.retry',
      },
    });

    expect(isAgentProviderTimeoutError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });

  it.each([
    ['wrong type', 'OTHER', 'agent.errors.providerTimeout', true, true, {
      provider_id: 'provider-1',
      model_id: 'model-1',
      deadline,
    }],
    ['wrong locale', 'PROVIDER_TIMEOUT', 'agent.errors.providerRateLimit', true, true, {
      provider_id: 'provider-1',
      model_id: 'model-1',
      deadline,
    }],
    ['non-retryable', 'PROVIDER_TIMEOUT', 'agent.errors.providerTimeout', false, true, {
      provider_id: 'provider-1',
      model_id: 'model-1',
      deadline,
    }],
    ['non-terminal', 'PROVIDER_TIMEOUT', 'agent.errors.providerTimeout', true, false, {
      provider_id: 'provider-1',
      model_id: 'model-1',
      deadline,
    }],
    ['empty provider', 'PROVIDER_TIMEOUT', 'agent.errors.providerTimeout', true, true, {
      provider_id: '',
      model_id: 'model-1',
      deadline,
    }],
    ['empty model', 'PROVIDER_TIMEOUT', 'agent.errors.providerTimeout', true, true, {
      provider_id: 'provider-1',
      model_id: '',
      deadline,
    }],
    ['non-RFC3339 deadline', 'PROVIDER_TIMEOUT', 'agent.errors.providerTimeout', true, true, {
      provider_id: 'provider-1',
      model_id: 'model-1',
      deadline: '2026-09-16 01:02:03Z',
    }],
    ['impossible deadline', 'PROVIDER_TIMEOUT', 'agent.errors.providerTimeout', true, true, {
      provider_id: 'provider-1',
      model_id: 'model-1',
      deadline: '2026-02-30T01:02:03Z',
    }],
    ['extra detail', 'PROVIDER_TIMEOUT', 'agent.errors.providerTimeout', true, true, {
      provider_id: 'provider-1',
      model_id: 'model-1',
      deadline,
      retry_after_ms: '0',
    }],
  ])('rejects %s', (
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

    expect(isAgentProviderTimeoutError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });
});
