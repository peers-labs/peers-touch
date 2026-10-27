import { describe, expect, it } from 'vitest';

import type { ProviderListItem } from '../services/desktop_api';
import { isProviderUsable, mapProviderUIStatus } from './providerReadiness';

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
    }))).toEqual({ status: 'unverified' });
  });

  it('leaves a keyless enabled provider unverified until a real check', () => {
    expect(mapProviderUIStatus(provider({
      id: 'ollama',
      requires_api_key: false,
    }))).toEqual({ status: 'unverified' });
  });

  it('marks disabled providers unavailable', () => {
    expect(mapProviderUIStatus(provider({ enabled: false }))).toEqual({ status: 'unavailable' });
  });

  it('treats a successful explicit check as ready', () => {
    expect(isProviderUsable(provider(), { status: 'ready' })).toBe(false);
    expect(isProviderUsable(provider({
      has_api_key: true,
      credential_status: 'configured',
    }, ), { status: 'ready' })).toBe(true);
  });

  it('shows enabled and credentialed providers as usable while unverified', () => {
    expect(isProviderUsable(provider())).toBe(false);
    expect(isProviderUsable(provider({
      has_api_key: true,
      credential_status: 'configured',
    }))).toBe(true);
    expect(isProviderUsable(provider({
      enabled: false,
      has_api_key: true,
      credential_status: 'configured',
    }))).toBe(false);
    expect(isProviderUsable(provider({
      has_api_key: true,
      credential_status: 'configured',
    }), { status: 'invalid' })).toBe(false);
  });
});
