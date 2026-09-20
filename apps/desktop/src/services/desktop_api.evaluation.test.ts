import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeSnapshotSchema } from '../gen/proto/domain/agent/agent_pb';
import {
  CreateEvaluationRunRequestSchema,
  CreateEvaluationRunResponseSchema,
  EvaluationRunStatus,
} from '../gen/proto/domain/agent/evaluation_pb';
import { api } from './desktop_api';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Desktop Evaluation API', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('authors target identity inputs and decodes the Station target snapshot', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ok: true,
      data: Array.from(toBinary(
        CreateEvaluationRunResponseSchema,
        create(CreateEvaluationRunResponseSchema, {
          run: {
            runId: 'run-1',
            datasetId: 'dataset-1',
            datasetRevision: 4n,
            targetAgentId: 'agent-1',
            targetAgentRevision: 8n,
            readinessSnapshotId: 'readiness-1',
            revision: 1n,
            status: EvaluationRunStatus.PENDING,
            targetAgentSnapshot: create(RuntimeSnapshotSchema, {
              providerId: 'provider-1',
              modelId: 'model-1',
              runtimeProfileId: 'runtime-1',
              agentConfigVersion: 'agent:agent-1:8',
            }),
          },
        }),
      )),
    });

    const result = await api.createEvaluationRun(create(
      CreateEvaluationRunRequestSchema,
      {
        datasetId: 'dataset-1',
        datasetRevision: 4n,
        targetAgentId: 'agent-1',
        expectedAgentRevision: 8n,
        readinessSnapshotId: 'readiness-1',
        runtimeProfileId: 'runtime-1',
        modelId: 'model-1',
        idempotencyKey: 'run-create-1',
      },
    ));

    const invocation = vi.mocked(invoke).mock.calls[0];
    expect(invocation?.[0]).toBe('agent_evaluation_run_create');
    const args = invocation?.[1] as {
      input?: { requestBytes?: number[] };
    } | undefined;
    const request = fromBinary(
      CreateEvaluationRunRequestSchema,
      new Uint8Array(args?.input?.requestBytes ?? []),
    );
    expect(request).toMatchObject({
      datasetId: 'dataset-1',
      datasetRevision: 4n,
      targetAgentId: 'agent-1',
      expectedAgentRevision: 8n,
      readinessSnapshotId: 'readiness-1',
      runtimeProfileId: 'runtime-1',
      modelId: 'model-1',
    });
    expect('targetAgentSnapshot' in request).toBe(false);
    expect(result.targetAgentSnapshot?.runtimeProfileId).toBe('runtime-1');
    expect(result.targetAgentSnapshot?.agentConfigVersion)
      .toBe('agent:agent-1:8');
  });
});
