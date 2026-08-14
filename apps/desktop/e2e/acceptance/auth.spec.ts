import { test, expect } from '../fixtures';
import { AUTH_CONTRACT } from './auth.contract';
import { login, waitForAuth } from './helpers';

/**
 * Auth Module Acceptance Spec
 *
 * Injection: setup logs in via gateway, then waits for frontend sync.
 * Matrix: verifies ready shell and identity availability.
 */

test.describe(AUTH_CONTRACT.module, () => {
  test.beforeAll(async ({ tauriPage }) => {
    // ── Setup: login alice ──
    const result = await login('alice');
    expect(result.ok).toBe(true);
    await waitForAuth(tauriPage);
  });

  test(AUTH_CONTRACT.matrix[0].name, async ({ tauriPage }) => {
    const navCount = await tauriPage.evaluate(
      "document.querySelectorAll('[data-pt-primary-nav]').length",
    );
    expect(navCount).toBeGreaterThan(0);
  });

  test(AUTH_CONTRACT.matrix[1].name, async ({ tauriPage }) => {
    const identity = await tauriPage.evaluate(`
      (async () => {
        if (typeof window.__PT_ACCEPTANCE__?.getRealtimeDevice === 'function') {
          return await window.__PT_ACCEPTANCE__.getRealtimeDevice();
        }
        return { actorId: '' };
      })()
    `);
    expect(identity.actorId).toBeTruthy();
  });
});
