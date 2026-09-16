import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentInvalidReferenceError,
  normalizeAgentTurnStreamError,
} from './desktop_api';

const REFERENCE_HASH = 'a'.repeat(64);

describe('Desktop invalid-reference typed error mapping', () => {
  it('maps only the exact Station contract to the local remove-reference action', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.contextInvalidReference',
      error_type: 'CONTEXT_INVALID_REFERENCE',
      locale_key: 'agent.errors.contextInvalidReference',
      retryable: false,
      terminal: true,
      details: {
        reference_kind: 'file',
        reference_hash: REFERENCE_HASH,
      },
    });

    expect(isAgentInvalidReferenceError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'removeReference',
      referenceKind: 'file',
      referenceHash: REFERENCE_HASH,
      label: 'agent.recovery.removeReference',
    });
  });

  it.each([
    ['wrong locale', 'agent.errors.attachmentRejected', false, true, {
      reference_kind: 'file',
      reference_hash: REFERENCE_HASH,
    }],
    ['retryable', 'agent.errors.contextInvalidReference', true, true, {
      reference_kind: 'file',
      reference_hash: REFERENCE_HASH,
    }],
    ['non-terminal', 'agent.errors.contextInvalidReference', false, false, {
      reference_kind: 'file',
      reference_hash: REFERENCE_HASH,
    }],
    ['unknown kind', 'agent.errors.contextInvalidReference', false, true, {
      reference_kind: 'memory',
      reference_hash: REFERENCE_HASH,
    }],
    ['uppercase hash', 'agent.errors.contextInvalidReference', false, true, {
      reference_kind: 'file',
      reference_hash: REFERENCE_HASH.toUpperCase(),
    }],
    ['extra detail', 'agent.errors.contextInvalidReference', false, true, {
      reference_kind: 'file',
      reference_hash: REFERENCE_HASH,
      path: '/private/source',
    }],
  ])('rejects %s from local recovery mapping', (
    _case,
    localeKey,
    retryable,
    terminal,
    details,
  ) => {
    const error = agentTurnStreamErrorFromData({
      error: localeKey,
      error_type: 'CONTEXT_INVALID_REFERENCE',
      locale_key: localeKey,
      retryable,
      terminal,
      details,
      resolution: {
        type: 'removeReference',
        referenceKind: 'file',
        referenceHash: REFERENCE_HASH,
        label: 'agent.recovery.removeReference',
      },
    });

    expect(error.resolution).toBeUndefined();
  });

  it('normalizes only the allowlisted flat reference fields from native errors', () => {
    const error = normalizeAgentTurnStreamError(Object.assign(
      new Error('Agent turn rejected'),
      {
        details: {
          error_code: 'CONTEXT_INVALID_REFERENCE',
          locale_key: 'agent.errors.contextInvalidReference',
          retryable: 'false',
          terminal: 'true',
          reference_kind: 'git',
          reference_hash: REFERENCE_HASH,
          raw_reference: '@git:3',
        },
      },
    ));

    expect(error.typedError).toEqual({
      error: 'Agent turn rejected',
      error_type: 'CONTEXT_INVALID_REFERENCE',
      locale_key: 'agent.errors.contextInvalidReference',
      retryable: false,
      terminal: true,
      details: {
        reference_kind: 'git',
        reference_hash: REFERENCE_HASH,
      },
    });
    expect(error.resolution?.type).toBe('removeReference');
  });
});
