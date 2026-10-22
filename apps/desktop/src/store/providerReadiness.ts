import type { ProviderListItem } from '../services/desktop_api';

export type ProviderReadinessStatus =
  | 'loading'
  | 'unconfigured'
  | 'saving'
  | 'checking'
  | 'ready'
  | 'invalid'
  | 'unavailable'
  | 'error';

export interface ProviderReadiness {
  status: ProviderReadinessStatus;
  error?: string;
}

export function mapProviderUIStatus(provider: ProviderListItem): ProviderReadiness {
  if (!provider.enabled) {
    return { status: 'unavailable' };
  }
  if (provider.requires_api_key && !provider.has_api_key) {
    return { status: 'unconfigured' };
  }
  return { status: 'ready' };
}

export function isProviderUsable(
  provider: ProviderListItem,
  readiness: ProviderReadiness = mapProviderUIStatus(provider),
): boolean {
  return provider.enabled && readiness.status === 'ready';
}
