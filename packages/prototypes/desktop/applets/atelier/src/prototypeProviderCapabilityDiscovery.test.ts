import { describe, expect, it } from 'vitest';
import {
  ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
  ATELIER_PROVIDER_CAPABILITY_SCOPE,
} from './projection.contract.generated';
import {
  buildPrototypeProviderCapabilityDiscoveryRequestKey,
  buildPrototypeProviderCapabilitiesResponse,
  derivePrototypeProviderCapabilityDiscoveryView,
  prototypeProviderCapabilityDiscoveryErrorStatus,
  shouldApplyPrototypeProviderCapabilityDiscoveryResponse,
} from './prototypeProviderCapabilityDiscovery';
import type { AtelierProviderCapabilitiesResponse } from './runtime';

describe('prototypeProviderCapabilityDiscovery', () => {
  it('builds read-only Station provider capability descriptors without invoking providers', () => {
    const response = buildPrototypeProviderCapabilitiesResponse();

    expect(response).toEqual({
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
    });
    expect(response.capabilities.every((capability) => capability.slashCommand.startsWith('/'))).toBe(true);
    expect(JSON.stringify(response)).not.toMatch(/provider\.invoke|runtime\.execute|model\.run|cli\.execute|policy\.override|input_snapshot/);
  });

  it('projects Station provider capability discovery responses without invoking providers', () => {
    const response: AtelierProviderCapabilitiesResponse = {
      source: 'station.provider.capabilities',
      capabilities: [
        {
          id: 'capability.review',
          label: 'Review',
          description: 'Review current task',
          slashCommand: '/review',
          scope: 'station-provider',
          readOnly: true,
        },
      ],
    };

    expect(derivePrototypeProviderCapabilityDiscoveryView(response)).toEqual({
      capabilities: response.capabilities,
      source: 'station.provider.capabilities',
      error: '',
    });
  });

  it('uses runtime error messages for provider capability discovery failures', () => {
    expect(prototypeProviderCapabilityDiscoveryErrorStatus(new Error('auth denied'))).toBe('auth denied');
  });

  it('uses a bounded fallback for unknown provider capability discovery failures', () => {
    expect(prototypeProviderCapabilityDiscoveryErrorStatus('offline')).toBe('provider capabilities unavailable');
  });

  it('keys provider capability discovery by selected task or workspace scope', () => {
    expect(buildPrototypeProviderCapabilityDiscoveryRequestKey({ taskId: ' task-1 ' })).toBe('task:task-1');
    expect(buildPrototypeProviderCapabilityDiscoveryRequestKey({ taskId: '' })).toBe('workspace');
    expect(buildPrototypeProviderCapabilityDiscoveryRequestKey({})).toBe('workspace');
  });

  it('rejects stale provider capability discovery responses without execution payloads', () => {
    const currentRequestKey = buildPrototypeProviderCapabilityDiscoveryRequestKey({ taskId: 'task-new' });
    const staleRequestKey = buildPrototypeProviderCapabilityDiscoveryRequestKey({ taskId: 'task-old' });

    expect(shouldApplyPrototypeProviderCapabilityDiscoveryResponse({
      currentRequestKey,
      responseRequestKey: currentRequestKey,
    })).toBe(true);
    expect(shouldApplyPrototypeProviderCapabilityDiscoveryResponse({
      currentRequestKey,
      responseRequestKey: staleRequestKey,
    })).toBe(false);
    expect(shouldApplyPrototypeProviderCapabilityDiscoveryResponse({
      currentRequestKey,
      responseRequestKey: '',
    })).toBe(false);
    expect(`${currentRequestKey} ${staleRequestKey}`).not.toMatch(/provider\.invoke|model\.run|runtime\.execute|cli\.execute|input_snapshot/);
  });
});
