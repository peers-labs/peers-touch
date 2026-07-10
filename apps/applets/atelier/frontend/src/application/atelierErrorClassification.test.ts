import { describe, expect, it } from 'vitest';
import { classifyAtelierError, normalizeAtelierError } from '../infrastructure/capability/atelierClient';
import {
  stateFromAtelierError,
  stateFromAtelierEventStreamConnecting,
  stateFromAtelierEventStreamError,
} from './controllerTransitions';

function codedError(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe('official Atelier error classification', () => {
  it('preserves explicit Atelier error keys before fallback classification', () => {
    expect(normalizeAtelierError(new Error('atelier.error.invalidProjection'))).toBe('atelier.error.invalidProjection');
    expect(classifyAtelierError(new Error('atelier.error.agentIdsRequired'))).toEqual({
      key: 'atelier.error.agentIdsRequired',
      kind: 'agent-ids-required',
    });
  });

  it('maps structured auth and network codes through generated recovery taxonomy', () => {
    for (const code of ['PERMISSION_DENIED', 'UNAUTHORIZED', 'FORBIDDEN', 'AUTH_DENIED']) {
      expect(classifyAtelierError({ code })).toEqual({
        key: 'atelier.error.authDenied',
        kind: 'auth-denied',
      });
    }
    for (const code of ['NETWORK_DISCONNECTED', 'NETWORK_ERROR', 'TIMEOUT', 'STREAM_DISCONNECTED', 'CONNECTION_CLOSED']) {
      expect(classifyAtelierError({ code })).toEqual({
        key: 'atelier.error.disconnected',
        kind: 'disconnected',
      });
    }
  });

  it('reads structured error code from Error.cause.error.code without relying on message text', () => {
    expect(
      classifyAtelierError(
        new Error('opaque host failure', {
          cause: { error: { code: 'UNAUTHORIZED', message: 'opaque' } },
        }),
      ),
    ).toEqual({
      key: 'atelier.error.authDenied',
      kind: 'auth-denied',
    });
    expect(
      classifyAtelierError(
        new Error('opaque host failure', {
          cause: { code: 'STREAM_DISCONNECTED', message: 'opaque' },
        }),
      ),
    ).toEqual({
      key: 'atelier.error.disconnected',
      kind: 'disconnected',
    });
  });

  it('reads direct nested error envelopes without relying on message text', () => {
    expect(classifyAtelierError({
      error: { code: 'PERMISSION_DENIED', message: 'opaque host envelope' },
    })).toEqual({
      key: 'atelier.error.authDenied',
      kind: 'auth-denied',
    });
    expect(classifyAtelierError({
      error: { code: 'CONNECTION_CLOSED', message: 'opaque host envelope' },
    })).toEqual({
      key: 'atelier.error.disconnected',
      kind: 'disconnected',
    });
  });

  it('keeps unknown structured codes generic and uses message fallback only for legacy errors', () => {
    expect(classifyAtelierError({ code: 'CAPABILITY_FAILED', message: 'opaque' })).toEqual({
      key: 'atelier.error.loadFailed',
      kind: 'error',
    });
    expect(classifyAtelierError(codedError('UNKNOWN', 'opaque'))).toEqual({
      key: 'atelier.error.loadFailed',
      kind: 'error',
    });
    expect(classifyAtelierError(new Error('request timeout while reconnecting'))).toEqual({
      key: 'atelier.error.disconnected',
      kind: 'disconnected',
    });
    expect(classifyAtelierError(new Error('forbidden by host policy'))).toEqual({
      key: 'atelier.error.authDenied',
      kind: 'auth-denied',
    });
  });
});

describe('controller transition error states', () => {
  it('keeps event-stream failures non-destructive when a snapshot exists', () => {
    expect(stateFromAtelierEventStreamError({ code: 'NETWORK_ERROR' }, true)).toMatchObject({
      loading: false,
      eventStreamState: 'degraded',
      eventStreamErrorKind: 'disconnected',
      resolvingDecisionId: '',
      creatingProject: false,
      sendingMessage: false,
      taskActionId: '',
      taskActionKind: '',
      purgeConfirmTaskId: '',
    });
  });

  it('promotes event-stream failures to load failure when no snapshot exists', () => {
    expect(stateFromAtelierEventStreamError({ code: 'UNAUTHORIZED' }, false)).toMatchObject({
      loading: false,
      errorKind: 'auth-denied',
      resolvingDecisionId: '',
      creatingProject: false,
      sendingMessage: false,
      taskActionId: '',
      taskActionKind: '',
      purgeConfirmTaskId: '',
    });
  });

  it('resets stream error state when connecting and localizes load failures', () => {
    expect(stateFromAtelierEventStreamConnecting()).toEqual({
      loading: false,
      eventStreamState: 'subscribing',
      eventStreamError: '',
      eventStreamErrorKind: '',
    });
    expect(stateFromAtelierError({ code: 'FORBIDDEN' })).toMatchObject({
      errorKind: 'auth-denied',
    });
  });
});
