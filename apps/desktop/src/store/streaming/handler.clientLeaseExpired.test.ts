import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../chat';
import { isTerminalEvent, reduceStreamEvent } from './handler';
import type { TurnStreamEvent } from './types';

const event: TurnStreamEvent = {
  event: 'progress',
  data: {
    stage: 'client_lease_expired',
    outcome_error: {
      error: 'agent.errors.clientLeaseExpired',
      error_type: 'CLIENT_LEASE_EXPIRED',
      locale_key: 'agent.errors.clientLeaseExpired',
      retryable: true,
      terminal: false,
      details: {
        session_id: 'capability-session-1',
        lease_id: 'capability-lease-1',
        expired_at: '2026-09-15T03:00:00Z',
      },
    },
  },
};

function pendingMessage(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    loading: true,
    timestamp: 1,
    turnId: 'turn-1',
    toolCalls: [{
      id: 'tool-call-1',
      name: 'local_clipboard_read',
      pending: true,
      status: 'pending',
    }],
  };
}

describe('client lease-expired stream projection', () => {
  it('keeps the Turn and pending ToolCall non-terminal', () => {
    const result = reduceStreamEvent(pendingMessage(), event);

    expect(isTerminalEvent(event)).toBe(false);
    expect(result.loading).toBe(true);
    expect(result.terminalStatus).toBeUndefined();
    expect(result.toolCalls).toEqual(pendingMessage().toolCalls);
    expect(result.error).toBe('agent.errors.clientLeaseExpired');
    expect(result.resolution).toMatchObject({
      type: 'reconcile',
      sessionId: 'capability-session-1',
      leaseId: 'capability-lease-1',
    });
  });

  it('does not make a typed non-terminal error frame terminal', () => {
    expect(isTerminalEvent({
      ...event,
      event: 'error',
    })).toBe(false);
  });

  it('clears a stale terminal marker for the non-terminal lease incident', () => {
    const result = reduceStreamEvent({
      ...pendingMessage(),
      loading: false,
      terminalStatus: 'completed',
    }, event);

    expect(result.loading).toBe(true);
    expect(result.terminalStatus).toBeUndefined();
    expect(result.error).toBe('agent.errors.clientLeaseExpired');
    expect(result.typedError?.terminal).toBe(false);
    expect(result.resolution?.type).toBe('reconcile');
  });
});
