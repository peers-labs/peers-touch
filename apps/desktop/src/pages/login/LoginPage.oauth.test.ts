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

  it('keeps OAuth recovery focus on retry', () => {
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
  });

  it('normalizes button focus globally without border rings', () => {
    expect(globalStyles).toContain(
      ':where(button, [role="button"]):focus-visible',
    );
    expect(globalStyles).toContain(
      'outline: none !important',
    );
    expect(globalStyles).toContain(
      'box-shadow: inset 0 0 0 9999px color-mix(in srgb, currentColor 8%, transparent) !important',
    );
    expect(globalStyles).toContain(
      ':where(.ant-btn-text, .ant-btn-link)',
    );
    expect(globalStyles).toContain('border-color: transparent !important');
    expect(globalStyles).not.toContain('--pt-focus-ring-color');
    expect(globalStyles).not.toContain('outline: 2px solid');
    expect(mainSource).toContain("colorPrimaryBorder: '#6f87f5'");
    expect(mainSource).toContain('lineWidthFocus: 0');
  });
});
