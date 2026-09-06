import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submitAgentToolDecision = vi.hoisted(() => vi.fn());
const exportAgentTurnDiagnostics = vi.hoisted(() => vi.fn());

vi.mock('../services/desktop_api', () => ({
  api: {
    exportAgentTurnDiagnostics,
    submitAgentToolDecision,
  },
}));

import { ToolCallStatus as AgentToolCallStatus } from '../gen/proto/domain/agent/agent_pb';
import {
  reconcileToolProjectionState,
  reduceToolProjection,
  resolveToolCallProjection,
  toolRuntime,
  type ToolProjection,
  type ToolProjectionState,
} from './toolRuntime';

const approvalRequired = {
  event: 'tool_approval_required',
  data: {
    turnId: 'turn-1',
    toolCallId: 'tool-call-1',
    toolName: 'filesystem.read',
    arguments: '{"resource_ref":"opaque-1"}',
    approvalId: 'approval-1',
    decisionRevision: 0,
  },
};

describe('toolRuntime projection authority', () => {
  beforeEach(async () => {
    exportAgentTurnDiagnostics.mockReset();
    submitAgentToolDecision.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('crypto', { randomUUID: () => 'decision-generated-1' });
    await toolRuntime.bootstrap(null);
    toolRuntime.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('projects Station proposals without invoking command or execution APIs', () => {
    toolRuntime.consume({
      event: 'tool_call',
      data: {
        turnId: 'turn-1',
        toolCallId: 'tool-call-1',
        toolName: 'filesystem.read',
        arguments: '{"resource_ref":"opaque-1"}',
      },
    });

    expect(toolRuntime.getProjection('tool-call-1')).toMatchObject({
      status: 'pending',
      pending: true,
    });
    expect(submitAgentToolDecision).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    toolRuntime.consume(approvalRequired);
    expect(toolRuntime.getProjection('tool-call-1')).toMatchObject({
      status: 'approval_required',
      approvalId: 'approval-1',
      decisionRevision: 0,
    });
  });

  it('reconciles a missed approval event from authoritative Turn diagnostics', async () => {
    exportAgentTurnDiagnostics.mockResolvedValue({
      replay: {
        turnId: 'turn-1',
        toolCalls: [{
          toolCallId: 'tool-call-1',
          toolName: 'filesystem.read',
          redactedArguments: '{"resource_ref":"opaque-1"}',
          status: AgentToolCallStatus.WAITING_APPROVAL,
          approvalId: 'approval-1',
          decisionId: '',
          decisionRevision: 0n,
          errorCode: '',
        }],
      },
    });

    await expect(toolRuntime.reconcileMessages([{
      turnId: 'turn-1',
      toolCalls: [{
        id: 'tool-call-1',
        name: 'filesystem.read',
        args: '{"resource_ref":"opaque-1"}',
        pending: true,
        status: 'approval_required',
        approvalId: 'approval-1',
        decisionRevision: 0,
        payloadHash: 'payload-1',
      }],
    }])).resolves.toBe(true);

    expect(toolRuntime.getProjection('tool-call-1')).toMatchObject({
      turnId: 'turn-1',
      status: 'approval_required',
      pending: true,
      approvalId: 'approval-1',
      decisionRevision: 0,
      payloadHash: 'payload-1',
    });
  });

  it('does not regress a newer event projection with stale Turn diagnostics', async () => {
    toolRuntime.consume(approvalRequired);
    toolRuntime.consume({
      event: 'tool_approval_decision',
      data: {
        toolCallId: 'tool-call-1',
        decisionId: 'decision-1',
        decisionRevision: 1,
        approved: true,
        payloadHash: 'decision-hash-1',
      },
    });
    const current = toolRuntime.getSnapshot();
    exportAgentTurnDiagnostics.mockResolvedValue({
      replay: {
        turnId: 'turn-1',
        toolCalls: [{
          toolCallId: 'tool-call-1',
          toolName: 'filesystem.read',
          redactedArguments: '{}',
          status: AgentToolCallStatus.WAITING_APPROVAL,
          approvalId: 'approval-1',
          decisionId: '',
          decisionRevision: 0n,
          errorCode: '',
        }],
      },
    });

    await expect(toolRuntime.reconcileMessages([{
      turnId: 'turn-1',
      toolCalls: [{
        id: 'tool-call-1',
        name: 'filesystem.read',
        pending: true,
        status: 'approval_required',
        approvalId: 'approval-1',
        decisionRevision: 0,
      }],
    }])).resolves.toBe(false);
    expect(toolRuntime.getSnapshot()).toBe(current);
    expect(toolRuntime.getProjection('tool-call-1')).toMatchObject({
      status: 'approved',
      decisionRevision: 1,
    });
  });

  it('keeps a classified terminal projection immutable at the same revision', () => {
    const expired: ToolProjection = {
      toolCallId: 'tool-call-1',
      turnId: 'turn-1',
      toolName: 'filesystem.read',
      arguments: '{}',
      status: 'expired',
      pending: false,
      error: 'agent.errors.toolApprovalExpired',
      decisionRevision: 0,
      decisionErrorCode: 'TOOL_APPROVAL_EXPIRED',
    };
    const current = { [expired.toolCallId]: expired };
    const reconciled = reconcileToolProjectionState(current, [{
      ...expired,
      status: 'denied',
      error: 'agent.errors.toolApprovalDenied',
      decisionErrorCode: 'TOOL_APPROVAL_DENIED',
    }]);

    expect(reconciled).toBe(current);
  });

  it('ignores late live decision and result events after expiry', () => {
    const expired: ToolProjection = {
      toolCallId: 'tool-call-1',
      turnId: 'turn-1',
      toolName: 'filesystem.read',
      arguments: '{}',
      status: 'expired',
      pending: false,
      error: 'agent.errors.toolApprovalExpired',
      decisionRevision: 0,
      decisionErrorCode: 'TOOL_APPROVAL_EXPIRED',
    };
    const current = { [expired.toolCallId]: expired };

    expect(reduceToolProjection(current, {
      event: 'tool_approval_decision',
      data: {
        toolCallId: 'tool-call-1',
        decisionId: 'late-decision',
        decisionRevision: 1,
        approved: true,
      },
    })).toBe(current);
    expect(reduceToolProjection(current, {
      event: 'tool_result',
      data: {
        toolCallId: 'tool-call-1',
        content: 'late result',
      },
    })).toBe(current);
  });

  it('does not refine an unclassified terminal error to a nonterminal state', () => {
    const failed: ToolProjection = {
      toolCallId: 'tool-call-1',
      turnId: 'turn-1',
      toolName: 'filesystem.read',
      arguments: '{}',
      status: 'error',
      pending: false,
      error: 'agent.errors.providerFailed',
      decisionRevision: 0,
    };
    const current = { [failed.toolCallId]: failed };
    const reconciled = reconcileToolProjectionState(current, [{
      ...failed,
      status: 'approval_required',
      pending: true,
      approvalId: 'approval-1',
      error: undefined,
    }]);

    expect(reconciled).toBe(current);
  });

  it('refines an unclassified terminal message error from Station truth', () => {
    const projected = resolveToolCallProjection({
      id: 'tool-call-1',
      name: 'filesystem.read',
      pending: false,
      status: 'error',
      decisionRevision: 0,
    }, {
      toolCallId: 'tool-call-1',
      turnId: 'turn-1',
      toolName: 'filesystem.read',
      arguments: '{}',
      status: 'expired',
      pending: false,
      error: 'agent.errors.toolApprovalExpired',
      decisionRevision: 0,
      decisionErrorCode: 'TOOL_APPROVAL_EXPIRED',
    });

    expect(projected).toMatchObject({
      status: 'expired',
      error: 'agent.errors.toolApprovalExpired',
    });
  });

  it('projects Station approval expiry as a localized terminal error', async () => {
    exportAgentTurnDiagnostics.mockResolvedValue({
      replay: {
        turnId: 'turn-1',
        toolCalls: [{
          toolCallId: 'tool-call-1',
          toolName: 'filesystem.read',
          redactedArguments: '{}',
          status: AgentToolCallStatus.EXPIRED,
          approvalId: 'approval-1',
          decisionId: '',
          decisionRevision: 0n,
          errorCode: 'TOOL_APPROVAL_EXPIRED',
        }],
      },
    });

    await expect(toolRuntime.reconcileMessages([{
      turnId: 'turn-1',
      toolCalls: [{
        id: 'tool-call-1',
        name: 'filesystem.read',
        pending: true,
        status: 'approval_required',
        approvalId: 'approval-1',
        decisionRevision: 0,
      }],
    }])).resolves.toBe(true);

    expect(toolRuntime.getProjection('tool-call-1')).toMatchObject({
      status: 'expired',
      pending: false,
      error: 'agent.errors.toolApprovalExpired',
      approvalId: 'approval-1',
      decisionRevision: 0,
    });
  });

  it('projects Station approval denial as a localized terminal error', async () => {
    exportAgentTurnDiagnostics.mockResolvedValue({
      replay: {
        turnId: 'turn-1',
        toolCalls: [{
          toolCallId: 'tool-call-1',
          toolName: 'filesystem.read',
          redactedArguments: '{}',
          status: AgentToolCallStatus.DENIED,
          approvalId: 'approval-1',
          decisionId: 'decision-1',
          decisionRevision: 1n,
          errorCode: 'TOOL_APPROVAL_DENIED',
        }],
      },
    });

    await expect(toolRuntime.reconcileMessages([{
      turnId: 'turn-1',
      toolCalls: [{
        id: 'tool-call-1',
        name: 'filesystem.read',
        pending: false,
        status: 'denied',
        approvalId: 'approval-1',
        decisionId: 'decision-1',
        decisionRevision: 1,
      }],
    }])).resolves.toBe(true);

    expect(toolRuntime.getProjection('tool-call-1')).toMatchObject({
      status: 'denied',
      pending: false,
      error: 'agent.errors.toolApprovalDenied',
      decisionErrorCode: 'TOOL_APPROVAL_DENIED',
      approvalId: 'approval-1',
      decisionId: 'decision-1',
      decisionRevision: 1,
    });
  });

  it('deduplicates decision projections by identity and revision', () => {
    let state: ToolProjectionState = reduceToolProjection({}, approvalRequired);
    state = reduceToolProjection(state, {
      event: 'tool_approval_decision',
      data: {
        toolCallId: 'tool-call-1',
        decisionId: 'decision-1',
        decisionRevision: 1,
        approved: true,
        payloadHash: 'decision-hash-1',
      },
    });
    const accepted = state['tool-call-1'];

    state = reduceToolProjection(state, {
      event: 'tool_approval_decision',
      data: {
        toolCallId: 'tool-call-1',
        decisionId: 'decision-stale',
        decisionRevision: 0,
        approved: false,
        payloadHash: 'decision-hash-stale',
      },
    });
    expect(state['tool-call-1']).toBe(accepted);

    state = reduceToolProjection(state, {
      event: 'tool_approval_decision',
      data: {
        toolCallId: 'tool-call-1',
        decisionId: 'decision-conflict',
        decisionRevision: 1,
        approved: false,
        payloadHash: 'decision-hash-conflict',
      },
    });
    expect(state['tool-call-1']).toBe(accepted);
    expect(state['tool-call-1']).toMatchObject({
      status: 'approved',
      decisionRevision: 1,
    });
  });

  it('submits one complete CAS intent for concurrent duplicate actions', async () => {
    let resolveRequest: ((value: {
      accepted: boolean;
      decision_revision: number;
      approval_id: string;
      tool_call_id: string;
      decision_id: string;
      approved: boolean;
      idempotency_key: string;
      payload_hash: string;
      error_code: string;
    }) => void) | undefined;
    submitAgentToolDecision.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    toolRuntime.consume(approvalRequired);

    const first = toolRuntime.submitDecision('tool-call-1', true);
    const duplicate = toolRuntime.submitDecision('tool-call-1', true);

    expect(duplicate).toBe(first);
    expect(submitAgentToolDecision).toHaveBeenCalledTimes(1);
    expect(submitAgentToolDecision).toHaveBeenCalledWith({
      approval_id: 'approval-1',
      tool_call_id: 'tool-call-1',
      decision_id: 'decision-generated-1',
      expected_revision: 0,
      approved: true,
      idempotency_key: 'decision-generated-1',
    });

    resolveRequest?.({
      accepted: true,
      decision_revision: 1,
      approval_id: 'approval-1',
      tool_call_id: 'tool-call-1',
      decision_id: 'decision-generated-1',
      approved: true,
      idempotency_key: 'decision-generated-1',
      payload_hash: 'decision-hash-1',
      error_code: 'TOOL_APPROVAL_DECISION_ERROR_CODE_UNSPECIFIED',
    });
    await first;

    expect(toolRuntime.getProjection('tool-call-1')).toMatchObject({
      status: 'approved',
      decisionRevision: 1,
      payloadHash: 'decision-hash-1',
    });
  });

  it('retains the typed denial outcome in the terminal projection', async () => {
    submitAgentToolDecision.mockResolvedValue({
      accepted: true,
      decision_revision: 1,
      approval_id: 'approval-1',
      tool_call_id: 'tool-call-1',
      decision_id: 'decision-generated-1',
      approved: false,
      idempotency_key: 'decision-generated-1',
      payload_hash: 'decision-hash-1',
      error_code: 'TOOL_APPROVAL_DECISION_ERROR_CODE_UNSPECIFIED',
      outcome_error: {
        error: 'agent.errors.toolApprovalDenied',
        error_type: 'TOOL_APPROVAL_DENIED',
        locale_key: 'agent.errors.toolApprovalDenied',
        retryable: false,
        terminal: true,
        details: {
          tool_call_id: 'tool-call-1',
          decision_id: 'decision-generated-1',
        },
      },
    });
    toolRuntime.consume(approvalRequired);

    await toolRuntime.submitDecision('tool-call-1', false);

    const projection = toolRuntime.getProjection('tool-call-1');
    expect(projection).toMatchObject({
      status: 'denied',
      pending: false,
      error: 'agent.errors.toolApprovalDenied',
      decisionId: 'decision-generated-1',
      decisionRevision: 1,
      decisionErrorCode: 'agent.errors.toolApprovalDenied',
      decisionOutcome: {
        error_type: 'TOOL_APPROVAL_DENIED',
        locale_key: 'agent.errors.toolApprovalDenied',
        retryable: false,
        terminal: true,
        details: {
          tool_call_id: 'tool-call-1',
          decision_id: 'decision-generated-1',
        },
      },
    });
    expect(resolveToolCallProjection({
      id: 'tool-call-1',
      name: 'filesystem.read',
      pending: false,
      status: 'success',
      decisionId: 'decision-generated-1',
      decisionRevision: 1,
    }, projection)).toMatchObject({
      status: 'denied',
      error: 'agent.errors.toolApprovalDenied',
    });
  });

  it('projects a rejected expired decision as a typed terminal error', async () => {
    submitAgentToolDecision.mockResolvedValue({
      accepted: false,
      decision_revision: 0,
      approval_id: 'approval-1',
      tool_call_id: 'tool-call-1',
      decision_id: 'decision-generated-1',
      approved: true,
      idempotency_key: 'decision-generated-1',
      payload_hash: 'decision-hash-1',
      error_code: 'TOOL_APPROVAL_DECISION_ERROR_CODE_EXPIRED',
      outcome_error: {
        error: 'agent.errors.toolApprovalExpired',
        error_type: 'TOOL_APPROVAL_EXPIRED',
        locale_key: 'agent.errors.toolApprovalExpired',
        retryable: true,
        terminal: true,
        details: {
          decision_id: 'decision-generated-1',
          expires_at: '2026-09-04T22:00:00Z',
        },
      },
    });
    toolRuntime.consume(approvalRequired);

    await toolRuntime.submitDecision('tool-call-1', true);

    expect(toolRuntime.getProjection('tool-call-1')).toMatchObject({
      status: 'expired',
      pending: false,
      decisionRevision: 0,
      decisionErrorCode: 'agent.errors.toolApprovalExpired',
      decisionOutcome: {
        error_type: 'TOOL_APPROVAL_EXPIRED',
        locale_key: 'agent.errors.toolApprovalExpired',
        retryable: true,
        terminal: true,
        details: {
          decision_id: 'decision-generated-1',
          expires_at: '2026-09-04T22:00:00Z',
        },
      },
    });
  });

  it('projects result and terminal events without Web execution authority', () => {
    let state = reduceToolProjection({}, approvalRequired);
    state = reduceToolProjection(state, {
      event: 'tool_result',
      data: {
        turnId: 'turn-1',
        toolCallId: 'tool-call-1',
        result: '{"ok":true}',
      },
    });

    expect(state['tool-call-1']).toMatchObject({
      status: 'success',
      pending: false,
      result: '{"ok":true}',
    });
    expect(submitAgentToolDecision).not.toHaveBeenCalled();
  });
});
