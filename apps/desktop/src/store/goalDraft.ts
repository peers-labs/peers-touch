import {
  AgentGoalStatus,
  type AgentGoal,
} from '../gen/proto/domain/agent/goal_pb';
import { createDesktopStore } from './createDesktopStore';

export interface GoalBudgetDraft {
  maxTokens: bigint;
  maxCost?: number;
  wallTimeMs: bigint;
  maxParallelTasks: number;
}

export interface GoalAcceptanceCriterionDraft {
  criterionId: string;
  description: string;
  evaluator: string;
  required: boolean;
}

export type GoalContractMutationState =
  | 'idle'
  | 'dirty'
  | 'saving'
  | 'reviewing'
  | 'admitting'
  | 'ready'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'cancel-failed'
  | 'admission-rejected'
  | 'conflict'
  | 'forbidden'
  | 'failed';

interface GoalDraftState {
  goalId: string | null;
  baseRevision: bigint | null;
  status: AgentGoalStatus;
  outcome: string;
  nonGoals: string[];
  constraints: string[];
  budget: GoalBudgetDraft;
  acceptanceCriteria: GoalAcceptanceCriterionDraft[];
  dirty: boolean;
  mutationState: GoalContractMutationState;
  mutationError: string | null;
  conflictRevision: bigint | null;
  updateIdempotencyKey: string;
  reviewIdempotencyKey: string;
  admitIdempotencyKey: string;
  startIdempotencyKey: string;
  cancelIdempotencyKey: string;
  admissionReasonCode: string;
  reloadLoading: boolean;
  hydrate: (goal: AgentGoal) => void;
  setOutcome: (outcome: string) => void;
  setNonGoals: (nonGoals: string[]) => void;
  setConstraints: (constraints: string[]) => void;
  setBudget: (budget: Partial<GoalBudgetDraft>) => void;
  addAcceptanceCriterion: () => void;
  updateAcceptanceCriterion: (
    criterionId: string,
    updates: Partial<GoalAcceptanceCriterionDraft>,
  ) => void;
  removeAcceptanceCriterion: (criterionId: string) => void;
  beginMutation: (
    kind: 'update' | 'review' | 'admit' | 'start' | 'cancel',
    idempotencyKey: string,
  ) => void;
  applyMutation: (goal: AgentGoal) => void;
  markAdmissionRejected: (error: string, reasonCode: string) => void;
  markConflict: (actualRevision: bigint, error: string) => void;
  markForbidden: (error: string) => void;
  markFailure: (error: string) => void;
  markCancelFailure: (error: string) => void;
  beginReload: () => void;
  applyReloadPreservingEdits: (goal: AgentGoal) => void;
  failReload: (error: string) => void;
  reset: () => void;
}

const emptyBudget: GoalBudgetDraft = {
  maxTokens: 0n,
  wallTimeMs: 0n,
  maxParallelTasks: 0,
};

function draftFromGoal(goal: AgentGoal) {
  let mutationState: GoalContractMutationState = 'idle';
  if (goal.status === AgentGoalStatus.REVIEWING) mutationState = 'reviewing';
  if (goal.status === AgentGoalStatus.READY) mutationState = 'ready';
  if (goal.status === AgentGoalStatus.RUNNING) mutationState = 'running';
  if (goal.status === AgentGoalStatus.CANCELLED) mutationState = 'cancelled';
  return {
    goalId: goal.goalId,
    baseRevision: goal.revision,
    status: goal.status,
    outcome: goal.outcome,
    nonGoals: [...goal.nonGoals],
    constraints: [...goal.constraints],
    budget: {
      maxTokens: goal.budget?.maxTokens ?? 0n,
      ...(goal.budget?.maxCost === undefined
        ? {}
        : { maxCost: goal.budget.maxCost }),
      wallTimeMs: goal.budget?.wallTimeMs ?? 0n,
      maxParallelTasks: goal.budget?.maxParallelTasks ?? 0,
    },
    acceptanceCriteria: goal.acceptanceCriteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      description: criterion.description,
      evaluator: criterion.evaluator,
      required: criterion.required,
    })),
    dirty: false,
    mutationState,
    mutationError: null,
    conflictRevision: null,
    updateIdempotencyKey: '',
    reviewIdempotencyKey: '',
    admitIdempotencyKey: '',
    startIdempotencyKey: '',
    cancelIdempotencyKey: '',
    admissionReasonCode: '',
    reloadLoading: false,
  };
}

function editable(state: GoalDraftState): boolean {
  return state.status === AgentGoalStatus.DRAFT;
}

function dirtyState() {
  return {
    dirty: true,
    mutationState: 'dirty' as const,
    mutationError: null,
    conflictRevision: null,
    updateIdempotencyKey: '',
    reviewIdempotencyKey: '',
    admitIdempotencyKey: '',
    startIdempotencyKey: '',
    cancelIdempotencyKey: '',
    admissionReasonCode: '',
  };
}

export const useGoalDraftStore = createDesktopStore<GoalDraftState>(
  'goalDraft',
  (set) => ({
    goalId: null,
    baseRevision: null,
    status: AgentGoalStatus.UNSPECIFIED,
    outcome: '',
    nonGoals: [],
    constraints: [],
    budget: emptyBudget,
    acceptanceCriteria: [],
    dirty: false,
    mutationState: 'idle',
    mutationError: null,
    conflictRevision: null,
    updateIdempotencyKey: '',
    reviewIdempotencyKey: '',
    admitIdempotencyKey: '',
    startIdempotencyKey: '',
    cancelIdempotencyKey: '',
    admissionReasonCode: '',
    reloadLoading: false,

    hydrate: (goal) => set(draftFromGoal(goal)),

    setOutcome: (outcome) => set((state) => (
      editable(state) ? { outcome, ...dirtyState() } : state
    )),

    setNonGoals: (nonGoals) => set((state) => (
      editable(state) ? { nonGoals: [...nonGoals], ...dirtyState() } : state
    )),

    setConstraints: (constraints) => set((state) => (
      editable(state) ? { constraints: [...constraints], ...dirtyState() } : state
    )),

    setBudget: (budget) => set((state) => (
      editable(state)
        ? { budget: { ...state.budget, ...budget }, ...dirtyState() }
        : state
    )),

    addAcceptanceCriterion: () => set((state) => {
      if (!editable(state)) return state;
      const id = globalThis.crypto?.randomUUID?.()
        || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return {
        acceptanceCriteria: [
          ...state.acceptanceCriteria,
          {
            criterionId: `criterion-${id}`,
            description: '',
            evaluator: 'deterministic',
            required: true,
          },
        ],
        ...dirtyState(),
      };
    }),

    updateAcceptanceCriterion: (criterionId, updates) => set((state) => (
      editable(state)
        ? {
            acceptanceCriteria: state.acceptanceCriteria.map((criterion) => (
              criterion.criterionId === criterionId
                ? { ...criterion, ...updates, criterionId }
                : criterion
            )),
            ...dirtyState(),
          }
        : state
    )),

    removeAcceptanceCriterion: (criterionId) => set((state) => (
      editable(state)
        ? {
            acceptanceCriteria: state.acceptanceCriteria.filter(
              (criterion) => criterion.criterionId !== criterionId,
            ),
            ...dirtyState(),
          }
        : state
    )),

    beginMutation: (kind, idempotencyKey) => set({
      mutationState:
        kind === 'admit'
          ? 'admitting'
          : kind === 'start'
            ? 'starting'
            : kind === 'cancel'
              ? 'cancelling'
              : 'saving',
      mutationError: null,
      conflictRevision: null,
      admissionReasonCode: '',
      ...(kind === 'update' ? { updateIdempotencyKey: idempotencyKey } : {}),
      ...(kind === 'review' ? { reviewIdempotencyKey: idempotencyKey } : {}),
      ...(kind === 'admit' ? { admitIdempotencyKey: idempotencyKey } : {}),
      ...(kind === 'start' ? { startIdempotencyKey: idempotencyKey } : {}),
      ...(kind === 'cancel' ? { cancelIdempotencyKey: idempotencyKey } : {}),
    }),

    applyMutation: (goal) => set(draftFromGoal(goal)),

    markAdmissionRejected: (error, reasonCode) => set({
      mutationState: 'admission-rejected',
      mutationError: error,
      admissionReasonCode: reasonCode,
      conflictRevision: null,
    }),

    markConflict: (actualRevision, error) => set({
      mutationState: 'conflict',
      mutationError: error,
      conflictRevision: actualRevision,
    }),

    markForbidden: (error) => set({
      mutationState: 'forbidden',
      mutationError: error,
      conflictRevision: null,
    }),

    markFailure: (error) => set({
      mutationState: 'failed',
      mutationError: error,
      conflictRevision: null,
    }),

    markCancelFailure: (error) => set({
      mutationState: 'cancel-failed',
      mutationError: error,
      conflictRevision: null,
    }),

    beginReload: () => set({ reloadLoading: true }),

    applyReloadPreservingEdits: (goal) => set((state) => {
      if (state.goalId !== goal.goalId || !state.dirty) {
        return draftFromGoal(goal);
      }
      return {
        baseRevision: goal.revision,
        status: goal.status,
        mutationState: 'dirty',
        mutationError: null,
        conflictRevision: null,
        updateIdempotencyKey: '',
        reviewIdempotencyKey: '',
        admitIdempotencyKey: '',
        startIdempotencyKey: '',
        cancelIdempotencyKey: '',
        admissionReasonCode: '',
        reloadLoading: false,
      };
    }),

    failReload: (error) => set({
      reloadLoading: false,
      mutationError: error,
    }),

    reset: () => set({
      goalId: null,
      baseRevision: null,
      status: AgentGoalStatus.UNSPECIFIED,
      outcome: '',
      nonGoals: [],
      constraints: [],
      budget: emptyBudget,
      acceptanceCriteria: [],
      dirty: false,
      mutationState: 'idle',
      mutationError: null,
      conflictRevision: null,
      updateIdempotencyKey: '',
      reviewIdempotencyKey: '',
      admitIdempotencyKey: '',
      startIdempotencyKey: '',
      cancelIdempotencyKey: '',
      admissionReasonCode: '',
      reloadLoading: false,
    }),
  }),
);
