import { ATELIER_PROJECTION_DISPLAY_LIMITS } from './projection.contract.generated';
import type { AtelierProviderCapability } from './runtime';

export interface PrototypeProviderCapabilityPanelProjectionView {
  countLabel: string;
  visibleCapabilities: AtelierProviderCapability[];
  hiddenCapabilityCount: number;
  emptyVisible: boolean;
}

export function derivePrototypeProviderCapabilityPanelProjectionView(input: {
  capabilities: AtelierProviderCapability[];
  loading: boolean;
}): PrototypeProviderCapabilityPanelProjectionView {
  const visibleCapabilities = input.capabilities.slice(
    0,
    ATELIER_PROJECTION_DISPLAY_LIMITS.providerCapabilities,
  );

  return {
    countLabel: input.loading ? 'loading' : String(input.capabilities.length),
    visibleCapabilities,
    hiddenCapabilityCount: Math.max(0, input.capabilities.length - visibleCapabilities.length),
    emptyVisible: !input.loading && input.capabilities.length === 0,
  };
}
