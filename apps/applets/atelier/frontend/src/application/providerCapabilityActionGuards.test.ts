import { describe, expect, it } from 'vitest';
import {
  ATELIER_PROVIDER_CAPABILITY_ALLOWED_SCOPES,
  ATELIER_PROVIDER_CAPABILITY_FORBIDDEN_ACTIONS,
  ATELIER_PROVIDER_CAPABILITY_INSERT_READ_ONLY,
  appendAtelierProviderCapabilityCommand,
  buildAtelierProviderCapabilityDiscoveryIntent,
  buildAtelierProviderCapabilityCommandInsertIntent,
  containsForbiddenAtelierProviderCapabilityPayloadActions,
} from './providerCapabilityActionGuards';

describe('provider capability action guards', () => {
  it('builds read-only provider capability discovery intents with optional task scope', () => {
    expect(buildAtelierProviderCapabilityDiscoveryIntent({
      taskId: ' task-1 ',
    })).toEqual({
      status: 'ready',
      intent: {
        taskId: 'task-1',
      },
    });
    expect(buildAtelierProviderCapabilityDiscoveryIntent({
      taskId: ' ',
    })).toEqual({
      status: 'ready',
      intent: {},
    });
  });

  it('rejects provider capability discovery payloads shaped like execution', () => {
    expect(buildAtelierProviderCapabilityDiscoveryIntent({
      taskId: 'task-1',
      extraPayload: { 'policy.override': true },
    })).toEqual({ status: 'invalid' });
  });

  it('builds read-only slash command insert intents from generated provider capability metadata', () => {
    expect(ATELIER_PROVIDER_CAPABILITY_ALLOWED_SCOPES).toEqual(['station-provider']);
    expect(ATELIER_PROVIDER_CAPABILITY_INSERT_READ_ONLY).toBe(true);
    expect(buildAtelierProviderCapabilityCommandInsertIntent({
      command: ' /provider.use code-review ',
      scope: 'station-provider',
      readOnly: true,
    })).toEqual({
      status: 'ready',
      intent: {
        command: '/provider.use code-review',
      },
    });
  });

  it('blocks empty command insert attempts', () => {
    expect(buildAtelierProviderCapabilityCommandInsertIntent({
      command: ' ',
      scope: 'station-provider',
      readOnly: true,
    })).toEqual({ status: 'blocked' });
  });

  it('rejects non-slash, non-station, and writable provider capability descriptors', () => {
    expect(buildAtelierProviderCapabilityCommandInsertIntent({
      command: 'provider.use code-review',
      scope: 'station-provider',
      readOnly: true,
    })).toEqual({ status: 'invalid' });
    expect(buildAtelierProviderCapabilityCommandInsertIntent({
      command: '/provider.use code-review',
      scope: 'local-runtime',
      readOnly: true,
    })).toEqual({ status: 'invalid' });
    expect(buildAtelierProviderCapabilityCommandInsertIntent({
      command: '/provider.use code-review',
      scope: 'station-provider',
      readOnly: false,
    })).toEqual({ status: 'invalid' });
  });

  it('rejects provider invoke, execute, run, and policy override payload actions', () => {
    expect(ATELIER_PROVIDER_CAPABILITY_FORBIDDEN_ACTIONS).toEqual([
      'invoke',
      'execute',
      'run',
      'action.execute',
      'action.run',
      'policy.override',
      'rollback.execute',
    ]);
    expect(containsForbiddenAtelierProviderCapabilityPayloadActions({ invoke: true })).toBe(true);
    expect(containsForbiddenAtelierProviderCapabilityPayloadActions({ 'action.run': true })).toBe(true);
    expect(buildAtelierProviderCapabilityCommandInsertIntent({
      command: '/provider.use code-review',
      scope: 'station-provider',
      readOnly: true,
      extraPayload: { execute: true },
    })).toEqual({ status: 'invalid' });
  });

  it('appends slash commands to composer text without sending or invoking anything', () => {
    expect(appendAtelierProviderCapabilityCommand({
      currentComposerText: '',
      command: '/provider.use code-review',
    })).toBe('/provider.use code-review ');
    expect(appendAtelierProviderCapabilityCommand({
      currentComposerText: 'summarize this',
      command: ' /provider.use code-review ',
    })).toBe('summarize this /provider.use code-review ');
  });
});
