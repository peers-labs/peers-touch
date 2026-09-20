import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./AssistantMessage.tsx', import.meta.url),
  'utf8',
);

describe('client lease-expired recovery wiring', () => {
  it('dispatches the store-owned reconcile action without retrying the Turn', () => {
    const actionStart = source.indexOf(
      "if (message.resolution!.type === 'reconcile')",
    );
    const actionEnd = source.indexOf(
      "if (message.resolution!.type === 'chooseResourceAgain')",
      actionStart,
    );
    const actionBranch = source.slice(actionStart, actionEnd);

    expect(actionStart).toBeGreaterThan(-1);
    expect(actionEnd).toBeGreaterThan(actionStart);
    expect(actionBranch).toContain('await handleReconcileClientLease()');
    expect(actionBranch).not.toContain('handleRetry(');
    expect(actionBranch).not.toContain('sendMessage(');
    expect(actionBranch).not.toContain('startAgentClientExecutorSupervisor');
  });

  it('exposes stable lease and recovery selectors', () => {
    expect(source).toContain('data-pt-agent-error-session-id=');
    expect(source).toContain('data-pt-agent-error-lease-id=');
    expect(source).toContain('data-pt-agent-error-expired-at=');
    expect(source).toContain("'reconcile'");
    expect(source).toContain(
      'data-pt-agent-message-error-recovery={resolutionTarget}',
    );
  });
});
