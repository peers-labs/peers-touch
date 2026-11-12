import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentRuntimeBindingStaleError,
} from './desktop_api';

describe('Desktop runtime-binding-stale typed error mapping', () => {
  it('maps only the canonical Station contract to runtime rebind', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.runtimeBindingStale',
      error_type: 'RUNTIME_BINDING_STALE',
      locale_key: 'agent.errors.runtimeBindingStale',
      retryable: true,
      terminal: true,
      details: {
        provider_id: 'provider-retired',
        model_id: 'model-retired',
      },
    });

    expect(isAgentRuntimeBindingStaleError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'rebindRuntime',
      providerId: 'provider-retired',
      modelId: 'model-retired',
      label: 'agent.recovery.rebindRuntime',
    });
  });

  it.each([
    ['wrong type', 'OTHER_ERROR', 'agent.errors.runtimeBindingStale', true, true, {
      provider_id: 'provider-retired',
      model_id: 'model-retired',
    }],
    ['wrong locale', 'RUNTIME_BINDING_STALE', 'agent.errors.runtimeUnavailable', true, true, {
      provider_id: 'provider-retired',
      model_id: 'model-retired',
    }],
    ['non-retryable', 'RUNTIME_BINDING_STALE', 'agent.errors.runtimeBindingStale', false, true, {
      provider_id: 'provider-retired',
      model_id: 'model-retired',
    }],
    ['non-terminal', 'RUNTIME_BINDING_STALE', 'agent.errors.runtimeBindingStale', true, false, {
      provider_id: 'provider-retired',
      model_id: 'model-retired',
    }],
    ['empty provider', 'RUNTIME_BINDING_STALE', 'agent.errors.runtimeBindingStale', true, true, {
      provider_id: ' ',
      model_id: 'model-retired',
    }],
    ['empty model', 'RUNTIME_BINDING_STALE', 'agent.errors.runtimeBindingStale', true, true, {
      provider_id: 'provider-retired',
      model_id: '',
    }],
    ['extra detail', 'RUNTIME_BINDING_STALE', 'agent.errors.runtimeBindingStale', true, true, {
      provider_id: 'provider-retired',
      model_id: 'model-retired',
      reason_code: 'retired',
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

    expect(isAgentRuntimeBindingStaleError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });
});
