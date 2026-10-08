import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  AgentGoalSchema,
  AgentGoalStatus,
} from '../gen/proto/domain/agent/goal_pb';
import { useGoalDraftStore } from './goalDraft';

function goal(revision: bigint, outcome = 'Station outcome') {
  return create(AgentGoalSchema, {
    goalId: 'goal-1',
    ownerPtid: 'ptid:actor-1',
    title: 'Durable Goal',
    outcome,
    nonGoals: ['No deployment'],
    constraints: ['Keep Station ownership'],
    budget: {
      maxTokens: 100_000n,
      maxCost: 10,
      wallTimeMs: 3_600_000n,
      maxParallelTasks: 2,
    },
    acceptanceCriteria: [{
      criterionId: 'criterion-1',
      description: 'Station readback matches',
      evaluator: 'deterministic',
      required: true,
    }],
    status: AgentGoalStatus.DRAFT,
    revision,
  });
}

describe('Goal contract draft store', () => {
  beforeEach(() => {
    useGoalDraftStore.getState().reset();
  });

  it('hydrates editable contract fields from Station truth', () => {
    useGoalDraftStore.getState().hydrate(goal(1n));

    expect(useGoalDraftStore.getState()).toMatchObject({
      goalId: 'goal-1',
      baseRevision: 1n,
      outcome: 'Station outcome',
      nonGoals: ['No deployment'],
      constraints: ['Keep Station ownership'],
      budget: {
        maxTokens: 100_000n,
        maxCost: 10,
        wallTimeMs: 3_600_000n,
        maxParallelTasks: 2,
      },
      dirty: false,
      mutationState: 'idle',
    });
  });

  it('rebases a conflict without losing local edits', () => {
    const store = useGoalDraftStore.getState();
    store.hydrate(goal(1n));
    store.setOutcome('Local outcome');
    store.setNonGoals(['Local non-goal']);
    store.markConflict(2n, 'agent.errors.lifecycleStaleVersion');

    useGoalDraftStore.getState().applyReloadPreservingEdits(
      goal(2n, 'Changed elsewhere'),
    );

    expect(useGoalDraftStore.getState()).toMatchObject({
      baseRevision: 2n,
      outcome: 'Local outcome',
      nonGoals: ['Local non-goal'],
      dirty: true,
      mutationState: 'dirty',
      mutationError: null,
      conflictRevision: null,
    });
  });

  it('projects the exact reviewed Station revision', () => {
    const store = useGoalDraftStore.getState();
    store.hydrate(goal(2n));
    store.setConstraints(['Reviewed constraint']);
    store.beginMutation('review', 'goal-review-1');
    store.applyMutation(create(AgentGoalSchema, {
      ...goal(2n),
      constraints: ['Reviewed constraint'],
      status: AgentGoalStatus.REVIEWING,
      revision: 3n,
    }));

    expect(useGoalDraftStore.getState()).toMatchObject({
      baseRevision: 3n,
      constraints: ['Reviewed constraint'],
      dirty: false,
      mutationState: 'reviewing',
    });
  });

  it('projects admitted and running Station states', () => {
    const store = useGoalDraftStore.getState();
    store.hydrate(create(AgentGoalSchema, {
      ...goal(3n),
      status: AgentGoalStatus.REVIEWING,
    }));
    store.beginMutation('admit', 'goal-admit-1');
    store.applyMutation(create(AgentGoalSchema, {
      ...goal(4n),
      status: AgentGoalStatus.READY,
    }));

    expect(useGoalDraftStore.getState()).toMatchObject({
      baseRevision: 4n,
      status: AgentGoalStatus.READY,
      mutationState: 'ready',
    });

    useGoalDraftStore.getState().beginMutation('start', 'goal-start-1');
    useGoalDraftStore.getState().applyMutation(create(AgentGoalSchema, {
      ...goal(5n),
      status: AgentGoalStatus.RUNNING,
    }));
    expect(useGoalDraftStore.getState()).toMatchObject({
      baseRevision: 5n,
      status: AgentGoalStatus.RUNNING,
      mutationState: 'running',
    });
  });

  it('keeps cancellation pending until Station readback is applied', () => {
    const reviewing = create(AgentGoalSchema, {
      ...goal(3n),
      status: AgentGoalStatus.REVIEWING,
    });
    const store = useGoalDraftStore.getState();
    store.hydrate(reviewing);
    store.beginMutation('cancel', 'goal-cancel-retry');

    expect(useGoalDraftStore.getState()).toMatchObject({
      baseRevision: 3n,
      status: AgentGoalStatus.REVIEWING,
      mutationState: 'cancelling',
      cancelIdempotencyKey: 'goal-cancel-retry',
    });

    useGoalDraftStore.getState().applyMutation(create(AgentGoalSchema, {
      ...reviewing,
      status: AgentGoalStatus.CANCELLED,
      revision: 4n,
    }));
    expect(useGoalDraftStore.getState()).toMatchObject({
      baseRevision: 4n,
      status: AgentGoalStatus.CANCELLED,
      mutationState: 'cancelled',
      cancelIdempotencyKey: '',
    });
  });

  it('preserves the reviewed contract and admission reason after rejection', () => {
    const reviewed = create(AgentGoalSchema, {
      ...goal(3n),
      status: AgentGoalStatus.REVIEWING,
    });
    const store = useGoalDraftStore.getState();
    store.hydrate(reviewed);
    store.beginMutation('admit', 'goal-admit-retry');
    store.markAdmissionRejected(
      'agent.errors.goalAdmissionRejected',
      'max_tokens_missing',
    );

    expect(useGoalDraftStore.getState()).toMatchObject({
      goalId: reviewed.goalId,
      baseRevision: reviewed.revision,
      status: AgentGoalStatus.REVIEWING,
      mutationState: 'admission-rejected',
      admissionReasonCode: 'max_tokens_missing',
      admitIdempotencyKey: 'goal-admit-retry',
    });
  });

  it('keeps unauthorized mutation terminal and preserves edits', () => {
    const store = useGoalDraftStore.getState();
    store.hydrate(goal(1n));
    store.setOutcome('Local unauthorized edit');
    store.markForbidden('agent.errors.forbiddenActor');

    expect(useGoalDraftStore.getState()).toMatchObject({
      outcome: 'Local unauthorized edit',
      dirty: true,
      mutationState: 'forbidden',
      mutationError: 'agent.errors.forbiddenActor',
    });
  });
});
