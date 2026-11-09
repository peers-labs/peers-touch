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
    const resetCallbackStart = source.indexOf('const performRuntimeReset', handlerStart);
    const opener = source.slice(handlerStart, resetCallbackStart);
    const actionStart = source.indexOf(
      "if (message.resolution!.type === 'confirmReset')",
    );
    const actionEnd = source.indexOf(
      "if (message.resolution!.type === 'openPermissionSettings')",
      actionStart,
    );
    const action = source.slice(actionStart, actionEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    // The handler only opens a peer confirm Dialog; it never resets directly.
    expect(opener).toContain('setResetConfirmOpen(true)');
    expect(opener).not.toContain('resetExternalRuntime');
    // The guarded reset lives in the confirm callback.
    expect(handler).toContain('const performRuntimeReset');
    expect(handler).toContain('await resetExternalRuntime(currentSessionKey)');
    // The declarative Dialog carries the destructive description, danger tone,
    // and the acceptance anchor on its confirm button.
    expect(source).toContain("'agent.recovery.confirmResetDescription'");
    expect(source).toContain('tone="danger"');
    expect(source).toContain('data-pt-agent-runtime-reset-confirm');
    expect(action).toContain('handleConfirmRuntimeReset()');
    expect(action).not.toContain('handleRetry(');
    expect(source).toContain("'confirm-reset'");
    expect(source).toContain('data-pt-agent-error-runtime-profile-id');
  });
});
