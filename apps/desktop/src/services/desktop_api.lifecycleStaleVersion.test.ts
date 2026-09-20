import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentLifecycleStaleVersionError,
  normalizeAgentTurnStreamError,
} from './desktop_api';

const DETAILS = {
  resource_id: 'conversation-1',
  expected_revision: '4',
  actual_revision: '5',
};

describe('Desktop lifecycle stale-version typed error mapping', () => {
  it('maps only the canonical stale revision contract to reload latest', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.lifecycleStaleVersion',
      error_type: 'LIFECYCLE_STALE_VERSION',
      locale_key: 'agent.errors.lifecycleStaleVersion',
      retryable: true,
      terminal: true,
      details: DETAILS,
    });

    expect(isAgentLifecycleStaleVersionError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'reloadLatest',
      resourceId: 'conversation-1',
      expectedRevision: 4,
      actualRevision: 5,
      label: 'agent.recovery.reloadLatest',
    });
  });

  it.each([
    ['wrong type', 'OTHER', 'agent.errors.lifecycleStaleVersion', true, true, DETAILS],
    ['wrong locale', 'LIFECYCLE_STALE_VERSION', 'agent.errors.lifecycleInterrupted', true, true, DETAILS],
    ['not retryable', 'LIFECYCLE_STALE_VERSION', 'agent.errors.lifecycleStaleVersion', false, true, DETAILS],
    ['not terminal', 'LIFECYCLE_STALE_VERSION', 'agent.errors.lifecycleStaleVersion', true, false, DETAILS],
    ['missing resource', 'LIFECYCLE_STALE_VERSION', 'agent.errors.lifecycleStaleVersion', true, true, {
      expected_revision: '4',
      actual_revision: '5',
    }],
    ['equal revision', 'LIFECYCLE_STALE_VERSION', 'agent.errors.lifecycleStaleVersion', true, true, {
      ...DETAILS,
      actual_revision: '4',
    }],
    ['future expected revision', 'LIFECYCLE_STALE_VERSION', 'agent.errors.lifecycleStaleVersion', true, true, {
      ...DETAILS,
      expected_revision: '6',
    }],
    ['unsafe revision', 'LIFECYCLE_STALE_VERSION', 'agent.errors.lifecycleStaleVersion', true, true, {
      ...DETAILS,
      actual_revision: '9007199254740992',
    }],
    ['extra detail', 'LIFECYCLE_STALE_VERSION', 'agent.errors.lifecycleStaleVersion', true, true, {
      ...DETAILS,
      private_detail: 'must-not-enable-recovery',
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
        type: 'reloadLatest',
        label: 'agent.recovery.reloadLatest',
      },
    });

    expect(isAgentLifecycleStaleVersionError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });

  it('normalizes the allowlisted flat fields from a native command rejection', () => {
    const error = normalizeAgentTurnStreamError(Object.assign(
      new Error('Agent revision command rejected'),
      {
        details: {
          error_code: 'LIFECYCLE_STALE_VERSION',
          locale_key: 'agent.errors.lifecycleStaleVersion',
          retryable: 'true',
          terminal: 'true',
          ...DETAILS,
          internal_query: 'must-not-cross-transport',
        },
      },
    ));

    expect(error.typedError).toEqual({
      error: 'Agent revision command rejected',
      error_type: 'LIFECYCLE_STALE_VERSION',
      locale_key: 'agent.errors.lifecycleStaleVersion',
      retryable: true,
      terminal: true,
      details: DETAILS,
    });
    expect(error.resolution?.type).toBe('reloadLatest');
  });
});
