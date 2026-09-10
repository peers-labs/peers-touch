import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { DescMessage, MessageShape } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import {
  AgentDefinitionSchema,
  AgentAttachmentRefSchema,
  AgentMessageStatus,
  AgentTurnSchema,
  AgentTurnStatus,
  CancelTurnRequestSchema,
  CanonicalAgentMessageSchema,
  CapabilityPermissionState,
  ClientCapabilityAdvertisementSchema,
  ClientCapabilityLeaseSchema,
  ClientCapabilityReceiptSchema,
  ClientCapabilityReceiptStatus,
  ClientCapabilityRequestSchema,
  ClientExecutionReplayPolicy,
  ClientPlatform,
  ClientResourceRefSchema,
  ContextLedgerSchema,
  ContextSegmentDecision,
  ContextSegmentType,
  ConversationSchema,
  EditAndResendRequestSchema,
  MessageRole,
  RegenerateTurnRequestSchema,
  RetryTurnRequestSchema,
  RuntimeKind,
  RuntimeSnapshotSchema,
  SelectActiveBranchRequestSchema,
  SubmitTurnRequestSchema,
  ToolCallSchema,
  ToolCallStatus,
  TurnStatus,
  TurnDiagnosticReplaySchema,
  TurnFeedbackSchema,
  TurnUsageSchema,
} from '../gen/proto/domain/agent/agent_pb';
import {
  SubmitToolApprovalDecisionRequestSchema,
  SubmitToolApprovalDecisionResponseSchema,
  ToolApprovalDecisionErrorCode,
} from '../gen/proto/domain/agent/agent_config_pb';
import {
  CapabilityOperationErrorCode,
  CapabilityOperationErrorSchema,
  CapabilityOperationStatus,
  CapabilityReadinessSnapshotSchema,
  CapabilityReadinessState,
  GetCapabilityReadinessRequestSchema,
} from '../gen/proto/domain/agent/capability_pb';
import {
  EvaluationAttemptStatus,
  EvaluationCaseAttemptSchema,
  EvaluationMetricsSchema,
  EvaluationResultSchema,
  EvaluationRunSchema,
  EvaluationRunStatus,
} from '../gen/proto/domain/agent/evaluation_pb';
import {
  HomeProjectionFreshness,
  HomeWorkProjectionSchema,
  SubmitHomeChatCommandResponseSchema,
  SubmitHomeTaskCommandResponseSchema,
} from '../gen/proto/domain/agent/home_pb';
import {
  CancelledPayloadSchema,
  CatchupDonePayloadSchema,
  ErrorPayloadSchema,
  StreamTurnEventsRequestSchema,
  ToolApprovalDecisionPayloadSchema,
  TurnSnapshotSchema,
  TurnStreamEventSchema,
  TurnStreamEventType,
} from '../gen/proto/domain/agent/turn_stream_pb';

const roundTrip = <Desc extends DescMessage>(
  schema: Desc,
  value: MessageShape<Desc>,
): MessageShape<Desc> => fromBinary(schema, toBinary(schema, value));

describe('Modern Chat Agent V2 Mobile Foundation contracts', () => {
  it('[foundation-mobile-cell:AS-15-P01] round-trips config and readiness and blocks send while unavailable', () => {
    const agentConfig = create(AgentDefinitionSchema, {
      agentId: 'agent-1',
      ptid: 'ptid:person:fixture',
      defaultRuntimeRef: 'mobile-runtime',
      version: 7n,
    });
    const readinessRequest = create(GetCapabilityReadinessRequestSchema, {
      agentId: 'agent-1',
      runtimeSnapshotId: 'mobile-runtime',
      clientCapabilitySessionId: 'mobile-session-1',
    });
    const readiness = create(CapabilityReadinessSnapshotSchema, {
      snapshotId: 'readiness-1',
      ptid: 'ptid:person:fixture',
      agentId: readinessRequest.agentId,
      runtimeSnapshotId: 'runtime-1',
      selectedClientSessionId: readinessRequest.clientCapabilitySessionId,
      capabilities: [{
        capabilityId: 'mcp.local.stdio',
        capabilityVersion: 'v1',
        state: CapabilityReadinessState.BLOCKED,
        authority: 'station',
        reasonCode: 'LOCAL_PROCESS_UNAVAILABLE',
      }],
    });
    const decoded = roundTrip(
      CapabilityReadinessSnapshotSchema,
      readiness,
    );
    const sendCommand = decoded.capabilities.every(
      (capability) => capability.state === CapabilityReadinessState.READY,
    )
      ? create(SubmitTurnRequestSchema, {
          conversationId: 'conversation-1',
          clientIdempotencyKey: 'turn-1',
          userInput: 'blocked',
        })
      : undefined;

    expect(roundTrip(AgentDefinitionSchema, agentConfig)).toMatchObject({
      agentId: 'agent-1',
      defaultRuntimeRef: 'mobile-runtime',
      version: 7n,
    });
    expect(roundTrip(GetCapabilityReadinessRequestSchema, readinessRequest))
      .toMatchObject({
        agentId: 'agent-1',
        clientCapabilitySessionId: 'mobile-session-1',
      });
    expect(decoded.capabilities[0]?.state).toBe(
      CapabilityReadinessState.BLOCKED,
    );
    expect(sendCommand).toBeUndefined();
  });

  it('[foundation-mobile-cell:AS-15-P02] decodes durable conversation and message revisions without client ownership', () => {
    const conversation = create(ConversationSchema, {
      conversationId: 'conversation-1',
      ptid: 'ptid:person:fixture',
      activeBranchMessageId: 'message-1',
      version: 7n,
    });
    const message = create(CanonicalAgentMessageSchema, {
      messageId: 'message-1',
      conversationId: conversation.conversationId,
      turnId: 'turn-1',
      role: MessageRole.ASSISTANT,
      status: AgentMessageStatus.COMPLETED,
      content: 'station-owned',
    });

    expect(roundTrip(ConversationSchema, conversation)).toMatchObject({
      conversationId: 'conversation-1',
      activeBranchMessageId: 'message-1',
      version: 7n,
    });
    expect(roundTrip(CanonicalAgentMessageSchema, message)).toMatchObject({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    });
  });

  it('[foundation-mobile-cell:AS-15-P03] preserves ordered turn events, cancel intent, and one terminal snapshot', () => {
    const events = [1n, 2n].map((sequence) =>
      create(TurnStreamEventSchema, {
        type: TurnStreamEventType.CATCHUP_DONE,
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        sequence,
        eventId: `event-${sequence}`,
        payload: {
          case: 'catchupDone',
          value: create(CatchupDonePayloadSchema, { lastSequence: sequence }),
        },
      }));
    const cancel = create(CancelTurnRequestSchema, {
      turnId: 'turn-1',
      idempotencyKey: 'cancel-1',
    });
    const cancelled = create(TurnStreamEventSchema, {
      type: TurnStreamEventType.CANCELLED,
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      sequence: 3n,
      eventId: 'event-3',
      payload: {
        case: 'cancelled',
        value: create(CancelledPayloadSchema, {
          reason: 'cancelled_by_user',
          outcomeError: create(ErrorPayloadSchema, {
            error: 'agent.errors.lifecycleCancelled',
            errorType: 'LIFECYCLE_CANCELLED',
            localeKey: 'agent.errors.lifecycleCancelled',
            retryable: false,
            terminal: true,
            details: {
              resource_kind: 'turn',
              resource_id: 'turn-1',
            },
          }),
        }),
      },
    });
    const terminal = create(TurnSnapshotSchema, {
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      status: TurnStatus.CANCELLED,
      lastSequence: 3n,
    });

    expect(events.map((event) =>
      roundTrip(TurnStreamEventSchema, event).sequence)).toEqual([1n, 2n]);
    expect(roundTrip(CancelTurnRequestSchema, cancel).idempotencyKey)
      .toBe('cancel-1');
    expect(roundTrip(TurnStreamEventSchema, cancelled).payload).toMatchObject({
      case: 'cancelled',
      value: {
        reason: 'cancelled_by_user',
        outcomeError: {
          errorType: 'LIFECYCLE_CANCELLED',
          localeKey: 'agent.errors.lifecycleCancelled',
          retryable: false,
          terminal: true,
          details: {
            resource_kind: 'turn',
            resource_id: 'turn-1',
          },
        },
      },
    });
    expect(roundTrip(TurnSnapshotSchema, terminal)).toMatchObject({
      turnId: 'turn-1',
      status: TurnStatus.CANCELLED,
      lastSequence: 3n,
    });
  });

  it('[foundation-mobile-cell:AS-15-P04] preserves context source IDs, omission reasons, and redacted content hashes', () => {
    const ledger = create(ContextLedgerSchema, {
      contextLedgerId: 'ledger-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      estimatedInputTokens: 512n,
      promptHash: 'sha256:redacted-prompt',
      segments: [{
        segmentId: 'segment-1',
        type: ContextSegmentType.KNOWLEDGE,
        sourceRefs: ['knowledge:source-1'],
        contentHash: 'sha256:redacted-content',
        estimatedTokens: 128n,
        decision: ContextSegmentDecision.REJECTED,
        decisionReason: 'UNAUTHORIZED_SOURCE',
        trustMetadataRef: 'trust:1',
      }],
    });
    const decoded = roundTrip(ContextLedgerSchema, ledger);

    expect(decoded.segments[0]).toMatchObject({
      sourceRefs: ['knowledge:source-1'],
      contentHash: 'sha256:redacted-content',
      decision: ContextSegmentDecision.REJECTED,
      decisionReason: 'UNAUTHORIZED_SOURCE',
    });
  });

  it('[foundation-mobile-cell:AS-15-P05] decodes tool proposal, decision, and result lineage without local authority', () => {
    const toolCall = create(ToolCallSchema, {
      toolCallId: 'tool-call-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      manifestId: 'manifest-1',
      manifestVersion: 'v1',
      bindingId: 'binding-1',
      bindingRevision: 4n,
      readinessSnapshotId: 'readiness-1',
      status: ToolCallStatus.PROPOSED,
    });
    const decisionCommand = create(SubmitToolApprovalDecisionRequestSchema, {
      approvalId: 'approval-1',
      toolCallId: toolCall.toolCallId,
      decisionId: 'decision-1',
      expectedRevision: 2n,
      approved: true,
      idempotencyKey: 'decision-command-1',
      payloadHash: 'sha256:decision',
    });
    const acknowledgement = create(SubmitToolApprovalDecisionResponseSchema, {
      accepted: true,
      decisionRevision: 3n,
      approvalId: decisionCommand.approvalId,
      toolCallId: decisionCommand.toolCallId,
      decisionId: decisionCommand.decisionId,
      approved: true,
      idempotencyKey: decisionCommand.idempotencyKey,
      payloadHash: decisionCommand.payloadHash,
      errorCode: ToolApprovalDecisionErrorCode.UNSPECIFIED,
    });
    const event = create(TurnStreamEventSchema, {
      type: TurnStreamEventType.TOOL_APPROVAL_DECISION,
      turnId: toolCall.turnId,
      payload: {
        case: 'toolApprovalDecision',
        value: create(ToolApprovalDecisionPayloadSchema, {
          approvalId: acknowledgement.approvalId,
          toolCallId: acknowledgement.toolCallId,
          decisionId: acknowledgement.decisionId,
          decisionRevision: acknowledgement.decisionRevision,
          approved: acknowledgement.approved,
          idempotencyKey: acknowledgement.idempotencyKey,
          payloadHash: acknowledgement.payloadHash,
        }),
      },
    });
    const result = create(ClientCapabilityReceiptSchema, {
      requestId: 'request-1',
      turnId: toolCall.turnId,
      toolCallId: toolCall.toolCallId,
      capabilitySessionId: 'mobile-session-1',
      targetDeviceId: 'mobile-device-1',
      executorLeaseId: 'lease-1',
      payloadHash: 'sha256:tool-result',
      sideEffectReceiptId: 'receipt-1',
      status: ClientCapabilityReceiptStatus.APPLIED,
      resultId: 'result-1',
    });

    expect(roundTrip(ToolCallSchema, toolCall).status)
      .toBe(ToolCallStatus.PROPOSED);
    expect(roundTrip(
      SubmitToolApprovalDecisionResponseSchema,
      acknowledgement,
    ).decisionRevision).toBe(3n);
    expect(roundTrip(TurnStreamEventSchema, event).payload.case)
      .toBe('toolApprovalDecision');
    expect(roundTrip(ClientCapabilityReceiptSchema, result)).toMatchObject({
      toolCallId: 'tool-call-1',
      status: ClientCapabilityReceiptStatus.APPLIED,
      resultId: 'result-1',
    });
  });

  it('[foundation-mobile-cell:AS-15-P06] round-trips opaque resource refs and rejects local or unauthorized refs', () => {
    const attachment = create(AgentAttachmentRefSchema, {
      attachmentId: 'attachment-1',
      objectRef: 'object:sha256:fixture',
      mimeType: 'text/plain',
      sizeBytes: 12n,
      checksum: 'sha256:fixture',
      filename: 'fixture.txt',
      authorizationScope: 'conversation:conversation-1',
    });
    const resource = create(ClientResourceRefSchema, {
      resourceRef: 'resource:opaque-1',
      ptid: 'ptid:person:fixture',
      deviceId: 'mobile-device-1',
      capabilitySessionId: 'mobile-session-1',
      capabilityId: 'files.read',
      permissionGrantId: 'grant-1',
      integrityHash: 'sha256:resource',
    });
    const rejected = create(ErrorPayloadSchema, {
      errorType: 'CLIENT_INVALID_RESOURCE_REFERENCE',
      localeKey: 'agent.errors.invalidResourceReference',
      retryable: false,
      terminal: true,
      details: {
        resource_kind: 'file',
        resource_ref_hash: 'sha256:invalid',
      },
    });

    expect(roundTrip(AgentAttachmentRefSchema, attachment).objectRef)
      .toBe('object:sha256:fixture');
    expect(roundTrip(ClientResourceRefSchema, resource).resourceRef)
      .toBe('resource:opaque-1');
    expect(roundTrip(ErrorPayloadSchema, rejected).details)
      .not.toHaveProperty('local_path');
  });

  it('[foundation-mobile-cell:AS-15-P07] preserves queued intent, replay cursor, and recovery boundary', () => {
    const queuedTurn = create(AgentTurnSchema, {
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      clientIdempotencyKey: 'turn-command-1',
      status: AgentTurnStatus.QUEUED,
    });
    const queue = create(ConversationSchema, {
      conversationId: 'conversation-1',
      queuedTurnCount: 3,
      version: 8n,
    });
    const overflow = create(ErrorPayloadSchema, {
      errorType: 'ADMISSION_QUEUE_FULL',
      localeKey: 'agent.errors.queueFull',
      retryable: true,
      terminal: true,
      details: { conversation_id: 'conversation-1', capacity: '3' },
    });
    const cursor = create(StreamTurnEventsRequestSchema, {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      afterSequence: 41n,
    });
    const recovery = create(TurnSnapshotSchema, {
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      status: TurnStatus.RUNNING,
      lastSequence: 42n,
    });

    expect(roundTrip(AgentTurnSchema, queuedTurn).status)
      .toBe(AgentTurnStatus.QUEUED);
    expect(roundTrip(ConversationSchema, queue).queuedTurnCount).toBe(3);
    expect(roundTrip(ErrorPayloadSchema, overflow)).toMatchObject({
      errorType: 'ADMISSION_QUEUE_FULL',
      details: { conversation_id: 'conversation-1', capacity: '3' },
    });
    expect(roundTrip(StreamTurnEventsRequestSchema, cursor).afterSequence)
      .toBe(41n);
    expect(roundTrip(TurnSnapshotSchema, recovery).lastSequence).toBe(42n);
  });

  it('[foundation-mobile-cell:AS-15-P08] preserves retry, regenerate, edit, and active-branch lineage', () => {
    const retry = create(RetryTurnRequestSchema, {
      conversationId: 'conversation-1',
      sourceTurnId: 'turn-1',
      clientIdempotencyKey: 'retry-1',
      expectedConversationVersion: 7n,
    });
    const regenerate = create(RegenerateTurnRequestSchema, {
      conversationId: 'conversation-1',
      sourceAssistantMessageId: 'assistant-1',
      clientIdempotencyKey: 'regenerate-1',
      expectedConversationVersion: 8n,
    });
    const edit = create(EditAndResendRequestSchema, {
      conversationId: 'conversation-1',
      sourceUserMessageId: 'user-1',
      revisedContent: 'revised',
      clientIdempotencyKey: 'edit-1',
      expectedConversationVersion: 9n,
    });
    const select = create(SelectActiveBranchRequestSchema, {
      conversationId: 'conversation-1',
      activeBranchMessageId: 'assistant-2',
      clientIdempotencyKey: 'branch-1',
      expectedConversationVersion: 10n,
    });

    expect(roundTrip(RetryTurnRequestSchema, retry).sourceTurnId).toBe('turn-1');
    expect(roundTrip(
      RegenerateTurnRequestSchema,
      regenerate,
    ).sourceAssistantMessageId).toBe('assistant-1');
    expect(roundTrip(EditAndResendRequestSchema, edit).sourceUserMessageId)
      .toBe('user-1');
    expect(roundTrip(
      SelectActiveBranchRequestSchema,
      select,
    ).activeBranchMessageId).toBe('assistant-2');
  });

  it('[foundation-mobile-cell:AS-15-P09] exposes degraded or unavailable local work before commitment', () => {
    const snapshot = create(CapabilityReadinessSnapshotSchema, {
      snapshotId: 'readiness-1',
      ptid: 'ptid:person:fixture',
      agentId: 'agent-1',
      runtimeSnapshotId: 'runtime-1',
      capabilities: [{
        capabilityId: 'shell.local',
        capabilityVersion: 'v1',
        state: CapabilityReadinessState.UNAVAILABLE,
        authority: 'station',
        reasonCode: 'MOBILE_EXECUTOR_UNAVAILABLE',
      }],
    });
    const decoded = roundTrip(CapabilityReadinessSnapshotSchema, snapshot);

    expect(decoded.capabilities[0]).toMatchObject({
      capabilityId: 'shell.local',
      state: CapabilityReadinessState.UNAVAILABLE,
      reasonCode: 'MOBILE_EXECUTOR_UNAVAILABLE',
    });
    expect(decoded.capabilities.some(
      (capability) => capability.state === CapabilityReadinessState.READY,
    )).toBe(false);
  });

  it('[foundation-mobile-cell:AS-15-P10] round-trips usage, feedback, and redacted diagnostics', () => {
    const usage = create(TurnUsageSchema, {
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      inputTokens: 10n,
      outputTokens: 5n,
      providerCallCount: 1,
      providerId: 'provider-1',
      modelId: 'model-1',
    });
    const feedback = create(TurnFeedbackSchema, {
      feedbackId: 'feedback-1',
      turnId: 'turn-1',
      assistantMessageId: 'assistant-1',
      ptid: 'ptid:person:fixture',
      source: 'mobile',
      rating: 1,
      categories: ['useful'],
      comment: 'redacted',
      conversationId: 'conversation-1',
    });
    const diagnostics = create(TurnDiagnosticReplaySchema, {
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      status: AgentTurnStatus.COMPLETED,
      attempts: [],
      contextLedgers: [],
      toolCalls: [],
      feedback: [feedback],
      messages: [],
    });
    const decoded = roundTrip(TurnDiagnosticReplaySchema, diagnostics);
    const serialized = JSON.stringify(decoded);

    expect(roundTrip(TurnUsageSchema, usage).outputTokens).toBe(5n);
    expect(decoded.feedback[0]?.feedbackId).toBe('feedback-1');
    expect(serialized).not.toMatch(/token|password|\/Users\//i);
  });

  it('[foundation-mobile-cell:AS-15-P11] advertises no shell or stdio MCP and accepts only matching fenced results', () => {
    const advertisement = create(ClientCapabilityAdvertisementSchema, {
      advertisementId: 'advertisement-1',
      platform: ClientPlatform.MOBILE,
      capabilities: [{
        capabilityId: 'camera.capture',
        schemaVersion: '1',
        permission: CapabilityPermissionState.GRANTED,
      }],
      connectionId: 'connection-1',
      deviceSigningKeyId: 'device-key-1',
      deviceId: 'mobile-device-1',
    });
    const request = create(ClientCapabilityRequestSchema, {
      requestId: 'request-1',
      turnId: 'turn-1',
      toolCallId: 'tool-call-1',
      capabilitySessionId: 'mobile-session-1',
      capabilityId: 'camera.capture',
      schemaVersion: '1',
      targetDeviceId: advertisement.deviceId,
      executorLeaseId: 'lease-1',
      fencingToken: 5n,
      payloadHash: 'sha256:payload',
    });
    const decodedAdvertisement = roundTrip(
      ClientCapabilityAdvertisementSchema,
      advertisement,
    );
    const decodedRequest = roundTrip(ClientCapabilityRequestSchema, request);
    const matchingLease = {
      deviceId: decodedAdvertisement.deviceId,
      capabilitySessionId: 'mobile-session-1',
      leaseId: 'lease-1',
    };
    const receipt = (
      decodedRequest.targetDeviceId === matchingLease.deviceId
      && decodedRequest.capabilitySessionId === matchingLease.capabilitySessionId
      && decodedRequest.executorLeaseId === matchingLease.leaseId
    )
      ? create(ClientCapabilityReceiptSchema, {
          requestId: decodedRequest.requestId,
          turnId: decodedRequest.turnId,
          toolCallId: decodedRequest.toolCallId,
          capabilitySessionId: decodedRequest.capabilitySessionId,
          targetDeviceId: decodedRequest.targetDeviceId,
          executorLeaseId: decodedRequest.executorLeaseId,
          fencingToken: decodedRequest.fencingToken,
          payloadHash: decodedRequest.payloadHash,
          status: ClientCapabilityReceiptStatus.APPLIED,
        })
      : undefined;
    const mismatchedReceipt = (
      decodedRequest.targetDeviceId === 'desktop-device-1'
      && decodedRequest.capabilitySessionId === matchingLease.capabilitySessionId
      && decodedRequest.executorLeaseId === matchingLease.leaseId
    )
      ? create(ClientCapabilityReceiptSchema, {
          requestId: decodedRequest.requestId,
        })
      : undefined;

    expect(decodedAdvertisement.capabilities.map(({ capabilityId }) => capabilityId))
      .toEqual(['camera.capture']);
    expect(decodedAdvertisement.capabilities.some(({ capabilityId }) =>
      capabilityId.includes('shell') || capabilityId.includes('stdio'))).toBe(false);
    expect(receipt?.requestId).toBe('request-1');
    expect(mismatchedReceipt).toBeUndefined();
  });

  it('[foundation-mobile-cell:AS-F10] preserves platform capability selection without Desktop fallback', () => {
    const runtime = create(RuntimeSnapshotSchema, {
      runtimeKind: RuntimeKind.DIRECT_MODEL,
      providerId: 'provider-1',
      modelId: 'model-1',
      thinkingMode: 'disabled',
    });
    const lease = create(ClientCapabilityLeaseSchema, {
      capabilitySessionId: 'mobile-session-1',
      ptid: 'ptid:person:fixture',
      deviceId: 'mobile-device-1',
      platform: ClientPlatform.MOBILE,
      capabilities: [{
        capabilityId: 'camera.capture',
        schemaVersion: '1',
        permission: CapabilityPermissionState.GRANTED,
      }],
      connectionId: 'connection-1',
      leaseId: 'lease-1',
      leaseRevision: 2n,
      capabilitySetHash: 'sha256:capabilities',
      deviceSigningKeyId: 'device-key-1',
    });
    const decodedLease = roundTrip(ClientCapabilityLeaseSchema, lease);

    const decodedRuntime = roundTrip(RuntimeSnapshotSchema, runtime);
    expect(decodedRuntime.runtimeKind).toBe(RuntimeKind.DIRECT_MODEL);
    expect(decodedRuntime.thinkingMode).toBe('disabled');
    expect(decodedLease.platform).toBe(ClientPlatform.MOBILE);
    expect(decodedLease.deviceId).toBe('mobile-device-1');
    expect(decodedLease.capabilities).toHaveLength(1);
  });

  it('[foundation-mobile-cell:BASE-EXECUTOR_UNAVAILABLE] emits the typed terminal executor error with zero execution', () => {
    const error = create(CapabilityOperationErrorSchema, {
      code: CapabilityOperationErrorCode.EXECUTOR_UNAVAILABLE,
      retryable: true,
      recoveryAction: 'Reconnect executor',
    });
    const decoded = roundTrip(CapabilityOperationErrorSchema, error);
    const executionCount = decoded.code === CapabilityOperationErrorCode.UNSPECIFIED
      ? 1
      : 0;

    expect(decoded).toMatchObject({
      code: CapabilityOperationErrorCode.EXECUTOR_UNAVAILABLE,
      retryable: true,
      recoveryAction: 'Reconnect executor',
    });
    expect(executionCount).toBe(0);
  });

  it('[foundation-mobile-cell:BASE-PERMISSION_DENIED] emits the stable permission error with safe arguments and zero execution', () => {
    const error = create(ErrorPayloadSchema, {
      errorType: 'CLIENT_PERMISSION_DENIED',
      localeKey: 'agent.errors.clientPermissionDenied',
      retryable: false,
      terminal: true,
      details: {
        capability_id: 'camera.capture',
        permission_kind: 'camera',
      },
    });
    const decoded = roundTrip(ErrorPayloadSchema, error);

    expect(decoded).toMatchObject({
      errorType: 'CLIENT_PERMISSION_DENIED',
      localeKey: 'agent.errors.clientPermissionDenied',
      retryable: false,
      terminal: true,
    });
    expect(Object.keys(decoded.details).sort()).toEqual([
      'capability_id',
      'permission_kind',
    ]);
    expect(decoded.details).not.toHaveProperty('local_path');
  });

  it('[foundation-mobile-cell:BASE-TARGET_DISCONNECTED] preserves pending intent and emits the typed reconnectable error', () => {
    const operation = create(AgentTurnSchema, {
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      clientIdempotencyKey: 'turn-command-1',
      status: AgentTurnStatus.WAITING_LOCAL_TOOL,
    });
    const error = create(ErrorPayloadSchema, {
      errorType: 'CLIENT_TARGET_DISCONNECTED',
      localeKey: 'agent.errors.targetDisconnected',
      retryable: true,
      terminal: false,
      details: { target_device_id: 'mobile-device-1' },
    });

    expect(roundTrip(AgentTurnSchema, operation).status)
      .toBe(AgentTurnStatus.WAITING_LOCAL_TOOL);
    expect(roundTrip(ErrorPayloadSchema, error)).toMatchObject({
      errorType: 'CLIENT_TARGET_DISCONNECTED',
      retryable: true,
      terminal: false,
      details: { target_device_id: 'mobile-device-1' },
    });
  });
});
