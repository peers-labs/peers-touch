import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HomeTaskStatus,
  HomeWorkKind,
  HomeWorkProjectionSchema,
  type HomeWorkProjection,
} from '../gen/proto/domain/agent/home_pb';
import { TaskSurface } from '../gen/proto/domain/agent/orchestration_pb';
import {
  AgentGoalSchema,
  AgentGoalStatus,
  type AgentGoal,
} from '../gen/proto/domain/agent/goal_pb';
import { EVENT } from '../kernel/events/catalog';
import type { EventPayloadMap } from '../kernel/events/types';
import { useGoalDraftStore } from '../store/goalDraft';
import { useGoalExecutionStore } from '../store/goalExecution';

const getHomeWorkProjection = vi.hoisted(() => vi.fn());
const submitHomeChatCommand = vi.hoisted(() => vi.fn());
const submitHomeTaskCommand = vi.hoisted(() => vi.fn());
const createAgentGoalDraft = vi.hoisted(() => vi.fn());
const getAgentGoal = vi.hoisted(() => vi.fn());
const updateAgentGoal = vi.hoisted(() => vi.fn());
const reviewAgentGoal = vi.hoisted(() => vi.fn());
const admitAgentGoal = vi.hoisted(() => vi.fn());
const startAgentGoal = vi.hoisted(() => vi.fn());
const cancelAgentGoal = vi.hoisted(() => vi.fn());
const setAgentSurface = vi.hoisted(() => vi.fn());
const setSelectedAgent = vi.hoisted(() => vi.fn());
const selectSession = vi.hoisted(() => vi.fn());
const setActiveTask = vi.hoisted(() => vi.fn());
const applyProjection = vi.hoisted(() => vi.fn());
const beginLoad = vi.hoisted(() => vi.fn());
const beginResync = vi.hoisted(() => vi.fn());
const markConnectionLost = vi.hoisted(() => vi.fn());
const failLoad = vi.hoisted(() => vi.fn());
const applyAgentDomainEvent = vi.hoisted(() => vi.fn(() => true));
const beginGoalCreate = vi.hoisted(() => vi.fn());
const applyGoalDraft = vi.hoisted(() => vi.fn());
const failGoalCreate = vi.hoisted(() => vi.fn());
const beginGoalReadback = vi.hoisted(() => vi.fn());
const failGoalReadback = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn());
const eventHandlers = vi.hoisted(
  () => new Map<string, (payload: unknown) => void>(),
);

const agentState = {
  setAgentSurface,
  setSelectedAgent,
};

const homeState = {
  projection: null,
  connectionState: 'fresh',
  retryable: false,
  goalDraftTitle: '',
  goalDraftOutcome: '',
  goalDraftIdempotencyKey: '',
  savedGoal: null as AgentGoal | null,
  beginLoad,
  beginResync,
  markConnectionLost,
  applyProjection,
  applyAgentDomainEvent,
  failLoad,
  beginGoalCreate,
  applyGoalDraft,
  failGoalCreate,
  beginGoalReadback,
  failGoalReadback,
  reset,
};

vi.mock('../services/desktop_api', () => ({
  api: {
    getHomeWorkProjection,
    submitHomeChatCommand,
    submitHomeTaskCommand,
    createAgentGoalDraft,
    getAgentGoal,
    updateAgentGoal,
    reviewAgentGoal,
    admitAgentGoal,
    startAgentGoal,
    cancelAgentGoal,
  },
  isAgentForbiddenActorError: (error: { error_type?: string } | undefined) =>
    error?.error_type === 'OWNERSHIP_FORBIDDEN_ACTOR',
  isAgentLifecycleStaleVersionError: (
    error: { error_type?: string } | undefined,
  ) => error?.error_type === 'LIFECYCLE_STALE_VERSION',
  isAgentGoalAdmissionRejectedError: (
    error: { error_type?: string } | undefined,
  ) => error?.error_type === 'GOAL_ADMISSION_REJECTED',
  normalizeAgentTurnStreamError: (error: unknown) => error,
}));

vi.mock('../store/agent', () => ({
  useAgentStore: {
    getState: () => agentState,
  },
}));

vi.mock('../store/chat', () => ({
  useChatStore: {
    getState: () => ({ selectSession }),
  },
}));

vi.mock('../store/tasks', () => ({
  useTaskStore: {
    getState: () => ({ setActiveTask }),
  },
}));

vi.mock('../store/home', () => ({
  useHomeStore: {
    getState: () => homeState,
  },
}));

vi.mock('../kernel/events/bus', () => ({
  eventBus: {
    subscribe: vi.fn((
      type: string,
      handler: (payload: unknown) => void,
    ) => {
      eventHandlers.set(type, handler);
      return () => eventHandlers.delete(type);
    }),
  },
}));

vi.mock('../utils/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  cancelHomeGoal,
  createHomeGoalDraft,
  homeGoalDraftByteLength,
  homeRuntime,
  openHomeConversation,
  reloadHomeGoalContract,
  reviewHomeGoalContract,
  startHomeGoal,
  submitHomeChat,
  submitHomeTask,
  updateHomeGoalContract,
  validateHomeGoalDraftBytes,
} from './homeRuntime';

describe('homeRuntime', () => {
  beforeEach(() => {
    homeRuntime.teardown();
    vi.clearAllMocks();
    eventHandlers.clear();
    applyAgentDomainEvent.mockReturnValue(true);
    selectSession.mockResolvedValue(undefined);
    getHomeWorkProjection.mockResolvedValue(create(HomeWorkProjectionSchema, {
      ptid: 'ptid:actor-1',
      revision: 7n,
    }));
    homeState.goalDraftTitle = '';
    homeState.goalDraftOutcome = '';
    homeState.goalDraftIdempotencyKey = '';
    homeState.savedGoal = null;
    homeState.connectionState = 'fresh';
    homeState.retryable = false;
    useGoalDraftStore.getState().reset();
    useGoalExecutionStore.getState().reset();
  });

  it('loads the Station projection during actor bootstrap', async () => {
    homeRuntime.install();

    await homeRuntime.bootstrap('ptid:actor-1');

    expect(beginLoad).toHaveBeenCalledOnce();
    expect(getHomeWorkProjection).toHaveBeenCalledWith(0n);
    expect(applyProjection).toHaveBeenCalledWith(
      expect.objectContaining({ ptid: 'ptid:actor-1', revision: 7n }),
    );
  });

  it('reconciles accepted Agent events without a page remount', async () => {
    homeRuntime.install();
    await homeRuntime.bootstrap('ptid:actor-1');
    getHomeWorkProjection.mockResolvedValueOnce(
      create(HomeWorkProjectionSchema, {
        ptid: 'ptid:actor-1',
        revision: 8n,
        activeTasks: [{
          goalId: 'goal-1',
          goalNodeId: 'node-1',
          taskId: 'task-1',
          stepId: 'step-1',
          attemptId: 'attempt-1',
          attempt: 1,
          title: 'Live task',
          status: HomeTaskStatus.RUNNING,
          progressPercent: 25,
          surface: TaskSurface.DIRECT_RUN,
        }],
      }),
    );
    const handler = eventHandlers.get(EVENT.REALTIME_AGENT_DOMAIN_EVENT) as
      ((payload: EventPayloadMap[typeof EVENT.REALTIME_AGENT_DOMAIN_EVENT]) => void);

    handler({
      eventId: 'stream-2',
      domainEventId: 'task-event-2',
      domainSequence: 2n,
      schemaVersion: 1,
      eventType: 'agent.collaboration.node.running',
      goalId: 'goal-1',
      taskId: 'task-1',
      goalRevision: 5n,
      committedTsUnixMs: 2,
    });

    await vi.waitFor(() => expect(getHomeWorkProjection).toHaveBeenCalledTimes(2));
    expect(applyAgentDomainEvent).toHaveBeenCalledOnce();
    expect(useGoalExecutionStore.getState().executions).toEqual([
      expect.objectContaining({
        taskId: 'task-1',
        status: HomeTaskStatus.RUNNING,
        progressPercent: 25,
      }),
    ]);
  });

  it('ignores duplicate or older Agent events before projection readback', async () => {
    applyAgentDomainEvent
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    homeRuntime.install();
    await homeRuntime.bootstrap('ptid:actor-1');
    const handler = eventHandlers.get(EVENT.REALTIME_AGENT_DOMAIN_EVENT) as
      ((payload: EventPayloadMap[typeof EVENT.REALTIME_AGENT_DOMAIN_EVENT]) => void);
    const event = {
      eventId: 'stream-2',
      domainEventId: 'task-event-2',
      domainSequence: 2n,
      schemaVersion: 1,
      eventType: 'agent.collaboration.node.running',
      goalId: 'goal-1',
      taskId: 'task-1',
      goalRevision: 5n,
      committedTsUnixMs: 2,
    };

    handler(event);
    await vi.waitFor(() => expect(getHomeWorkProjection).toHaveBeenCalledTimes(2));
    handler(event);
    await Promise.resolve();

    expect(getHomeWorkProjection).toHaveBeenCalledTimes(2);
  });

  it('runs one trailing readback when an Agent event arrives in flight', async () => {
    let resolveFirstEvent!: (projection: HomeWorkProjection) => void;
    homeRuntime.install();
    await homeRuntime.bootstrap('ptid:actor-1');
    getHomeWorkProjection.mockReturnValueOnce(new Promise((resolve) => {
      resolveFirstEvent = resolve;
    }));
    const handler = eventHandlers.get(EVENT.REALTIME_AGENT_DOMAIN_EVENT) as
      ((payload: EventPayloadMap[typeof EVENT.REALTIME_AGENT_DOMAIN_EVENT]) => void);
    const first = {
      eventId: 'stream-2',
      domainEventId: 'task-event-2',
      domainSequence: 2n,
      schemaVersion: 1,
      eventType: 'agent.collaboration.node.running',
      goalId: 'goal-1',
      taskId: 'task-1',
      goalRevision: 5n,
      committedTsUnixMs: 2,
    };

    handler(first);
    await vi.waitFor(() => expect(getHomeWorkProjection).toHaveBeenCalledTimes(2));
    handler({
      ...first,
      eventId: 'stream-3',
      domainEventId: 'task-event-3',
      domainSequence: 3n,
      eventType: 'agent.collaboration.task.completed',
      committedTsUnixMs: 3,
    });
    expect(getHomeWorkProjection).toHaveBeenCalledTimes(2);

    resolveFirstEvent(create(HomeWorkProjectionSchema, {
      ptid: 'ptid:actor-1',
      revision: 8n,
    }));
    await vi.waitFor(() => expect(getHomeWorkProjection).toHaveBeenCalledTimes(3));
  });

  it('preserves Home data while reconnecting and runs one resync readback', async () => {
    homeRuntime.install();
    await homeRuntime.bootstrap('ptid:actor-1');
    const connectionHandler = eventHandlers.get(
      EVENT.REALTIME_CONNECTION_STATE,
    ) as (
      payload: EventPayloadMap[typeof EVENT.REALTIME_CONNECTION_STATE],
    ) => void;
    const resyncHandler = eventHandlers.get(EVENT.REALTIME_RESYNC) as (
      payload: EventPayloadMap[typeof EVENT.REALTIME_RESYNC],
    ) => void;

    connectionHandler({ connected: false, reason: 'network-lost' });
    expect(markConnectionLost).toHaveBeenCalledOnce();
    expect(getHomeWorkProjection).toHaveBeenCalledOnce();

    connectionHandler({ connected: true, reason: 'connected' });
    resyncHandler({ newestEventId: 'event-9', reason: 'cursor-gap' });
    await vi.waitFor(() => expect(getHomeWorkProjection).toHaveBeenCalledTimes(2));

    expect(beginResync).toHaveBeenCalledTimes(3);
  });

  it('blocks Home mutations while the projection is not fresh', async () => {
    homeState.connectionState = 'stale';
    homeState.goalDraftTitle = 'Blocked Goal';
    homeState.goalDraftOutcome = 'Must not write';

    await expect(createHomeGoalDraft()).rejects.toThrow(
      'agent.home.projectionNotFresh',
    );
    expect(createAgentGoalDraft).not.toHaveBeenCalled();
  });

  it('opens the exact Station conversation for its owning Agent', async () => {
    await openHomeConversation({
      workId: 'conversation-1',
      kind: HomeWorkKind.CHAT,
      agentId: 'agent-1',
      agentName: 'researcher',
      title: 'Recent work',
      updatedAt: '2026-09-16T00:00:00.000Z',
    });

    expect(setAgentSurface).toHaveBeenCalledWith('researcher', 'chat');
    expect(setSelectedAgent).toHaveBeenCalledWith('researcher');
    expect(selectSession).toHaveBeenCalledWith('conversation-1');
  });

  it('submits Home Chat with the projected Agent revision and readiness', async () => {
    submitHomeChatCommand.mockResolvedValue({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      projectionRevision: 8n,
    });

    const work = await submitHomeChat({
      agentId: 'agent-1',
      agentName: 'researcher',
      displayName: 'Researcher',
      avatarRef: '',
      readinessSnapshotId: 'readiness-1',
      agentVersion: 3n,
      providerId: 'provider-1',
      modelId: 'model-1',
    }, 'Compare recovery models', 'home-chat-key');

    expect(submitHomeChatCommand).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      input: 'Compare recovery models',
      clientIdempotencyKey: 'home-chat-key',
      expectedAgentVersion: 3n,
      readinessSnapshotId: 'readiness-1',
    }));
    expect(work.workId).toBe('conversation-1');
  });

  it('selects the exact task after Station accepts Task mode', async () => {
    submitHomeTaskCommand.mockResolvedValue({
      taskId: 'task-1',
      projectionRevision: 8n,
    });

    const taskId = await submitHomeTask({
      agentId: 'agent-1',
      agentName: 'researcher',
      displayName: 'Researcher',
      avatarRef: '',
      readinessSnapshotId: 'readiness-1',
      agentVersion: 3n,
      providerId: 'provider-1',
      modelId: 'model-1',
    }, 'Prepare the launch brief', 'home-task-key');

    expect(taskId).toBe('task-1');
    expect(setActiveTask).toHaveBeenCalledWith('task-1');
  });

  it('creates a Goal draft with a stable retry key and applies Station truth', async () => {
    const goal = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Durable Goal',
      outcome: 'Reopen the same record',
      status: AgentGoalStatus.DRAFT,
      revision: 1n,
    });
    homeState.goalDraftTitle = '  Durable Goal  ';
    homeState.goalDraftOutcome = '  Reopen the same record  ';
    homeState.goalDraftIdempotencyKey = 'goal-key-1';
    createAgentGoalDraft.mockResolvedValue(goal);

    const created = await createHomeGoalDraft();

    expect(beginGoalCreate).toHaveBeenCalledWith('goal-key-1');
    expect(createAgentGoalDraft).toHaveBeenCalledWith({
      title: 'Durable Goal',
      outcome: 'Reopen the same record',
      idempotencyKey: 'goal-key-1',
    });
    expect(applyGoalDraft).toHaveBeenCalledWith(goal, 'create');
    expect(created).toBe(goal);
  });

  it('uses the Station UTF-8 byte limits for Goal input', () => {
    const acceptedTitle = '界'.repeat(85);
    const rejectedTitle = '界'.repeat(86);

    expect(homeGoalDraftByteLength(acceptedTitle)).toBe(255);
    expect(validateHomeGoalDraftBytes(
      acceptedTitle,
      'Durable outcome',
    )).toEqual({
      titleTooLong: false,
      outcomeTooLong: false,
    });
    expect(validateHomeGoalDraftBytes(
      rejectedTitle,
      'Durable outcome',
    )).toEqual({
      titleTooLong: true,
      outcomeTooLong: false,
    });
  });

  it('reads the exact saved Goal when Home is reopened', async () => {
    const goal = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Durable Goal',
      outcome: 'Reopen the same record',
      status: AgentGoalStatus.DRAFT,
      revision: 1n,
    });
    homeState.savedGoal = goal;
    getAgentGoal.mockResolvedValue(goal);

    await homeRuntime.acquirePage?.('home', 'activate');

    expect(beginGoalReadback).toHaveBeenCalledOnce();
    expect(getAgentGoal).toHaveBeenCalledWith('goal-1');
    expect(applyGoalDraft).toHaveBeenCalledWith(goal, 'readback');
  });

  it('starts a new Goal readback when the active actor changes', async () => {
    const actorOneGoal = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Actor one Goal',
      outcome: 'Must not cross the actor boundary',
      status: AgentGoalStatus.DRAFT,
      revision: 1n,
    });
    const actorTwoGoal = create(AgentGoalSchema, {
      goalId: 'goal-2',
      ownerPtid: 'ptid:actor-2',
      title: 'Actor two Goal',
      outcome: 'Must load from Station independently',
      status: AgentGoalStatus.DRAFT,
      revision: 1n,
    });
    let resolveActorOne!: (goal: AgentGoal) => void;
    const actorOneReadback = new Promise<AgentGoal>((resolve) => {
      resolveActorOne = resolve;
    });
    getAgentGoal.mockImplementation((goalId: string) => (
      goalId === 'goal-1'
        ? actorOneReadback
        : Promise.resolve(actorTwoGoal)
    ));
    homeRuntime.install();
    await homeRuntime.bootstrap('ptid:actor-1');
    homeState.savedGoal = actorOneGoal;

    const firstAcquire = homeRuntime.acquirePage?.('home', 'activate');
    expect(getAgentGoal).toHaveBeenCalledWith('goal-1');

    await homeRuntime.bootstrap('ptid:actor-2');
    homeState.savedGoal = actorTwoGoal;
    await homeRuntime.acquirePage?.('home', 'activate');

    expect(getAgentGoal).toHaveBeenCalledWith('goal-2');
    expect(applyGoalDraft).toHaveBeenCalledOnce();
    expect(applyGoalDraft).toHaveBeenCalledWith(actorTwoGoal, 'readback');

    resolveActorOne(actorOneGoal);
    await firstAcquire;
    expect(applyGoalDraft).toHaveBeenCalledOnce();
  });

  it('updates local edits and reviews the exact returned Station revision', async () => {
    const initial = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Durable Goal',
      outcome: 'Initial outcome',
      status: AgentGoalStatus.DRAFT,
      revision: 1n,
    });
    const updated = create(AgentGoalSchema, {
      ...initial,
      outcome: 'Local outcome',
      status: AgentGoalStatus.DRAFT,
      revision: 2n,
    });
    const reviewed = create(AgentGoalSchema, {
      ...updated,
      status: AgentGoalStatus.REVIEWING,
      revision: 3n,
    });
    useGoalDraftStore.getState().hydrate(initial);
    useGoalDraftStore.getState().setOutcome('Local outcome');
    updateAgentGoal.mockResolvedValue(updated);
    reviewAgentGoal.mockResolvedValue(reviewed);

    const result = await reviewHomeGoalContract();

    expect(updateAgentGoal).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'goal-1',
      outcome: 'Local outcome',
      expectedRevision: 1n,
    }));
    expect(reviewAgentGoal).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'goal-1',
      expectedRevision: 2n,
    }));
    expect(result.revision).toBe(3n);
    expect(useGoalDraftStore.getState()).toMatchObject({
      baseRevision: 3n,
      mutationState: 'reviewing',
    });
  });

  it('admits and starts a reviewed Goal with exact Station revisions', async () => {
    const reviewed = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Durable Goal',
      outcome: 'Start the reviewed Goal',
      status: AgentGoalStatus.REVIEWING,
      revision: 3n,
    });
    const admitted = create(AgentGoalSchema, {
      ...reviewed,
      status: AgentGoalStatus.READY,
      revision: 4n,
    });
    const running = create(AgentGoalSchema, {
      ...admitted,
      status: AgentGoalStatus.RUNNING,
      revision: 5n,
    });
    useGoalDraftStore.getState().hydrate(reviewed);
    admitAgentGoal.mockResolvedValue(admitted);
    startAgentGoal.mockResolvedValue(running);
    getHomeWorkProjection.mockResolvedValue(create(HomeWorkProjectionSchema, {
      ptid: 'ptid:actor-1',
      revision: 6n,
      activeTasks: [{
        goalId: 'goal-1',
        goalNodeId: 'node-1',
        taskId: 'task-1',
        stepId: 'step-1',
        attemptId: 'attempt-1',
        attempt: 1,
        title: 'Durable Goal',
        status: HomeTaskStatus.PENDING,
        surface: TaskSurface.DIRECT_RUN,
      }],
    }));
    homeRuntime.install();

    const result = await startHomeGoal();

    expect(admitAgentGoal).toHaveBeenCalledWith({
      goalId: 'goal-1',
      expectedRevision: 3n,
      idempotencyKey: expect.stringMatching(/^home-goal-admit-/),
    });
    expect(startAgentGoal).toHaveBeenCalledWith({
      goalId: 'goal-1',
      expectedRevision: 4n,
      idempotencyKey: expect.stringMatching(/^home-goal-start-/),
    });
    expect(result).toBe(running);
    expect(useGoalDraftStore.getState()).toMatchObject({
      baseRevision: 5n,
      status: AgentGoalStatus.RUNNING,
      mutationState: 'running',
    });
    expect(useGoalExecutionStore.getState().executions).toEqual([
      expect.objectContaining({
        goalId: 'goal-1',
        nodeId: 'node-1',
        taskId: 'task-1',
        stepId: 'step-1',
        attemptId: 'attempt-1',
        attempt: 1,
      }),
    ]);
  });

  it('waits for cancelled Station readback before projecting the terminal state', async () => {
    const reviewed = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Cancellable Goal',
      outcome: 'Stop before execution',
      status: AgentGoalStatus.REVIEWING,
      revision: 3n,
    });
    const cancelled = create(AgentGoalSchema, {
      ...reviewed,
      status: AgentGoalStatus.CANCELLED,
      revision: 4n,
    });
    let resolveReadback!: (goal: AgentGoal) => void;
    cancelAgentGoal.mockResolvedValue(cancelled);
    getAgentGoal.mockReturnValueOnce(new Promise<AgentGoal>((resolve) => {
      resolveReadback = resolve;
    }));
    useGoalDraftStore.getState().hydrate(reviewed);

    const pending = cancelHomeGoal();
    await vi.waitFor(() => expect(cancelAgentGoal).toHaveBeenCalledWith({
      goalId: 'goal-1',
      expectedRevision: 3n,
      idempotencyKey: expect.stringMatching(/^home-goal-cancel-/),
    }));
    expect(useGoalDraftStore.getState()).toMatchObject({
      status: AgentGoalStatus.REVIEWING,
      mutationState: 'cancelling',
    });
    expect(applyGoalDraft).not.toHaveBeenCalled();

    resolveReadback(cancelled);
    await expect(pending).resolves.toBe(cancelled);
    expect(getAgentGoal).toHaveBeenCalledWith('goal-1');
    expect(applyGoalDraft).toHaveBeenCalledWith(cancelled, 'readback');
    expect(useGoalDraftStore.getState()).toMatchObject({
      baseRevision: 4n,
      status: AgentGoalStatus.CANCELLED,
      mutationState: 'cancelled',
    });
  });

  it('keeps the prior Goal and retry key when cancellation fails', async () => {
    const ready = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Cancellable Goal',
      outcome: 'Keep this visible on failure',
      status: AgentGoalStatus.READY,
      revision: 4n,
    });
    const failure = new Error('agent.home.goalCancelFailed');
    cancelAgentGoal.mockRejectedValueOnce(failure);
    useGoalDraftStore.getState().hydrate(ready);

    await expect(cancelHomeGoal()).rejects.toBe(failure);

    expect(getAgentGoal).not.toHaveBeenCalled();
    expect(useGoalDraftStore.getState()).toMatchObject({
      goalId: 'goal-1',
      baseRevision: 4n,
      status: AgentGoalStatus.READY,
      mutationState: 'cancel-failed',
      mutationError: 'agent.home.goalCancelFailed',
      cancelIdempotencyKey: expect.stringMatching(/^home-goal-cancel-/),
    });

    const retryKey = useGoalDraftStore.getState().cancelIdempotencyKey;
    const cancelled = create(AgentGoalSchema, {
      ...ready,
      status: AgentGoalStatus.CANCELLED,
      revision: 5n,
    });
    cancelAgentGoal.mockResolvedValueOnce(cancelled);
    getAgentGoal.mockResolvedValueOnce(cancelled);
    await expect(cancelHomeGoal()).resolves.toBe(cancelled);

    expect(cancelAgentGoal).toHaveBeenNthCalledWith(2, {
      goalId: 'goal-1',
      expectedRevision: 4n,
      idempotencyKey: retryKey,
    });
  });

  it('keeps a reviewed Goal visible when admission rejects it', async () => {
    const reviewed = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Durable Goal',
      outcome: 'Start the reviewed Goal',
      status: AgentGoalStatus.REVIEWING,
      revision: 3n,
    });
    useGoalDraftStore.getState().hydrate(reviewed);
    const rejected = Object.assign(
      new Error('agent.errors.goalAdmissionRejected'),
      {
        typedError: {
          error_type: 'GOAL_ADMISSION_REJECTED',
          locale_key: 'agent.errors.goalAdmissionRejected',
          details: { reason_code: 'max_tokens_missing' },
        },
      },
    );
    admitAgentGoal.mockRejectedValueOnce(rejected);

    await expect(startHomeGoal()).rejects.toBe(rejected);

    expect(startAgentGoal).not.toHaveBeenCalled();
    expect(useGoalDraftStore.getState()).toMatchObject({
      goalId: 'goal-1',
      baseRevision: 3n,
      status: AgentGoalStatus.REVIEWING,
      mutationState: 'admission-rejected',
      admissionReasonCode: 'max_tokens_missing',
    });
  });

  it('does not start the old Goal after the runtime actor changes', async () => {
    const reviewed = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Durable Goal',
      outcome: 'Do not cross actor sessions',
      status: AgentGoalStatus.REVIEWING,
      revision: 3n,
    });
    const admitted = create(AgentGoalSchema, {
      ...reviewed,
      status: AgentGoalStatus.READY,
      revision: 4n,
    });
    let resolveAdmission!: (goal: AgentGoal) => void;
    admitAgentGoal.mockReturnValueOnce(new Promise<AgentGoal>((resolve) => {
      resolveAdmission = resolve;
    }));
    useGoalDraftStore.getState().hydrate(reviewed);

    const pending = startHomeGoal();
    homeRuntime.teardown();
    resolveAdmission(admitted);

    await expect(pending).resolves.toBe(admitted);
    expect(startAgentGoal).not.toHaveBeenCalled();
    expect(useGoalDraftStore.getState().goalId).toBeNull();
  });

  it('reloads a stale Goal revision without losing local edits', async () => {
    const initial = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Durable Goal',
      outcome: 'Initial outcome',
      status: AgentGoalStatus.DRAFT,
      revision: 1n,
    });
    useGoalDraftStore.getState().hydrate(initial);
    useGoalDraftStore.getState().setOutcome('Local outcome');
    const conflict = Object.assign(
      new Error('agent.errors.lifecycleStaleVersion'),
      {
        typedError: {
          error_type: 'LIFECYCLE_STALE_VERSION',
          locale_key: 'agent.errors.lifecycleStaleVersion',
          details: { actual_revision: '2' },
        },
      },
    );
    updateAgentGoal.mockRejectedValueOnce(conflict);

    await expect(updateHomeGoalContract()).rejects.toBe(conflict);
    expect(useGoalDraftStore.getState()).toMatchObject({
      outcome: 'Local outcome',
      mutationState: 'conflict',
      conflictRevision: 2n,
    });

    getAgentGoal.mockResolvedValue(create(AgentGoalSchema, {
      ...initial,
      outcome: 'Changed elsewhere',
      revision: 2n,
    }));
    await reloadHomeGoalContract();

    expect(useGoalDraftStore.getState()).toMatchObject({
      baseRevision: 2n,
      outcome: 'Local outcome',
      mutationState: 'dirty',
    });
  });

  it('classifies forbidden review as non-retryable UI state', async () => {
    const initial = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Durable Goal',
      outcome: 'Initial outcome',
      status: AgentGoalStatus.DRAFT,
      revision: 1n,
    });
    useGoalDraftStore.getState().hydrate(initial);
    const forbidden = Object.assign(new Error('agent.errors.forbiddenActor'), {
      typedError: {
        error_type: 'OWNERSHIP_FORBIDDEN_ACTOR',
        locale_key: 'agent.errors.forbiddenActor',
        details: {},
      },
    });
    reviewAgentGoal.mockRejectedValueOnce(forbidden);

    await expect(reviewHomeGoalContract()).rejects.toBe(forbidden);
    expect(useGoalDraftStore.getState()).toMatchObject({
      mutationState: 'forbidden',
      mutationError: 'agent.errors.forbiddenActor',
    });
  });
});
