import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./AssistantMessage.tsx', import.meta.url),
  'utf8',
);

describe('runtime-resume-unavailable recovery wiring', () => {
  it('requires destructive confirmation before dispatching reset', () => {
    const handlerStart = source.indexOf('const handleConfirmRuntimeReset');
    const handlerEnd = source.indexOf(
      'const handleDelAndRegenerate',
      handlerStart,
    );
    const handler = source.slice(handlerStart, handlerEnd);
    const actionStart = source.indexOf(
      "if (message.resolution!.type === 'confirmReset')",
    );
    const actionEnd = source.indexOf(
      "if (message.resolution!.type === 'openPermissionSettings')",
      actionStart,
    );
    const action = source.slice(actionStart, actionEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handler).toContain('Modal.confirm({');
    expect(handler).toContain("'agent.recovery.confirmResetDescription'");
    expect(handler).toContain('danger: true');
    expect(handler).toContain('await resetExternalRuntime(currentSessionKey)');
    expect(action).toContain('handleConfirmRuntimeReset()');
    expect(action).not.toContain('handleRetry(');
    expect(source).toContain("'confirm-reset'");
    expect(source).toContain('data-pt-agent-runtime-reset-confirm');
    expect(source).toContain('data-pt-agent-error-runtime-profile-id');
  });
});
