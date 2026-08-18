import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { ActorKind } from '../gen/proto/domain/actor/actor_pb';
import {
  AgentDefinitionSchema,
  AgentTurnSchema,
  AgentTurnStatus,
  ClientCapabilityLeaseSchema,
  ClientPlatform,
  ContextLedgerSchema,
  RuntimeKind,
  RuntimeSnapshotSchema,
  ToolCallSchema,
  ToolCallStatus,
  TurnAttemptSchema,
  TurnUsageSchema,
} from '../gen/proto/domain/agent/agent_pb';
import {
  SubmitToolApprovalDecisionRequestSchema,
} from '../gen/proto/domain/agent/agent_config_pb';
import {
  CapabilityAvailability,
  CapabilityManifestSchema,
  CapabilityOperationSchema,
  CapabilityOperationStatus,
  CapabilityReadinessSnapshotSchema,
  CapabilityReadinessState,
  CapabilitySourceKind,
  ConnectorResourceManifestSchema,
  ConnectorResourceStatus,
  StartCapabilityOperationRequestSchema,
} from '../gen/proto/domain/agent/capability_pb';
import {
  CreateEvaluationRunRequestSchema,
  EvaluationRunEventSchema,
  EvaluationRunStatus,
} from '../gen/proto/domain/agent/evaluation_pb';
import {
  HomeProjectionFreshness,
  HomeWorkProjectionSchema,
  SubmitHomeChatCommandRequestSchema,
  SubmitHomeTaskCommandRequestSchema,
} from '../gen/proto/domain/agent/home_pb';
import {
  ToolApprovalDecisionPayloadSchema,
  TurnStreamEventSchema,
  TurnStreamEventType,
} from '../gen/proto/domain/agent/turn_stream_pb';

describe('Modern Chat Agent V2 Mobile generated contracts', () => {
  it('round-trips the C01-C10 canonical kernel without desktop-only fields', () => {
    const agent = create(AgentDefinitionSchema, {
      agentId: 'agent-1',
      ptid: 'ptid:person:fixture',
      name: 'Research',
      defaultRuntimeRef: 'runtime-1',
      version: 7n,
    });
    const decodedAgent = fromBinary(
      AgentDefinitionSchema,
      toBinary(AgentDefinitionSchema, agent),
    );
    expect(decodedAgent).toMatchObject({
      agentId: 'agent-1',
      ptid: 'ptid:person:fixture',
      version: 7n,
    });

    const runtime = create(RuntimeSnapshotSchema, {
      runtimeKind: RuntimeKind.DIRECT_MODEL,
      providerId: 'provider-1',
      modelId: 'model-1',
    });
    const turn = create(AgentTurnSchema, {
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      ptid: 'ptid:person:fixture',
      agentId: 'agent-1',
      clientIdempotencyKey: 'mobile-turn-1',
      status: AgentTurnStatus.SUBMITTED,
      runtimeSnapshot: runtime,
    });
    expect(
      fromBinary(AgentTurnSchema, toBinary(AgentTurnSchema, turn)).runtimeSnapshot
        ?.runtimeKind,
    ).toBe(RuntimeKind.DIRECT_MODEL);
    const attempt = create(TurnAttemptSchema, {
      attemptId: 'attempt-1',
      turnId: 'turn-1',
      index: 1,
      runtimeSnapshot: runtime,
      contextLedgerId: 'ledger-1',
      capabilityReadinessSnapshotId: 'ready-1',
      status: AgentTurnStatus.RUNNING,
    });
    expect(
      fromBinary(
        TurnAttemptSchema,
        toBinary(TurnAttemptSchema, attempt),
      ).capabilityReadinessSnapshotId,
    ).toBe('ready-1');

    const ledger = create(ContextLedgerSchema, {
      contextLedgerId: 'ledger-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      estimatedInputTokens: 512n,
      promptHash: 'sha256:prompt',
    });
    expect(
      fromBinary(ContextLedgerSchema, toBinary(ContextLedgerSchema, ledger))
        .estimatedInputTokens,
    ).toBe(512n);

    const mobileLease = create(ClientCapabilityLeaseSchema, {
      capabilitySessionId: 'mobile-session-1',
      ptid: 'ptid:person:fixture',
      deviceId: 'mobile-device-1',
      platform: ClientPlatform.MOBILE,
      capabilities: [],
      connectionId: 'connection-1',
      leaseId: 'lease-1',
    });
    expect(
      fromBinary(
        ClientCapabilityLeaseSchema,
        toBinary(ClientCapabilityLeaseSchema, mobileLease),
      ),
    ).toMatchObject({
      platform: ClientPlatform.MOBILE,
      leaseId: 'lease-1',
    });

    const toolCall = create(ToolCallSchema, {
      toolCallId: 'tool-call-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      manifestId: 'manifest-1',
      manifestVersion: 'v1',
      bindingId: 'binding-1',
      bindingRevision: 4n,
      readinessSnapshotId: 'ready-1',
      status: ToolCallStatus.PROPOSED,
    });
    expect(
      fromBinary(ToolCallSchema, toBinary(ToolCallSchema, toolCall)).bindingRevision,
    ).toBe(4n);

    const usage = create(TurnUsageSchema, {
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      inputTokens: 10n,
      outputTokens: 5n,
    });
    expect(fromBinary(TurnUsageSchema, toBinary(TurnUsageSchema, usage)).outputTokens).toBe(
      5n,
    );
  });

  it('decodes the exact Station approval command and authoritative event lineage', () => {
    const command = create(SubmitToolApprovalDecisionRequestSchema, {
      approvalId: 'approval-1',
      toolCallId: 'tool-call-1',
      decisionId: 'decision-1',
      expectedRevision: 2n,
      approved: true,
      idempotencyKey: 'mobile-decision-1',
    });
    const decodedCommand = fromBinary(
      SubmitToolApprovalDecisionRequestSchema,
      toBinary(SubmitToolApprovalDecisionRequestSchema, command),
    );
    expect(decodedCommand).toMatchObject({
      approvalId: 'approval-1',
      toolCallId: 'tool-call-1',
      decisionId: 'decision-1',
      expectedRevision: 2n,
      approved: true,
      idempotencyKey: 'mobile-decision-1',
    });
    expect('actorId' in decodedCommand).toBe(false);

    const decision = create(ToolApprovalDecisionPayloadSchema, {
      approvalId: 'approval-1',
      toolCallId: 'tool-call-1',
      decisionId: 'decision-1',
      decisionRevision: 3n,
      approved: true,
      actorRef: {
        ptid: 'ptid:person:fixture',
        acct: 'fixture',
        kind: ActorKind.PERSON,
      },
      idempotencyKey: 'mobile-decision-1',
    });
    const event = create(TurnStreamEventSchema, {
      type: TurnStreamEventType.TOOL_APPROVAL_DECISION,
      turnId: 'turn-1',
      payload: { case: 'toolApprovalDecision', value: decision },
    });
    const decodedEvent = fromBinary(
      TurnStreamEventSchema,
      toBinary(TurnStreamEventSchema, event),
    );
    expect(decodedEvent.payload.case).toBe('toolApprovalDecision');
    if (decodedEvent.payload.case !== 'toolApprovalDecision') {
      throw new Error('tool approval decision payload was not decoded');
    }
    expect(decodedEvent.payload.value.decisionRevision).toBe(3n);
    expect(decodedEvent.payload.value.actorRef?.ptid).toBe(
      'ptid:person:fixture',
    );
  });

  it('round-trips C11-C15 Station commands, projections, operations, and events', () => {
    const home = create(HomeWorkProjectionSchema, {
      ptid: 'ptid:person:fixture',
      revision: 9n,
      freshness: HomeProjectionFreshness.FRESH,
      pinnedAgents: [{ agentId: 'agent-1', displayName: 'Research' }],
    });
    expect(
      fromBinary(HomeWorkProjectionSchema, toBinary(HomeWorkProjectionSchema, home))
        .revision,
    ).toBe(9n);

    for (const command of [
      create(SubmitHomeChatCommandRequestSchema, {
        agentId: 'agent-1',
        input: 'Summarize',
        clientIdempotencyKey: 'home-chat-1',
      }),
      create(SubmitHomeTaskCommandRequestSchema, {
        agentId: 'agent-1',
        input: 'Monitor',
        clientIdempotencyKey: 'home-task-1',
      }),
    ]) {
      expect(command.agentId).toBe('agent-1');
    }

    const manifest = create(CapabilityManifestSchema, {
      capabilityId: 'connector.search',
      version: 'v1',
      sourceKind: CapabilitySourceKind.CONNECTOR,
      availability: CapabilityAvailability.AVAILABLE,
    });
    expect(
      fromBinary(CapabilityManifestSchema, toBinary(CapabilityManifestSchema, manifest))
        .capabilityId,
    ).toBe('connector.search');

    const operation = create(CapabilityOperationSchema, {
      operationId: 'operation-1',
      idempotencyKey: 'operation-key-1',
      payloadHash: 'sha256:payload',
      ptid: 'ptid:person:fixture',
      capabilityId: 'mcp.files',
      capabilityVersion: 'v1',
      status: CapabilityOperationStatus.PENDING,
      revision: 1n,
    });
    expect(
      fromBinary(
        CapabilityOperationSchema,
        toBinary(CapabilityOperationSchema, operation),
      ).status,
    ).toBe(CapabilityOperationStatus.PENDING);

    const connector = create(ConnectorResourceManifestSchema, {
      ptid: 'ptid:person:fixture',
      connectorId: 'connector-1',
      oauthConnectionId: 'oauth-1',
      connectionRevision: 3n,
      resourceId: 'resource-1',
      resourceVersion: 'v2',
      status: ConnectorResourceStatus.READY,
    });
    expect(
      fromBinary(
        ConnectorResourceManifestSchema,
        toBinary(ConnectorResourceManifestSchema, connector),
      ).connectionRevision,
    ).toBe(3n);

    const evaluationCommand = create(CreateEvaluationRunRequestSchema, {
      datasetId: 'dataset-1',
      datasetRevision: 4n,
      targetAgentSnapshot: {
        runtimeKind: RuntimeKind.DIRECT_MODEL,
        providerId: 'provider-1',
        modelId: 'model-1',
      },
      readinessSnapshotId: 'ready-1',
      idempotencyKey: 'evaluation-1',
    });
    expect(
      fromBinary(
        CreateEvaluationRunRequestSchema,
        toBinary(CreateEvaluationRunRequestSchema, evaluationCommand),
      ).datasetRevision,
    ).toBe(4n);

    const evaluationEvent = create(EvaluationRunEventSchema, {
      runId: 'run-1',
      sequence: 1n,
      status: EvaluationRunStatus.RUNNING,
      completedCases: 1,
      totalCases: 3,
    });
    expect(
      fromBinary(
        EvaluationRunEventSchema,
        toBinary(EvaluationRunEventSchema, evaluationEvent),
      ).status,
    ).toBe(EvaluationRunStatus.RUNNING);
  });

  it('fails closed when Mobile lacks a local stdio MCP executor', () => {
    const snapshot = create(CapabilityReadinessSnapshotSchema, {
      snapshotId: 'mobile-readiness-1',
      ptid: 'ptid:person:fixture',
      agentId: 'agent-1',
      runtimeSnapshotId: 'runtime-1',
      selectedClientSessionId: 'mobile-session-1',
      capabilities: [
        {
          capabilityId: 'mcp.local.stdio',
          capabilityVersion: 'v1',
          state: CapabilityReadinessState.UNAVAILABLE,
          authority: 'mobile-kernel',
          reasonCode: 'LOCAL_PROCESS_UNAVAILABLE',
        },
      ],
    });
    const decoded = fromBinary(
      CapabilityReadinessSnapshotSchema,
      toBinary(CapabilityReadinessSnapshotSchema, snapshot),
    );
    expect(decoded.capabilities[0]?.state).toBe(CapabilityReadinessState.UNAVAILABLE);

    const readiness = decoded.capabilities[0];
    const dispatch =
      readiness?.state === CapabilityReadinessState.READY
        ? create(StartCapabilityOperationRequestSchema, {
            capabilityId: readiness.capabilityId,
            capabilityVersion: readiness.capabilityVersion,
            capabilitySessionId: decoded.selectedClientSessionId,
            idempotencyKey: 'mobile-operation-1',
          })
        : undefined;
    expect(dispatch).toBeUndefined();
  });
});
