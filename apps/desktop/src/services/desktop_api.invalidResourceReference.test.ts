import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentInvalidResourceReferenceError,
  normalizeAgentTurnStreamError,
} from './desktop_api';

const RESOURCE_REF_HASH = 'a'.repeat(64);

describe('Desktop invalid resource-reference typed error mapping', () => {
  it('maps only the canonical Station contract to choose-resource-again', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.invalidResourceReference',
      error_type: 'CLIENT_INVALID_RESOURCE_REFERENCE',
      locale_key: 'agent.errors.invalidResourceReference',
      retryable: false,
      terminal: true,
      details: {
        resource_kind: 'file',
        resource_ref_hash: RESOURCE_REF_HASH,
      },
    });

    expect(isAgentInvalidResourceReferenceError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'chooseResourceAgain',
      resourceKind: 'file',
      resourceRefHash: RESOURCE_REF_HASH,
      label: 'agent.recovery.chooseResourceAgain',
    });
  });

  it.each([
    ['wrong type', 'OTHER_ERROR', 'agent.errors.invalidResourceReference', false, true, {
      resource_kind: 'file',
      resource_ref_hash: RESOURCE_REF_HASH,
    }],
    ['wrong locale', 'CLIENT_INVALID_RESOURCE_REFERENCE', 'agent.errors.attachmentRejected', false, true, {
      resource_kind: 'file',
      resource_ref_hash: RESOURCE_REF_HASH,
    }],
    ['retryable', 'CLIENT_INVALID_RESOURCE_REFERENCE', 'agent.errors.invalidResourceReference', true, true, {
      resource_kind: 'file',
      resource_ref_hash: RESOURCE_REF_HASH,
    }],
    ['non-terminal', 'CLIENT_INVALID_RESOURCE_REFERENCE', 'agent.errors.invalidResourceReference', false, false, {
      resource_kind: 'file',
      resource_ref_hash: RESOURCE_REF_HASH,
    }],
    ['empty kind', 'CLIENT_INVALID_RESOURCE_REFERENCE', 'agent.errors.invalidResourceReference', false, true, {
      resource_kind: ' ',
      resource_ref_hash: RESOURCE_REF_HASH,
    }],
    ['unknown kind', 'CLIENT_INVALID_RESOURCE_REFERENCE', 'agent.errors.invalidResourceReference', false, true, {
      resource_kind: 'device',
      resource_ref_hash: RESOURCE_REF_HASH,
    }],
    ['uppercase hash', 'CLIENT_INVALID_RESOURCE_REFERENCE', 'agent.errors.invalidResourceReference', false, true, {
      resource_kind: 'file',
      resource_ref_hash: RESOURCE_REF_HASH.toUpperCase(),
    }],
    ['short hash', 'CLIENT_INVALID_RESOURCE_REFERENCE', 'agent.errors.invalidResourceReference', false, true, {
      resource_kind: 'file',
      resource_ref_hash: 'a'.repeat(63),
    }],
    ['extra detail', 'CLIENT_INVALID_RESOURCE_REFERENCE', 'agent.errors.invalidResourceReference', false, true, {
      resource_kind: 'file',
      resource_ref_hash: RESOURCE_REF_HASH,
      raw_path: '/private/source',
    }],
  ])('rejects %s from local recovery mapping', (
    _case,
    errorType,
    localeKey,
    retryable,
    terminal,
    details,
  ) => {
    const error = agentTurnStreamErrorFromData({
      error: localeKey,
      error_type: errorType,
      locale_key: localeKey,
      retryable,
      terminal,
      details,
      resolution: {
        type: 'chooseResourceAgain',
        resourceKind: 'file',
        resourceRefHash: RESOURCE_REF_HASH,
        label: 'agent.recovery.chooseResourceAgain',
      },
    });

    expect(error.resolution).toBeUndefined();
  });

  it('normalizes only the allowlisted resource fields from native errors', () => {
    const error = normalizeAgentTurnStreamError(Object.assign(
      new Error('Agent turn rejected'),
      {
        details: {
          error_code: 'CLIENT_INVALID_RESOURCE_REFERENCE',
          locale_key: 'agent.errors.invalidResourceReference',
          retryable: 'false',
          terminal: 'true',
          resource_kind: 'image',
          resource_ref_hash: RESOURCE_REF_HASH,
          raw_path: '/private/source',
        },
      },
    ));

    expect(error.typedError).toEqual({
      error: 'Agent turn rejected',
      error_type: 'CLIENT_INVALID_RESOURCE_REFERENCE',
      locale_key: 'agent.errors.invalidResourceReference',
      retryable: false,
      terminal: true,
      details: {
        resource_kind: 'image',
        resource_ref_hash: RESOURCE_REF_HASH,
      },
    });
    expect(error.resolution).toEqual({
      type: 'chooseResourceAgain',
      resourceKind: 'image',
      resourceRefHash: RESOURCE_REF_HASH,
      label: 'agent.recovery.chooseResourceAgain',
    });
  });
});
