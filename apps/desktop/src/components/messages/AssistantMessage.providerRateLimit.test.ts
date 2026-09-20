import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./AssistantMessage.tsx', import.meta.url),
  'utf8',
);

describe('provider-rate-limit recovery wiring', () => {
  it('retries only from the explicit recovery action', () => {
    const actionStart = source.indexOf(
      "if (message.resolution!.type === 'retryLater')",
    );
    const actionEnd = source.indexOf(
      "if (message.resolution!.type === 'switchAccount')",
      actionStart,
    );
    const actionBranch = source.slice(actionStart, actionEnd);

    expect(actionStart).toBeGreaterThan(-1);
    expect(actionEnd).toBeGreaterThan(actionStart);
    expect(actionBranch).toContain('await handleRetry()');
    expect(actionBranch).not.toContain('setTimeout');
    expect(actionBranch).not.toContain('sendMessage(');
  });

  it('exposes bounded rate-limit evidence', () => {
    expect(source).toContain("'retry-later'");
    expect(source).toContain('data-pt-agent-error-provider-id');
    expect(source).toContain('data-pt-agent-error-retry-after-ms');
  });
});
