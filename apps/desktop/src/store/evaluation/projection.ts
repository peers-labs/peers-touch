import {
  EvaluationRunStatus,
  type EvaluationRun,
  type GetEvaluationRunResponse,
} from '../../gen/proto/domain/agent/evaluation_pb';
import { api } from '../../services/desktop_api';
import type {
  EvaluationProjectionState,
  EvaluationRunDetail,
} from './types';

const EVALUATION_RUN_PAGE_SIZE = 100;

export function isActiveEvaluationRun(run: EvaluationRun): boolean {
  return [
    EvaluationRunStatus.DRAFT,
    EvaluationRunStatus.PENDING,
    EvaluationRunStatus.RUNNING,
    EvaluationRunStatus.CANCEL_INTENT_COMMITTED,
    EvaluationRunStatus.CANCELLING,
  ].includes(run.status);
}

export function upsertById<T>(
  items: readonly T[],
  next: T,
  idOf: (item: T) => string,
): T[] {
  const nextId = idOf(next);
  return [next, ...items.filter((item) => idOf(item) !== nextId)];
}

export async function loadEvaluationRunDetails(
  runs: readonly EvaluationRun[],
): Promise<Record<string, EvaluationRunDetail>> {
  const details = await Promise.all(runs.map((run) => api.getEvaluationRun(run.runId)));
  return Object.fromEntries(
    details
      .filter(
        (detail): detail is GetEvaluationRunResponse & { run: EvaluationRun } =>
          Boolean(detail.run),
      )
      .map((detail) => [
        detail.run.runId,
        {
          run: detail.run,
          attempts: detail.attempts,
          results: detail.results,
          cases: detail.cases,
        },
      ]),
  );
}

export async function loadEvaluationProjection(): Promise<
  Pick<
    EvaluationProjectionState,
    | 'benchmarks'
    | 'datasets'
    | 'testCasesByDatasetId'
    | 'runs'
    | 'runDetailsById'
  >
> {
  const [benchmarks, runResponse] = await Promise.all([
    api.listEvaluationBenchmarks(),
    api.listEvaluationRuns(1, EVALUATION_RUN_PAGE_SIZE),
  ]);
  const datasetGroups = await Promise.all(
    benchmarks.map((benchmark) =>
      api.listEvaluationDatasets(benchmark.benchmarkId),
    ),
  );
  const datasets = datasetGroups.flat();
  const testCaseGroups = await Promise.all(
    datasets.map((dataset) =>
      api.listEvaluationTestCases(dataset.datasetId),
    ),
  );
  const testCasesByDatasetId = Object.fromEntries(
    datasets.map((dataset, index) => [
      dataset.datasetId,
      testCaseGroups[index] ?? [],
    ]),
  );
  const runDetailsById = await loadEvaluationRunDetails(runResponse.runs);
  return {
    benchmarks,
    datasets,
    testCasesByDatasetId,
    runs: runResponse.runs,
    runDetailsById,
  };
}

export function evaluationRunStatusName(
  status: EvaluationRunStatus,
): 'draft' | 'pending' | 'running' | 'cancelling' | 'completed' | 'partial' | 'failed' | 'cancelled' {
  switch (status) {
    case EvaluationRunStatus.DRAFT:
      return 'draft';
    case EvaluationRunStatus.PENDING:
      return 'pending';
    case EvaluationRunStatus.RUNNING:
      return 'running';
    case EvaluationRunStatus.CANCEL_INTENT_COMMITTED:
    case EvaluationRunStatus.CANCELLING:
      return 'cancelling';
    case EvaluationRunStatus.COMPLETED:
      return 'completed';
    case EvaluationRunStatus.PARTIAL:
      return 'partial';
    case EvaluationRunStatus.FAILED:
      return 'failed';
    case EvaluationRunStatus.CANCELLED:
      return 'cancelled';
    default:
      return 'pending';
  }
}
