import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityReadinessSnapshotSchema } from '../gen/proto/domain/agent/capability_pb';
import { agentService } from '../services/agent-service';
import type {
  Agent,
  AgentTurnStreamController,
  AgentTurnStreamError,
  StreamEvent,
} from '../services/desktop_api';
import {
  applyOperationEventIdentity,
  isMessageRetryBlocked,
  shouldUseSessionBuffer,
  type ChatMessage,
  type ChatOperation,
  useChatStore,
} from './chat';
import { useAgentStore } from './agent';
import { useAgentCapabilityStore } from './agentCapabilities';
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
  it('increments the composer focus intent without mutating the draft', () => {
    const before = useChatStore.getState().composerFocusNonce;

    useChatStore.getState().requestComposerFocus();

    expect(useChatStore.getState().composerFocusNonce).toBe(before + 1);
    expect(useChatStore.getState().composerFill).toBeNull();

    useChatStore.getState().consumeComposerFocus();

    expect(useChatStore.getState().composerFocusNonce).toBe(0);
  });

  it('forwards the Station-selected capability session to the turn command', () => {
    const previousAgentState = useAgentStore.getState();
    const streamSpy = vi.spyOn(agentService, 'streamTurn').mockImplementation(
      () => {
        const controller = new AbortController() as AgentTurnStreamController;
        Object.defineProperty(controller, 'streamGeneration', {
          value: 1,
          enumerable: true,
        });
        return controller;
      },
    );
    useChatStore.getState().reset();
    useChatStore.setState({ currentSessionKey: 'conversation-1' });
    useAgentStore.setState({
      selectedAgent: 'assistant',
      agents: [{
        id: 'agent-1',
        name: 'assistant',
        provider: 'provider-1',
        model: 'model-1',
      } as Agent],
    });
    useAgentCapabilityStore.setState({
      readinessByAgentId: {
        'agent-1': create(CapabilityReadinessSnapshotSchema, {
          snapshotId: 'snapshot-1',
          agentId: 'agent-1',
          selectedClientSessionId: 'session-desktop',
        }),
      },
    });

    try {
      expect(useChatStore.getState().sendMessage(
        'conflicting input',
        [],
        { clientIdempotencyKey: 'request-1' },
      )).toBe(true);
      expect(streamSpy).toHaveBeenCalledTimes(1);
      expect(streamSpy.mock.calls[0]?.[0].client_idempotency_key)
        .toBe('request-1');
      expect(streamSpy.mock.calls[0]?.[0].client_capability_session_id)
        .toBe('session-desktop');
    } finally {
      streamSpy.mockRestore();
      useChatStore.getState().reset();
      useAgentCapabilityStore.getState().reset();
      useAgentStore.setState(previousAgentState);
    }
  });

  it('retains only local pre-admission failure buffers after navigation', () => {
    expect(shouldUseSessionBuffer({
      ...operation(),
      status: 'failed',
      runState: 'failed',
      endedAt: 2,
    })).toBe(true);
    expect(shouldUseSessionBuffer({
      ...operation(),
      status: 'failed',
      runState: 'failed',
      turnId: 'turn-1',
      endedAt: 2,
    })).toBe(false);
  });

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

  it('discards the local pair for a pre-admission rejection', async () => {
    const failedOperation: ChatOperation = {
      ...operation(),
      status: 'failed',
      runState: 'failed',
      assistantMessageId: 'temp-assistant',
      endedAt: 2,
    };
    const messages: ChatMessage[] = [
      {
        id: 'persisted-user',
        role: 'user',
        content: 'persisted',
        timestamp: 0,
      },
      {
        id: 'temp-user',
        role: 'user',
        content: 'oversized input',
        timestamp: 1,
      },
      {
        id: 'temp-assistant',
        role: 'assistant',
        content: '',
        error: 'agent.errors.contextOverflow',
        timestamp: 2,
      },
    ];
    useChatStore.setState({
      currentSessionKey: failedOperation.sessionKey,
      messages,
      operations: {
        [failedOperation.sessionKey]: failedOperation,
      },
      sessionBuffers: {
        [failedOperation.sessionKey]: messages,
      },
    });

    await useChatStore.getState().deleteMessage('temp-assistant');

    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'persisted-user',
    ]);
    expect(useChatStore.getState().operations[failedOperation.sessionKey]).toBeUndefined();
    expect(useChatStore.getState().sessionBuffers[failedOperation.sessionKey]).toBeUndefined();
    useChatStore.getState().reset();
  });

  it('replaces a retained pre-admission rejection when the corrected send succeeds', async () => {
    const previousAgentState = useAgentStore.getState();
    const draftKey = 'draft:agent-1:conversation-1';
    const otherDraftKey = 'draft:agent-1:conversation-2';
    const streams: Array<{
      controller: AgentTurnStreamController;
      onEvent: (event: StreamEvent) => void;
      onDone: () => void;
      onError: (error: AgentTurnStreamError) => void;
    }> = [];
    let streamGeneration = 0;
    const streamSpy = vi.spyOn(agentService, 'streamTurn').mockImplementation(
      (_input, onEvent, onDone, onError) => {
        const controller = new AbortController() as AgentTurnStreamController;
        streamGeneration += 1;
        Object.defineProperty(controller, 'streamGeneration', {
          value: streamGeneration,
          enumerable: true,
        });
        Object.defineProperty(controller, 'disconnectTransport', {
          value: () => undefined,
          enumerable: true,
        });
        streams.push({ controller, onEvent, onDone, onError });
        return controller;
      },
    );
    const agent: Agent = {
      id: 'agent-1',
      name: 'assistant',
      title: 'Assistant',
      description: '',
      avatar: '',
      backgroundColor: '',
      systemPrompt: '',
      soulMd: '',
      agentsMd: '',
      model: 'model-1',
      provider: 'provider-1',
      effort: '',
      visibility: 'private',
      isolationEnabled: false,
      isolationMode: '',
      isolationRetentionDays: 0,
      workspaceMode: '',
      allowedRoots: '',
      tags: '',
      pinned: false,
      favorite: false,
      sortOrder: 0,
      openingMessage: '',
      openingQuestions: '',
      chatConfig: '{}',
      isDefault: true,
      version: 1,
      createdAt: '',
      updatedAt: '',
    };

    useChatStore.getState().reset();
    useChatStore.setState({ currentSessionKey: draftKey });
    useAgentStore.setState({
      selectedAgent: agent.name,
      agents: [agent],
    });

    try {
      expect(useChatStore.getState().sendMessage('oversized input')).toBe(true);
      const overflow = new Error(
        'agent.errors.contextOverflow',
      ) as AgentTurnStreamError;
      overflow.typedError = {
        error: 'agent.errors.contextOverflow',
        error_type: 'CONTEXT_OVERFLOW',
        locale_key: 'agent.errors.contextOverflow',
        retryable: false,
        terminal: true,
        details: {
          limit_tokens: '64',
          actual_tokens: '65',
        },
      };
      streams[0].onError(overflow);

      await useChatStore.getState().selectSession(otherDraftKey);
      await useChatStore.getState().selectSession(draftKey);
      expect(useChatStore.getState().messages.some(
        (message) => message.content === 'oversized input',
      )).toBe(true);

      expect(useChatStore.getState().sendMessage('reduced input')).toBe(true);
      streams[1].onEvent({
        event: 'done',
        data: {
          turnId: 'turn-2',
          conversationId: draftKey,
          seq: 1,
          streamGeneration: streams[1].controller.streamGeneration,
          status: 'completed',
        },
      });
      streams[1].onDone();

      const state = useChatStore.getState();
      expect(state.messages.some(
        (message) => message.content === 'oversized input',
      )).toBe(false);
      expect(state.messages.filter(
        (message) => message.role === 'user',
      ).map((message) => message.content)).toEqual(['reduced input']);
      expect(state.operations[draftKey]?.status).toBe('completed');
      expect(state.sessionBuffers[draftKey]).toBeUndefined();
    } finally {
      streamSpy.mockRestore();
      useChatStore.getState().reset();
      useAgentStore.setState(previousAgentState);
    }
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
