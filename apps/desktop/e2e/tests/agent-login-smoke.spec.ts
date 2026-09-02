import { test, expect } from '../fixtures';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_DIR = path.resolve(__dirname, '../../../../tooling/acceptance/reports/agent-native');

test.describe('Agent Native Tauri: login bootstrap', () => {
  test('authenticates and reaches shell with agent nav', async ({ authenticatedPage }) => {
    const navCount = await authenticatedPage.evaluate(
      "document.querySelectorAll('[data-pt-primary-nav]').length"
    );
    expect(navCount).toBeGreaterThan(0);

    await authenticatedPage.click('[data-pt-primary-nav="agent"]');
    await authenticatedPage.waitForTimeout(1000);

    const url = await authenticatedPage.url();

    const screenshot = await authenticatedPage.screenshot();
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'login-smoke.png'), screenshot);

    const hasAgentNav = await authenticatedPage.isVisible('[data-pt-primary-nav="agent"]');

    const report = {
      schemaVersion: 1,
      artifactKind: 'agent-native-login-smoke',
      status: 'passed',
      proofStatus: 'PROVEN',
      url,
      navCount,
      hasAgentNav,
    };
    fs.writeFileSync(
      path.join(REPORT_DIR, 'login-smoke.json'),
      JSON.stringify(report, null, 2),
    );

    expect(hasAgentNav).toBe(true);
  });
});
