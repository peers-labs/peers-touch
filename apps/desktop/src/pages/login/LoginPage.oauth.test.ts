import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./LoginPage.tsx', import.meta.url), 'utf8');
const formViewSource = readFileSync(
  new URL('./views/LoginFormView.tsx', import.meta.url),
  'utf8',
);
const globalStyles = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8');

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

  it('keeps OAuth recovery focus on retry and normalizes visible button focus', () => {
    expect(formViewSource).toContain(
      "if (['opening', 'waiting'].includes(oauthActionState))",
    );
    expect(formViewSource).toContain(
      "if (oauthActionState === 'error')",
    );
    expect(formViewSource).toContain(
      "?.querySelector<HTMLElement>('[data-pt-login-oauth-provider]')",
    );
    expect(formViewSource).not.toContain('oauthButtonRefs');
    expect(globalStyles).toContain(
      ':where(button, [role="button"], a[href]):focus-visible',
    );
    expect(globalStyles).toContain('--pt-focus-ring-color: #6f87f5');
    expect(globalStyles).toContain(
      'outline: 2px solid var(--pt-focus-ring-color)',
    );
    expect(globalStyles).toContain('outline-offset: 2px');
    expect(mainSource).toContain("colorPrimaryBorder: '#6f87f5'");
    expect(mainSource).toContain('lineWidthFocus: 2');
  });
});
