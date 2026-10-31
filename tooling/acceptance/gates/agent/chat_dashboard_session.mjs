import assert from 'node:assert/strict';
import fs from 'node:fs';
import readline from 'node:readline';
import { createRequire } from 'node:module';

const root = fs.realpathSync(new URL('../../../../', import.meta.url));
const require = createRequire(`${root}/apps/desktop/package.json`);
const { chromium, expect } = require('@playwright/test');
const labels = JSON.parse(fs.readFileSync(`${root}/packages/locales/en/dashboard.json`));
const t = key => key.split('.').reduce((value, part) => value[part], labels);
let browser, page, stationUrl, token;

async function api(route, body = {}) {
  const response = await page.request.post(`${stationUrl}/dashboard/api/ai/${route}`, {
    headers: { Authorization: `Bearer ${token}` }, data: body,
  });
  assert(response.ok(), `Dashboard ${route} returned ${response.status()}`);
  return response.json();
}
async function mutation(route, operation) {
  const pending = page.waitForResponse(r => r.url().endsWith(`/ai/${route}`));
  await operation();
  const response = await pending;
  assert(response.ok(), `Dashboard ${route} returned ${response.status()}`);
  return response.json();
}
async function choose(label, value) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.locator('.ant-select-dropdown:visible').getByText(value, { exact: true }).click();
  await page.keyboard.press('Escape');
}
async function advanced() {
  const header = page.locator('.ant-collapse-header').filter({ hasText: t('ai.advancedConfiguration') });
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click();
}
async function select(providerId) {
  const provider = (await api('provider/get', { provider_id: providerId })).provider;
  const method = provider.runtime_kind === 'cli' ? 'ai.cliMethod' : 'ai.dmMethod';
  await page.getByText(t(method), { exact: true }).click();
  await page.locator('.ai-provider-option').filter({ hasText: provider.name }).click();
  await page.getByRole('heading', { name: provider.name, exact: true }).waitFor();
  return provider;
}
async function configure() {
  const catalog = (await api('provider/list')).providers;
  assert(catalog.some(p => p.runtime_kind !== 'cli') && catalog.some(p => p.runtime_kind === 'cli'));
  await page.getByText(t('ai.dmMethod'), { exact: true }).click();
  await expect(page.locator('.ai-provider-editor input#base_url')).toBeVisible();
  await expect(page.getByRole('heading', { name: t('ai.cliInstallation'), exact: true })).toHaveCount(0);
  const cli = catalog.find(p => p.id === 'trae-cli');
  assert(cli, 'Registered TRAE adapter is absent');
  await select(cli.id);
  await expect(page.getByRole('heading', { name: t('ai.cliInstallation'), exact: true })).toBeVisible();
  await expect(page.locator('.ai-provider-editor input#base_url')).toHaveCount(0);
  await advanced();
  const detail = (await api('provider/get', { provider_id: cli.id })).provider;
  if (detail.adapter_capabilities.startup_args) await expect(page.locator('textarea#startup_args')).toBeVisible();
  if (detail.adapter_capabilities.environment) await expect(page.locator('textarea#environment')).toBeVisible();
  await expect(page.locator('input#command, textarea#command')).toHaveCount(0);
  await expect(page.getByRole('button', { name: t('ai.addModel'), exact: true })).toHaveCount(0);
  return { cliProviderId: cli.id };
}
async function createDirect(input) {
  await page.getByText(t('ai.dmMethod'), { exact: true }).click();
  await page.getByRole('button', { name: t('ai.addProvider'), exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const [field, value] of Object.entries({
    provider_id: input.providerId, display_name: input.name, base_url: input.endpoint,
  })) await dialog.locator(`input#${field}`).fill(value);
  await mutation('provider/create', () => dialog.getByRole('button', { name: 'OK', exact: true }).click());
  await page.getByRole('heading', { name: input.name, exact: true }).waitFor();
  await page.getByLabel(t('ai.apiKey'), { exact: true }).fill(input.key);
  await mutation('credential/set', () => page.getByRole('button', { name: t('ai.saveCredential'), exact: true }).click());
  await expect(page.getByLabel(t('ai.apiKey'), { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: t('ai.addModel'), exact: true }).click();
  await dialog.locator('input#id').fill(input.modelId);
  await dialog.locator('input#display_name').fill(input.modelName);
  await dialog.locator('input#context_window').fill('8192');
  await dialog.getByLabel(t('ai.flags.streaming'), { exact: true }).check();
  await mutation('model/create', () => dialog.getByRole('button', { name: 'OK', exact: true }).click());
  await page.getByRole('button', { name: t('ai.addGrant'), exact: true }).click();
  await choose(t('ai.grantUsers').replace('{{index}}', '1'), t('ai.specificUser'));
  const directory = await (await page.request.get(`${stationUrl}/dashboard/api/actors?page=1&page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  const actor = directory.items.find(value => value.ptid === input.actorPTID);
  assert(actor, 'Suite actor is absent');
  await choose(t('ai.grantActor').replace('{{index}}', '1'), actor.name || actor.preferred_username);
  await choose(t('ai.grantModels').replace('{{index}}', '1'), input.modelName);
  await mutation('access/set', () => page.locator('.ai-provider-editor')
    .getByRole('button', { name: t('ai.saveAccess'), exact: true }).click());
  return { providerId: input.providerId, credentialWriteOnly: true };
}
async function discovery({ providerId }) {
  const before = await select(providerId);
  assert(before.install_state === 'ready', 'CLI fixture is not installed');
  const defaults = before.default_runtime_config;
  await advanced();
  for (const [field, value] of Object.entries({
    startup_args: JSON.stringify(defaults.startup_args),
    environment: JSON.stringify(defaults.environment, null, 2),
    timeout_seconds: String(defaults.timeout_seconds),
  })) {
    const control = page.locator(`#${field}`);
    if (await control.count()) await control.fill(value);
  }
  await mutation('provider/update', () => page.getByRole('button', { name: t('ai.saveConfiguration'), exact: true }).click());
  await mutation('model/discover', () => page.getByRole('button', { name: t('ai.discoverModels'), exact: true }).click());
  const provider = (await api('provider/get', { provider_id: providerId })).provider;
  assert(provider.models.length, 'CLI discovery returned no models');
  await expect(page.locator('.ai-model-row')).toHaveCount(provider.models.length);
  await expect(page.locator('.ai-model-row button, .ai-model-row input')).toHaveCount(0);
  return { providerId, ready: true, modelIds: provider.models.map(m => m.id) };
}
async function availability({ providerId, modelName, enabled }) {
  await select(providerId);
  if (modelName) {
    await mutation('model/update', () => page.getByRole('switch', {
      name: t('ai.enableModel').replace('{{name}}', modelName), exact: true,
    }).click());
  } else {
    const control = page.locator('.ai-provider-editor').getByRole('switch').first();
    assert((await control.getAttribute('aria-checked')) !== String(enabled));
    await control.click();
    await mutation('provider/update', () => page.getByRole('button', {
      name: t('ai.saveConfiguration'), exact: true,
    }).click());
  }
  return { enabled };
}

const commands = readline.createInterface({ input: process.stdin });
try {
  for await (const line of commands) {
    const { action, payload } = JSON.parse(line);
    try {
      let value;
      if (action === 'start') {
        stationUrl = payload.stationUrl;
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.setDefaultTimeout(15000);
        const version = await (await page.request.get(`${stationUrl}/app-meta/version`)).json();
        assert(version.build_commit === payload.sourceCommit, 'Dashboard source identity differs');
        await page.goto(`${stationUrl}/dashboard/`);
        await page.getByLabel('Username', { exact: true }).fill(payload.username);
        await page.getByLabel('Password', { exact: true }).fill(payload.password);
        const loggedIn = page.waitForResponse(r => r.url().endsWith('/auth/login') && r.ok());
        await page.getByRole('button', { name: 'Sign In', exact: true }).click();
        token = (await (await loggedIn).json()).token;
        await page.goto(`${stationUrl}/dashboard/#/ai`);
        await page.getByRole('heading', { name: t('ai.title'), exact: true }).waitFor();
        value = { sourceCommit: version.build_commit };
      } else if (action === 'api') value = await api(payload.route, payload.body);
      else if (action === 'configuration') value = await configure();
      else if (action === 'create-direct') value = await createDirect(payload);
      else if (action === 'discovery') value = await discovery(payload);
      else if (action === 'availability') value = await availability(payload);
      else if (action === 'stop') {
        await browser?.close();
        browser = null;
        console.log(JSON.stringify({ ok: true, value: { stopped: true } }));
        break;
      } else throw new Error('Unknown Dashboard action');
      console.log(JSON.stringify({ ok: true, value }));
    } catch {
      // Neither Playwright input dumps nor vendor errors enter evidence.
      console.log(JSON.stringify({ ok: false, error: `Dashboard ${action} failed` }));
    }
  }
} finally {
  await browser?.close();
}
