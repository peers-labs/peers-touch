import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ToolCallsBlock approval visibility', () => {
  it('automatically exposes a persisted actionable approval', () => {
    const source = readFileSync(
      new URL('./ToolCallCard.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      "toolCall.status === 'approval_required' && Boolean(toolCall.approvalId)",
    );
    expect(source).toContain(
      'const [expanded, setExpanded] = useState(actionableApproval)',
    );
    expect(source).toContain(
      'if (actionableApproval) setExpanded(true)',
    );
  });
});
