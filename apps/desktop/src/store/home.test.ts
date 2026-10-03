import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  HomeErrorCode,
  HomeProjectionFreshness,
  HomeWorkProjectionSchema,
} from '../gen/proto/domain/agent/home_pb';
import {
  AgentGoalSchema,
  AgentGoalStatus,
} from '../gen/proto/domain/agent/goal_pb';
import { useHomeStore } from './home';

describe('home projection store', () => {
  beforeEach(() => {
    useHomeStore.getState().reset();
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
