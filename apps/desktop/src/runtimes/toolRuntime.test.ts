import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submitAgentToolDecision = vi.hoisted(() => vi.fn());

vi.mock('../services/desktop_api', () => ({
  api: {
    submitAgentToolDecision,
  },
}));

import { reduceToolProjection, toolRuntime, type ToolProjectionState } from './toolRuntime';

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
