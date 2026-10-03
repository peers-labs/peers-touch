import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./LoginPage.tsx', import.meta.url), 'utf8');

describe('LoginPage OAuth lifecycle contract', () => {
  it('binds account login cancellation and browser-open state to the active attempt', () => {
    const handlerStart = source.indexOf('const handleOAuthConnect');
    const handlerEnd = source.indexOf('const handleOAuthCancel', handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handler).toContain("'account_login',");
    expect(handler).toContain('signal: attempt.controller.signal');
    expect(handler).toContain('if (oauthAttemptRef.current === attempt)');
    expect(handler).toContain("setAuthState('waiting')");
    expect(handler).toContain(
      'if (attempt.controller.signal.aborted) setConnectProvider(provider)',
    );
    expect(source).toContain('resetOAuthAction(true)');
  });
});
