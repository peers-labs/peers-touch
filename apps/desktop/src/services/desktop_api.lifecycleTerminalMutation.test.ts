import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentLifecycleTerminalMutationError,
  normalizeAgentTurnStreamError,
} from './desktop_api';

const DETAILS = {
  resource_id: 'turn-1',
  terminal_status: 'completed',
};

describe('Desktop lifecycle terminal-mutation typed error mapping', () => {
  it('maps only the canonical terminal mutation contract to open result', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.lifecycleTerminalMutation',
      error_type: 'LIFECYCLE_TERMINAL_MUTATION',
      locale_key: 'agent.errors.lifecycleTerminalMutation',
      retryable: false,
      terminal: true,
      details: DETAILS,
    });

    expect(isAgentLifecycleTerminalMutationError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'openResult',
      resourceId: 'turn-1',
      turnId: 'turn-1',
      terminalStatus: 'completed',
      label: 'agent.recovery.openResult',
    });
  });

  it.each([
    ['wrong type', 'OTHER', 'agent.errors.lifecycleTerminalMutation', false, true, DETAILS],
    ['wrong locale', 'LIFECYCLE_TERMINAL_MUTATION', 'agent.errors.lifecycleInterrupted', false, true, DETAILS],
    ['retryable', 'LIFECYCLE_TERMINAL_MUTATION', 'agent.errors.lifecycleTerminalMutation', true, true, DETAILS],
    ['not terminal', 'LIFECYCLE_TERMINAL_MUTATION', 'agent.errors.lifecycleTerminalMutation', false, false, DETAILS],
    ['missing resource', 'LIFECYCLE_TERMINAL_MUTATION', 'agent.errors.lifecycleTerminalMutation', false, true, {
      terminal_status: 'completed',
    }],
    ['unsupported status', 'LIFECYCLE_TERMINAL_MUTATION', 'agent.errors.lifecycleTerminalMutation', false, true, {
      ...DETAILS,
      terminal_status: 'running',
    }],
    ['extra detail', 'LIFECYCLE_TERMINAL_MUTATION', 'agent.errors.lifecycleTerminalMutation', false, true, {
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
        type: 'openResult',
        turnId: 'turn-1',
        label: 'agent.recovery.openResult',
      },
    });

    expect(isAgentLifecycleTerminalMutationError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });

  it('normalizes the allowlisted flat fields from a native command rejection', () => {
    const error = normalizeAgentTurnStreamError(Object.assign(
      new Error('Agent turn cancel rejected'),
      {
        details: {
          error_code: 'LIFECYCLE_TERMINAL_MUTATION',
          locale_key: 'agent.errors.lifecycleTerminalMutation',
          retryable: 'false',
          terminal: 'true',
          ...DETAILS,
          private_detail: 'must-not-cross-transport',
        },
      },
    ));

    expect(error.typedError).toEqual({
      error: 'Agent turn cancel rejected',
      error_type: 'LIFECYCLE_TERMINAL_MUTATION',
      locale_key: 'agent.errors.lifecycleTerminalMutation',
      retryable: false,
      terminal: true,
      details: DETAILS,
    });
    expect(error.resolution?.type).toBe('openResult');
  });
});
