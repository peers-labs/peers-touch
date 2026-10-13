/**
 * Whole-product Desktop master -> Mobile semantic parity gate.
 *
 * Pixel identity is intentionally out of scope. The gate compares product
 * anatomy, section ownership, enabled commands, and mobile geometry while each
 * platform keeps its native layout.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');

const mobileUrl = process.env.MOBILE_URL ?? process.env.PROTOTYPE_URL ?? 'http://localhost:3210';
const desktopUrl = process.env.DESKTOP_URL ?? 'http://localhost:3212';
const groups = ['General', 'Network', 'AI', 'Advanced'];
const socialScopes = ['Home', 'Public', 'Search', 'Circles'];

for (const value of [mobileUrl, desktopUrl]) {
  const target = new URL(value);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Parity gate only accepts local portals');
}

async function chooseSite(page, site) {
  const button = page.getByRole('button', { name: `${site} ${site === 'mobile' ? 'Mobile' : 'Desktop'} Prototypes`, exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await page.getByText('Live Preview', { exact: true }).waitFor();
}

async function readDesktopSettings(page) {
  await page.goto(`${desktopUrl}/`);
  await chooseSite(page, 'desktop');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const groupTabs = page.locator('[role="tablist"][aria-label="Settings groups"] [role="tab"]');
  assert.deepEqual(await groupTabs.allTextContents(), groups);
  const sections = {};
  for (const group of groups) {
    await groupTabs.filter({ hasText: group }).click();
    sections[group] = await page.locator('nav[aria-label="Settings sections"] button').allTextContents();
  }
  return sections;
}

async function readDesktopAuth(page) {
  await page.goto(`${desktopUrl}/?state=auth-oauth-idle`);
  await chooseSite(page, 'desktop');
  const card = page.locator('[data-pt-prototype-login-card]');
  await card.waitFor();
  return {
    cardCount: await card.count(),
    tabs: await card.locator('button').evaluateAll((elements) => elements
      .map((element) => element.textContent?.trim())
      .filter((label) => label === 'Quick Login' || label === 'Email Login')),
    providers: await card.locator('[data-pt-prototype-oauth-provider]').evaluateAll(
      (elements) => elements.map((element) => element.getAttribute('data-pt-prototype-oauth-provider')),
    ),
  };
}

async function readMobile(page) {
  await page.goto(`${mobileUrl}/?scenario=journey`);
  await chooseSite(page, 'mobile');
  const device = page.getByRole('region', { name: 'Mobile device preview', exact: true });
  await device.getByRole('button', { name: 'Continue', exact: true }).click();
  const authCard = device.locator('.mp-auth-card');
  const auth = {
    cardCount: await authCard.count(),
    tabs: await authCard.locator('.mp-auth-tab').allTextContents(),
    providers: await authCard.locator('[data-oauth-provider]').evaluateAll(
      (elements) => elements.map((element) => element.getAttribute('data-oauth-provider')),
    ),
    stationInsideCard: await authCard.locator('.mp-auth-station-summary').count(),
    detachedOverlayCount: await device.locator('.mp-oauth-overlay').count(),
    quickModes: await authCard.locator('.mp-auth-quick-modes button').allTextContents(),
  };
  await authCard.getByRole('button', { name: 'PIN', exact: true }).click();
  auth.pinAvailable = await authCard.getByLabel('Account PIN', { exact: true }).count() === 1
    && await authCard.getByRole('button', { name: 'Unlock', exact: true }).isEnabled();
  await authCard.getByRole('button', { name: 'Accounts', exact: true }).click();
  auth.accountPicker = await authCard.getByRole('button', { name: /Alice Chen/ }).count() === 1
    && await authCard.getByRole('button', { name: /Another account/ }).count() === 1;

  await page.goto(`${mobileUrl}/?scenario=chat-default`);
  await chooseSite(page, 'mobile');
  await device.waitFor();

  await device.getByRole('button', { name: 'Contacts', exact: true }).click();
  const firstContact = device.locator('.mp-contact-item').first();
  const firstContactName = await firstContact.locator('.mp-contact-info .ant-typography').first().innerText();
  await firstContact.click();
  const contactCommands = {};
  for (const command of ['Message', 'Audio', 'Video']) {
    contactCommands[command] = await device.getByRole('button', { name: command, exact: true }).isEnabled();
  }
  await device.getByRole('button', { name: 'Audio', exact: true }).click();
  contactCommands.callLaunched = await device.locator('[data-prototype-call-state="outgoing"]').count() === 1;
  await device.getByRole('button', { name: 'Cancel', exact: true }).click();
  await device.getByRole('button', { name: 'Close', exact: true }).click();
  await device.getByRole('button', { name: 'Safety Number', exact: true }).click();
  contactCommands.safetyNumberVisible = await device.locator('.mp-safety-number-value').isVisible();
  await device.getByRole('button', { name: 'Block Contact', exact: true }).click();
  contactCommands.blockToggled = await device.getByRole('button', { name: 'Unblock Contact', exact: true }).isVisible();
  await device.getByRole('button', { name: 'Back', exact: true }).click();
  await device.locator('.mp-contact-item').filter({ hasText: firstContactName }).click();
  contactCommands.blockPersisted = await device.getByRole('button', { name: 'Unblock Contact', exact: true }).isVisible();
  await device.getByRole('button', { name: 'Remove Contact', exact: true }).click();
  await device.getByRole('button', { name: 'Remove', exact: true }).click();
  contactCommands.removePersisted = await device.locator('.mp-contact-item').filter({ hasText: firstContactName }).count() === 0;
  await device.locator('.mp-group-item').first().click();
  const group = {
    openChatEnabled: await device.getByRole('button', { name: 'Message', exact: true }).isEnabled(),
    adminSection: await device.getByText('Group administration', { exact: true }).count(),
    moderationCommands: (await device.locator('.mp-group-admin-actions button').allTextContents())
      .map((label) => label.trim()),
    ownerAction: await device.getByRole('button', { name: 'Dissolve Group', exact: true }).count(),
    transferAction: await device.getByRole('button', { name: 'Transfer ownership', exact: true }).count(),
  };
  await device.locator('.mp-member-item').first().click();
  await device.getByRole('button', { name: 'Transfer ownership', exact: true }).click();
  group.transferOutcome = await device.getByText(/Ownership transfer to .* is ready for confirmation/).count();
  await device.getByRole('button', { name: 'Back', exact: true }).click();

  await device.getByRole('button', { name: 'Moments', exact: true }).click();
  const social = {
    scopes: await device.locator('.mp-social-scope button').allTextContents(),
    homePosts: await device.locator('[data-social-post]').count(),
  };
  await device.getByRole('button', { name: 'Public', exact: true }).click();
  social.publicPosts = await device.locator('[data-social-post]').count();
  social.publicAudienceOnly = await device.locator('[data-social-post] .mp-moment-audience').evaluateAll(
    (elements) => elements.every((element) => element.textContent?.trim() === 'Public'),
  );
  await device.getByRole('button', { name: 'Home', exact: true }).click();
  await device.getByRole('button', { name: 'Open post by Carol Li', exact: true }).click();
  social.detailCount = await device.locator('[data-prototype-page="social-detail"]').count();
  social.commentComposer = await device.getByPlaceholder('Add a comment...', { exact: true }).count();
  social.detailTabbarHidden = await device.locator('.mp-tabbar').count() === 0;
  await device.getByRole('button', { name: 'Back', exact: true }).click();

  await device.getByRole('button', { name: 'Me', exact: true }).click();
  const mobileGroups = await device.locator('.mp-settings-group-title').allTextContents();
  const settingLabels = {};
  for (const group of groups) {
    settingLabels[group] = await device.locator(`[data-settings-group="${group.toLowerCase()}"] [data-setting-id] .mp-setting-label`).allTextContents();
  }
  const settingRows = await device.locator('[data-setting-id]').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      id: element.getAttribute('data-setting-id'),
      height: Math.round(rect.height),
      width: Math.round(rect.width),
      ownerWidth: Math.round(element.parentElement?.getBoundingClientRect().width ?? 0),
    };
  }));
  const exercisedSettings = [];

  for (const row of settingRows) {
    await device.locator(`[data-setting-id="${row.id}"]`).click();
    const detail = device.locator(`[data-setting-detail="${row.id}"]`);
    assert.equal(await detail.count(), 1, `Mobile setting ${row.id} has no detail route`);
    assert.equal(await detail.getByText(/Configure your .* preferences here\./).count(), 0,
      `Mobile setting ${row.id} uses a generic placeholder`);
    assert(await detail.locator('.mp-setting-section, .mp-account-identity, .mp-about-hero').count() > 0,
      `Mobile setting ${row.id} has no meaningful content section`);
    if (row.id === 'account') {
      await detail.getByRole('button', { name: 'Edit', exact: true }).click();
      await detail.getByRole('textbox', { name: 'Display name', exact: true }).fill('Alice Review');
      assert(await detail.getByText('Alice Review', { exact: true }).isVisible());
      exercisedSettings.push('account-edit');
    } else if (row.id === 'privacy') {
      await detail.getByRole('button', { name: 'Change PIN', exact: true }).click();
      await detail.getByLabel('New PIN', { exact: true }).fill('2468');
      await detail.getByRole('button', { name: 'Save PIN', exact: true }).click();
      assert(await detail.getByText('PIN updated on this device.', { exact: true }).isVisible());
      exercisedSettings.push('pin-change');
    } else if (row.id === 'station') {
      await detail.getByRole('button', { name: 'Remove', exact: true }).click();
      assert.equal(await detail.getByText('MacBook Pro', { exact: true }).count(), 0);
      exercisedSettings.push('device-remove');
    } else if (row.id === 'providers') {
      await detail.getByRole('button', { name: 'Add provider', exact: true }).click();
      assert(await detail.getByText('Custom endpoint', { exact: true }).isVisible());
      exercisedSettings.push('provider-add');
    } else if (row.id === 'memory') {
      await detail.getByRole('button', { name: 'Review 3', exact: true }).click();
      await detail.getByRole('button', { name: 'Remove Prefers concise answers', exact: true }).click();
      assert(await detail.getByRole('button', { name: 'Review 2', exact: true }).isVisible());
      exercisedSettings.push('memory-remove');
    } else if (row.id === 'storage') {
      await detail.getByRole('button', { name: 'Clear cache · 204 MB', exact: true }).click();
      assert(await detail.getByRole('button', { name: 'Cache cleared', exact: true }).isDisabled());
      exercisedSettings.push('cache-clear');
    } else if (row.id === 'cron') {
      await detail.getByRole('button', { name: 'New task', exact: true }).click();
      assert(await detail.getByText('Monthly archive', { exact: true }).isVisible());
      exercisedSettings.push('schedule-create');
    } else if (row.id === 'command-menu') {
      await detail.getByRole('button', { name: 'Open Command Palette', exact: true }).click();
      const palette = detail.getByRole('dialog', { name: 'Command Palette', exact: true });
      await palette.getByRole('button', { name: 'Open Chats', exact: true }).click();
      assert(await detail.getByText('Open Chats selected', { exact: true }).isVisible());
      exercisedSettings.push('command-run');
    }
    await detail.getByRole('button', { name: 'Back', exact: true }).click();
  }

  return {
    auth,
    contactCommands,
    group,
    social,
    settings: {
      groups: mobileGroups,
      sections: settingLabels,
      rows: settingRows,
      exercised: exercisedSettings,
      overflow: await device.evaluate((element) => element.scrollWidth > element.clientWidth),
    },
  };
}

const browser = await chromium.launch({ headless: true });
try {
  const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const mobilePage = await browser.newPage({ viewport: { width: 430, height: 932 }, colorScheme: 'light' });
  const errors = [];
  for (const page of [desktopPage, mobilePage]) {
    page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`));
  }

  const desktopAuth = await readDesktopAuth(desktopPage);
  const desktopSettings = await readDesktopSettings(desktopPage);
  const mobile = await readMobile(mobilePage);

  assert.equal(desktopAuth.cardCount, 1);
  assert.equal(mobile.auth.cardCount, 1);
  assert.deepEqual(mobile.auth.tabs, ['Quick Login', 'Email Login']);
  assert.deepEqual(mobile.auth.tabs, desktopAuth.tabs);
  assert.deepEqual(desktopAuth.providers, ['github', 'google']);
  assert.deepEqual(mobile.auth.providers, desktopAuth.providers);
  assert.equal(mobile.auth.stationInsideCard, 1);
  assert.equal(mobile.auth.detachedOverlayCount, 0);
  assert.deepEqual(mobile.auth.quickModes, ['OAuth', 'PIN', 'Accounts']);
  assert(mobile.auth.pinAvailable && mobile.auth.accountPicker);

  assert.deepEqual(mobile.settings.groups, groups);
  assert.deepEqual(mobile.settings.sections, desktopSettings);
  assert.equal(mobile.settings.rows.length, 20);
  assert.deepEqual(mobile.settings.exercised, [
    'account-edit',
    'pin-change',
    'device-remove',
    'provider-add',
    'memory-remove',
    'cache-clear',
    'schedule-create',
    'command-run',
  ]);
  assert(mobile.settings.rows.every((row) => row.height >= 56), 'Every Mobile setting row must remain touch-safe');
  assert(mobile.settings.rows.every((row) => row.width <= row.ownerWidth + 1), 'Settings rows must not overflow their group');
  assert.equal(mobile.settings.overflow, false);

  assert.deepEqual(mobile.social.scopes, socialScopes);
  assert(mobile.social.homePosts >= 5);
  assert(mobile.social.publicPosts >= 1 && mobile.social.publicAudienceOnly);
  assert.equal(mobile.social.detailCount, 1);
  assert.equal(mobile.social.commentComposer, 1);
  assert(mobile.social.detailTabbarHidden);

  assert(Object.values(mobile.contactCommands).every(Boolean), 'Contact detail commands must be operational');
  assert(mobile.group.openChatEnabled);
  assert.equal(mobile.group.adminSection, 1);
  assert.deepEqual(mobile.group.moderationCommands, ['Mute', 'Promote', 'Remove']);
  assert.equal(mobile.group.ownerAction, 1);
  assert.equal(mobile.group.transferAction, 1);
  assert.equal(mobile.group.transferOutcome, 1);
  assert.deepEqual(errors, []);

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    desktop: { auth: desktopAuth, settings: desktopSettings },
    mobile,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
