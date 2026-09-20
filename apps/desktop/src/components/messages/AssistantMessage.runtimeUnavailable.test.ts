import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./AssistantMessage.tsx', import.meta.url),
  'utf8',
);

describe('runtime-unavailable component recovery wiring', () => {
  it('opens the existing Agent profile selector without resending', () => {
    const actionStart = source.indexOf(
      "if (message.resolution!.type === 'selectRuntime')",
    );
    const actionEnd = source.indexOf(
      "if (message.resolution!.type === 'switchAccount')",
      actionStart,
    );
    const actionBranch = source.slice(actionStart, actionEnd);

    expect(actionStart).toBeGreaterThan(-1);
    expect(actionEnd).toBeGreaterThan(actionStart);
    expect(actionBranch).toContain('handleChooseCompatibleModel()');
    expect(actionBranch).not.toContain('handleRetry(');
    expect(actionBranch).not.toContain('sendMessage(');
  });

  it('exposes bounded runtime evidence on the visible error surface', () => {
    expect(source).toContain("'select-runtime'");
    expect(source).toContain('data-pt-agent-error-runtime-kind');
    expect(source).toContain('data-pt-agent-error-reason-code');
  });
});
