import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySettingsCapabilities } from './verify-settings-capabilities.mjs';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const target = new URL(process.env.PROTOTYPE_URL ?? 'http://localhost:3210');
const output = resolve(
  repoRoot,
  process.env.PROTOTYPE_EVIDENCE_DIR
    ?? 'apps/mobile/src-tauri/target/prototype-control-audit',
);

assert(
  ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname),
  'Control audit only accepts a local Prototype Portal',
);
await mkdir(output, { recursive: true });

const checks = [];
const screenshots = [];
const pageErrors = [];
const consoleErrors = [];
const consoleWarnings = [];
const onePixelPng = {
  name: 'profile.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
};
const coverPng = {
  name: 'cover.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
    'base64',
  ),
};

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    colorScheme: 'light',
    acceptDownloads: true,
  });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: target.origin,
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (message.text().includes('[antd: List] The `List` component is deprecated')) {
      consoleWarnings.push(message.text());
      return;
    }
    consoleErrors.push(message.text());
  });
  const device = page.getByRole('region', { name: 'Mobile device preview', exact: true });

  async function open(scenario = 'chat-default') {
    target.searchParams.set('scenario', scenario);
    await page.goto(target.href);
    const mobile = page.getByRole('button', { name: 'mobile Mobile Prototypes', exact: true });
    if (await mobile.getAttribute('aria-pressed') !== 'true') await mobile.click();
    await page.getByText('Live Preview', { exact: true }).waitFor();
    await device.waitFor();
  }

  async function record(name, action) {
    await action();
    checks.push(name);
  }

  async function capture(name) {
    const filename = `${name}.png`;
    await device.screenshot({
      path: resolve(output, filename),
      animations: 'disabled',
    });
    screenshots.push(filename);
  }

  async function inspectSurface(name) {
    const minimumTarget = name.startsWith('settings-') ? 40 : 24;
    const result = await device.evaluate((owner, minTarget) => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      };
      const controls = [...owner.querySelectorAll(
        'button, [role="button"], input:not([type="hidden"]), textarea, [role="combobox"]',
      )].filter(visible).map((element) => {
        const rect = element.getBoundingClientRect();
        const label = element.getAttribute('aria-label')
          || element.getAttribute('placeholder')
          || element.getAttribute('title')
          || element.querySelector('[aria-label]')?.getAttribute('aria-label')
          || element.closest('label')?.textContent?.trim()
          || element.textContent?.trim();
        return {
          tag: element.tagName,
          role: element.getAttribute('role'),
          label: label ?? '',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          disabled: 'disabled' in element ? element.disabled : false,
        };
      });
      return {
        overflow: owner.scrollWidth > owner.clientWidth,
        unnamed: controls.filter((control) => !control.label),
        undersized: controls.filter((control) => (
          (control.tag === 'BUTTON' || control.role === 'button')
          && !control.disabled
          && (control.width < minTarget || control.height < minTarget)
        )),
      };
    }, minimumTarget);
    assert.equal(result.overflow, false, `${name}: horizontal overflow`);
    assert.deepEqual(result.unnamed, [], `${name}: unnamed controls`);
    assert.deepEqual(result.undersized, [], `${name}: controls below ${minimumTarget}px`);
    checks.push(`${name}: control naming, target size, overflow`);
  }

  async function goToSettings() {
    await open();
    await device.getByRole('button', { name: 'Me', exact: true }).click();
  }

  async function openSetting(id) {
    await device.locator(`[data-setting-id="${id}"]`).click();
    const detail = device.locator(`[data-setting-detail="${id}"]`);
    await detail.waitFor();
    return detail;
  }

  async function backFromSetting(detail) {
    await detail.getByRole('button', { name: 'Back', exact: true }).click();
    await device.locator('[data-prototype-page="settings"]').waitFor();
  }

  await goToSettings();
  await record('profile identity card account shortcut', async () => {
    assert.equal(await device.getByRole('button', { name: 'Open account settings', exact: true }).count(), 0);
    await device.getByRole('button', { name: 'Edit profile', exact: true }).click();
    assert.equal(await device.locator('[data-setting-detail="account"]').count(), 1);
    await device.getByRole('button', { name: 'Back', exact: true }).click();
  });
  await record('profile sign-out confirmation owns focus and restores its source', async () => {
    const source = device.getByRole('button', { name: 'Sign out and switch Station', exact: true });
    await source.click();
    const dialog = device.getByRole('dialog', { name: 'Sign out and switch Station?', exact: true });
    assert(await dialog.getByRole('button', { name: 'Cancel', exact: true })
      .evaluate((element) => element === document.activeElement));
    assert.equal(await device.locator('.mp-profile-body').getAttribute('inert'), '');
    await page.keyboard.press('Shift+Tab');
    assert(await dialog.evaluate((element) => element.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    assert(await source.evaluate((element) => element === document.activeElement));
  });

  const settingsResult = await verifySettingsCapabilities({
    page,
    device,
    goToSettings,
    openSetting,
    backFromSetting,
    inspectSurface,
    record,
    capture,
    onePixelPng,
    coverPng,
  });

  await record('Settings dark theme preserves controls and geometry', async () => {
    await goToSettings();
    let detail = await openSetting('general');
    await detail.getByRole('button', { name: 'Dark', exact: true }).click();
    await backFromSetting(detail);
    detail = await openSetting('storage');
    await inspectSurface('settings-storage-dark');
    await capture('storage-dark-aligned');
    await backFromSetting(detail);
    detail = await openSetting('general');
    await detail.getByRole('button', { name: 'Light', exact: true }).click();
    await backFromSetting(detail);
  });

  await open('journey');
  await inspectSurface('launch');
  await device.getByRole('button', { name: 'Continue', exact: true }).click();
  await inspectSurface('auth-quick');
  await device.getByRole('button', { name: 'Email Login', exact: true }).click();
  await inspectSurface('auth-email');
  await device.getByPlaceholder('Email address', { exact: true }).fill('alice@peers.social');
  await device.getByPlaceholder('Passport', { exact: true }).fill('1');
  await device.getByRole('button', { name: 'Sign In', exact: true }).click();
  await device.locator('[data-prototype-page="chats"]').waitFor();
  await inspectSurface('chats');
  assert.equal(
    await device.getByPlaceholder('Search people, chats, and messages', { exact: true }).count(),
    0,
  );
  await device.getByRole('button', { name: 'Search chats', exact: true }).click();
  const chatSearch = device.getByPlaceholder('Search people, chats, and messages', { exact: true });
  await chatSearch.fill('Alice');
  await chatSearch.press('Enter');
  assert(await device.locator('[data-chat-search-kind="people"]').isVisible());
  assert(await device.locator('[data-chat-search-kind="conversations"]').isVisible());
  await inspectSurface('chats-search-active');
  await chatSearch.fill('meetup');
  await chatSearch.press('Enter');
  assert(await device.locator('[data-chat-search-kind="messages"]').isVisible());
  await chatSearch.fill('');
  const recentSearches = device.locator('[data-chat-search-history]');
  assert(await recentSearches.isVisible());
  assert.deepEqual(
    await recentSearches.locator('.mp-chat-search-history-query').allTextContents(),
    ['meetup', 'Alice'],
  );
  await recentSearches.getByRole('button', { name: 'Alice', exact: true }).click();
  assert.equal(await chatSearch.inputValue(), 'Alice');
  await chatSearch.fill('');
  assert.deepEqual(
    await recentSearches.locator('.mp-chat-search-history-query').allTextContents(),
    ['Alice', 'meetup'],
  );
  await device.getByRole('button', { name: 'Close search', exact: true }).click();
  await device.getByRole('button', { name: 'Search chats', exact: true }).click();
  assert(await recentSearches.isVisible(), 'Recent searches survive search surface remount');
  await device.getByRole('button', { name: 'Delete recent search: Alice', exact: true }).click();
  assert.deepEqual(
    await recentSearches.locator('.mp-chat-search-history-query').allTextContents(),
    ['meetup'],
  );
  for (let index = 0; index < 11; index += 1) {
    await chatSearch.fill(`query ${index}`);
    await chatSearch.press('Enter');
  }
  await chatSearch.fill('');
  assert.equal(await recentSearches.locator('.mp-chat-search-history-query').count(), 10);
  assert.deepEqual(
    await recentSearches.locator('.mp-chat-search-history-query').allTextContents(),
    Array.from({ length: 10 }, (_, index) => `query ${10 - index}`),
  );
  await recentSearches.getByRole('button', { name: 'Clear all', exact: true }).click();
  assert.equal(await recentSearches.count(), 0);
  assert(await device.getByText('Search across people, conversations, and messages.', { exact: true }).isVisible());
  await chatSearch.fill('meetup');
  assert(await device.locator('[data-chat-search-kind="messages"]').isVisible());
  await device.getByRole('button', { name: 'Close search', exact: true }).click();
  assert.equal(await chatSearch.count(), 0);
  await device.locator('.mp-conversation-item').first().click();
  await inspectSurface('chat-thread');
  await device.getByRole('button', { name: 'More', exact: true }).click();
  await inspectSurface('chat-details');
  await device.getByRole('button', { name: 'Back', exact: true }).click();
  await device.getByRole('button', { name: 'Back', exact: true }).click();
  await device.getByRole('button', { name: 'Contacts', exact: true }).click();
  await inspectSurface('contacts');
  await device.getByRole('button', { name: 'Find People', exact: true }).click();
  await inspectSurface('find-people');
  await page.keyboard.press('Escape');
  await device.getByRole('button', { name: 'Moments', exact: true }).click();
  await inspectSurface('moments');
  await device.getByRole('button', { name: 'Me', exact: true }).click();
  await inspectSurface('profile');

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await page.close();

  const report = {
    evidenceType: 'prototype-only',
    checksPassed: checks.length,
    checks,
    settings: settingsResult,
    screenshots,
    pageErrors,
    consoleErrors,
    consoleWarnings,
    unproven: ['native product runtime', 'physical-device file and camera pickers'],
  };
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    checksPassed: checks.length,
    settingsCapabilities: settingsResult.capabilities.length,
    screenshots: screenshots.length,
    output,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
