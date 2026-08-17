import { describe, expect, it } from 'vitest';

import type { ProviderListItem } from '../services/desktop_api';
import { deriveProviderReadiness } from './provider';

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
    runtime_kind: 'direct',
    version: 0,
    ...overrides,
  };
}

describe('deriveProviderReadiness', () => {
  it('keeps a direct provider unconfigured until its credential exists', () => {
    expect(deriveProviderReadiness(provider())).toEqual({ status: 'unconfigured' });
    expect(deriveProviderReadiness(provider({
      has_api_key: true,
      credential_status: 'configured',
    }))).toEqual({ status: 'ready' });
  });

  it('allows an enabled provider that does not require an API key', () => {
    expect(deriveProviderReadiness(provider({
      id: 'ollama',
      requires_api_key: false,
    }))).toEqual({ status: 'ready' });
  });

  it('marks disabled providers and missing CLI runtimes unavailable', () => {
    expect(deriveProviderReadiness(provider({ enabled: false }))).toEqual({ status: 'unavailable' });
    expect(deriveProviderReadiness(provider({
      id: 'trae-cli',
      runtime_kind: 'cli',
      credential_status: 'cli_not_installed',
    }))).toEqual({ status: 'unavailable' });
  });
});
