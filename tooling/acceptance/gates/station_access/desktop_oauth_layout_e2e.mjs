#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer as createTcpServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../..');
const outputDir = path.resolve(
  process.argv[2] || path.join(repoRoot, '.tmp-station-access-desktop-oauth-layout'),
);
const require = createRequire(path.join(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');

const viewports = [
  { id: 'wide-1200x800', width: 1200, height: 800, layout: 'side-by-side' },
  { id: 'narrow-640x800', width: 640, height: 800, layout: 'stacked' },
];
const providers = ['github', 'google'];

function stage(message) {
  console.error(`[station-access-desktop-oauth-layout-e2e] ${message}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite has not opened its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Desktop Vite server did not become ready: ${url}`);
}

function loadEnglishResources() {
  const localeDir = path.join(repoRoot, 'packages/locales/en');
  const entries = readdirSync(localeDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => [
      path.basename(name, '.json'),
      JSON.parse(readFileSync(path.join(localeDir, name), 'utf8')),
    ]);
  return {
    languages: [{
      code: 'en',
      name: 'English',
      native_name: 'English',
      namespaces: entries.map(([namespace]) => namespace),
    }],
    resources: { en: Object.fromEntries(entries) },
  };
}

async function installMockTauri(context, resources) {
  await context.addInitScript(({ localeResources }) => {
    const invocations = [];
    let connectedProvider = null;
    let oauthAttemptCount = 0;
    const status = (command, value) => ({
      ok: true,
      data: {
        command,
        status: JSON.stringify(value),
      },
    });
    const oauthProviders = [
      {
        id: 'github',
        name: 'GitHub',
        description: 'GitHub account',
        icon: 'github',
        color: '#24292f',
        category: 'social',
        builtin: true,
        enabled: true,
        status: 'ready',
        has_credentials: false,
        connected: false,
        callback_url: '',
        auth_hosts: [],
        environments: [],
      },
      {
        id: 'google',
        name: 'Google',
        description: 'Google account',
        icon: 'google',
        color: '#4285f4',
        category: 'social',
        builtin: true,
        enabled: true,
        status: 'ready',
        has_credentials: false,
        connected: false,
        callback_url: '',
        auth_hosts: [],
        environments: [],
      },
    ];
    const mockInvoke = async (command, args) => {
      invocations.push({ command, args: args || null });
      switch (command) {
        case 'plugin:event|listen':
          return 1;
        case 'plugin:event|unlisten':
          return null;
        case 'i18n_load_resources':
          return { ok: true, data: localeResources };
        case 'applets_product_window_launch_context':
        case 'applets_readiness_probe_context':
          return status(command, { enabled: false });
        case 'auth_restore_session':
          return {
            ok: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'missing session',
              details: { command, reason: 'session_missing' },
            },
          };
        case 'account_list_restorable':
          return status(command, { accounts: [] });
        case 'account_get_active':
          return status(command, {
            account: {
              id: 'github:fixture-user',
              provider: 'github',
              provider_user_id: 'fixture-user',
              name: 'OAuth Fixture',
              email: 'fixture@example.invalid',
              has_pin: false,
              has_session: true,
            },
          });
        case 'oauth2_list_providers':
          return status(command, oauthProviders);
        case 'oauth2_list_connections':
          return status(command, connectedProvider ? [{
            provider_id: connectedProvider,
            user_id: 'fixture-user',
            user_name: 'OAuth Fixture',
            status: 'connected',
          }] : []);
        case 'oauth2_start_loopback':
          oauthAttemptCount += 1;
          return status(command, {
            auth_url: `https://example.invalid/oauth/${args?.input?.id || 'unknown'}`,
            session_id: `session-${args?.input?.id || 'unknown'}-${oauthAttemptCount}`,
          });
        case 'oauth2_poll_loopback': {
          const sessionId = args?.input?.session_id || '';
          if (sessionId.endsWith('-1')) {
            return status(command, { completed: false, status: 'pending' });
          }
          if (sessionId.endsWith('-2')) {
            return status(command, {
              completed: true,
              status: 'failed',
              error: 'provider rejected the fixture authorization',
            });
          }
          connectedProvider = sessionId.includes('google') ? 'google' : 'github';
          return status(command, { completed: true, status: 'completed' });
        }
        case 'oauth2_cancel_loopback':
          return status(command, { cancelled: true, status: 'cancelled' });
        case 'open_external_url':
          return status(command, { ok: true });
        case 'ensure_station_session':
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          return {
            ok: true,
            data: {
              actor_ptid: 'ptid:person:oauth-fixture',
              name: 'OAuth Fixture',
              email: 'fixture@example.invalid',
              login_method: connectedProvider || 'github',
              session_token: 'fixture-session-token',
            },
          };
        case 'sync_user_profile':
          return status(command, {
            name: 'OAuth Fixture',
            email: 'fixture@example.invalid',
            avatar_url: '',
          });
        default:
          return status(command, {});
      }
    };

    Object.defineProperty(window, '__PT_E2E_INVOCATIONS__', {
      configurable: false,
      value: invocations,
      writable: false,
    });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: false,
      value: {
        invoke: mockInvoke,
        transformCallback(callback) {
          const id = crypto.randomUUID();
          if (callback) window[`_${id}`] = callback;
          return id;
        },
        convertFileSrc(value) {
          return value;
        },
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { label: 'main' },
        },
      },
      writable: false,
    });
  }, { localeResources: resources });
}

async function measureOAuthGeometry(page, provider) {
  return page.evaluate(({ expectedProvider }) => {
    const cardElement = document.querySelector('[data-pt-login-card]');
    const actionElement = document.querySelector(
      `[data-pt-login-oauth-action="${expectedProvider}"]`,
    );
    const buttonElement = document.querySelector(
      `[data-pt-login-oauth-provider="${expectedProvider}"]`,
    );
    if (!cardElement || !actionElement || !buttonElement) return null;
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      card: rect(cardElement),
      action: rect(actionElement),
      button: rect(buttonElement),
      detachedPanelCount: document.querySelectorAll('[data-pt-login-oauth-panel]').length,
    };
  }, { expectedProvider: provider });
}

function assertStableRect(expected, actual, label, epsilon = 0.5) {
  for (const field of ['left', 'top', 'width', 'height']) {
    assert.ok(
      Math.abs(expected[field] - actual[field]) <= epsilon,
      `${label} changed ${field}: ${expected[field]} -> ${actual[field]}`,
    );
  }
}

async function runCase(browser, endpoint, viewport, provider) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  await installMockTauri(context, loadEnglishResources());
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(60_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const caseId = `${viewport.id}-${provider}`;

  try {
    stage(`opening ${caseId}`);
    await page.goto(endpoint, { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-pt-login-card]');
    const githubButton = page.locator('[data-pt-login-oauth-provider="github"]');
    const googleButton = page.locator('[data-pt-login-oauth-provider="google"]');
    await card.waitFor();
    await githubButton.waitFor();
    await googleButton.waitFor();
    await page.waitForTimeout(2_800);
    assert.equal(await githubButton.isEnabled(), true, 'GitHub login must be enabled');
    assert.equal(await googleButton.isEnabled(), true, 'Google login must be enabled');

    const providerButton = page.locator(
      `[data-pt-login-oauth-provider="${provider}"]`,
    );
    const otherProvider = provider === 'github' ? 'google' : 'github';
    const otherProviderButton = page.locator(
      `[data-pt-login-oauth-provider="${otherProvider}"]`,
    );
    const screenshotPaths = {};
    const capture = async (state) => {
      const screenshotPath = path.join(outputDir, `${caseId}-${state}.png`);
      await page.screenshot({ path: screenshotPath });
      screenshotPaths[state] = screenshotPath;
    };
    const geometries = {};

    geometries.idle = await measureOAuthGeometry(page, provider);
    assert.ok(geometries.idle, `${caseId} must expose idle login geometry`);
    assert.equal(
      geometries.idle.detachedPanelCount,
      0,
      `${caseId} must not render a detached OAuth panel`,
    );
    await capture('idle');

    await providerButton.click();
    await page.waitForSelector(
      `[data-pt-login-oauth-provider="${provider}"][data-pt-login-oauth-state="waiting"]`,
    );
    geometries.waiting = await measureOAuthGeometry(page, provider);
    assert.ok(geometries.waiting, `${caseId} must expose waiting login geometry`);
    assert.equal(await otherProviderButton.isDisabled(), true);
    assert.equal(
      await page.locator(`[data-pt-login-oauth-cancel="${provider}"]`).count(),
      1,
      `${caseId} must expose inline cancellation while waiting`,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-pt-login-oauth-cancel')),
      provider,
      `${caseId} must move focus to the inline cancel action`,
    );
    await capture('waiting');

    await page.locator(`[data-pt-login-oauth-cancel="${provider}"]`).click();
    await page.waitForSelector(
      `[data-pt-login-oauth-provider="${provider}"][data-pt-login-oauth-state="idle"]`,
    );
    geometries.cancelled = await measureOAuthGeometry(page, provider);
    assert.ok(geometries.cancelled, `${caseId} must expose cancelled login geometry`);
    assert.equal(await otherProviderButton.isEnabled(), true);
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-pt-login-oauth-provider')),
      provider,
      `${caseId} must restore focus to the provider action after cancellation`,
    );
    await page.waitForFunction(
      ({ expectedProvider }) => window.__PT_E2E_INVOCATIONS__.some(
        (invocation) => invocation.command === 'oauth2_cancel_loopback'
          && String(invocation.args?.input?.session_id || '').includes(expectedProvider),
      ),
      { expectedProvider: provider },
    );
    await capture('cancelled');

    await providerButton.click();
    await page.waitForSelector(
      `[data-pt-login-oauth-provider="${provider}"][data-pt-login-oauth-state="error"]`,
    );
    geometries.error = await measureOAuthGeometry(page, provider);
    assert.ok(geometries.error, `${caseId} must expose error login geometry`);
    assert.equal(await providerButton.isEnabled(), true);
    assert.equal(
      await page.locator(`[data-pt-login-oauth-cancel="${provider}"]`).count(),
      1,
      `${caseId} must expose inline recovery cancellation`,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-pt-login-oauth-cancel')),
      provider,
      `${caseId} error recovery must keep focus on an available action`,
    );
    await capture('error');

    await providerButton.click();
    await page.waitForSelector(
      `[data-pt-login-oauth-provider="${provider}"][data-pt-login-oauth-state="initializing"]`,
    );
    geometries.initializing = await measureOAuthGeometry(page, provider);
    assert.ok(geometries.initializing, `${caseId} must expose initializing login geometry`);
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-pt-login-oauth-action')),
      provider,
      `${caseId} initialization must retain a focus owner`,
    );
    await capture('initializing');

    await page.waitForSelector(
      `[data-pt-login-oauth-provider="${provider}"][data-pt-login-oauth-state="success"]`,
    );
    geometries.success = await measureOAuthGeometry(page, provider);
    assert.ok(geometries.success, `${caseId} must expose success login geometry`);
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-pt-login-oauth-action')),
      provider,
      `${caseId} success must retain a focus owner`,
    );
    await capture('success');

    for (const [state, geometry] of Object.entries(geometries)) {
      assert.equal(
        geometry.detachedPanelCount,
        0,
        `${caseId}/${state} must not render a detached OAuth panel`,
      );
      assertStableRect(geometries.idle.card, geometry.card, `${caseId}/${state} card`);
      assertStableRect(geometries.idle.action, geometry.action, `${caseId}/${state} action`);
      assertStableRect(geometries.idle.button, geometry.button, `${caseId}/${state} button`);
    }
    assert.equal(geometries.idle.card.width, 400, `${caseId} card width must stay fixed`);
    assert.equal(geometries.idle.action.height, 44, `${caseId} OAuth action height must stay fixed`);

    const domPath = path.join(outputDir, `${caseId}.html`);
    writeFileSync(domPath, await page.content(), { mode: 0o600 });

    const startCount = await page.evaluate(
      ({ expectedProvider }) => window.__PT_E2E_INVOCATIONS__.filter(
        (invocation) => invocation.command === 'oauth2_start_loopback'
          && invocation.args?.input?.id === expectedProvider,
      ).length,
      { expectedProvider: provider },
    );
    assert.equal(startCount, 3, `${caseId} must start one attempt per click/retry`);
    assert.deepEqual(pageErrors, [], `${caseId} emitted page errors`);

    return {
      caseId,
      geometries,
      domPath,
      screenshotPaths,
      invocationCount: await page.evaluate(
        () => window.__PT_E2E_INVOCATIONS__.length,
      ),
    };
  } catch (error) {
    await page.screenshot({
      path: path.join(outputDir, `${caseId}-failure.png`),
    }).catch(() => {});
    writeFileSync(
      path.join(outputDir, `${caseId}-failure.html`),
      await page.content().catch(() => ''),
      { mode: 0o600 },
    );
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const serverLogPath = path.join(outputDir, 'vite.log');
  const serverLog = createWriteStream(serverLogPath, { flags: 'w', mode: 0o600 });
  const vite = spawn(
    process.execPath,
    [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: path.join(repoRoot, 'apps/desktop'),
      env: {
        ...process.env,
        VITE_GATEWAY_PORT: '3030',
        VITE_RUNTIME_EVIDENCE_HARNESS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  vite.stdout.pipe(serverLog);
  vite.stderr.pipe(serverLog);

  const browser = await chromium.launch({ headless: true });
  try {
    stage('waiting for exact-source Vite runtime');
    await waitForHttp(endpoint);
    const cases = [];
    for (const viewport of viewports) {
      for (const provider of providers) {
        cases.push(await runCase(browser, endpoint, viewport, provider));
      }
    }

    const assertions = {
      github_and_google_actions_enabled: true,
      oauth_actions_route_to_selected_provider: true,
      oauth_progress_is_inline: true,
      detached_oauth_panel_absent: true,
      oauth_cancel_and_retry_recover_in_place: true,
      oauth_initialization_and_success_render_in_place: true,
      card_geometry_stable_across_oauth_states: true,
      action_geometry_stable_across_oauth_states: true,
      oauth_focus_transfers_and_restores: true,
      dom_and_screenshot_evidence_saved: true,
      no_page_errors: true,
    };
    writeFileSync(
      path.join(outputDir, 'summary.json'),
      `${JSON.stringify({
        assertions,
        endpoint,
        cases,
        artifacts: {
          serverLog: serverLogPath,
          doms: Object.fromEntries(cases.map((item) => [item.caseId, item.domPath])),
          screenshots: Object.fromEntries(
            cases.flatMap((item) => Object.entries(item.screenshotPaths).map(
              ([state, screenshotPath]) => [`${item.caseId}-${state}`, screenshotPath],
            )),
          ),
        },
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    stage('journey complete');
  } finally {
    await browser.close();
    vite.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (vite.exitCode === null) vite.kill('SIGKILL');
        resolve();
      }, 5_000);
      vite.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await new Promise((resolve) => serverLog.end(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
