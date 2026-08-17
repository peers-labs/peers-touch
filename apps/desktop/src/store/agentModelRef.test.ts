import { describe, expect, it } from 'vitest';

import type { Agent, AvailableModel } from '../services/desktop_api';
import { resolveAgentModelRef } from './agent';

const baseAgent = {
  provider: 'ark',
  model: 'shared-model',
} as Agent;

const models: AvailableModel[] = [
  {
    id: 'shared-model',
    display_name: 'Shared Model on OpenAI',
    provider_id: 'openai',
    provider_name: 'OpenAI',
    type: 'chat',
    context_window: 128_000,
    enabled: true,
  },
  {
    id: 'shared-model',
    display_name: 'Shared Model on Ark',
    provider_id: 'ark',
    provider_name: 'Ark',
    type: 'chat',
    context_window: 256_000,
    enabled: true,
  },
];

describe('resolveAgentModelRef', () => {
  it('resolves provider and model as one compound identity', () => {
    expect(resolveAgentModelRef(baseAgent, models)).toEqual({
      provider: 'ark',
      model: 'shared-model',
    });
  });

  it('does not fall back to another provider with the same model id', () => {
    expect(resolveAgentModelRef(
      { ...baseAgent, provider: 'anthropic' },
      models,
    )).toBeNull();
  });

  it('rejects disabled or incomplete Agent configuration', () => {
    expect(resolveAgentModelRef(
      baseAgent,
      models.map((model) => ({ ...model, enabled: false })),
    )).toBeNull();
    expect(resolveAgentModelRef(
      { ...baseAgent, model: '' },
      models,
    )).toBeNull();
  });
});
