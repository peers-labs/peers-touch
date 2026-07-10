import { describe, expect, it } from 'vitest';
import { ATELIER_PROJECTION_DISPLAY_LIMITS } from './projection.contract.generated';
import { derivePrototypeProviderCapabilityPanelProjectionView } from './prototypeProviderCapabilityPanelProjection';
import type { AtelierProviderCapability } from './runtime';

function capability(index: number): AtelierProviderCapability {
  return {
    id: `cap-${index}`,
    label: `Capability ${index}`,
    description: `Projected capability ${index}`,
    slashCommand: `/cap-${index}`,
    providerKind: 'station-provider',
    scope: 'station-provider',
    readOnly: true,
  };
}

describe('prototypeProviderCapabilityPanelProjection', () => {
  it('uses the generated display limit for visible provider capability descriptors', () => {
    const limit = ATELIER_PROJECTION_DISPLAY_LIMITS.providerCapabilities;
    const capabilities = Array.from({ length: limit + 2 }, (_, index) => capability(index));

    expect(derivePrototypeProviderCapabilityPanelProjectionView({
      capabilities,
      loading: false,
    })).toMatchObject({
      countLabel: String(capabilities.length),
      visibleCapabilities: capabilities.slice(0, limit),
      hiddenCapabilityCount: 2,
      emptyVisible: false,
    });
  });

  it('does not report hidden descriptors when capabilities fit the generated limit', () => {
    const capabilities = Array.from(
      { length: ATELIER_PROJECTION_DISPLAY_LIMITS.providerCapabilities },
      (_, index) => capability(index),
    );

    expect(derivePrototypeProviderCapabilityPanelProjectionView({
      capabilities,
      loading: false,
    })).toMatchObject({
      visibleCapabilities: capabilities,
      hiddenCapabilityCount: 0,
      emptyVisible: false,
    });
  });

  it('shows loading instead of count while discovery is pending', () => {
    expect(derivePrototypeProviderCapabilityPanelProjectionView({
      capabilities: [capability(1)],
      loading: true,
    })).toMatchObject({
      countLabel: 'loading',
      emptyVisible: false,
    });
  });

  it('shows empty state only after non-loading discovery returns no descriptors', () => {
    expect(derivePrototypeProviderCapabilityPanelProjectionView({
      capabilities: [],
      loading: false,
    })).toMatchObject({
      countLabel: '0',
      visibleCapabilities: [],
      hiddenCapabilityCount: 0,
      emptyVisible: true,
    });
  });
});
