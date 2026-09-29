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
        case 'oauth2_list_providers':
          return status(command, oauthProviders);
        case 'oauth2_list_connections':
          return status(command, []);
        case 'oauth2_start_loopback':
          return status(command, {
            auth_url: `https://example.invalid/oauth/${args?.input?.id || 'unknown'}`,
            session_id: `session-${args?.input?.id || 'unknown'}`,
          });
        case 'open_external_url':
          return status(command, { ok: true });
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

function rectanglesIntersect(left, right) {
  return (
    Math.max(left.left, right.left) < Math.min(left.right, right.right)
    && Math.max(left.top, right.top) < Math.min(left.bottom, right.bottom)
  );
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
    await providerButton.click();
    const panel = page.locator(
      `[data-pt-login-oauth-panel="${provider}"]`,
    );
    await panel.waitFor();
    await page.waitForTimeout(100);

    const geometry = await page.evaluate(({ expectedProvider }) => {
      const cardElement = document.querySelector('[data-pt-login-card]');
      const panelElement = document.querySelector(
        `[data-pt-login-oauth-panel="${expectedProvider}"]`,
      );
      const buttonElement = document.querySelector(
        `[data-pt-login-oauth-provider="${expectedProvider}"]`,
      );
      if (!cardElement || !panelElement || !buttonElement) return null;
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
        panel: rect(panelElement),
        button: rect(buttonElement),
      };
    }, { expectedProvider: provider });
    assert.ok(geometry, `${caseId} must expose measurable login geometry`);

    const epsilon = 0.5;
    assert.ok(geometry.panel.left >= -epsilon, `${caseId} panel left overflow`);
    assert.ok(geometry.panel.top >= -epsilon, `${caseId} panel top overflow`);
    assert.ok(
      geometry.panel.right <= geometry.viewport.width + epsilon,
      `${caseId} panel right overflow`,
    );
    assert.ok(
      geometry.panel.bottom <= geometry.viewport.height + epsilon,
      `${caseId} panel bottom overflow`,
    );
    assert.equal(
      rectanglesIntersect(geometry.card, geometry.panel),
      false,
      `${caseId} panel must not intersect the login card`,
    );
    assert.ok(
      geometry.button.left >= geometry.card.left - epsilon
        && geometry.button.right <= geometry.card.right + epsilon
        && geometry.button.top >= geometry.card.top - epsilon
        && geometry.button.bottom <= geometry.card.bottom + epsilon,
      `${caseId} OAuth action must remain inside the login card`,
    );
    if (viewport.layout === 'side-by-side') {
      assert.ok(
        geometry.panel.left >= geometry.card.right,
        `${caseId} must keep the wide side-card layout`,
      );
    } else {
      assert.ok(
        geometry.panel.top >= geometry.card.bottom,
        `${caseId} must stack the side card below the login card`,
      );
    }

    const screenshotPath = path.join(outputDir, `${caseId}.png`);
    const domPath = path.join(outputDir, `${caseId}.html`);
    await page.screenshot({ path: screenshotPath });
    writeFileSync(domPath, await page.content(), { mode: 0o600 });

    const startAuth = panel.locator('button.ant-btn-primary');
    await startAuth.click();
    await page.waitForFunction(
      ({ expectedProvider }) => window.__PT_E2E_INVOCATIONS__.some(
        (invocation) => invocation.command === 'oauth2_start_loopback'
          && invocation.args?.input?.id === expectedProvider,
      ),
      { expectedProvider: provider },
    );
    assert.deepEqual(pageErrors, [], `${caseId} emitted page errors`);

    return {
      caseId,
      geometry,
      domPath,
      screenshotPath,
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
      wide_side_card_inside_viewport: true,
      narrow_side_card_inside_viewport: true,
      oauth_panel_never_intersects_login_card: true,
      oauth_actions_never_occluded: true,
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
            cases.map((item) => [item.caseId, item.screenshotPath]),
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
