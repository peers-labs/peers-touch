import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentProviderModelUnavailableError,
} from './desktop_api';

describe('Desktop provider-model-unavailable typed error mapping', () => {
  it('maps the canonical Station payload to model selection', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.providerModelUnavailable',
      error_type: 'PROVIDER_MODEL_UNAVAILABLE',
      locale_key: 'agent.errors.providerModelUnavailable',
      retryable: true,
      terminal: true,
      details: {
        provider_id: 'provider-1',
        model_id: 'missing-model',
      },
    });

    expect(isAgentProviderModelUnavailableError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'chooseCompatibleModel',
      providerId: 'provider-1',
      modelId: 'missing-model',
      label: 'agent.recovery.chooseCompatibleModel',
    });
  });

  it.each([
    ['wrong type', 'OTHER', 'agent.errors.providerModelUnavailable', true, true, {
      provider_id: 'provider-1',
      model_id: 'missing-model',
    }],
    ['wrong locale', 'PROVIDER_MODEL_UNAVAILABLE', 'agent.errors.providerTimeout', true, true, {
      provider_id: 'provider-1',
      model_id: 'missing-model',
    }],
    ['non-retryable', 'PROVIDER_MODEL_UNAVAILABLE', 'agent.errors.providerModelUnavailable', false, true, {
      provider_id: 'provider-1',
      model_id: 'missing-model',
    }],
    ['empty provider', 'PROVIDER_MODEL_UNAVAILABLE', 'agent.errors.providerModelUnavailable', true, true, {
      provider_id: '',
      model_id: 'missing-model',
    }],
    ['empty model', 'PROVIDER_MODEL_UNAVAILABLE', 'agent.errors.providerModelUnavailable', true, true, {
      provider_id: 'provider-1',
      model_id: '',
    }],
    ['extra detail', 'PROVIDER_MODEL_UNAVAILABLE', 'agent.errors.providerModelUnavailable', true, true, {
      provider_id: 'provider-1',
      model_id: 'missing-model',
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

    expect(isAgentProviderModelUnavailableError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });
});
