import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentClientPermissionDeniedError,
  normalizeAgentTurnStreamError,
  streamAgentTurn,
} from './desktop_api';
import { EVENT, eventBus } from '../kernel/events';

const DETAILS = {
  capability_id: 'filesystem.read',
  permission_kind: 'filesystem',
};

describe('Desktop client permission-denied typed error mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps only the canonical terminal contract to capability settings', () => {
    const error = agentTurnStreamErrorFromData({
      outcome_error: {
        error: 'agent.errors.clientPermissionDenied',
        error_type: 'CLIENT_PERMISSION_DENIED',
        locale_key: 'agent.errors.clientPermissionDenied',
        retryable: false,
        terminal: true,
        details: DETAILS,
      },
    });

    expect(isAgentClientPermissionDeniedError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'openPermissionSettings',
      capabilityId: DETAILS.capability_id,
      permissionKind: DETAILS.permission_kind,
      label: 'agent.recovery.openPermissionSettings',
    });
  });

  it.each([
    ['wrong type', 'OTHER_ERROR', 'agent.errors.clientPermissionDenied', false, true, DETAILS],
    ['wrong locale', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientLeaseExpired', false, true, DETAILS],
    ['retryable', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientPermissionDenied', true, true, DETAILS],
    ['non-terminal', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientPermissionDenied', false, false, DETAILS],
    ['empty capability', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientPermissionDenied', false, true, {
      ...DETAILS,
      capability_id: ' ',
    }],
    ['unknown permission', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientPermissionDenied', false, true, {
      ...DETAILS,
      permission_kind: 'location',
    }],
    ['extra detail', 'CLIENT_PERMISSION_DENIED', 'agent.errors.clientPermissionDenied', false, true, {
      ...DETAILS,
      device_id: 'private-device',
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
      outcome_error: {
        error: localeKey,
        error_type: errorType,
        locale_key: localeKey,
        retryable,
        terminal,
        details,
      },
    });

    expect(error.resolution).toBeUndefined();
  });

  it('normalizes only the allowlisted permission fields from native errors', () => {
    const error = normalizeAgentTurnStreamError(Object.assign(
      new Error('Agent turn rejected'),
      {
        details: {
          error_code: 'CLIENT_PERMISSION_DENIED',
          locale_key: 'agent.errors.clientPermissionDenied',
          retryable: 'false',
          terminal: 'true',
          capability_id: DETAILS.capability_id,
          permission_kind: DETAILS.permission_kind,
          device_id: 'private-device',
        },
      },
    ));

    expect(error.typedError).toEqual({
      error: 'Agent turn rejected',
      error_type: 'CLIENT_PERMISSION_DENIED',
      locale_key: 'agent.errors.clientPermissionDenied',
      retryable: false,
      terminal: true,
      details: DETAILS,
    });
    expect(error.resolution?.type).toBe('openPermissionSettings');
  });

  it('source-binds a structured Browser transport rejection', async () => {
    const browserWindow = Object.assign(new EventTarget(), {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      __PT_GATEWAY_BASE__: 'http://127.0.0.1:3030',
    });
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(
      new Error('Agent turn rejected'),
      {
        details: {
          error_code: 'CLIENT_PERMISSION_DENIED',
          locale_key: 'agent.errors.clientPermissionDenied',
          retryable: 'false',
          terminal: 'true',
          capability_id: DETAILS.capability_id,
          permission_kind: DETAILS.permission_kind,
        },
      },
    )));
    const onEvent = vi.fn();
    const onError = vi.fn();
    const onRuntimeEvent = vi.fn();
    const unsubscribe = eventBus.subscribe(
      EVENT.AGENT_TURN_STREAM_EVENT,
      onRuntimeEvent,
    );

    try {
      streamAgentTurn(
        {
          client_idempotency_key: 'request-browser-permission-denied',
          conversation_id: 'conversation-1',
          agent_id: 'agent-1',
          user_input: 'permission denied',
        },
        onEvent,
        vi.fn(),
        onError,
        'ptid:person:alice',
      );

      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    } finally {
      unsubscribe();
    }
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'error',
      data: expect.objectContaining({
        error_type: 'CLIENT_PERMISSION_DENIED',
        locale_key: 'agent.errors.clientPermissionDenied',
        conversationId: 'conversation-1',
      }),
      sourceDelivery: expect.objectContaining({
        transport: 'station-sse',
        ptid: 'ptid:person:alice',
        conversationId: 'conversation-1',
      }),
    }));
    expect(onRuntimeEvent).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      event: 'error',
      ptid: 'ptid:person:alice',
      sourceDelivery: expect.objectContaining({
        transport: 'station-sse',
        conversationId: 'conversation-1',
      }),
    }));
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      typedError: {
        error_type: 'CLIENT_PERMISSION_DENIED',
        details: DETAILS,
      },
      resolution: {
        type: 'openPermissionSettings',
      },
    });
  });
});
