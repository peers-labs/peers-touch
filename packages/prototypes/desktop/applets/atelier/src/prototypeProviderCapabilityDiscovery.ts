import type {
  AtelierProviderCapabilitiesResponse,
  AtelierProviderCapability,
} from './runtime';
import {
  ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
  ATELIER_PROVIDER_CAPABILITY_SCOPE,
} from './projection.contract.generated';

export interface PrototypeProviderCapabilityDiscoveryView {
  capabilities: AtelierProviderCapability[];
  source: string;
  error: string;
}

export function buildPrototypeProviderCapabilityDiscoveryRequestKey(input: { taskId?: string }): string {
  const taskId = input.taskId?.trim();
  return taskId ? `task:${taskId}` : 'workspace';
}

export function shouldApplyPrototypeProviderCapabilityDiscoveryResponse(input: {
  currentRequestKey: string;
  responseRequestKey: string;
}): boolean {
  return Boolean(input.responseRequestKey) && input.currentRequestKey === input.responseRequestKey;
}

export function buildPrototypeProviderCapabilitiesResponse(): AtelierProviderCapabilitiesResponse {
  return {
    source: 'prototype.station.provider.capabilities',
    capabilities: [
      {
        id: 'provider.capability.implement',
        label: 'Implement',
        description: 'Ask Station orchestration to plan and implement through the configured coding provider.',
        slashCommand: '/implement',
        providerKind: 'coding',
        scope: ATELIER_PROVIDER_CAPABILITY_SCOPE,
        readOnly: ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
      },
      {
        id: 'provider.capability.review',
        label: 'Review',
        description: 'Ask Station orchestration to review the selected task context with evidence.',
        slashCommand: '/review',
        providerKind: 'verifier',
        scope: ATELIER_PROVIDER_CAPABILITY_SCOPE,
        readOnly: ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
      },
      {
        id: 'provider.capability.test',
        label: 'Test',
        description: 'Ask Station orchestration to derive and run the task-owned verification plan.',
        slashCommand: '/test',
        providerKind: 'verifier',
        scope: ATELIER_PROVIDER_CAPABILITY_SCOPE,
        readOnly: ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
      },
    ],
  };
}

export function derivePrototypeProviderCapabilityDiscoveryView(
  response: AtelierProviderCapabilitiesResponse,
): PrototypeProviderCapabilityDiscoveryView {
  return {
    capabilities: response.capabilities,
    source: response.source,
    error: '',
  };
}

export function prototypeProviderCapabilityDiscoveryErrorStatus(error: unknown): string {
  return error instanceof Error ? error.message : 'provider capabilities unavailable';
}
