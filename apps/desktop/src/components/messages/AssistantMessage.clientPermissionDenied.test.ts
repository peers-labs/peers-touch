import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./AssistantMessage.tsx', import.meta.url),
  'utf8',
);

describe('client permission-denied recovery wiring', () => {
  it('opens the exact in-product capability detail without retrying the Turn', () => {
    const handlerStart = source.indexOf(
      'const handleOpenPermissionSettings = useCallback',
    );
    const handlerEnd = source.indexOf(
      'const handleDelAndRegenerate',
      handlerStart,
    );
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handler).toContain('focusAgentCapability(');
    expect(handler).toContain('resolution.capabilityId');
    expect(handler).toContain('resolution.permissionKind');
    expect(handler).toContain("setAgentSurface(activeAgent.name, 'profile')");
    expect(handler).toContain("resource: 'sessions'");
    expect(handler).not.toContain('handleRetry(');
    expect(handler).not.toContain('sendMessage(');
    expect(handler).not.toContain('invoke(');
  });

  it('exposes stable permission evidence selectors', () => {
    expect(source).toContain('data-pt-agent-error-capability-id=');
    expect(source).toContain('data-pt-agent-error-permission-kind=');
    expect(source).toContain("'open-permission-settings'");
  });
});
