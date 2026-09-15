import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentProviderRateLimitError,
} from './desktop_api';

describe('Desktop provider-rate-limit typed error mapping', () => {
  it('maps the canonical Station payload to explicit retry', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.providerRateLimit',
      error_type: 'PROVIDER_RATE_LIMIT',
      locale_key: 'agent.errors.providerRateLimit',
      retryable: true,
      terminal: true,
      details: {
        provider_id: 'provider-1',
        retry_after_ms: '2000',
      },
    });

    expect(isAgentProviderRateLimitError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'retryLater',
      providerId: 'provider-1',
      retryAfterMs: 2000,
      label: 'agent.recovery.retryLater',
    });
  });

  it.each([
    ['wrong type', 'OTHER', 'agent.errors.providerRateLimit', true, true, {
      provider_id: 'provider-1',
      retry_after_ms: '2000',
    }],
    ['wrong locale', 'PROVIDER_RATE_LIMIT', 'agent.errors.providerTimeout', true, true, {
      provider_id: 'provider-1',
      retry_after_ms: '2000',
    }],
    ['non-retryable', 'PROVIDER_RATE_LIMIT', 'agent.errors.providerRateLimit', false, true, {
      provider_id: 'provider-1',
      retry_after_ms: '2000',
    }],
    ['non-terminal', 'PROVIDER_RATE_LIMIT', 'agent.errors.providerRateLimit', true, false, {
      provider_id: 'provider-1',
      retry_after_ms: '2000',
    }],
    ['empty provider', 'PROVIDER_RATE_LIMIT', 'agent.errors.providerRateLimit', true, true, {
      provider_id: '',
      retry_after_ms: '2000',
    }],
    ['negative retry', 'PROVIDER_RATE_LIMIT', 'agent.errors.providerRateLimit', true, true, {
      provider_id: 'provider-1',
      retry_after_ms: '-1',
    }],
    ['fractional retry', 'PROVIDER_RATE_LIMIT', 'agent.errors.providerRateLimit', true, true, {
      provider_id: 'provider-1',
      retry_after_ms: '1.5',
    }],
    ['extra detail', 'PROVIDER_RATE_LIMIT', 'agent.errors.providerRateLimit', true, true, {
      provider_id: 'provider-1',
      retry_after_ms: '2000',
      model_id: 'model-1',
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

    expect(isAgentProviderRateLimitError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });
});
