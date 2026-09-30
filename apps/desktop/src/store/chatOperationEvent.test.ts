import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityReadinessSnapshotSchema } from '../gen/proto/domain/agent/capability_pb';
import { agentService } from '../services/agent-service';
import type {
  Agent,
  AgentTypedErrorPayload,
  AgentTurnStreamController,
  AgentTurnStreamError,
  StreamEvent,
} from '../services/desktop_api';
import {
  applyOperationEventIdentity,
  applyStreamEvent,
  cachedMessageToChatMessage,
  isMessageRetryBlocked,
  mergeServerMessages,
  shouldUseSessionBuffer,
  type ChatMessage,
  type ChatOperation,
  useChatStore,
} from './chat';
import { useAgentStore } from './agent';
import { useAgentCapabilityStore } from './agentCapabilities';
import { useAgentTopicStore } from './agentTopics';
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

function forbiddenActorData(): AgentTypedErrorPayload & Record<string, unknown> {
  return {
    error: 'agent.errors.forbiddenActor',
    error_type: 'OWNERSHIP_FORBIDDEN_ACTOR',
    locale_key: 'agent.errors.forbiddenActor',
    retryable: false,
    terminal: true,
    details: {
      resource_kind: 'conversation',
      resource_id: 'conversation-owned-by-bob',
    },
  };
}

function incompatibleCapabilityData(): Record<string, unknown> {
  return {
    error: 'agent.errors.incompatibleCapability',
    error_type: 'RUNTIME_INCOMPATIBLE_CAPABILITY',
    locale_key: 'agent.errors.incompatibleCapability',
    retryable: false,
    terminal: true,
    details: {
      capability_id: 'tool:skills_list',
      reason_code: 'runtime_capability_unavailable',
    },
  };
}

function lifecycleInterruptedOutcome(): Record<string, unknown> {
  return {
    error: 'agent.errors.lifecycleInterrupted',
    error_type: 'LIFECYCLE_INTERRUPTED',
    locale_key: 'agent.errors.lifecycleInterrupted',
    retryable: true,
    terminal: true,
    details: {
      turn_id: 'turn-interrupted',
      reason_code: 'station_restart_interrupted',
    },
  };
}

describe('Agent turn event identity projection', () => {
  it('reconciles a completed optimistic reply by its Station turn identity', () => {
    const optimistic = applyStreamEvent({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: 'TEST_OK',
      loading: true,
      timestamp: Date.now(),
    }, {
      event: 'done',
      data: {
        turnId: 'turn-1',
        model: 'model-1',
      },
    });
    const authoritative: ChatMessage = {
      id: 'message-1',
      role: 'assistant',
      content: 'TEST_OK',
      loading: false,
      terminalStatus: 'completed',
      timestamp: optimistic.timestamp,
      turnId: 'turn-1',
    };

    const merged = mergeServerMessages([optimistic], [authoritative]);

    expect(optimistic.turnId).toBe('turn-1');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'message-1',
      content: 'TEST_OK',
      turnId: 'turn-1',
      terminalStatus: 'completed',
    });
  });

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

  it('keeps transport control frames from admitting a rejected turn', () => {
    const previousAgentState = useAgentStore.getState();
    const onAccepted = vi.fn();
    const onRejected = vi.fn();
    const reconcileSpy = vi
      .spyOn(
        useAgentTopicStore.getState(),
        'reconcileSelectedAgentTopics',
      )
      .mockResolvedValue(undefined);
    let callbacks: {
      onEvent: (event: StreamEvent) => void;
      onError: (error: AgentTurnStreamError) => void;
    } | undefined;
    const streamSpy = vi.spyOn(agentService, 'streamTurn').mockImplementation(
      (_input, onEvent, _onDone, onError) => {
        callbacks = { onEvent, onError };
        const controller = new AbortController() as AgentTurnStreamController;
        Object.defineProperty(controller, 'streamGeneration', {
          value: 1,
          enumerable: true,
        });
        return controller;
      },
    );
    const conversationId = 'conversation-owned-by-bob';
    const typedError = forbiddenActorData();
    const streamError = new Error(
      'agent.errors.forbiddenActor',
    ) as AgentTurnStreamError;
    streamError.typedError = typedError;

    useChatStore.getState().reset();
    useChatStore.setState({ currentSessionKey: conversationId });
    useAgentStore.setState({
      selectedAgent: 'assistant',
      agents: [{
        id: 'agent-1',
        name: 'assistant',
        provider: 'provider-1',
        model: 'model-1',
      } as Agent],
    });

    try {
      expect(useChatStore.getState().sendMessage(
        'forbidden',
        [],
        { onAccepted, onRejected },
      )).toBe(true);
      callbacks?.onEvent({
        event: 'connected',
        data: { conversationId },
      });
      callbacks?.onEvent({
        event: 'admission_replayed',
        data: { conversationId, admission: {} },
      });
      callbacks?.onEvent({
        event: 'error',
        data: {
          ...forbiddenActorData(),
          conversationId,
          streamGeneration: 1,
        },
      });
      callbacks?.onError(streamError);

      const state = useChatStore.getState();
      expect(onAccepted).not.toHaveBeenCalled();
      expect(onRejected).toHaveBeenCalledOnce();
      expect(onRejected).toHaveBeenCalledWith(typedError);
      expect(reconcileSpy).not.toHaveBeenCalled();
      expect(state.isStreaming).toBe(false);
      expect(state.operations[conversationId]).toMatchObject({
        runState: 'failed',
        status: 'failed',
        turnId: undefined,
      });
      expect(state.sessionBuffers[conversationId]).toContainEqual(
        expect.objectContaining({
          role: 'assistant',
          loading: false,
          typedError,
        }),
      );
    } finally {
      streamSpy.mockRestore();
      reconcileSpy.mockRestore();
      useChatStore.getState().reset();
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

  it('projects a typed interruption into the operation lifecycle', () => {
    const result = applyOperationEventIdentity(
      { 'conversation-1': operation() },
      'conversation-1',
      {
        event: 'error',
        data: {
          seq: 4,
          turnId: 'turn-interrupted',
          conversationId: 'conversation-1',
          streamGeneration: 10,
          outcome_error: lifecycleInterruptedOutcome(),
        },
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.operations['conversation-1']).toMatchObject({
      turnId: 'turn-interrupted',
      runState: 'interrupted',
      status: 'interrupted',
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

  it('allows an ordered recovery transition to share the acknowledged sequence', () => {
    const current = {
      ...operation(),
      turnId: 'turn-1',
      lastEventSeq: 31,
      runState: 'connection_lost' as const,
    };
    const result = applyOperationEventIdentity(
      { 'conversation-1': current },
      'conversation-1',
      {
        event: 'reconnecting',
        data: { seq: 31, turnId: 'turn-1', streamGeneration: 10 },
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.operations['conversation-1']).toMatchObject({
      lastEventSeq: 31,
      runState: 'reconnecting',
    });
  });

  it('rejects a stale same-sequence recovery control without regressing the operation', () => {
    const current = {
      ...operation(),
      turnId: 'turn-1',
      lastEventSeq: 31,
      runState: 'reconnecting' as const,
    };
    const result = applyOperationEventIdentity(
      { 'conversation-1': current },
      'conversation-1',
      {
        event: 'connection_lost',
        data: { seq: 31, turnId: 'turn-1', streamGeneration: 10 },
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

  it('projects a live lifecycle interruption as interrupted with Recover', () => {
    const data = {
      error: 'station_restart_interrupted',
      terminal_reason: 'station_restart_interrupted',
      outcome_error: lifecycleInterruptedOutcome(),
    };
    const projected = reduceStreamEvent({
      id: 'message-1',
      role: 'assistant',
      content: 'partial',
      loading: true,
      timestamp: 1,
      turnId: 'turn-interrupted',
    }, {
      event: 'error',
      data,
    });

    expect(projected).toMatchObject({
      content: 'partial',
      error: 'agent.errors.lifecycleInterrupted',
      errorDetail: 'station_restart_interrupted',
      terminalStatus: 'interrupted',
      loading: false,
      typedError: lifecycleInterruptedOutcome(),
      resolution: {
        type: 'recover',
        turnId: 'turn-interrupted',
        reasonCode: 'station_restart_interrupted',
        label: 'agent.recovery.recover',
      },
    });
    expect(isTerminalEvent({ event: 'error', data })).toBe(true);
  });

  it('keeps malformed lifecycle interruption events failed without Recover', () => {
    const projected = reduceStreamEvent({
      id: 'message-1',
      role: 'assistant',
      content: 'partial',
      loading: true,
      timestamp: 1,
    }, {
      event: 'error',
      data: {
        error: 'station_restart_interrupted',
        outcome_error: {
          ...lifecycleInterruptedOutcome(),
          details: {
            turn_id: 'turn-interrupted',
            reason_code: 'station_restart_interrupted',
            internal_error: 'must-not-enable-recovery',
          },
        },
      },
    });

    expect(projected.terminalStatus).toBe('failed');
    expect(projected.resolution).toBeNull();

    const nonStationShape = reduceStreamEvent({
      id: 'message-2',
      role: 'assistant',
      content: 'partial',
      loading: true,
      timestamp: 1,
    }, {
      event: 'error',
      data: lifecycleInterruptedOutcome(),
    });

    expect(nonStationShape.terminalStatus).toBe('failed');
    expect(nonStationShape.resolution).toBeNull();
  });

  it('projects lifecycle interruption recovery from an authoritative snapshot', () => {
    const projected = reduceStreamEvent({
      id: 'message-1',
      role: 'assistant',
      content: 'partial',
      loading: true,
      timestamp: 1,
      turnId: 'turn-interrupted',
    }, {
      event: 'snapshot',
      data: {
        status: 'interrupted',
        terminal_reason: 'station_restart_interrupted',
        outcome_error: lifecycleInterruptedOutcome(),
      },
    });

    expect(projected).toMatchObject({
      error: 'agent.errors.lifecycleInterrupted',
      terminalStatus: 'interrupted',
      typedError: lifecycleInterruptedOutcome(),
      resolution: {
        type: 'recover',
        turnId: 'turn-interrupted',
        reasonCode: 'station_restart_interrupted',
        label: 'agent.recovery.recover',
      },
    });
  });

  it('does not invent Recover for an interrupted snapshot without a typed outcome', () => {
    const projected = reduceStreamEvent({
      id: 'message-1',
      role: 'assistant',
      content: 'partial',
      loading: true,
      timestamp: 1,
    }, {
      event: 'snapshot',
      data: {
        status: 'interrupted',
        terminal_reason: 'station_restart_interrupted',
      },
    });

    expect(projected.terminalStatus).toBe('interrupted');
    expect(projected.typedError).toBeUndefined();
    expect(projected.resolution).toBeNull();
  });

  it('restores lifecycle interruption recovery from a persisted typed error', () => {
    const projected = cachedMessageToChatMessage({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      turnId: 'turn-interrupted',
      role: 'assistant',
      status: 'interrupted',
      content: 'partial',
      seq: 1,
      errorJson: JSON.stringify(lifecycleInterruptedOutcome()),
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });

    expect(projected).toMatchObject({
      error: 'agent.errors.lifecycleInterrupted',
      terminalStatus: 'interrupted',
      typedError: lifecycleInterruptedOutcome(),
      resolution: {
        type: 'recover',
        turnId: 'turn-interrupted',
        reasonCode: 'station_restart_interrupted',
        label: 'agent.recovery.recover',
      },
    });
  });

  it('projects forbidden-actor recovery from a live error event', () => {
    const projected = reduceStreamEvent({
      id: 'message-1',
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: 1,
    }, {
      event: 'error',
      data: forbiddenActorData(),
    });

    expect(projected).toMatchObject({
      error: 'agent.errors.forbiddenActor',
      terminalStatus: 'failed',
      loading: false,
      typedError: forbiddenActorData(),
      resolution: {
        type: 'switchAccount',
        resourceKind: 'conversation',
        resourceId: 'conversation-owned-by-bob',
        label: 'agent.recovery.switchAccount',
      },
    });
  });

  it('restores forbidden-actor recovery from a persisted typed error', () => {
    const projected = cachedMessageToChatMessage({
      messageId: 'message-1',
      conversationId: 'conversation-owned-by-bob',
      turnId: 'turn-1',
      role: 'assistant',
      status: 'failed',
      content: '',
      seq: 1,
      errorJson: JSON.stringify(forbiddenActorData()),
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });

    expect(projected).toMatchObject({
      error: 'agent.errors.forbiddenActor',
      terminalStatus: 'failed',
      typedError: forbiddenActorData(),
      resolution: {
        type: 'switchAccount',
        resourceKind: 'conversation',
        resourceId: 'conversation-owned-by-bob',
        label: 'agent.recovery.switchAccount',
      },
    });
  });

  it('preserves forbidden-actor recovery through replay projection', () => {
    useChatStore.getState().reset();
    useChatStore.setState({ currentSessionKey: 'conversation-owned-by-bob' });

    try {
      useChatStore.getState().applyRecoveredTurnEvent(
        'conversation-owned-by-bob',
        'agent-owned-by-bob',
        'turn-rejected',
        {
          event: 'error',
          data: forbiddenActorData(),
        },
      );

      expect(useChatStore.getState().messages).toContainEqual(expect.objectContaining({
        turnId: 'turn-rejected',
        error: 'agent.errors.forbiddenActor',
        typedError: forbiddenActorData(),
        resolution: {
          type: 'switchAccount',
          resourceKind: 'conversation',
          resourceId: 'conversation-owned-by-bob',
          label: 'agent.recovery.switchAccount',
        },
      }));
    } finally {
      useChatStore.getState().reset();
    }
  });

  it('projects recovered events onto the assistant when a turn is shared with the user message', () => {
    const messages: ChatMessage[] = [
      {
        id: 'user-message-1',
        role: 'user',
        content: 'Use the local tool',
        timestamp: 1,
        turnId: 'turn-1',
      },
      {
        id: 'assistant-message-1',
        role: 'assistant',
        content: '',
        loading: true,
        timestamp: 2,
        turnId: 'turn-1',
      },
    ];
    useChatStore.getState().reset();
    useChatStore.setState({
      currentSessionKey: 'conversation-1',
      messages,
      sessionBuffers: {
        'conversation-1': messages,
      },
    });

    try {
      useChatStore.getState().applyRecoveredTurnEvent(
        'conversation-1',
        'agent-1',
        'turn-1',
        {
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
                session_id: 'session-1',
                lease_id: 'lease-1',
                expired_at: '2026-09-15T00:00:00Z',
              },
            },
          },
        },
      );

      const state = useChatStore.getState();
      expect(state.messages[0]).toEqual(messages[0]);
      expect(state.messages[1]).toMatchObject({
        id: 'assistant-message-1',
        role: 'assistant',
        error: 'agent.errors.clientLeaseExpired',
        typedError: {
          error_type: 'CLIENT_LEASE_EXPIRED',
        },
        resolution: {
          type: 'reconcile',
        },
      });
      expect(state.sessionBuffers['conversation-1'][0]).toEqual(messages[0]);
      expect(state.sessionBuffers['conversation-1'][1]).toMatchObject({
        id: 'assistant-message-1',
        role: 'assistant',
        typedError: {
          error_type: 'CLIENT_LEASE_EXPIRED',
        },
      });
    } finally {
      useChatStore.getState().reset();
    }
  });

  it('projects incompatible-capability recovery from a live error event', () => {
    const projected = reduceStreamEvent({
      id: 'message-1',
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: 1,
    }, {
      event: 'error',
      data: incompatibleCapabilityData(),
    });

    expect(projected).toMatchObject({
      error: 'agent.errors.incompatibleCapability',
      terminalStatus: 'failed',
      loading: false,
      typedError: incompatibleCapabilityData(),
      resolution: {
        type: 'chooseCompatibleModel',
        capabilityId: 'tool:skills_list',
        reasonCode: 'runtime_capability_unavailable',
        label: 'agent.recovery.chooseCompatibleModel',
      },
    });
  });

  it('restores incompatible-capability recovery from a persisted typed error', () => {
    const projected = cachedMessageToChatMessage({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      role: 'assistant',
      status: 'failed',
      content: '',
      seq: 1,
      errorJson: JSON.stringify(incompatibleCapabilityData()),
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    });

    expect(projected).toMatchObject({
      error: 'agent.errors.incompatibleCapability',
      terminalStatus: 'failed',
      typedError: incompatibleCapabilityData(),
      resolution: {
        type: 'chooseCompatibleModel',
        capabilityId: 'tool:skills_list',
        reasonCode: 'runtime_capability_unavailable',
        label: 'agent.recovery.chooseCompatibleModel',
      },
    });
  });

  it('preserves incompatible-capability recovery through replay projection', () => {
    useChatStore.getState().reset();
    useChatStore.setState({ currentSessionKey: 'conversation-1' });

    try {
      useChatStore.getState().applyRecoveredTurnEvent(
        'conversation-1',
        'agent-1',
        'turn-rejected',
        {
          event: 'error',
          data: incompatibleCapabilityData(),
        },
      );

      expect(useChatStore.getState().messages).toContainEqual(expect.objectContaining({
        turnId: 'turn-rejected',
        error: 'agent.errors.incompatibleCapability',
        typedError: incompatibleCapabilityData(),
        resolution: {
          type: 'chooseCompatibleModel',
          capabilityId: 'tool:skills_list',
          reasonCode: 'runtime_capability_unavailable',
          label: 'agent.recovery.chooseCompatibleModel',
        },
      }));
    } finally {
      useChatStore.getState().reset();
    }
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

  it('allows RetryTurn only for a matching recoverable operation', () => {
    const recoveryFailed: ChatOperation = {
      ...operation(),
      runState: 'recovery_failed',
      turnId: 'turn-1',
    };
    const replaying: ChatOperation = {
      ...operation(),
      runState: 'replaying',
      turnId: 'turn-1',
    };

    expect(isMessageRetryBlocked(true, recoveryFailed, 'turn-1')).toBe(false);
    expect(isMessageRetryBlocked(true, recoveryFailed, 'turn-2')).toBe(true);
    expect(
      isMessageRetryBlocked(true, replaying, 'turn-1', 'interrupted'),
    ).toBe(false);
    expect(
      isMessageRetryBlocked(true, replaying, 'turn-2', 'interrupted'),
    ).toBe(true);
    expect(
      isMessageRetryBlocked(true, replaying, 'turn-1', 'failed'),
    ).toBe(true);
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
