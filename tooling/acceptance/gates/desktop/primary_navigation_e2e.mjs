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
const outputDir = path.resolve(process.argv[2] || path.join(repoRoot, '.tmp-primary-navigation-e2e'));
const require = createRequire(path.join(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');

function stage(message) {
  console.error(`[desktop-primary-navigation-e2e] ${message}`);
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
      // The Vite process has not opened its socket yet.
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
  const namespaces = entries.map(([namespace]) => namespace);
  return {
    languages: [{
      code: 'en',
      name: 'English',
      native_name: 'English',
      namespaces,
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
    const agent = {
      id: 'agent-assistant',
      name: 'assistant',
      title: 'Peers Touch',
      description: 'Desktop acceptance agent',
      avatar: '',
      openingMessage: 'How can I help?',
      openingQuestions: '[]',
      chatConfig: JSON.stringify({ memory: { enabled: true } }),
      systemPrompt: 'You are a helpful assistant.',
      pinned: false,
      favorite: false,
    };
    const files = [
      {
        id: 'file-live',
        key: 'attachments/navigation-live.txt',
        name: 'navigation-live.txt',
        size: 128,
        mime: 'text/plain',
        backend: 'local',
        bucket_id: 'attachments',
        owner_actor_ptid: 'ptid:acceptance-navigation',
        visibility: 'private',
        created_at: '2026-09-28T00:00:00.000Z',
        updated_at: '2026-09-28T00:00:00.000Z',
      },
      {
        id: 'file-deleted',
        key: 'archive/navigation-deleted.txt',
        name: 'navigation-deleted.txt',
        size: 256,
        mime: 'text/plain',
        backend: 'local',
        bucket_id: 'archive',
        owner_actor_ptid: 'ptid:acceptance-navigation',
        visibility: 'private',
        deleted_at: '2026-09-28T00:00:00.000Z',
        created_at: '2026-09-27T00:00:00.000Z',
        updated_at: '2026-09-28T00:00:00.000Z',
      },
    ];
    const cronJobs = [{
      id: 'cron-navigation-proof',
      name: 'Navigation proof',
      description: 'Acceptance fixture',
      enabled: true,
      scheduleKind: 'interval',
      cronExpr: '',
      intervalSec: 3600,
      runAt: '',
      timezone: 'UTC',
      execKind: 'agent',
      shellCmd: '',
      agentPrompt: 'Verify navigation',
      agentName: 'assistant',
      modelOverride: '',
      timeoutSec: 60,
      deleteAfterRun: false,
      nextRunAt: '2026-09-29T00:00:00.000Z',
      lastRunAt: '2026-09-28T00:00:00.000Z',
      lastStatus: 'ok',
      lastError: '',
      lastDurationMs: 120,
      consecErrors: 0,
      deliveryMode: '',
      deliveryChannelId: '',
      deliveryTargetId: '',
      deliveryTargetType: '',
      failureChannelId: '',
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z',
    }];
    const channels = [{
      id: 'channel-navigation-proof',
      name: 'Navigation Proof Channel',
      type: 'webhook',
      enabled: true,
      config: JSON.stringify({ url: 'https://example.invalid/hook' }),
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z',
    }];
    const mockInvoke = async (command) => {
      invocations.push(command);
      switch (command) {
        case 'plugin:event|listen':
          return 1;
        case 'plugin:event|unlisten':
          return null;
        case 'i18n_load_resources':
          return { ok: true, data: localeResources };
        case 'auth_restore_session':
          return {
            ok: true,
            data: {
              command,
              status: '',
              actor_ptid: 'ptid:acceptance-navigation',
              name: 'Navigation Acceptance',
              email: 'navigation@acceptance.invalid',
              login_method: 'password',
            },
          };
        case 'auth_validate_token':
          return {
            ok: true,
            data: {
              command,
              status: '',
              actor_ptid: 'ptid:acceptance-navigation',
              name: 'Navigation Acceptance',
              email: 'navigation@acceptance.invalid',
              login_method: 'password',
            },
          };
        case 'ensure_station_session':
          return { ok: true, data: { command, status: '' } };
        case 'account_list_restorable':
          return status(command, {
            accounts: [{
              id: 'acceptance-navigation',
              name: 'Navigation Acceptance',
              email: 'navigation@acceptance.invalid',
              provider: 'local',
              has_pin: false,
              has_session: true,
            }],
          });
        case 'account_get_active':
          return status(command, {
            account: {
              id: 'acceptance-navigation',
              name: 'Navigation Acceptance',
              email: 'navigation@acceptance.invalid',
              provider: 'local',
              has_pin: false,
              has_session: true,
            },
          });
        case 'sync_user_profile':
          return {
            ok: true,
            data: {
              command,
              status: JSON.stringify({
                name: 'Navigation Acceptance',
                email: 'navigation@acceptance.invalid',
                avatar_url: '',
              }),
            },
          };
        case 'agent_list':
          return { ok: true, data: [agent] };
        case 'agent_get':
          return { ok: true, data: agent };
        case 'agent_get_selected':
          return { ok: true, data: 'assistant' };
        case 'agent_set_selected':
          return { ok: true, data: null };
        case 'model_list_available':
          return { ok: true, data: [] };
        case 'chat_list_sessions':
        case 'agent_topic_list':
        case 'applet_list':
        case 'notification_list':
        case 'provider_list':
        case 'mcp_list_servers':
        case 'skill_list':
          return { ok: true, data: [] };
        case 'oauth2_list_connections':
          return status(command, []);
        case 'search_sources':
          return status(command, { sources: [] });
        case 'applets_store_list_catalog':
          return status(command, { items: [], total: 0 });
        case 'applets_store_list_installed':
          return status(command, { states: [] });
        case 'applets_create_session':
          return status(command, {
            ok: true,
            appletId: 'peers.note',
            sessionId: 'desktop-session-peers-note',
          });
        case 'applets_invoke':
          return status(command, { ok: true });
        case 'applets_product_window_report_rendered':
        case 'applets_product_window_report_lifecycle':
          return status(command, { recorded: true });
        case 'applets_product_window_launch_context':
        case 'applets_readiness_probe_context':
          return status(command, { enabled: false });
        case 'oss_list_my_files':
          return status(command, { files, total: files.length, page: 1, page_size: 20 });
        case 'cron_list_jobs':
          return status(command, { jobs: cronJobs });
        case 'channels_list':
          return status(command, { channels });
        case 'context_snapshot_get':
        case 'context_action_dispatch':
        case 'preference_get':
        case 'preference_set':
        case 'realtime_stream_start':
        case 'realtime_stream_stop':
          return { ok: true, data: null };
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installMockTauri(context, loadEnglishResources());

  const assertions = {};
  try {
    stage('waiting for Vite');
    await waitForHttp(endpoint);
    stage('opening legacy Notes route');
    await page.goto(`${endpoint}/#/notes/legacy-document`, {
      waitUntil: 'domcontentloaded',
    });
    const accountChoice = page.locator('button').filter({
      hasText: 'Navigation Acceptance',
    });
    if (await accountChoice.waitFor({ timeout: 15_000 }).then(
      () => true,
      () => false,
    )) {
      stage('selecting restorable account');
      await accountChoice.click();
    }
    await page.locator('[data-pt-primary-nav="settings"]').waitFor({ timeout: 30_000 });

    const removedPrimaryEntries = ['notes', 'oss', 'cron', 'channels'];
    for (const entry of removedPrimaryEntries) {
      assert.equal(
        await page.locator(`[data-pt-primary-nav="${entry}"]`).count(),
        0,
        `${entry} must not appear in primary navigation`,
      );
    }
    assert.equal(
      await page.locator('button[title^="Command palette"]').count(),
      0,
      'Command Palette must not appear in primary navigation',
    );
    assertions.primary_navigation_clean = true;

    await page.locator('[data-page="search"]').waitFor();
    assert.equal(await page.locator('[data-page^="applet:"]').count(), 0);
    assertions.notes_route_falls_back_without_applet_redirect = true;

    stage('launching the official Note applet');
    await page.locator('[data-pt-primary-nav="applets"]').click();
    await page.locator('[data-applet-open="peers.note"]').waitFor();
    await page.locator('[data-applet-open="peers.note"]').click();
    await page.locator('[data-applet-container-shell="peers.note"]').waitFor();
    await page.waitForFunction(
      () => window.__PT_E2E_INVOCATIONS__.includes('applets_create_session'),
    );
    assert.equal(new URL(page.url()).hash, '#/applet:peers.note');
    assertions.official_note_applet_launchable = true;

    stage('opening Settings tools');
    await page.locator('[data-pt-primary-nav="settings"]').click();
    await page.locator('[data-page="settings"]').waitFor();

    await page.locator('[data-pt-secondary-tab="tools"]').click();
    await page.locator('[data-pt-section-item="cron"]').click();
    const cronSection = page.locator('[data-pt-section-host="cron"]');
    await cronSection.waitFor();
    await cronSection.getByText('Navigation proof', { exact: true }).waitFor();
    await cronSection.getByRole('button', { name: 'Refresh' }).waitFor();
    await cronSection.getByRole('button', { name: 'New Job' }).waitFor();
    const cronCountAfterMount = await page.evaluate(
      () => window.__PT_E2E_INVOCATIONS__.filter((command) => command === 'cron_list_jobs').length,
    );
    assert.ok(cronCountAfterMount >= 1);
    assertions.cron_jobs_controls_available_in_settings = true;

    stage('proving selected-only Cron lifecycle');
    await page.locator('[data-pt-section-item="command-menu"]').click();
    await page.locator('[data-pt-section-host="command-menu"]').waitFor();
    assert.equal(await page.locator('[data-pt-section-host="cron"]').count(), 0);
    await page.waitForTimeout(15_500);
    const cronCountAfterHiddenInterval = await page.evaluate(
      () => window.__PT_E2E_INVOCATIONS__.filter((command) => command === 'cron_list_jobs').length,
    );
    assert.equal(cronCountAfterHiddenInterval, cronCountAfterMount);
    assertions.selected_only_stops_hidden_cron_polling = true;

    stage('proving canonical Command Palette');
    await page.locator('[data-pt-settings-command-palette-open]').click();
    await page.locator('.command-menu-modal').waitFor();
    assert.equal(await page.locator('.command-menu-modal').count(), 1);
    await page.keyboard.press('Escape');
    await page.locator('.command-menu-modal').waitFor({ state: 'detached' });
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'k',
        metaKey: true,
      }));
    });
    await page.locator('.command-menu-modal').waitFor();
    assert.equal(await page.locator('.command-menu-modal').count(), 1);
    assertions.command_palette_uses_one_global_overlay = true;

    stage('opening My Files');
    await page.keyboard.press('Escape');
    await page.locator('[data-pt-secondary-tab="data"]').click();
    await page.locator('[data-pt-section-item="oss"]').click();
    const myFilesSection = page.locator('[data-pt-section-host="oss"]');
    await myFilesSection.waitFor();
    await myFilesSection.getByText('navigation-live.txt', { exact: true }).waitFor();
    await myFilesSection.getByText('navigation-deleted.txt', { exact: true }).waitFor();
    await myFilesSection.getByRole('button', { name: 'Upload' }).waitFor();
    await myFilesSection.getByRole('button', { name: 'Refresh' }).waitFor();
    await myFilesSection.getByRole('button', { name: 'Edit' }).waitFor();
    await myFilesSection.getByRole('button', { name: 'Delete' }).waitFor();
    await myFilesSection.getByRole('button', { name: 'Restore' }).waitFor();
    await myFilesSection.getByText('Bucket name', { exact: true }).waitFor();
    await myFilesSection.getByText('MIME prefix', { exact: true }).waitFor();
    await myFilesSection.getByText('Include deleted', { exact: true }).waitFor();
    assertions.my_files_controls_available_in_settings = true;

    stage('opening Channels');
    await page.locator('[data-pt-secondary-tab="channels"]').click();
    const channelsSection = page.locator('[data-pt-section-host="channels"]');
    await channelsSection.waitFor();
    await channelsSection.getByText('Navigation Proof Channel', { exact: true }).waitFor();
    await channelsSection.getByRole('button', { name: 'Refresh' }).waitFor();
    await channelsSection.getByRole('button', { name: 'Add Channel' }).waitFor();
    assert.equal(await channelsSection.locator('.ant-switch').count(), 1);
    assert.ok(await channelsSection.locator('button').count() >= 5);
    assertions.channel_management_controls_available_in_settings = true;

    assert.deepEqual(pageErrors, []);
    assertions.no_page_errors = true;

    const screenshotPath = path.join(outputDir, 'desktop-settings-channels.png');
    const domPath = path.join(outputDir, 'desktop-settings-channels.html');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    writeFileSync(domPath, await page.content(), { mode: 0o600 });
    const summary = {
      assertions,
      endpoint,
      artifacts: {
        dom: domPath,
        screenshot: screenshotPath,
        serverLog: serverLogPath,
      },
      invocationCounts: await page.evaluate(() => Object.fromEntries(
        [...new Set(window.__PT_E2E_INVOCATIONS__)].map((command) => [
          command,
          window.__PT_E2E_INVOCATIONS__.filter((value) => value === command).length,
        ]),
      )),
    };
    writeFileSync(
      path.join(outputDir, 'summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
      { mode: 0o600 },
    );
    stage('journey complete');
  } catch (error) {
    await page.screenshot({
      path: path.join(outputDir, 'failure.png'),
      fullPage: true,
    }).catch(() => {});
    writeFileSync(
      path.join(outputDir, 'failure.html'),
      await page.content().catch(() => ''),
      { mode: 0o600 },
    );
    throw error;
  } finally {
    await context.close();
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
