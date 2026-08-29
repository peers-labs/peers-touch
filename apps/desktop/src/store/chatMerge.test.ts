import { describe, expect, it } from 'vitest';
import { mergeServerMessages, type ChatMessage } from './chat';

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

  it('retains a failed assistant message when the server has not persisted it', () => {
    const current = [
      msg('temp-user-1', 'user', 'hello'),
      msg('temp-assistant-1', 'assistant', '', { error: 'runtime unavailable', loading: false }),
    ];

    const merged = mergeServerMessages(current, []);

    expect(merged.map((m) => m.id)).toEqual(['temp-user-1', 'temp-assistant-1']);
    expect(merged[1].error).toBe('runtime unavailable');
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

  it('carries a recovered cancelled terminal fact to a persisted message with the same turn', () => {
    const current = [
      msg('recovered-turn-1', 'assistant', 'partial answer', {
        turnId: 'turn-1',
        loading: false,
        cancelled: true,
        terminalStatus: 'cancelled',
      }),
    ];
    const server = [
      msg('assistant-1', 'assistant', 'persisted partial answer', {
        turnId: 'turn-1',
        loading: true,
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
