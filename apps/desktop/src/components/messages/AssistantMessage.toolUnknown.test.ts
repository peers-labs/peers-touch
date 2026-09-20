import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./AssistantMessage.tsx', import.meta.url),
  'utf8',
);

describe('unknown-tool recovery wiring', () => {
  it('opens the existing Agent Profile without retrying the Turn', () => {
    const actionStart = source.indexOf(
      "if (message.resolution!.type === 'chooseTool')",
    );
    const actionEnd = source.indexOf(
      "if (message.resolution!.type === 'recover')",
      actionStart,
    );
    const actionBranch = source.slice(actionStart, actionEnd);

    expect(actionStart).toBeGreaterThan(-1);
    expect(actionEnd).toBeGreaterThan(actionStart);
    expect(actionBranch).toContain('handleChooseCompatibleModel()');
    expect(actionBranch).not.toContain('handleRetry()');
    expect(actionBranch).not.toContain('sendMessage(');
  });

  it('exposes a stable recovery target and bounded tool identity', () => {
    expect(source).toContain("? 'choose-tool'");
    expect(source).toContain(
      'data-pt-agent-error-tool-id={message.typedError?.details.tool_id}',
    );
    expect(source).toContain(
      'data-pt-agent-error-tool-version={message.typedError?.details.tool_version}',
    );
  });
});
