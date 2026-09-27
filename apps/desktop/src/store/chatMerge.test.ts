import { describe, expect, it } from 'vitest';
import {
  isMessageRetryBlocked,
  mergeServerMessages,
  type ChatMessage,
  type ChatOperation,
} from './chat';

function msg(id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content, timestamp: 1781680000000, ...extra };
}

describe('mergeServerMessages', () => {
  it('preserves an optimistic user message and in-flight assistant when server returns an empty page', () => {
    const current = [
      msg('temp-user-1', 'user', 'hello'),
      msg('temp-assistant-1', 'assistant', '', { loading: true }),
    ];

    const merged = mergeServerMessages(current, []);

    expect(merged.map((m) => m.id)).toEqual(['temp-user-1', 'temp-assistant-1']);
  });

  it('drops optimistic messages once the server has echoed their authoritative counterparts', () => {
    const current = [
      msg('temp-user-1', 'user', 'hello'),
      msg('temp-assistant-1', 'assistant', '', { loading: true }),
    ];
    const server = [
      msg('server-user-1', 'user', 'hello'),
      msg('server-assistant-1', 'assistant', 'hi there'),
    ];

    const merged = mergeServerMessages(current, server);

    expect(merged.map((m) => m.id)).toEqual(['server-user-1', 'server-assistant-1']);
    expect(merged.every((m) => !m.loading)).toBe(true);
  });

  it('keeps the optimistic user message while the assistant is still in flight and server has only the user message', () => {
    const current = [
      msg('temp-user-1', 'user', 'hello'),
      msg('temp-assistant-1', 'assistant', '', { loading: true }),
    ];
    const server = [msg('server-user-1', 'user', 'hello')];

    const merged = mergeServerMessages(current, server);

    expect(merged.map((m) => m.id)).toEqual(['server-user-1', 'temp-assistant-1']);
  });

  it('does not let a recent reply supersede the next optimistic assistant', () => {
    const current = [
      msg('server-user-1', 'user', 'original request', { timestamp: 1000 }),
      msg('server-assistant-1', 'assistant', 'original response', { timestamp: 1500 }),
      msg('temp-user-2', 'user', 'conflicting request', { timestamp: 1900 }),
      msg('temp-assistant-2', 'assistant', '', { loading: true, timestamp: 1900 }),
    ];
    const server = current.slice(0, 2);

    const merged = mergeServerMessages(current, server);

    expect(merged.map((message) => message.id)).toEqual([
      'server-user-1',
      'server-assistant-1',
      'temp-user-2',
      'temp-assistant-2',
    ]);
  });

  it('uses server messages as the authoritative base and carries chain-of-thought fields for matched ids', () => {
    const current = [
      msg('a1', 'assistant', '', {
        thinking: 'working',
        thinkingDone: true,
        toolCalls: [{ id: 't1', name: 'search', args: '{}', result: 'ok', pending: false }],
      }),
    ];
    const server = [msg('a1', 'assistant', 'final answer')];

    const merged = mergeServerMessages(current, server);

    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe('final answer');
    expect(merged[0].thinking).toBe('working');
    expect(merged[0].toolCalls).toHaveLength(1);
  });

  it('carries a live ToolCall onto an unkeyed authoritative assistant reply', () => {
    const current = [
      msg('temp-assistant-1', 'assistant', '', {
        loading: true,
        turnId: 'turn-1',
        toolCalls: [{
          id: 'tool-call-1',
          name: 'memory',
          args: '{"action":"add"}',
          pending: true,
          status: 'approval_required',
          approvalId: 'approval-1',
        }],
      }),
    ];
    const server = [
      msg('server-assistant-1', 'assistant', 'Saved.', {
        loading: false,
        terminalStatus: 'completed',
        timestamp: current[0].timestamp + 500,
      }),
    ];

    const merged = mergeServerMessages(current, server);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'server-assistant-1',
      turnId: 'turn-1',
      content: 'Saved.',
      terminalStatus: 'completed',
      toolCalls: [{
        id: 'tool-call-1',
        status: 'approval_required',
        approvalId: 'approval-1',
      }],
    });
  });

  it('removes an inactive branch when the authoritative projection selects an older sibling', () => {
    const current = [
      msg('user-1', 'user', 'question'),
      msg('assistant-newer', 'assistant', 'regenerated answer'),
    ];
    const server = [
      msg('user-1', 'user', 'question'),
      msg('assistant-older', 'assistant', 'selected original answer'),
    ];

    const merged = mergeServerMessages(current, server);

    expect(merged.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-older',
    ]);
  });

  it('retains a failed assistant message when the server has not persisted it', () => {
    const current = [
      msg('temp-user-1', 'user', 'hello'),
      msg('temp-assistant-1', 'assistant', '', { error: 'runtime unavailable', loading: false }),
    ];

    const merged = mergeServerMessages(current, []);

    expect(merged.map((m) => m.id)).toEqual(['temp-user-1', 'temp-assistant-1']);
    expect(merged[1].error).toBe('runtime unavailable');
  });

  it('retains a local typed rejection when a late server page contains the preceding reply', () => {
    const current = [
      msg('server-user-1', 'user', 'original request', { timestamp: 1000 }),
      msg('server-assistant-1', 'assistant', 'original response', { timestamp: 1500 }),
      msg('temp-user-conflict', 'user', 'conflicting request', { timestamp: 1900 }),
      msg('temp-assistant-conflict', 'assistant', '', {
        timestamp: 1900,
        loading: false,
        error: 'agent.errors.duplicateConflict',
        typedError: {
          error: 'agent.errors.duplicateConflict',
          error_type: 'ADMISSION_DUPLICATE_CONFLICT',
          locale_key: 'agent.errors.duplicateConflict',
          retryable: false,
          terminal: true,
          details: {
            existing_command_id: 'turn-1',
            idempotency_key_hash: 'hash-1',
          },
        },
      }),
    ];
    const server = current.slice(0, 2);

    const merged = mergeServerMessages(current, server);

    expect(merged.map((message) => message.id)).toEqual([
      'server-user-1',
      'server-assistant-1',
      'temp-user-conflict',
      'temp-assistant-conflict',
    ]);
    expect(merged[3].typedError?.error_type).toBe('ADMISSION_DUPLICATE_CONFLICT');
  });

  it('keeps a non-terminal lease incident over a stale server terminal', () => {
    const current = [
      msg('assistant-1', 'assistant', '', {
        turnId: 'turn-1',
        loading: true,
        error: 'agent.errors.clientLeaseExpired',
        typedError: {
          error: 'agent.errors.clientLeaseExpired',
          error_type: 'CLIENT_LEASE_EXPIRED',
          locale_key: 'agent.errors.clientLeaseExpired',
          retryable: true,
          terminal: false,
          details: {
            session_id: 'capability-session-1',
            lease_id: 'capability-lease-1',
            expired_at: '2026-09-26T08:00:00Z',
          },
        },
        resolution: {
          type: 'reconcile',
          sessionId: 'capability-session-1',
          leaseId: 'capability-lease-1',
          expiredAt: '2026-09-26T08:00:00Z',
          label: 'agent.recovery.reconcile',
        },
      }),
    ];
    const server = [
      msg('assistant-1', 'assistant', '', {
        turnId: 'turn-1',
        loading: false,
        terminalStatus: 'completed',
      }),
    ];

    const [merged] = mergeServerMessages(current, server);

    expect(merged).toMatchObject({
      loading: true,
      cancelled: false,
      error: 'agent.errors.clientLeaseExpired',
      terminalStatus: undefined,
      typedError: {
        error_type: 'CLIENT_LEASE_EXPIRED',
        terminal: false,
      },
      resolution: {
        type: 'reconcile',
      },
    });
  });

  it.each([
    ['cancelled', true, undefined],
    ['failed', false, 'provider failed'],
    ['interrupted', false, 'station restarted'],
  ] as const)(
    'preserves an immediate authoritative %s terminal fact when sync is stale',
    (terminalStatus, cancelled, error) => {
      const current = [
        msg('a1', 'assistant', 'partial answer', {
          loading: false,
          cancelled,
          terminalStatus,
          error,
          errorDetail: error,
        }),
      ];
      const server = [
        msg('a1', 'assistant', 'persisted partial answer', { loading: true }),
      ];

      const [merged] = mergeServerMessages(current, server);

      expect(merged).toMatchObject({
        loading: false,
        cancelled,
        terminalStatus,
      });
      if (error) {
        expect(merged.error).toBe(error);
        expect(merged.errorDetail).toBe(error);
      }
    },
  );

  it('keeps the authoritative server terminal over a stale local terminal', () => {
    const current = [
      msg('assistant-1', 'assistant', 'stale partial response', {
        turnId: 'turn-1',
        loading: false,
        terminalStatus: 'failed',
        error: 'provider failed',
        errorDetail: 'provider failed',
      }),
    ];
    const server = [
      msg('assistant-1', 'assistant', '', {
        turnId: 'turn-1',
        loading: false,
        terminalStatus: 'interrupted',
      }),
    ];

    const [merged] = mergeServerMessages(current, server);

    expect(merged).toMatchObject({
      content: '',
      loading: false,
      terminalStatus: 'interrupted',
    });
    expect(merged.cancelled).not.toBe(true);
    expect(merged.error).toBeUndefined();
    expect(merged.errorDetail).toBeUndefined();
  });

  it('carries a recovered cancelled terminal fact to a persisted message with the same turn', () => {
    const typedError = {
      error: 'agent.errors.lifecycleCancelled',
      error_type: 'LIFECYCLE_CANCELLED',
      locale_key: 'agent.errors.lifecycleCancelled',
      retryable: false,
      terminal: true,
      details: {
        resource_kind: 'turn',
        resource_id: 'turn-1',
      },
    };
    const current = [
      msg('recovered-turn-1', 'assistant', 'partial answer', {
        turnId: 'turn-1',
        loading: false,
        cancelled: true,
        terminalStatus: 'cancelled',
        error: typedError.locale_key,
        errorDetail: 'cancelled_by_user',
        typedError,
      }),
    ];
    const server = [
      msg('assistant-1', 'assistant', 'persisted partial answer', {
        turnId: 'turn-1',
        loading: false,
        cancelled: true,
        terminalStatus: 'cancelled',
        error: typedError.locale_key,
        typedError,
      }),
    ];

    const merged = mergeServerMessages(current, server);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'assistant-1',
      turnId: 'turn-1',
      loading: false,
      cancelled: true,
      terminalStatus: 'cancelled',
      error: 'agent.errors.lifecycleCancelled',
      errorDetail: 'cancelled_by_user',
      typedError,
    });
  });

  it('retains a recovered terminal message while Station message sync is empty', () => {
    const current = [
      msg('recovered-turn-1', 'assistant', 'partial answer', {
        turnId: 'turn-1',
        loading: false,
        cancelled: true,
        terminalStatus: 'cancelled',
      }),
    ];

    const merged = mergeServerMessages(current, []);

    expect(merged).toEqual(current);
  });
});

describe('isMessageRetryBlocked', () => {
  it.each(['failed', 'cancelled', 'interrupted'] as const)(
    'allows retry when the matching %s Turn is terminal despite stale streaming state',
    (status) => {
      const operation: ChatOperation = {
        id: 'operation-1',
        sessionKey: 'test',
        type: 'sendMessage',
        status,
        runState: status,
        assistantMessageId: 'assistant-1',
        abortController: new AbortController(),
        startedAt: 1,
        endedAt: 2,
        turnId: 'turn-1',
      };

      expect(
        isMessageRetryBlocked(true, operation, 'turn-1', status),
      ).toBe(false);
      expect(
        isMessageRetryBlocked(true, operation, 'turn-2', status),
      ).toBe(true);
    },
  );
});
