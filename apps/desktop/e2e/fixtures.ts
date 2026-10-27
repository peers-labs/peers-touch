// Performance-only transport for Playwright tests.
// Native product Acceptance uses Python + Selenium + embedded WebDriver.
import type { APIRequestContext } from '@playwright/test';
import { createTauriTest } from '@srsholmes/tauri-playwright';
import type { TauriPage, TauriTestConfig } from '@srsholmes/tauri-playwright';

const tauriConfig: TauriTestConfig = {
  mcpSocket: process.env.PT_PLAYWRIGHT_SOCKET || process.env.PLAYWRIGHT_SOCKET || '/tmp/peers-ai-agent-agent.sock',
  devUrl: '',
};

const TEST_EMAIL = process.env.AGENT_TEST_EMAIL || 'agent-test-a@p.t';
const TEST_PASSWORD = process.env.AGENT_TEST_PASSWORD || 'Test-1234';
const TEST_NAME = process.env.AGENT_TEST_NAME || 'agenttesta';
const STATION_URL = process.env.PT_STATION_URL || process.env.PEERS_STATION_URL || 'http://127.0.0.1:18080';

const { test: baseTest, expect } = createTauriTest(tauriConfig);

// Socket bridge accepts numeric timeouts only.
const LOGIN_TIMEOUT_MS = 30_000;
const NAV_READY_MS = 30_000;

async function bootstrapAccount(request: APIRequestContext): Promise<void> {
  try {
    await request.post(`${STATION_URL}/actor/sign-up`, {
      data: {
        name: TEST_NAME,
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      },
      timeout: 10_000,
    });
  } catch {
    // Account may already exist; proceed to login.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isEmailTabActive(page: TauriPage): Promise<boolean> {
  return page.evaluate<boolean>(`(() => {
    const tabs = Array.from(document.querySelectorAll('[data-login-tab]'));
    const email = tabs.find((el) => el.getAttribute('data-login-tab') === 'email');
    return email?.getAttribute('aria-selected') === 'true'
      || email?.classList.contains('ant-tabs-tab-active')
      || false;
  })()`);
}

async function ensureStationBound(page: TauriPage): Promise<void> {
  // A fresh cell has no trusted Station. Discover the reachability seed via
  // the login-screen picker; a single direct route auto-selects and commits
  // the AccessGate binding.
  const alreadyBound = await page.evaluate<boolean>(
    "document.querySelectorAll('[data-station-peer-id]').length > 0",
  );
  if (alreadyBound) return;

  const inputSelector = 'input[aria-label="Station or private connection"]';
  const panelInput = await page.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(inputSelector)})`);
  if (!panelInput) {
    await page.click('[data-station-picker-trigger]');
  }
  await page.waitForSelector(inputSelector, LOGIN_TIMEOUT_MS);
  await page.fill(inputSelector, STATION_URL);
  await page.click('button[aria-label="Add Station"]');
  await page.waitForFunction(
    "document.querySelectorAll('[data-station-peer-id]').length > 0",
    LOGIN_TIMEOUT_MS,
  );
}

async function primaryNavVisible(page: TauriPage): Promise<boolean> {
  return page.evaluate<boolean>(
    "document.querySelectorAll('[data-pt-primary-nav]').length > 0",
  );
}

async function dismissPinScreen(page: TauriPage): Promise<boolean> {
  const skip = await page.evaluate<boolean>(
    "!!(document.querySelector('[data-login-pin-skip]') && document.querySelector('[data-login-pin-skip]').offsetParent !== null)",
  );
  if (skip) {
    await page.click('[data-login-pin-skip]');
    await page.waitForFunction(
      "document.querySelectorAll('[data-pt-primary-nav]').length > 0",
      LOGIN_TIMEOUT_MS,
    );
    return true;
  }
  return false;
}

async function loginToShell(page: TauriPage): Promise<void> {
  await ensureStationBound(page);
  await sleep(1_000);
  if (await primaryNavVisible(page)) return;
  if (await dismissPinScreen(page)) return;
  await page.waitForSelector('[data-login-tab="email"]', LOGIN_TIMEOUT_MS);

  if (!(await isEmailTabActive(page))) {
    await page.click('[data-login-tab="email"]');
    await sleep(300);
  }
  await page.waitForSelector('[data-login-email]', LOGIN_TIMEOUT_MS);
  await page.fill('[data-login-email]', TEST_EMAIL);
  await page.fill('[data-login-password]', TEST_PASSWORD);
  await page.click('[data-login-submit]');
  await settlePostLogin(page);
}

async function settlePostLogin(page: TauriPage): Promise<void> {
  const navReady =
    "document.querySelectorAll('[data-pt-primary-nav]').length > 0";
  // Fresh accounts offer an optional local PIN; acceptance skips it.
  await sleep(1_500);
  const skipVisible = await page.evaluate<boolean>(
    "!!document.querySelector('[data-login-pin-skip]') && document.querySelector('[data-login-pin-skip]').offsetParent !== null",
  );
  if (skipVisible) {
    await page.click('[data-login-pin-skip]');
  }
  await page.waitForFunction(navReady, LOGIN_TIMEOUT_MS);
}

export const test = baseTest.extend<{
  authenticatedPage: TauriPage;
}>({
  authenticatedPage: async ({ tauriPage, request }, use) => {
    const page = tauriPage as TauriPage;
    await bootstrapAccount(request);
    // After a renderer reload the persisted session restores asynchronously;
    // give it a grace window before falling back to an explicit login so the
    // restart simulation does not mint a second capability session.
    let primaryNavCount = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      primaryNavCount = await page.evaluate<number>(
        "document.querySelectorAll('[data-pt-primary-nav]').length",
      );
      if (primaryNavCount > 0) break;
      await sleep(1_000);
    }
    if (primaryNavCount === 0) {
      await loginToShell(page);
    }
    await use(page);
  },
});

export { expect, NAV_READY_MS };
export type { TauriPage };
