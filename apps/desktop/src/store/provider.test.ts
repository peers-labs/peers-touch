import { describe, expect, it } from 'vitest';

import type { ProviderListItem } from '../services/desktop_api';
import { mapProviderUIStatus } from './provider';

function provider(overrides: Partial<ProviderListItem> = {}): ProviderListItem {
  return {
    id: 'ark',
    name: 'Ark',
    description: '',
    enabled: true,
    builtin: true,
    has_api_key: false,
    requires_api_key: true,
    credential_status: 'not_configured',
    runtime_kind: 'http',
    version: 0,
    ...overrides,
  };
}

describe('mapProviderUIStatus', () => {
  it('marks a provider unconfigured until its credential exists', () => {
    expect(mapProviderUIStatus(provider())).toEqual({ status: 'unconfigured' });
    expect(mapProviderUIStatus(provider({
      has_api_key: true,
      credential_status: 'configured',
    }))).toEqual({ status: 'ready' });
  });

  it('allows an enabled provider that does not require an API key', () => {
    expect(mapProviderUIStatus(provider({
      id: 'ollama',
      requires_api_key: false,
    }))).toEqual({ status: 'ready' });
  });

  it('marks disabled providers unavailable', () => {
    expect(mapProviderUIStatus(provider({ enabled: false }))).toEqual({ status: 'unavailable' });
  });
});
