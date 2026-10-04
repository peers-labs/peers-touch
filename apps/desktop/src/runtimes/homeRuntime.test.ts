import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HomeWorkKind,
  HomeWorkProjectionSchema,
} from '../gen/proto/domain/agent/home_pb';
import {
  AgentGoalSchema,
  AgentGoalStatus,
  type AgentGoal,
} from '../gen/proto/domain/agent/goal_pb';
import { useGoalDraftStore } from '../store/goalDraft';

const getHomeWorkProjection = vi.hoisted(() => vi.fn());
const submitHomeChatCommand = vi.hoisted(() => vi.fn());
const submitHomeTaskCommand = vi.hoisted(() => vi.fn());
const createAgentGoalDraft = vi.hoisted(() => vi.fn());
const getAgentGoal = vi.hoisted(() => vi.fn());
const updateAgentGoal = vi.hoisted(() => vi.fn());
const reviewAgentGoal = vi.hoisted(() => vi.fn());
const setAgentSurface = vi.hoisted(() => vi.fn());
const setSelectedAgent = vi.hoisted(() => vi.fn());
const selectSession = vi.hoisted(() => vi.fn());
const setActiveTask = vi.hoisted(() => vi.fn());
const applyProjection = vi.hoisted(() => vi.fn());
const beginLoad = vi.hoisted(() => vi.fn());
const failLoad = vi.hoisted(() => vi.fn());
const beginGoalCreate = vi.hoisted(() => vi.fn());
const applyGoalDraft = vi.hoisted(() => vi.fn());
const failGoalCreate = vi.hoisted(() => vi.fn());
const beginGoalReadback = vi.hoisted(() => vi.fn());
const failGoalReadback = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn());

const agentState = {
  setAgentSurface,
  setSelectedAgent,
};

const homeState = {
  projection: null,
  goalDraftTitle: '',
  goalDraftOutcome: '',
  goalDraftIdempotencyKey: '',
  savedGoal: null as AgentGoal | null,
  beginLoad,
  applyProjection,
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
  },
  isAgentForbiddenActorError: (error: { error_type?: string } | undefined) =>
    error?.error_type === 'OWNERSHIP_FORBIDDEN_ACTOR',
  isAgentLifecycleStaleVersionError: (
    error: { error_type?: string } | undefined,
  ) => error?.error_type === 'LIFECYCLE_STALE_VERSION',
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
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../utils/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  createHomeGoalDraft,
  homeGoalDraftByteLength,
  homeRuntime,
  openHomeConversation,
  reloadHomeGoalContract,
  reviewHomeGoalContract,
  submitHomeChat,
  submitHomeTask,
  updateHomeGoalContract,
  validateHomeGoalDraftBytes,
} from './homeRuntime';

describe('homeRuntime', () => {
  beforeEach(() => {
    homeRuntime.teardown();
    vi.clearAllMocks();
    selectSession.mockResolvedValue(undefined);
    getHomeWorkProjection.mockResolvedValue(create(HomeWorkProjectionSchema, {
      ptid: 'ptid:actor-1',
      revision: 7n,
    }));
    homeState.goalDraftTitle = '';
    homeState.goalDraftOutcome = '';
    homeState.goalDraftIdempotencyKey = '';
    homeState.savedGoal = null;
    useGoalDraftStore.getState().reset();
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
