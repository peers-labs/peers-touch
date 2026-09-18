import { createDesktopStore } from './createDesktopStore';
import { api } from '../services/desktop_api';
import { log } from '../utils/logger';
import { toStoreError } from './revalidation';
import { createEvaluationCommands } from './evaluation/commands';
import {
  isActiveEvaluationRun,
  loadEvaluationProjection,
  upsertById,
} from './evaluation/projection';
import {
  initialEvaluationState,
  type EvaluationState,
} from './evaluation/types';

let projectionEpoch = 0;
let projectionLoadSequence = 0;
let eventLoadSequence = 0;

function currentScope(
  actorPtid: string,
  epoch: number,
  sequence: number,
): boolean {
  const state = useEvaluationStore.getState();
  return (
    state.actorPtid === actorPtid
    && projectionEpoch === epoch
    && projectionLoadSequence === sequence
  );
}

function currentMutation(actorPtid: string, epoch: number): boolean {
  return (
    useEvaluationStore.getState().actorPtid === actorPtid
    && projectionEpoch === epoch
  );
}

export const useEvaluationStore = createDesktopStore<EvaluationState>(
  'evaluation',
  (set, get) => ({
    ...initialEvaluationState(),

    setActorScope: (actorPtid) => {
      if (get().actorPtid === actorPtid) return;
      projectionEpoch += 1;
      projectionLoadSequence += 1;
      eventLoadSequence += 1;
      set({ ...initialEvaluationState(), actorPtid });
    },

    loadProjection: async (actorPtid, reason) => {
      if (get().actorPtid !== actorPtid) get().setActorScope(actorPtid);
      const epoch = projectionEpoch;
      const sequence = ++projectionLoadSequence;
      const hasProjection = (
        get().benchmarks.length > 0
        || get().datasets.length > 0
        || get().runs.length > 0
      );
      set({
        projectionPhase:
          reason === 'bootstrap' || reason === 'restart'
            ? 'restoring'
            : hasProjection
              ? 'ready'
              : 'loading',
        error: null,
      });
      try {
        const projection = await loadEvaluationProjection();
        if (!currentScope(actorPtid, epoch, sequence)) return;
        set({
          ...projection,
          projectionPhase: 'ready',
          error: null,
        });
      } catch (error) {
        if (!currentScope(actorPtid, epoch, sequence)) return;
        const message = toStoreError(error);
        set({ projectionPhase: 'error', error: message });
        log.warn('evaluation', 'Station projection load failed', {
          actorPtid,
          reason,
          error: message,
        });
        throw error;
      }
    },

    consumeRunEvents: async () => {
      const actorPtid = get().actorPtid;
      if (!actorPtid) return;
      const epoch = projectionEpoch;
      const sequence = ++eventLoadSequence;
      const runs = get().runs.filter(isActiveEvaluationRun);
      if (runs.length === 0) return;
      try {
        const eventResponses = await Promise.all(
          runs.map(async (run) => ({
            run,
            response: await api.listEvaluationRunEvents(
              run.runId,
              get().eventSequenceByRunId[run.runId] ?? 0n,
            ),
          })),
        );
        if (
          projectionEpoch !== epoch
          || eventLoadSequence !== sequence
          || get().actorPtid !== actorPtid
        ) return;
        const changedRunIds = eventResponses
          .filter(({ run, response }) =>
            response.latestSequence > (get().eventSequenceByRunId[run.runId] ?? 0n),
          )
          .map(({ run }) => run.runId);
        const details = await Promise.all(
          changedRunIds.map((runId) => api.getEvaluationRun(runId)),
        );
        if (
          projectionEpoch !== epoch
          || eventLoadSequence !== sequence
          || get().actorPtid !== actorPtid
        ) return;
        set((state) => {
          const eventSequenceByRunId = { ...state.eventSequenceByRunId };
          for (const { run, response } of eventResponses) {
            eventSequenceByRunId[run.runId] = response.latestSequence;
          }
          let nextRuns = state.runs;
          const runDetailsById = { ...state.runDetailsById };
          for (const detail of details) {
            if (!detail.run) continue;
            nextRuns = upsertById(nextRuns, detail.run, (run) => run.runId);
            runDetailsById[detail.run.runId] = {
              run: detail.run,
              attempts: detail.attempts,
              results: detail.results,
              cases: detail.cases,
            };
          }
          return { eventSequenceByRunId, runDetailsById, runs: nextRuns };
        });
      } catch (error) {
        if (projectionEpoch !== epoch || get().actorPtid !== actorPtid) return;
        log.warn('evaluation', 'Station event reconciliation failed', {
          error: toStoreError(error),
        });
      }
    },

    refreshRun: async (runId) => {
      const actorPtid = get().actorPtid;
      if (!actorPtid) return;
      const epoch = projectionEpoch;
      const detail = await api.getEvaluationRun(runId);
      if (!detail.run || !currentMutation(actorPtid, epoch)) return;
      set((state) => {
        const currentRevision = (
          state.runs.find((run) => run.runId === runId)?.revision ?? 0n
        );
        if (currentRevision > detail.run!.revision) return state;
        return {
          runs: upsertById(state.runs, detail.run!, (run) => run.runId),
          runDetailsById: {
            ...state.runDetailsById,
            [runId]: {
              run: detail.run!,
              attempts: detail.attempts,
              results: detail.results,
              cases: detail.cases,
            },
          },
        };
      });
    },

    clearError: () => set({ error: null }),

    reset: () => {
      projectionEpoch += 1;
      projectionLoadSequence += 1;
      eventLoadSequence += 1;
      set(initialEvaluationState());
    },

    ...createEvaluationCommands({
      set,
      get,
      epoch: () => projectionEpoch,
      isCurrent: currentMutation,
      fenceProjectionLoads: () => {
        projectionLoadSequence += 1;
        eventLoadSequence += 1;
      },
    }),
  }),
);

export { evaluationRevisionMutationKey } from './evaluation/commands';
export { evaluationRunStatusName } from './evaluation/projection';
export type {
  CreateEvaluationRunIntent,
  EvaluationProjectionPhase,
  EvaluationRunDetail,
  EvaluationState,
  EvaluationTestCaseValues,
} from './evaluation/types';
