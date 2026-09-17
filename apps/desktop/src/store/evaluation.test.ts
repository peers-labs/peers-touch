import { create } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EvaluationBenchmarkSchema,
  EvaluationDatasetSchema,
  DeleteEvaluationRunResponseSchema,
  EvaluationRunSchema,
  EvaluationRunStatus,
  EvaluationTestCaseSchema,
} from '../gen/proto/domain/agent/evaluation_pb';
import { RuntimeSnapshotSchema } from '../gen/proto/domain/agent/agent_pb';
import { api } from '../services/desktop_api';
import {
  evaluationRevisionMutationKey,
  evaluationRunStatusName,
  useEvaluationStore,
} from './evaluation';

const publish = vi.hoisted(() => vi.fn());

vi.mock('../kernel/events', () => ({
  EVENT: {
    EVALUATION_PROJECTION_INVALIDATED: 'agent.evaluation_projection_invalidated',
  },
  eventBus: { publish },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function run(
  runId: string,
  status: EvaluationRunStatus,
  revision = 1n,
) {
  return create(EvaluationRunSchema, {
    runId,
    ptid: 'ptid:actor-1',
    datasetId: 'dataset-1',
    datasetRevision: 3n,
    targetAgentId: 'agent-1',
    targetAgentRevision: 7n,
    readinessSnapshotId: 'readiness-1',
    revision,
    status,
  });
}

describe('useEvaluationStore', () => {
  beforeEach(() => {
    useEvaluationStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops a stale projection response after the actor scope changes', async () => {
    const aliceBenchmarks = deferred<Awaited<ReturnType<typeof api.listEvaluationBenchmarks>>>();
    vi.spyOn(api, 'listEvaluationBenchmarks').mockReturnValueOnce(aliceBenchmarks.promise);
    vi.spyOn(api, 'listEvaluationRuns').mockResolvedValue({
      $typeName: 'peers_touch.model.agent.v1.ListEvaluationRunsResponse',
      runs: [],
      total: 0n,
    });
    vi.spyOn(api, 'listEvaluationDatasets').mockResolvedValue([]);
    vi.spyOn(api, 'listEvaluationTestCases').mockResolvedValue([]);

    const loading = useEvaluationStore.getState().loadProjection(
      'ptid:actor-1',
      'bootstrap',
    );
    useEvaluationStore.getState().setActorScope('ptid:actor-2');
    aliceBenchmarks.resolve([
      create(EvaluationBenchmarkSchema, {
        benchmarkId: 'alice-benchmark',
        ptid: 'ptid:actor-1',
        name: 'Alice',
        revision: 1n,
      }),
    ]);
    await loading;

    expect(useEvaluationStore.getState().actorPtid).toBe('ptid:actor-2');
    expect(useEvaluationStore.getState().benchmarks).toEqual([]);
  });

  it('authors run identity fields and projects the Station runtime snapshot', async () => {
    useEvaluationStore.getState().setActorScope('ptid:actor-1');
    const authoritative = create(EvaluationRunSchema, {
      ...run('run-1', EvaluationRunStatus.PENDING),
      targetAgentSnapshot: create(RuntimeSnapshotSchema, {
        providerId: 'provider-1',
        modelId: 'model-1',
        runtimeProfileId: 'runtime-1',
        agentConfigVersion: 'agent:agent-1:7',
      }),
    });
    const createRun = vi.spyOn(api, 'createEvaluationRun').mockResolvedValue(
      authoritative,
    );

    const created = await useEvaluationStore.getState().createRun({
      datasetId: 'dataset-1',
      datasetRevision: 3n,
      targetAgentId: 'agent-1',
      expectedAgentRevision: 7n,
      readinessSnapshotId: 'readiness-1',
      runtimeProfileId: 'runtime-1',
      modelId: 'model-1',
    });

    const request = createRun.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      datasetId: 'dataset-1',
      datasetRevision: 3n,
      targetAgentId: 'agent-1',
      expectedAgentRevision: 7n,
      readinessSnapshotId: 'readiness-1',
      runtimeProfileId: 'runtime-1',
      modelId: 'model-1',
    });
    expect(request && 'targetAgentSnapshot' in request).toBe(false);
    expect(created.targetAgentSnapshot?.runtimeProfileId).toBe('runtime-1');
    expect(
      useEvaluationStore.getState().runs[0]?.targetAgentSnapshot?.modelId,
    ).toBe('model-1');
  });

  it('does not let an older same-actor projection overwrite a newer mutation', async () => {
    useEvaluationStore.getState().setActorScope('ptid:actor-1');
    const staleBenchmarks = deferred<
      Awaited<ReturnType<typeof api.listEvaluationBenchmarks>>
    >();
    vi.spyOn(api, 'listEvaluationBenchmarks')
      .mockReturnValueOnce(staleBenchmarks.promise);
    vi.spyOn(api, 'listEvaluationRuns').mockResolvedValue({
      $typeName: 'peers_touch.model.agent.v1.ListEvaluationRunsResponse',
      runs: [],
      total: 0n,
    });
    vi.spyOn(api, 'listEvaluationDatasets').mockResolvedValue([]);
    vi.spyOn(api, 'listEvaluationTestCases').mockResolvedValue([]);
    const loading = useEvaluationStore.getState().loadProjection(
      'ptid:actor-1',
      'reconcile',
    );
    const pending = run('run-1', EvaluationRunStatus.PENDING, 3n);
    useEvaluationStore.setState({ runs: [pending] });
    vi.spyOn(api, 'startEvaluationRun').mockResolvedValue(
      run('run-1', EvaluationRunStatus.RUNNING, 4n),
    );

    await useEvaluationStore.getState().startRun(pending);
    staleBenchmarks.resolve([]);
    await loading;

    expect(useEvaluationStore.getState().runs[0]?.revision).toBe(4n);
    expect(useEvaluationStore.getState().runs[0]?.status)
      .toBe(EvaluationRunStatus.RUNNING);
  });

  it('waits for the authoritative cancellation state', async () => {
    useEvaluationStore.getState().setActorScope('ptid:actor-1');
    const running = run('run-1', EvaluationRunStatus.RUNNING, 4n);
    useEvaluationStore.setState({ runs: [running] });
    const cancel = vi.spyOn(api, 'cancelEvaluationRun').mockResolvedValue(
      run('run-1', EvaluationRunStatus.CANCELLING, 5n),
    );

    await useEvaluationStore.getState().cancelRun(running);

    expect(cancel.mock.calls[0]?.[0].idempotencyKey)
      .toBe('evaluation:run:cancel:run-1:revision:4');
    expect(useEvaluationStore.getState().runs[0]?.status)
      .toBe(EvaluationRunStatus.CANCELLING);
    expect(evaluationRunStatusName(
      useEvaluationStore.getState().runs[0]!.status,
    )).toBe('cancelling');
  });

  it('deletes a terminal run and clears its projection state', async () => {
    useEvaluationStore.getState().setActorScope('ptid:actor-1');
    const completed = run('run-1', EvaluationRunStatus.COMPLETED, 8n);
    useEvaluationStore.setState({
      runs: [completed],
      runDetailsById: {
        'run-1': { run: completed, attempts: [], results: [], cases: [] },
      },
      eventSequenceByRunId: { 'run-1': 4n },
    });
    const deleteRun = vi.spyOn(api, 'deleteEvaluationRun').mockResolvedValue(
      create(DeleteEvaluationRunResponseSchema, { deleted: true }),
    );

    const deleted = await useEvaluationStore.getState().deleteRun(completed);

    expect(deleted).toBe(true);
    expect(deleteRun.mock.calls[0]?.[0].idempotencyKey)
      .toBe('evaluation:run:delete:run-1:revision:8');
    expect(useEvaluationStore.getState().runs).toEqual([]);
    expect(useEvaluationStore.getState().runDetailsById).toEqual({});
    expect(useEvaluationStore.getState().eventSequenceByRunId).toEqual({});
  });

  it('advances the parent dataset revision between sequential case creates', async () => {
    useEvaluationStore.getState().setActorScope('ptid:actor-1');
    const dataset = create(EvaluationDatasetSchema, {
      datasetId: 'dataset-1',
      benchmarkId: 'benchmark-1',
      ptid: 'ptid:actor-1',
      name: 'Dataset',
      revision: 3n,
    });
    useEvaluationStore.setState({ datasets: [dataset] });
    const createCase = vi.spyOn(api, 'createEvaluationTestCase')
      .mockImplementation(async (request) => ({
        testCase: create(EvaluationTestCaseSchema, {
          caseId: `case-${createCase.mock.calls.length}`,
          datasetId: request.datasetId,
          input: request.input,
          expected: request.expected,
          revision: 1n,
        }),
        dataset: create(EvaluationDatasetSchema, {
          ...dataset,
          revision: request.expectedDatasetRevision + 1n,
        }),
      }));

    await useEvaluationStore.getState().createTestCase(
      useEvaluationStore.getState().datasets[0]!,
      { input: 'first', expected: 'one', tags: [] },
    );
    await useEvaluationStore.getState().createTestCase(
      useEvaluationStore.getState().datasets[0]!,
      { input: 'second', expected: 'two', tags: [] },
    );

    expect(createCase.mock.calls.map(([request]) => request.expectedDatasetRevision))
      .toEqual([3n, 4n]);
    expect(useEvaluationStore.getState().datasets[0]?.revision).toBe(5n);
  });

  it('derives replay-stable revision keys and normalizes retry case order', () => {
    expect(evaluationRevisionMutationKey('run:start', 'run-1', 4n))
      .toBe('evaluation:run:start:run-1:revision:4');
    expect(
      evaluationRevisionMutationKey(
        'run:retry',
        'run-1',
        4n,
        ['case-b', 'case-a'],
      ),
    ).toBe(
      evaluationRevisionMutationKey(
        'run:retry',
        'run-1',
        4n,
        ['case-a', 'case-b'],
      ),
    );
  });
});
