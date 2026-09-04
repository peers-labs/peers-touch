import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ToolCallsBlock approval visibility', () => {
  it('automatically exposes a persisted actionable approval', () => {
    const source = readFileSync(
      new URL('./ToolCallCard.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      "(projection?.status ?? toolCall.status) === 'approval_required'",
    );
    expect(source).toContain(
      'Boolean(projection?.approvalId ?? toolCall.approvalId)',
    );
    expect(source).toContain(
      'const [expanded, setExpanded] = useState(actionableApproval)',
    );
    expect(source).toContain(
      'if (actionableApproval) setExpanded(true)',
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
});
