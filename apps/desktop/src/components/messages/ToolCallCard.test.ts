import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ToolCallsBlock approval visibility', () => {
  it('automatically exposes a persisted actionable approval', () => {
    const source = readFileSync(
      new URL('./ToolCallCard.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      "status === 'approval_required'",
    );
    expect(source).toContain(
      'Boolean(toolCall.approvalId)',
    );
    expect(source).toContain(
      'const [expanded, setExpanded] = useState(false)',
    );
    expect(source).toContain(
      'expanded || actionableToolState || pendingCount > 0',
    );

    const approveDecision = source.indexOf(
      'submitAgentToolDecision(tool.id, true)',
    );
    const recoverySelector = source.indexOf(
      'data-pt-agent-tool-recovery="continue-without-tool"',
    );
    const denyDecision = source.indexOf(
      'submitAgentToolDecision(tool.id, false)',
    );
    expect(approveDecision).toBeGreaterThan(-1);
    expect(recoverySelector).toBeGreaterThan(approveDecision);
    expect(recoverySelector).toBeLessThan(denyDecision);
  });

  it('exposes expired approval recovery without resubmitting the old decision', () => {
    const source = readFileSync(
      new URL('./ToolCallCard.tsx', import.meta.url),
      'utf8',
    );
    const runtimeSource = readFileSync(
      new URL('../../runtimes/toolRuntime.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      "tool.error === 'agent.errors.toolApprovalExpired'",
    );
    expect(source).toContain(
      'data-pt-agent-tool-recovery="request-again"',
    );
    expect(source).toContain(
      "t('agent.recovery.requestAgain', { ns: 'agent' })",
    );
    expect(source).toContain('void onRequestAgain()');
    expect(source).toContain('resolveToolCallProjection');
    expect(source).toContain(
      'const pendingCount = projectedToolCalls.filter',
    );
    expect(runtimeSource).toContain('projectionAddsTypedTerminalOutcome');
    expect(runtimeSource).toContain(
      "(source.status === projection.status || source.status === 'error')",
    );

    const requestAgain = source.indexOf(
      'data-pt-agent-tool-recovery="request-again"',
    );
    const decisionSubmission = source.indexOf(
      'submitAgentToolDecision(tool.id',
      requestAgain,
    );
    expect(decisionSubmission).toBe(-1);
  });

  it('renders executor-unavailable recovery without claiming or executing the ToolCall', () => {
    const source = readFileSync(
      new URL('./ToolCallCard.tsx', import.meta.url),
      'utf8',
    );
    const runtimeSource = readFileSync(
      new URL('../../runtimes/toolRuntime.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      "tool.error === 'agent.errors.executorUnavailable'",
    );
    expect(source).toContain(
      'data-pt-agent-tool-decision="approve"',
    );
    expect(source).toContain('disabled={!canApprove}');
    expect(source).toContain(
      'data-pt-agent-tool-recovery="reconnect-executor"',
    );
    expect(source).toContain(
      "t('agent.recovery.reconnectExecutor', { ns: 'agent' })",
    );
    expect(source).toContain('void reconnectAgentToolExecutor(tool.id)');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('openBrowserCapabilitySession');
    expect(runtimeSource).not.toContain('api.openBrowserCapabilitySession()');
    expect(runtimeSource).toContain('api.startAgentClientExecutorSupervisor()');
    expect(runtimeSource).toContain('api.listAgentCapabilitySessions()');
    expect(runtimeSource).not.toContain('claimAgentTool');
    expect(runtimeSource).not.toContain('executeAgentTool');
  });

  it('projects governed invocation metadata from Station diagnostics', () => {
    const source = readFileSync(
      new URL('./ToolCallCard.tsx', import.meta.url),
      'utf8',
    );
    const runtimeSource = readFileSync(
      new URL('../../runtimes/toolRuntime.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('data-pt-agent-tool-governance');
    expect(source).toContain('data-pt-agent-tool-turn');
    expect(source).toContain('tool.manifestId');
    expect(source).toContain('manifest?.riskClass');
    expect(source).toContain('tool.executionOwner');
    expect(source).toContain('tool.targetDeviceId');
    expect(source).toContain('tool.readinessSnapshotId');
    expect(runtimeSource).toContain('executionOwner: fact.executionOwner');
    expect(runtimeSource).toContain('approvalPolicy: fact.approvalPolicy');
    expect(runtimeSource).toContain('manifestId: fact.manifestId');
    expect(runtimeSource).toContain('targetDeviceId: fact.targetDeviceId');
  });
});
