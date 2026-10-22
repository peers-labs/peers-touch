import { describe, expect, it } from 'vitest';

import type { AvailableModel } from '../services/desktop_api';
import {
  availableModelIdentityKey,
  findAvailableModel,
  findUniqueAvailableModelById,
  parseModelIdentityKey,
} from './modelIdentity';

const collidingModels: AvailableModel[] = [
  {
    id: 'default',
    display_name: 'Codex Default',
    provider_id: 'codex-cli',
    provider_name: 'Codex CLI',
    type: 'chat',
    context_window: 128000,
    enabled: true,
  },
  {
    id: 'default',
    display_name: 'TRAE Default',
    provider_id: 'trae-cli',
    provider_name: 'TRAE CLI',
    type: 'chat',
    context_window: 128000,
    enabled: true,
  },
];

describe('model identity', () => {
  it('round-trips provider and model as one selection key', () => {
    const key = availableModelIdentityKey(collidingModels[1]);
    expect(parseModelIdentityKey(key)).toEqual({
      provider: 'trae-cli',
      model: 'default',
    });
  });

  it('never resolves an ambiguous bare model id', () => {
    expect(findUniqueAvailableModelById(collidingModels, 'default')).toBeUndefined();
    expect(findAvailableModel(collidingModels, {
      provider: 'trae-cli',
      model: 'default',
    })?.display_name).toBe('TRAE Default');
  });
});
