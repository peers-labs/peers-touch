import { describe, expect, it } from 'vitest';

import {
  clearReconciledClientLeaseError,
  type ChatMessage,
} from './chat';

function leaseExpiredMessage(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    loading: true,
    timestamp: 1,
    turnId: 'turn-1',
    error: 'agent.errors.clientLeaseExpired',
    errorDetail: 'lease expired',
    terminalStatus: undefined,
    typedError: {
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
    resolution: {
      type: 'reconcile',
      sessionId: 'capability-session-1',
      leaseId: 'capability-lease-1',
      expiredAt: '2026-09-15T03:00:00Z',
      label: 'agent.recovery.reconcile',
    },
    toolCalls: [{
      id: 'tool-call-1',
      name: 'local_clipboard_read',
      pending: true,
      status: 'pending',
    }],
  };
}

describe('client lease-expired reconciliation', () => {
  it('clears only the matching non-terminal lease incident', () => {
    const source = leaseExpiredMessage();
    const reconciled = clearReconciledClientLeaseError(
      source,
      source.id,
      source.typedError!.details.session_id,
      source.typedError!.details.lease_id,
      source.turnId,
    );

    expect(reconciled.error).toBeUndefined();
    expect(reconciled.typedError).toBeUndefined();
    expect(reconciled.resolution).toBeUndefined();
    expect(reconciled.terminalStatus).toBeUndefined();
    expect(reconciled.loading).toBe(true);
    expect(reconciled.cancelled).toBe(false);
    expect(reconciled.toolCalls).toEqual(source.toolCalls);
  });

  it('clears a stale terminal projection after snapshot reconciliation removes the incident', () => {
    const source = leaseExpiredMessage();
    const reconciled = clearReconciledClientLeaseError(
      {
        ...source,
        error: undefined,
        typedError: undefined,
        resolution: undefined,
        loading: false,
        cancelled: true,
        terminalStatus: 'completed',
      },
      source.id,
      source.typedError!.details.session_id,
      source.typedError!.details.lease_id,
      source.turnId,
    );

    expect(reconciled.error).toBeUndefined();
    expect(reconciled.typedError).toBeUndefined();
    expect(reconciled.resolution).toBeUndefined();
    expect(reconciled.terminalStatus).toBeUndefined();
    expect(reconciled.loading).toBe(true);
    expect(reconciled.cancelled).toBe(false);
  });

  it('does not clear a different message or error class', () => {
    const source = leaseExpiredMessage();

    expect(clearReconciledClientLeaseError(
      source,
      'assistant-other',
      source.typedError!.details.session_id,
      source.typedError!.details.lease_id,
      source.turnId,
    )).toBe(source);
    expect(clearReconciledClientLeaseError(
      {
        ...source,
        typedError: {
          ...source.typedError!,
          error_type: 'CLIENT_EXECUTOR_UNAVAILABLE',
        },
      },
      source.id,
      source.typedError!.details.session_id,
      source.typedError!.details.lease_id,
      source.turnId,
    ).error).toBe('agent.errors.clientLeaseExpired');
  });

  it('does not clear a newer lease incident for the same turn', () => {
    const source = leaseExpiredMessage();
    const newer = {
      ...source,
      typedError: {
        ...source.typedError!,
        details: {
          ...source.typedError!.details,
          lease_id: 'capability-lease-2',
        },
      },
    };

    expect(clearReconciledClientLeaseError(
      newer,
      source.id,
      source.typedError!.details.session_id,
      source.typedError!.details.lease_id,
      source.turnId,
    )).toBe(newer);
  });
});
