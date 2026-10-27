import type { ProviderListItem } from '../services/desktop_api';

export type ProviderReadinessStatus =
  | 'loading'
  | 'unconfigured'
  | 'saving'
  | 'checking'
  | 'unverified'
  | 'ready'
  | 'invalid'
  | 'unavailable'
  | 'error';

export interface ProviderReadiness {
  status: ProviderReadinessStatus;
  error?: string;
}

// Maps Station-authoritative provider facts to the initial three-state light:
// disabled providers are off, credential-less providers need configuration,
// and configured providers stay neutral ("unverified") until the user runs
// an explicit check. Availability is never inferred from configuration alone.
export function mapProviderUIStatus(provider: ProviderListItem): ProviderReadiness {
  if (!provider.enabled) {
    return { status: 'unavailable' };
  }
  if (provider.requires_api_key && !provider.has_api_key) {
    return { status: 'unconfigured' };
  }
  return { status: 'unverified' };
}

// Usable for new Topics means enabled with credentials present; the health
// light remains separate and only turns green after a real check.
export function isProviderUsable(
  provider: ProviderListItem,
  readiness: ProviderReadiness = mapProviderUIStatus(provider),
): boolean {
  if (!provider.enabled) return false;
  if (provider.requires_api_key && !provider.has_api_key) return false;
  return readiness.status === 'unverified' || readiness.status === 'ready';
}
