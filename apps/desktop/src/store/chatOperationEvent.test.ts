import { describe, expect, it } from 'vitest';
import {
  applyOperationEventIdentity,
  isMessageRetryBlocked,
  type ChatMessage,
  type ChatOperation,
  useChatStore,
} from './chat';
import { isTerminalEvent, reduceStreamEvent } from './streaming';

function operation(): ChatOperation {
  return {
    id: 'op-1',
    sessionKey: 'conversation-1',
    type: 'sendMessage',
    status: 'running',
    runState: 'streaming',
    assistantMessageId: 'message-1',
    abortController: new AbortController(),
    startedAt: 1,
    streamGeneration: 10,
  };
}

describe('Agent turn event identity projection', () => {
  it('records turn, conversation, and monotonic sequence identity', () => {
    const result = applyOperationEventIdentity(
      { 'conversation-1': operation() },
      'conversation-1',
      {
        event: 'text',
        data: {
          seq: 3,
          turnId: 'turn-1',
          conversationId: 'conversation-1',
          streamGeneration: 10,
        },
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.operations['conversation-1']).toMatchObject({
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      lastEventSeq: 3,
    });
  });

  it('rejects duplicate and out-of-order replay events', () => {
    const current = { ...operation(), lastEventSeq: 3 };
    const result = applyOperationEventIdentity(
      { 'conversation-1': current },
      'conversation-1',
      {
        event: 'text',
        data: { seq: 2, turnId: 'turn-1', streamGeneration: 10 },
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.operations['conversation-1']).toBe(current);
  });

  it('never lets an older turn generation overwrite the current turn', () => {
    const current = {
      ...operation(),
      turnId: 'turn-current',
      lastEventSeq: 2,
      streamGeneration: 11,
    };
    const result = applyOperationEventIdentity(
      { 'conversation-1': current },
      'conversation-1',
      {
        event: 'snapshot',
        data: {
          seq: 99,
          turnId: 'turn-old',
          conversationId: 'conversation-1',
          streamGeneration: 10,
          status: 'completed',
        },
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.operations['conversation-1']).toBe(current);
  });

  it('projects cancelled as a terminal assistant state', () => {
    const message: ChatMessage = {
      id: 'message-1',
      role: 'assistant',
      content: 'partial',
      loading: true,
      timestamp: 1,
    };
    const event = {
      event: 'cancelled' as const,
      data: {
        seq: 4,
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        reason: 'cancelled_by_user',
        outcome_error: {
          error: 'agent.errors.lifecycleCancelled',
          error_type: 'LIFECYCLE_CANCELLED',
          locale_key: 'agent.errors.lifecycleCancelled',
          retryable: false,
          terminal: true,
          details: {
            resource_kind: 'turn',
            resource_id: 'turn-1',
          },
        },
      },
    };

    expect(reduceStreamEvent(message, event)).toMatchObject({
      content: 'partial',
      loading: false,
      cancelled: true,
      terminalStatus: 'cancelled',
      error: 'agent.errors.lifecycleCancelled',
      errorDetail: 'cancelled_by_user',
      resolution: null,
      typedError: {
        error_type: 'LIFECYCLE_CANCELLED',
        locale_key: 'agent.errors.lifecycleCancelled',
        retryable: false,
        terminal: true,
        details: {
          resource_kind: 'turn',
          resource_id: 'turn-1',
        },
      },
    });
    expect(isTerminalEvent(event)).toBe(true);
  });

  it('keeps historical cancellation events without a typed payload readable', () => {
    const result = reduceStreamEvent({
      id: 'message-1',
      role: 'assistant',
      content: 'partial',
      loading: true,
      timestamp: 1,
    }, {
      event: 'cancelled',
      data: { reason: 'cancelled_by_user' },
    });

    expect(result).toMatchObject({
      content: 'partial',
      loading: false,
      cancelled: true,
      terminalStatus: 'cancelled',
      errorDetail: 'cancelled_by_user',
      resolution: null,
    });
    expect(result.typedError).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('preserves the typed cancellation outcome through terminal snapshot reconciliation', () => {
    const cancelled = reduceStreamEvent({
      id: 'message-1',
      role: 'assistant',
      content: 'partial',
      loading: true,
      timestamp: 1,
    }, {
      event: 'cancelled',
      data: {
        seq: 4,
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        reason: 'cancelled_by_user',
        outcome_error: {
          error: 'agent.errors.lifecycleCancelled',
          error_type: 'LIFECYCLE_CANCELLED',
          locale_key: 'agent.errors.lifecycleCancelled',
          retryable: false,
          terminal: true,
          details: {
            resource_kind: 'turn',
            resource_id: 'turn-1',
          },
        },
      },
    });
    const reconciled = reduceStreamEvent(cancelled, {
      event: 'snapshot',
      data: {
        seq: 4,
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'cancelled',
        terminal_reason: 'cancelled_by_user',
      },
    });

    expect(reconciled).toMatchObject({
      loading: false,
      cancelled: true,
      terminalStatus: 'cancelled',
      error: 'agent.errors.lifecycleCancelled',
      errorDetail: 'cancelled_by_user',
      resolution: null,
      typedError: {
        error_type: 'LIFECYCLE_CANCELLED',
        locale_key: 'agent.errors.lifecycleCancelled',
        retryable: false,
        terminal: true,
        details: {
          resource_kind: 'turn',
          resource_id: 'turn-1',
        },
      },
    });
  });

  it('keeps transport EOF in a non-terminal reconciling state', () => {
    const current = operation();
    const event = {
      event: 'reconciling' as const,
      data: { turnId: 'turn-1', conversationId: 'conversation-1' },
    };
    const result = applyOperationEventIdentity(
      { 'conversation-1': current },
      'conversation-1',
      event,
    );

    expect(result.operations['conversation-1'].runState).toBe('reconciling');
    expect(isTerminalEvent(event)).toBe(false);
  });

  it('keeps recovery failure retryable instead of failing the Turn', () => {
    const current = operation();
    const event = {
      event: 'recovery_failed' as const,
      data: {
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        error: 'agent.turnRecovery.replayFailed',
      },
    };
    const result = applyOperationEventIdentity(
      { 'conversation-1': current },
      'conversation-1',
      event,
    );

    expect(result.operations['conversation-1'].runState).toBe('recovery_failed');
    expect(isTerminalEvent(event)).toBe(false);
  });

  it('allows RetryTurn only for the matching recovery-failed operation', () => {
    const recoveryFailed: ChatOperation = {
      ...operation(),
      runState: 'recovery_failed',
      turnId: 'turn-1',
    };

    expect(isMessageRetryBlocked(true, recoveryFailed, 'turn-1')).toBe(false);
    expect(isMessageRetryBlocked(true, recoveryFailed, 'turn-2')).toBe(true);
    expect(isMessageRetryBlocked(true, operation(), 'turn-1')).toBe(true);
    expect(isMessageRetryBlocked(false, operation(), 'turn-1')).toBe(false);
  });

  it('keeps a replay catch-up marker non-terminal until Station reports a terminal snapshot', () => {
    const message: ChatMessage = {
      id: 'message-1',
      role: 'assistant',
      content: 'partial',
      loading: true,
      timestamp: 1,
    };
    const event = {
      event: 'catchup_done' as const,
      data: { seq: 4 },
    };

    expect(reduceStreamEvent(message, event)).toMatchObject({
      content: 'partial',
      loading: true,
    });
    expect(isTerminalEvent(event)).toBe(false);
  });

  it.each([
    ['failed', 'provider_failed', 'failed'],
    ['interrupted', 'station_restart', 'interrupted'],
    ['cancelled', 'user_cancelled', 'cancelled'],
  ] as const)(
    'preserves %s snapshot terminal status and reason',
    (status, reason, expectedRunState) => {
      const event = {
        event: 'snapshot' as const,
        data: {
          seq: 5,
          turnId: 'turn-1',
          streamGeneration: 10,
          status,
          terminal_reason: reason,
        },
      };
      const operationResult = applyOperationEventIdentity(
        { 'conversation-1': { ...operation(), turnId: 'turn-1' } },
        'conversation-1',
        event,
      );
      const messageResult = reduceStreamEvent({
        id: 'message-1',
        role: 'assistant',
        content: 'partial',
        loading: true,
        timestamp: 1,
      }, event);

      expect(operationResult.operations['conversation-1']).toMatchObject({
        runState: expectedRunState,
        status: expectedRunState,
      });
      expect(messageResult).toMatchObject({
        terminalStatus: status,
        loading: false,
      });
      expect(messageResult.errorDetail).toBe(reason);
    },
  );

  it('lets an authoritative snapshot supersede a same-sequence terminal error', () => {
    const terminalError = {
      event: 'error' as const,
      data: {
        seq: 5,
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        streamGeneration: 10,
        error: 'station_restart_interrupted',
      },
    };
    const snapshot = {
      event: 'snapshot' as const,
      data: {
        seq: 5,
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        streamGeneration: 10,
        status: 'interrupted',
        terminal_reason: 'station_restart_interrupted',
        text: '',
      },
    };
    const failedOperation = applyOperationEventIdentity(
      { 'conversation-1': { ...operation(), turnId: 'turn-1' } },
      'conversation-1',
      terminalError,
    );
    const reconciledOperation = applyOperationEventIdentity(
      failedOperation.operations,
      'conversation-1',
      snapshot,
    );
    const failedMessage = reduceStreamEvent(
      {
        id: 'message-1',
        role: 'assistant',
        content: 'stale partial response',
        loading: true,
        timestamp: 1,
      },
      terminalError,
    );
    const reconciledMessage = reduceStreamEvent(failedMessage, snapshot);

    expect(reconciledOperation.accepted).toBe(true);
    expect(reconciledOperation.operations['conversation-1']).toMatchObject({
      status: 'interrupted',
      runState: 'interrupted',
      lastEventSeq: 5,
    });
    expect(reconciledMessage).toMatchObject({
      content: '',
      terminalStatus: 'interrupted',
      loading: false,
    });
  });

  it('projects queued admission with position and settles the live stream', () => {
    const message: ChatMessage = {
      id: 'message-1',
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: 1,
    };
    const event = {
      event: 'queued' as const,
      data: {
        admission: {
          queue_entry: {
            queue_entry_id: 'queue-1',
            queue_position: 2,
          },
        },
      },
    };

    expect(reduceStreamEvent(message, event)).toMatchObject({
      queued: true,
      queueEntryId: 'queue-1',
      queuePosition: 2,
      loading: false,
    });
    expect(isTerminalEvent(event)).toBe(true);
  });

  it('keeps approval projection out of the generic streaming reducer', () => {
    const message: ChatMessage = {
      id: 'message-1',
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: 1,
    };

    const reduced = reduceStreamEvent(message, {
      event: 'tool_approval_required',
      data: {
        toolCallId: 'tool-call-1',
        approvalId: 'approval-1',
        decisionId: 'decision-1',
        decisionRevision: 3,
        payloadHash: 'payload-1',
      },
    });

    expect(reduced.toolCalls).toBeUndefined();
  });

  it('aborts active operations and clears actor-scoped chat state on reset', () => {
    const active = operation();
    useChatStore.setState({
      currentSessionKey: active.sessionKey,
      isStreaming: true,
      streamingStartedAt: active.startedAt,
      abortController: active.abortController,
      operations: { [active.sessionKey]: active },
      sessionBuffers: {
        [active.sessionKey]: [{
          id: 'message-1',
          role: 'assistant',
          content: 'partial',
          loading: true,
          timestamp: 1,
        }],
      },
    });

    useChatStore.getState().reset();

    expect(active.abortController.signal.aborted).toBe(true);
    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: 'main',
      isStreaming: false,
      streamingStartedAt: null,
      abortController: null,
      operations: {},
      turnQueues: {},
      sessionBuffers: {},
      messages: [],
    });
  });
});
