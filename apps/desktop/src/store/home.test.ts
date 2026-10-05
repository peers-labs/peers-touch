import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  HomeErrorCode,
  HomeProjectionFreshness,
  HomeTaskStatus,
  HomeWorkProjectionSchema,
} from '../gen/proto/domain/agent/home_pb';
import {
  AgentGoalSchema,
  AgentGoalStatus,
} from '../gen/proto/domain/agent/goal_pb';
import { normalizeHomeTaskRunStatus, useHomeStore } from './home';

describe('home projection store', () => {
  beforeEach(() => {
    useHomeStore.getState().reset();
  });

  it('maps unknown TaskRun lifecycle values to unavailable', () => {
    expect(normalizeHomeTaskRunStatus(HomeTaskStatus.PENDING)).toBe('pending');
    expect(normalizeHomeTaskRunStatus(HomeTaskStatus.NEEDS_USER)).toBe('needs_user');
    expect(normalizeHomeTaskRunStatus(HomeTaskStatus.UNSPECIFIED)).toBe('unavailable');
    expect(normalizeHomeTaskRunStatus(99 as HomeTaskStatus)).toBe('unavailable');
  });

  it('preserves accepted content and exposes stale retry metadata for an older revision', () => {
    useHomeStore.getState().applyProjection(
      create(HomeWorkProjectionSchema, {
        ptid: 'ptid:actor-1',
        revision: 9n,
        freshness: HomeProjectionFreshness.FRESH,
        pinnedAgents: [{
          agentId: 'agent-1',
          agentName: 'researcher',
          displayName: 'Researcher',
        }],
      }),
    );
    useHomeStore.getState().applyProjection(
      create(HomeWorkProjectionSchema, {
        ptid: 'ptid:actor-1',
        revision: 8n,
        freshness: HomeProjectionFreshness.STALE,
        sliceErrors: [{
          sliceId: 'projection',
          code: HomeErrorCode.PROJECTION_STALE,
          retryable: true,
          recoveryAction: 'retry',
        }],
      }),
    );

    expect(useHomeStore.getState().projection).toMatchObject({
      revision: 9n,
      freshness: HomeProjectionFreshness.STALE,
      pinnedAgents: [{
        agentId: 'agent-1',
        agentName: 'researcher',
        displayName: 'Researcher',
      }],
      sliceErrors: [{
        sliceId: 'projection',
        code: HomeErrorCode.PROJECTION_STALE,
        retryable: true,
        recoveryAction: 'retry',
      }],
    });
    expect(useHomeStore.getState()).toMatchObject({
      loading: false,
      error: null,
      connectionState: 'stale',
      retryable: true,
    });
  });

  it('accepts a lower revision after the actor scope changes', () => {
    useHomeStore.getState().applyProjection(
      create(HomeWorkProjectionSchema, {
        ptid: 'ptid:actor-1',
        revision: 9n,
      }),
    );
    useHomeStore.getState().applyProjection(
      create(HomeWorkProjectionSchema, {
        ptid: 'ptid:actor-2',
        revision: 1n,
      }),
    );

    expect(useHomeStore.getState().projection).toEqual(expect.objectContaining({
      ptid: 'ptid:actor-2',
      revision: 1n,
    }));
  });

  it('accepts each Agent event once and rejects older stream revisions', () => {
    const store = useHomeStore.getState();
    const running = {
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

    expect(store.applyAgentDomainEvent(running)).toBe(true);
    expect(store.applyAgentDomainEvent(running)).toBe(false);
    expect(store.applyAgentDomainEvent({
      ...running,
      eventId: 'stream-1',
      domainEventId: 'task-event-1',
      domainSequence: 1n,
    })).toBe(false);
    expect(store.applyAgentDomainEvent({
      ...running,
      eventId: 'stream-3',
      domainEventId: 'task-event-3',
      domainSequence: 3n,
      goalRevision: 4n,
    })).toBe(false);

    expect(useHomeStore.getState()).toMatchObject({
      lastAgentEvent: running,
      agentEventCursors: {
        'task:task-1': {
          domainEventId: 'task-event-2',
          domainSequence: 2n,
          goalRevision: 5n,
        },
      },
    });
  });

  it('tracks Goal and Task event sequences independently', () => {
    const store = useHomeStore.getState();
    expect(store.applyAgentDomainEvent({
      eventId: 'goal-stream-5',
      domainEventId: 'goal-event-5',
      domainSequence: 5n,
      schemaVersion: 1,
      eventType: 'agent.goal.running',
      goalId: 'goal-1',
      taskId: '',
      goalRevision: 5n,
      committedTsUnixMs: 1,
    })).toBe(true);
    expect(store.applyAgentDomainEvent({
      eventId: 'task-stream-1',
      domainEventId: 'task-event-1',
      domainSequence: 1n,
      schemaVersion: 1,
      eventType: 'agent.collaboration.task.created',
      goalId: 'goal-1',
      taskId: 'task-1',
      goalRevision: 5n,
      committedTsUnixMs: 2,
    })).toBe(true);
  });

  it('preserves accepted content through disconnect and resync states', () => {
    const store = useHomeStore.getState();
    store.applyProjection(create(HomeWorkProjectionSchema, {
      ptid: 'ptid:actor-1',
      revision: 9n,
      freshness: HomeProjectionFreshness.FRESH,
      pinnedAgents: [{
        agentId: 'agent-1',
        displayName: 'Researcher',
      }],
    }));
    useHomeStore.getState().markConnectionLost();

    expect(useHomeStore.getState()).toMatchObject({
      connectionState: 'reconnecting',
      retryable: false,
      projection: expect.objectContaining({
        revision: 9n,
        pinnedAgents: [expect.objectContaining({ agentId: 'agent-1' })],
      }),
    });

    useHomeStore.getState().beginResync();
    expect(useHomeStore.getState()).toMatchObject({
      connectionState: 'resyncing',
      loading: true,
      projection: expect.objectContaining({ revision: 9n }),
    });
  });

  it('makes authorization failures non-retryable without clearing data', () => {
    const store = useHomeStore.getState();
    store.applyProjection(create(HomeWorkProjectionSchema, {
      ptid: 'ptid:actor-1',
      revision: 3n,
      freshness: HomeProjectionFreshness.FRESH,
    }));
    useHomeStore.getState().failLoad('unauthorized', true);

    expect(useHomeStore.getState()).toMatchObject({
      connectionState: 'unauthorized',
      retryable: false,
      error: 'unauthorized',
      projection: expect.objectContaining({ revision: 3n }),
    });
  });

  it('preserves Goal input across loading and create failure', () => {
    const store = useHomeStore.getState();
    store.setGoalDraftTitle('Durable Goal');
    store.setGoalDraftOutcome('The same draft can be reopened');
    store.beginLoad();
    store.beginGoalCreate('goal-key-1');
    store.failGoalCreate('offline');

    expect(useHomeStore.getState()).toMatchObject({
      goalDraftTitle: 'Durable Goal',
      goalDraftOutcome: 'The same draft can be reopened',
      goalDraftIdempotencyKey: 'goal-key-1',
      goalCreating: false,
      goalCreateError: 'offline',
    });
  });

  it('keeps the newest Station Goal revision during readback', () => {
    const goal = create(AgentGoalSchema, {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Durable Goal',
      outcome: 'The same draft can be reopened',
      status: AgentGoalStatus.DRAFT,
      revision: 2n,
    });
    useHomeStore.getState().applyGoalDraft(goal, 'create');
    useHomeStore.getState().beginGoalReadback();
    useHomeStore.getState().applyGoalDraft(create(AgentGoalSchema, {
      ...goal,
      revision: 1n,
    }), 'readback');

    expect(useHomeStore.getState()).toMatchObject({
      savedGoal: expect.objectContaining({
        goalId: 'goal-1',
        revision: 2n,
      }),
      goalDraftTitle: 'Durable Goal',
      goalDraftOutcome: 'The same draft can be reopened',
      goalReadbackLoading: false,
      goalReadbackError: 'agent.home.goalReadbackStale',
    });
  });
});
