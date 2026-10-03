import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GetHomeWorkProjectionRequestSchema,
  GetHomeWorkProjectionResponseSchema,
  HomeWorkKind,
  SubmitHomeChatCommandRequestSchema,
  SubmitHomeChatCommandResponseSchema,
  SubmitHomeTaskCommandRequestSchema,
  SubmitHomeTaskCommandResponseSchema,
} from '../gen/proto/domain/agent/home_pb';
import {
  AgentGoalStatus,
  CreateAgentGoalRequestSchema,
  CreateAgentGoalResponseSchema,
  GetAgentGoalRequestSchema,
  GetAgentGoalResponseSchema,
} from '../gen/proto/domain/agent/goal_pb';
import { api } from './desktop_api';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Desktop Home projection API', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('encodes the revision cursor and decodes the Station projection', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ok: true,
      data: Array.from(toBinary(
        GetHomeWorkProjectionResponseSchema,
        create(GetHomeWorkProjectionResponseSchema, {
          projection: {
            ptid: 'ptid:actor-1',
            revision: 9n,
            recentWork: [{
              workId: 'conversation-1',
              kind: HomeWorkKind.CHAT,
              agentId: 'agent-1',
              title: 'Recent work',
            }],
          },
        }),
      )),
    });

    const projection = await api.getHomeWorkProjection(7n);

    expect(projection.ptid).toBe('ptid:actor-1');
    expect(projection.revision).toBe(9n);
    expect(projection.recentWork[0]?.workId).toBe('conversation-1');

    const invocation = vi.mocked(invoke).mock.calls[0];
    expect(invocation?.[0]).toBe('agent_home_projection_get');
    const args = invocation?.[1] as {
      input?: { requestBytes?: number[] };
    } | undefined;
    const request = fromBinary(
      GetHomeWorkProjectionRequestSchema,
      new Uint8Array(args?.input?.requestBytes ?? []),
    );
    expect(request.afterRevision).toBe(7n);
  });

  it('encodes the Home Chat command preconditions', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ok: true,
      data: Array.from(toBinary(
        SubmitHomeChatCommandResponseSchema,
        create(SubmitHomeChatCommandResponseSchema, {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          projectionRevision: 10n,
        }),
      )),
    });

    const response = await api.submitHomeChatCommand({
      agentId: 'agent-1',
      input: 'Compare recovery models',
      runtimeProfileId: 'modern-chat-agent-v1',
      clientIdempotencyKey: 'home-chat-1',
      expectedAgentVersion: 3n,
      readinessSnapshotId: 'readiness-1',
    });

    expect(response.conversationId).toBe('conversation-1');
    const invocation = vi.mocked(invoke).mock.calls[0];
    expect(invocation?.[0]).toBe('agent_home_chat_submit');
    const args = invocation?.[1] as { input?: { requestBytes?: number[] } } | undefined;
    const request = fromBinary(
      SubmitHomeChatCommandRequestSchema,
      new Uint8Array(args?.input?.requestBytes ?? []),
    );
    expect(request.expectedAgentVersion).toBe(3n);
    expect(request.readinessSnapshotId).toBe('readiness-1');
  });

  it('encodes and decodes the Home Task command', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ok: true,
      data: Array.from(toBinary(
        SubmitHomeTaskCommandResponseSchema,
        create(SubmitHomeTaskCommandResponseSchema, {
          taskId: 'task-1',
          projectionRevision: 11n,
        }),
      )),
    });

    const response = await api.submitHomeTaskCommand({
      agentId: 'agent-1',
      input: 'Prepare the launch brief',
      runtimeProfileId: 'modern-chat-agent-v1',
      clientIdempotencyKey: 'home-task-1',
      expectedAgentVersion: 3n,
      readinessSnapshotId: 'readiness-1',
    });

    expect(response.taskId).toBe('task-1');
    const invocation = vi.mocked(invoke).mock.calls[0];
    expect(invocation?.[0]).toBe('agent_home_task_submit');
    const args = invocation?.[1] as { input?: { requestBytes?: number[] } } | undefined;
    const request = fromBinary(
      SubmitHomeTaskCommandRequestSchema,
      new Uint8Array(args?.input?.requestBytes ?? []),
    );
    expect(request.clientIdempotencyKey).toBe('home-task-1');
  });

  it('creates and reads back a durable Goal draft', async () => {
    const goal = {
      goalId: 'goal-1',
      ownerPtid: 'ptid:actor-1',
      title: 'Durable Goal',
      outcome: 'Reopen the same Station record',
      status: AgentGoalStatus.DRAFT,
      revision: 1n,
    };
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        ok: true,
        data: Array.from(toBinary(
          CreateAgentGoalResponseSchema,
          create(CreateAgentGoalResponseSchema, { goal }),
        )),
      })
      .mockResolvedValueOnce({
        ok: true,
        data: Array.from(toBinary(
          GetAgentGoalResponseSchema,
          create(GetAgentGoalResponseSchema, { goal }),
        )),
      });

    const created = await api.createAgentGoalDraft({
      title: goal.title,
      outcome: goal.outcome,
      idempotencyKey: 'goal-create-1',
    });
    const createInvocation = vi.mocked(invoke).mock.calls[0];
    expect(createInvocation?.[0]).toBe('agent_home_goal_draft_create');
    const createArgs = createInvocation?.[1] as {
      input?: { requestBytes?: number[] };
    } | undefined;
    const createRequest = fromBinary(
      CreateAgentGoalRequestSchema,
      new Uint8Array(createArgs?.input?.requestBytes ?? []),
    );
    expect(createRequest).toMatchObject({
      title: goal.title,
      outcome: goal.outcome,
      idempotencyKey: 'goal-create-1',
      expectedRevision: 0n,
    });

    const reopened = await api.getAgentGoal(created.goalId);
    const getInvocation = vi.mocked(invoke).mock.calls[1];
    expect(getInvocation?.[0]).toBe('agent_home_goal_get');
    const getArgs = getInvocation?.[1] as {
      input?: { requestBytes?: number[] };
    } | undefined;
    const getRequest = fromBinary(
      GetAgentGoalRequestSchema,
      new Uint8Array(getArgs?.input?.requestBytes ?? []),
    );
    expect(getRequest.goalId).toBe('goal-1');
    expect(reopened).toMatchObject({
      goalId: 'goal-1',
      status: AgentGoalStatus.DRAFT,
      revision: 1n,
    });
  });
});
