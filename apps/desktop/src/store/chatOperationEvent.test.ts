import { describe, expect, it } from 'vitest';
import {
  applyOperationEventIdentity,
  type ChatMessage,
  type ChatOperation,
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
  };
}

describe('Agent turn event identity projection', () => {
  it('records turn, conversation, and monotonic sequence identity', () => {
    const result = applyOperationEventIdentity(
      { 'conversation-1': operation() },
      'conversation-1',
      {
        event: 'text',
        data: { seq: 3, turnId: 'turn-1', conversationId: 'conversation-1' },
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
      { event: 'text', data: { seq: 2, turnId: 'turn-1' } },
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
      data: { seq: 4, turnId: 'turn-1', conversationId: 'conversation-1' },
    };

    expect(reduceStreamEvent(message, event)).toMatchObject({
      content: 'partial',
      loading: false,
      cancelled: true,
    });
    expect(isTerminalEvent(event)).toBe(true);
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
});
