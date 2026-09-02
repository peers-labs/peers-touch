// Performance-only Playwright transport. Never use this fixture for Acceptance.
import {
  createTauriTest,
  type TauriTestConfig,
  type TauriPage,
} from '@srsholmes/tauri-playwright';

const tauriConfig: TauriTestConfig = {
  mcpSocket: process.env.PT_PLAYWRIGHT_SOCKET || process.env.PLAYWRIGHT_SOCKET || '/tmp/peers-ai-agent-agent.sock',
  devUrl: '',
};

const { test: baseTest, expect: tauriExpect } = createTauriTest(tauriConfig);

const TEST_EMAIL = process.env.AGENT_TEST_EMAIL || 'agent-test-a@p.t';
const TEST_PASSWORD = process.env.AGENT_TEST_PASSWORD || '1';
const TEST_NAME = process.env.AGENT_TEST_NAME || 'Agent Test A';
const STATION_URL = process.env.PT_STATION_URL || process.env.PEERS_STATION_URL || 'http://127.0.0.1:18080';

async function bootstrapAccount(request: any): Promise<void> {
  try {
    await request.post(`${STATION_URL}/actor/sign-up`, {
      data: { name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD },
      timeout: 10_000,
    });
  } catch {
    // Account may already exist; proceed to login
  }
}

async function isEmailTabActive(page: TauriPage): Promise<boolean> {
  return page.evaluate(() => {
    const tabs = document.querySelectorAll('[data-login-tab]');
    for (const tab of Array.from(tabs)) {
      if (tab.getAttribute('data-login-tab') === 'email') {
        const style = getComputedStyle(tab);
        return style.boxShadow !== 'none' && style.boxShadow !== '';
      }
    }
    return false;
  });
}

async function loginToShell(page: TauriPage): Promise<void> {
  await page.waitForSelector('[data-login-tab="email"]', { timeout: 30_000 });

  if (!(await isEmailTabActive(page))) {
    await page.click('[data-login-tab="email"]');
    await page.waitForTimeout(300);
  }

  await page.waitForSelector('[data-login-email]', { timeout: 5_000 });
  await page.fill('[data-login-email]', TEST_EMAIL);
  await page.fill('[data-login-password]', TEST_PASSWORD);
  await page.click('[data-login-submit]');

  try {
    await page.waitForSelector('[data-login-pin-skip]', { timeout: 15_000 });
    await page.click('[data-login-pin-skip]');
  } catch {
    // PIN skip may not appear if account has PIN set or flow differs
  }

  await page.waitForFunction(
    "document.querySelectorAll('[data-pt-primary-nav]').length > 0",
    { timeout: 30_000 }
  );
}

export const test = baseTest.extend<{
  authenticatedPage: TauriPage;
}>({
  authenticatedPage: async ({ tauriPage, request }, use) => {
    await bootstrapAccount(request);
    const primaryNavCount = await tauriPage.evaluate(
      "document.querySelectorAll('[data-pt-primary-nav]').length"
    );
    if (primaryNavCount === 0) {
      await loginToShell(tauriPage);
    }
    await use(tauriPage);
  },
});

export { expect } from '@playwright/test';
