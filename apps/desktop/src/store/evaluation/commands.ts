import { create } from '@bufbuild/protobuf';
import type { StoreApi } from 'zustand';

import {
  CancelEvaluationRunRequestSchema,
  CreateEvaluationBenchmarkRequestSchema,
  CreateEvaluationDatasetRequestSchema,
  CreateEvaluationRunRequestSchema,
  CreateEvaluationTestCaseRequestSchema,
  DeleteEvaluationBenchmarkRequestSchema,
  DeleteEvaluationDatasetRequestSchema,
  DeleteEvaluationRunRequestSchema,
  DeleteEvaluationTestCaseRequestSchema,
  RetryEvaluationCasesRequestSchema,
  StartEvaluationRunRequestSchema,
  UpdateEvaluationBenchmarkRequestSchema,
  UpdateEvaluationDatasetRequestSchema,
  UpdateEvaluationTestCaseRequestSchema,
  type EvaluationBenchmark,
  type EvaluationDataset,
  type EvaluationRun,
  type EvaluationTestCase,
} from '../../gen/proto/domain/agent/evaluation_pb';
import { EVENT, eventBus } from '../../kernel/events';
import { api } from '../../services/desktop_api';
import { beginMutation, endMutation, toStoreError } from '../revalidation';
import { upsertById } from './projection';
import type {
  EvaluationState,
  EvaluationTestCaseValues,
} from './types';

type EvaluationSet = StoreApi<EvaluationState>['setState'];
type EvaluationGet = StoreApi<EvaluationState>['getState'];

type EvaluationCommandActions = Pick<
  EvaluationState,
  | 'createBenchmark'
  | 'updateBenchmark'
  | 'deleteBenchmark'
  | 'createDataset'
  | 'updateDataset'
  | 'deleteDataset'
  | 'createTestCase'
  | 'updateTestCase'
  | 'deleteTestCase'
  | 'createRun'
  | 'startRun'
  | 'cancelRun'
  | 'deleteRun'
  | 'retryCases'
>;

interface EvaluationCommandContext {
  set: EvaluationSet;
  get: EvaluationGet;
  epoch: () => number;
  isCurrent: (actorPtid: string, epoch: number) => boolean;
  fenceProjectionLoads: () => void;
}

function randomCreateKey(resource: string): string {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `evaluation:create:${resource}:${id}`;
}

function stablePayloadHash(values: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  const input = Array.from(new Set(values)).sort().join('\u001f');
  for (const char of input) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Revision mutations must replay with the same key after transport retries.
 * Formula:
 *   evaluation:<operation>:<resourceId>:revision:<expectedRevision>
 *   evaluation:<operation>:<resourceId>:revision:<expectedRevision>:payload:<fnv64>
 */
export function evaluationRevisionMutationKey(
  operation: string,
  resourceId: string,
  expectedRevision: number | bigint,
  payloadIdentity: readonly string[] = [],
): string {
  const base = `evaluation:${operation}:${resourceId}:revision:${expectedRevision}`;
  return payloadIdentity.length > 0
    ? `${base}:payload:${stablePayloadHash(payloadIdentity)}`
    : base;
}

function notifyProjectionChanged(reason: string, runId?: string): void {
  eventBus.publish(EVENT.EVALUATION_PROJECTION_INVALIDATED, { reason, runId });
}

async function executeMutation<T>(
  context: EvaluationCommandContext,
  key: string,
  operation: () => Promise<T>,
  commit: (value: T) => void,
): Promise<T> {
  const actorPtid = context.get().actorPtid;
  if (!actorPtid) throw new Error('agent.evaluationActorRequired');
  const epoch = context.epoch();
  context.fenceProjectionLoads();
  context.set((state) => ({
    error: null,
    pendingMutations: beginMutation(state.pendingMutations, key),
  }));
  try {
    const value = await operation();
    if (context.isCurrent(actorPtid, epoch)) commit(value);
    return value;
  } catch (error) {
    if (context.isCurrent(actorPtid, epoch)) {
      context.set({ error: toStoreError(error) });
    }
    throw error;
  } finally {
    if (context.isCurrent(actorPtid, epoch)) {
      context.set((state) => ({
        pendingMutations: endMutation(state.pendingMutations, key),
      }));
    }
  }
}

export function createEvaluationCommands(
  context: EvaluationCommandContext,
): EvaluationCommandActions {
  const { get, set } = context;
  return {
    createBenchmark: (name, rubric) => {
      const key = randomCreateKey('benchmark');
      return executeMutation(
        context,
        key,
        () => api.createEvaluationBenchmark(create(
          CreateEvaluationBenchmarkRequestSchema,
          { name: name.trim(), rubric: rubric.trim(), idempotencyKey: key },
        )),
        (benchmark) => {
          set((state) => ({
            benchmarks: upsertById(
              state.benchmarks,
              benchmark,
              (item) => item.benchmarkId,
            ),
          }));
          notifyProjectionChanged('benchmark-created');
        },
      );
    },

    updateBenchmark: (benchmark, values) => {
      const key = evaluationRevisionMutationKey(
        'benchmark:update',
        benchmark.benchmarkId,
        benchmark.revision,
      );
      return executeMutation(
        context,
        key,
        () => api.updateEvaluationBenchmark(create(
          UpdateEvaluationBenchmarkRequestSchema,
          {
            benchmarkId: benchmark.benchmarkId,
            name: values.name.trim(),
            rubric: values.rubric.trim(),
            expectedRevision: benchmark.revision,
            idempotencyKey: key,
          },
        )),
        (updated) => {
          set((state) => ({
            benchmarks: upsertById(
              state.benchmarks,
              updated,
              (item) => item.benchmarkId,
            ),
          }));
          notifyProjectionChanged('benchmark-updated');
        },
      );
    },

    deleteBenchmark: async (benchmark) => {
      const key = evaluationRevisionMutationKey(
        'benchmark:delete',
        benchmark.benchmarkId,
        benchmark.revision,
      );
      await executeMutation(
        context,
        key,
        () => api.deleteEvaluationBenchmark(create(
          DeleteEvaluationBenchmarkRequestSchema,
          {
            benchmarkId: benchmark.benchmarkId,
            expectedRevision: benchmark.revision,
            idempotencyKey: key,
          },
        )),
        () => {
          const datasetIds = new Set(
            get().datasets
              .filter((dataset) => dataset.benchmarkId === benchmark.benchmarkId)
              .map((dataset) => dataset.datasetId),
          );
          set((state) => ({
            benchmarks: state.benchmarks.filter(
              (item) => item.benchmarkId !== benchmark.benchmarkId,
            ),
            datasets: state.datasets.filter(
              (item) => item.benchmarkId !== benchmark.benchmarkId,
            ),
            testCasesByDatasetId: Object.fromEntries(
              Object.entries(state.testCasesByDatasetId)
                .filter(([datasetId]) => !datasetIds.has(datasetId)),
            ),
          }));
          notifyProjectionChanged('benchmark-deleted');
        },
      );
    },

    createDataset: async (benchmark, name, description) => {
      const key = randomCreateKey(`dataset:${benchmark.benchmarkId}`);
      const result = await executeMutation(
        context,
        key,
        () => api.createEvaluationDataset(create(
          CreateEvaluationDatasetRequestSchema,
          {
            benchmarkId: benchmark.benchmarkId,
            name: name.trim(),
            description: description.trim(),
            expectedBenchmarkRevision: benchmark.revision,
            idempotencyKey: key,
          },
        )),
        ({ dataset, benchmark: authoritativeBenchmark }) => {
          set((state) => ({
            benchmarks: upsertById(
              state.benchmarks,
              authoritativeBenchmark,
              (item) => item.benchmarkId,
            ),
            datasets: upsertById(
              state.datasets,
              dataset,
              (item) => item.datasetId,
            ),
            testCasesByDatasetId: {
              ...state.testCasesByDatasetId,
              [dataset.datasetId]: [],
            },
          }));
          notifyProjectionChanged('dataset-created');
        },
      );
      return result.dataset;
    },

    updateDataset: (dataset, values) => {
      const key = evaluationRevisionMutationKey(
        'dataset:update',
        dataset.datasetId,
        dataset.revision,
      );
      return executeMutation(
        context,
        key,
        () => api.updateEvaluationDataset(create(
          UpdateEvaluationDatasetRequestSchema,
          {
            datasetId: dataset.datasetId,
            name: values.name.trim(),
            description: values.description.trim(),
            expectedRevision: dataset.revision,
            idempotencyKey: key,
          },
        )),
        (updated) => {
          set((state) => ({
            datasets: upsertById(
              state.datasets,
              updated,
              (item) => item.datasetId,
            ),
          }));
          notifyProjectionChanged('dataset-updated');
        },
      );
    },

    deleteDataset: async (dataset) => {
      const key = evaluationRevisionMutationKey(
        'dataset:delete',
        dataset.datasetId,
        dataset.revision,
      );
      await executeMutation(
        context,
        key,
        () => api.deleteEvaluationDataset(create(
          DeleteEvaluationDatasetRequestSchema,
          {
            datasetId: dataset.datasetId,
            expectedRevision: dataset.revision,
            idempotencyKey: key,
          },
        )),
        () => {
          set((state) => {
            const testCasesByDatasetId = { ...state.testCasesByDatasetId };
            delete testCasesByDatasetId[dataset.datasetId];
            return {
              datasets: state.datasets.filter(
                (item) => item.datasetId !== dataset.datasetId,
              ),
              testCasesByDatasetId,
            };
          });
          notifyProjectionChanged('dataset-deleted');
        },
      );
    },

    createTestCase: (
      dataset: EvaluationDataset,
      values: EvaluationTestCaseValues,
    ) => {
      const key = randomCreateKey(`case:${dataset.datasetId}`);
      return executeMutation(
        context,
        key,
        () => api.createEvaluationTestCase(create(
          CreateEvaluationTestCaseRequestSchema,
          {
            datasetId: dataset.datasetId,
            input: values.input.trim(),
            expected: values.expected.trim(),
            rubricOverride: values.rubricOverride?.trim() || undefined,
            expectedDatasetRevision: dataset.revision,
            idempotencyKey: key,
            tags: values.tags,
          },
        )),
        ({ testCase, dataset: authoritativeDataset }) => {
          set((state) => ({
            datasets: upsertById(
              state.datasets,
              authoritativeDataset,
              (item) => item.datasetId,
            ),
            testCasesByDatasetId: {
              ...state.testCasesByDatasetId,
              [dataset.datasetId]: upsertById(
                state.testCasesByDatasetId[dataset.datasetId] ?? [],
                testCase,
                (item) => item.caseId,
              ),
            },
          }));
          notifyProjectionChanged('case-created');
        },
      ).then(({ testCase }) => testCase);
    },

    updateTestCase: (
      testCase: EvaluationTestCase,
      values: EvaluationTestCaseValues,
    ) => {
      const key = evaluationRevisionMutationKey(
        'case:update',
        testCase.caseId,
        testCase.revision,
      );
      return executeMutation(
        context,
        key,
        () => api.updateEvaluationTestCase(create(
          UpdateEvaluationTestCaseRequestSchema,
          {
            caseId: testCase.caseId,
            input: values.input.trim(),
            expected: values.expected.trim(),
            rubricOverride: values.rubricOverride?.trim() || undefined,
            tags: values.tags,
            expectedRevision: testCase.revision,
            idempotencyKey: key,
          },
        )),
        ({ testCase: updated, dataset: authoritativeDataset }) => {
          set((state) => ({
            datasets: upsertById(
              state.datasets,
              authoritativeDataset,
              (item) => item.datasetId,
            ),
            testCasesByDatasetId: {
              ...state.testCasesByDatasetId,
              [testCase.datasetId]: upsertById(
                state.testCasesByDatasetId[testCase.datasetId] ?? [],
                updated,
                (item) => item.caseId,
              ),
            },
          }));
          notifyProjectionChanged('case-updated');
        },
      ).then(({ testCase: updated }) => updated);
    },

    deleteTestCase: async (testCase: EvaluationTestCase) => {
      const key = evaluationRevisionMutationKey(
        'case:delete',
        testCase.caseId,
        testCase.revision,
      );
      await executeMutation(
        context,
        key,
        () => api.deleteEvaluationTestCase(create(
          DeleteEvaluationTestCaseRequestSchema,
          {
            caseId: testCase.caseId,
            expectedRevision: testCase.revision,
            idempotencyKey: key,
          },
        )),
        (response) => {
          set((state) => ({
            datasets: upsertById(
              state.datasets,
              response.dataset,
              (item) => item.datasetId,
            ),
            testCasesByDatasetId: {
              ...state.testCasesByDatasetId,
              [testCase.datasetId]: (
                state.testCasesByDatasetId[testCase.datasetId] ?? []
              ).filter((item) => item.caseId !== testCase.caseId),
            },
          }));
          notifyProjectionChanged('case-deleted');
        },
      );
    },

    createRun: (intent) => {
      const key = randomCreateKey(`run:${intent.datasetId}`);
      return executeMutation(
        context,
        key,
        () => api.createEvaluationRun(create(
          CreateEvaluationRunRequestSchema,
          {
            datasetId: intent.datasetId,
            datasetRevision: intent.datasetRevision,
            readinessSnapshotId: intent.readinessSnapshotId,
            idempotencyKey: key,
            targetAgentId: intent.targetAgentId,
            expectedAgentRevision: intent.expectedAgentRevision,
            runtimeProfileId: intent.runtimeProfileId,
            modelId: intent.modelId,
          },
        )),
        (run) => {
          set((state) => ({
            runs: upsertById(state.runs, run, (item) => item.runId),
          }));
          notifyProjectionChanged('run-created', run.runId);
        },
      );
    },

    startRun: (run: EvaluationRun) => {
      const key = evaluationRevisionMutationKey(
        'run:start',
        run.runId,
        run.revision,
      );
      return executeMutation(
        context,
        key,
        () => api.startEvaluationRun(create(
          StartEvaluationRunRequestSchema,
          {
            runId: run.runId,
            expectedRevision: run.revision,
            idempotencyKey: key,
          },
        )),
        (updated) => {
          set((state) => ({
            runs: upsertById(state.runs, updated, (item) => item.runId),
          }));
          notifyProjectionChanged('run-started', updated.runId);
        },
      );
    },

    cancelRun: (run: EvaluationRun) => {
      const key = evaluationRevisionMutationKey(
        'run:cancel',
        run.runId,
        run.revision,
      );
      return executeMutation(
        context,
        key,
        () => api.cancelEvaluationRun(create(
          CancelEvaluationRunRequestSchema,
          {
            runId: run.runId,
            expectedRevision: run.revision,
            idempotencyKey: key,
          },
        )),
        (updated) => {
          set((state) => ({
            runs: upsertById(state.runs, updated, (item) => item.runId),
          }));
          notifyProjectionChanged('run-cancelled', updated.runId);
        },
      );
    },

    deleteRun: async (run: EvaluationRun) => {
      const key = evaluationRevisionMutationKey(
        'run:delete',
        run.runId,
        run.revision,
      );
      const response = await executeMutation(
        context,
        key,
        () => api.deleteEvaluationRun(create(
          DeleteEvaluationRunRequestSchema,
          {
            runId: run.runId,
            expectedRevision: run.revision,
            idempotencyKey: key,
          },
        )),
        () => {
          set((state) => {
            const runDetailsById = { ...state.runDetailsById };
            const eventSequenceByRunId = { ...state.eventSequenceByRunId };
            delete runDetailsById[run.runId];
            delete eventSequenceByRunId[run.runId];
            return {
              runs: state.runs.filter((item) => item.runId !== run.runId),
              runDetailsById,
              eventSequenceByRunId,
            };
          });
          notifyProjectionChanged('run-deleted');
        },
      );
      return response.deleted;
    },

    retryCases: (run: EvaluationRun, caseIds: string[]) => {
      const normalizedCaseIds = Array.from(new Set(caseIds)).sort();
      const key = evaluationRevisionMutationKey(
        'run:retry',
        run.runId,
        run.revision,
        normalizedCaseIds,
      );
      return executeMutation(
        context,
        key,
        () => api.retryEvaluationCases(create(
          RetryEvaluationCasesRequestSchema,
          {
            parentRunId: run.runId,
            caseIds: normalizedCaseIds,
            idempotencyKey: key,
            expectedParentRevision: run.revision,
          },
        )),
        (childRun) => {
          set((state) => ({
            runs: upsertById(state.runs, childRun, (item) => item.runId),
          }));
          notifyProjectionChanged('run-retried', childRun.runId);
        },
      );
    },
  };
}

export type {
  EvaluationBenchmark,
  EvaluationDataset,
  EvaluationRun,
  EvaluationTestCase,
};
