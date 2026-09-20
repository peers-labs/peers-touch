import type {
  EvaluationBenchmark,
  EvaluationCaseAttempt,
  EvaluationDataset,
  EvaluationResult,
  EvaluationRun,
  EvaluationRunCaseSnapshot,
  EvaluationTestCase,
} from '../../gen/proto/domain/agent/evaluation_pb';

export type EvaluationProjectionPhase =
  | 'idle'
  | 'loading'
  | 'restoring'
  | 'ready'
  | 'error';

export interface EvaluationRunDetail {
  run: EvaluationRun;
  attempts: EvaluationCaseAttempt[];
  results: EvaluationResult[];
  cases: EvaluationRunCaseSnapshot[];
}

export interface CreateEvaluationRunIntent {
  datasetId: string;
  datasetRevision: bigint;
  targetAgentId: string;
  expectedAgentRevision: bigint;
  readinessSnapshotId: string;
  runtimeProfileId?: string;
  modelId?: string;
}

export interface EvaluationProjectionState {
  actorPtid: string | null;
  projectionPhase: EvaluationProjectionPhase;
  error: string | null;
  benchmarks: EvaluationBenchmark[];
  datasets: EvaluationDataset[];
  testCasesByDatasetId: Record<string, EvaluationTestCase[]>;
  runs: EvaluationRun[];
  runDetailsById: Record<string, EvaluationRunDetail>;
  eventSequenceByRunId: Record<string, bigint>;
  pendingMutations: Record<string, true>;
}

export interface EvaluationState extends EvaluationProjectionState {
  setActorScope: (actorPtid: string | null) => void;
  loadProjection: (
    actorPtid: string,
    reason: 'bootstrap' | 'restart' | 'reconcile' | 'user',
  ) => Promise<void>;
  consumeRunEvents: () => Promise<void>;
  refreshRun: (runId: string) => Promise<void>;
  clearError: () => void;
  reset: () => void;

  createBenchmark: (name: string, rubric: string) => Promise<EvaluationBenchmark>;
  updateBenchmark: (
    benchmark: EvaluationBenchmark,
    values: { name: string; rubric: string },
  ) => Promise<EvaluationBenchmark>;
  deleteBenchmark: (benchmark: EvaluationBenchmark) => Promise<void>;
  createDataset: (
    benchmark: EvaluationBenchmark,
    name: string,
    description: string,
  ) => Promise<EvaluationDataset>;
  updateDataset: (
    dataset: EvaluationDataset,
    values: { name: string; description: string },
  ) => Promise<EvaluationDataset>;
  deleteDataset: (dataset: EvaluationDataset) => Promise<void>;
  createTestCase: (
    dataset: EvaluationDataset,
    values: EvaluationTestCaseValues,
  ) => Promise<EvaluationTestCase>;
  updateTestCase: (
    testCase: EvaluationTestCase,
    values: EvaluationTestCaseValues,
  ) => Promise<EvaluationTestCase>;
  deleteTestCase: (testCase: EvaluationTestCase) => Promise<void>;
  createRun: (intent: CreateEvaluationRunIntent) => Promise<EvaluationRun>;
  startRun: (run: EvaluationRun) => Promise<EvaluationRun>;
  cancelRun: (run: EvaluationRun) => Promise<EvaluationRun>;
  deleteRun: (run: EvaluationRun) => Promise<boolean>;
  retryCases: (
    run: EvaluationRun,
    caseIds: string[],
  ) => Promise<EvaluationRun>;
}

export interface EvaluationTestCaseValues {
  input: string;
  expected: string;
  rubricOverride?: string;
  tags: string[];
}

export function initialEvaluationState(): EvaluationProjectionState {
  return {
    actorPtid: null,
    projectionPhase: 'idle',
    error: null,
    benchmarks: [],
    datasets: [],
    testCasesByDatasetId: {},
    runs: [],
    runDetailsById: {},
    eventSequenceByRunId: {},
    pendingMutations: {},
  };
}
