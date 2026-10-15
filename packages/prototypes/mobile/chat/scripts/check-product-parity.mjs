/**
 * Whole-product Desktop master -> Mobile semantic parity gate.
 *
 * Pixel identity is intentionally out of scope. The gate compares product
 * anatomy, section ownership, enabled commands, and mobile geometry while each
 * platform keeps its native layout.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyInlineComments } from './verify-inline-comments.mjs';
import { verifySocialInteractions } from './verify-social-interactions.mjs';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const settingsCatalog = JSON.parse(await readFile(
  resolve(repoRoot, 'packages/prototypes/mobile/chat/src/settingsCapabilities.json'),
  'utf8',
));

const mobileUrl = process.env.MOBILE_URL ?? process.env.PROTOTYPE_URL ?? 'http://localhost:3210';
const desktopUrl = process.env.DESKTOP_URL ?? 'http://localhost:3212';
const groups = settingsCatalog.groups.map((group) => group.label);
const socialScopes = ['Home', 'Public', 'Circles'];

for (const value of [mobileUrl, desktopUrl]) {
  const target = new URL(value);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Parity gate only accepts local portals');
}

async function chooseSite(page, site) {
  const button = page.getByRole('button', { name: `${site} ${site === 'mobile' ? 'Mobile' : 'Desktop'} Prototypes`, exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await page.getByText('Live Preview', { exact: true }).waitFor();
}

async function readDesktopSettings() {
  const source = await readFile(
    resolve(repoRoot, 'apps/desktop/src/pages/SettingsPage.tsx'),
    'utf8',
  );
  const sections = Object.fromEntries(settingsCatalog.groups.map((group) => [
    group.label,
    group.sections.map((section) => section.label),
  ]));
  for (const group of settingsCatalog.groups) {
    const ids = group.sections.map((section) => `'${section.id}'`).join(', ');
    assert(
      source.includes(`sectionKeys: [${ids}`),
      `Desktop production Settings group ${group.label} no longer matches the capability catalog`,
    );
  }
  return sections;
}

async function readCrossClientThemeContract() {
  const paths = [
    'packages/prototypes/desktop/shell/src/main.tsx',
    'packages/prototypes/desktop/features/social-chat/src/main.tsx',
  ];
  const [sharedTokens, productionBranding, ...desktopPrototypeSources] = await Promise.all([
    readFile(resolve(repoRoot, 'packages/prototypes/shared/design-tokens/tokens.ts'), 'utf8'),
    readFile(resolve(repoRoot, 'apps/desktop/src/branding.ts'), 'utf8'),
    ...paths.map((path) => readFile(resolve(repoRoot, path), 'utf8')),
  ]);
  assert(sharedTokens.includes("brand: '#667eea'"), 'Shared prototype brand token drifted');
  assert(productionBranding.includes("primary: '#667eea'"), 'Production Desktop brand token drifted');
  for (const [index, source] of desktopPrototypeSources.entries()) {
    assert(source.includes('createAntdTokenTheme'), `${paths[index]} must consume the shared antd theme`);
    assert(source.includes('createDesignTokenCssVariables'), `${paths[index]} must expose shared CSS variables`);
    assert(!source.includes("colorPrimary: '#6b5bd6'"), `${paths[index]} still owns the retired purple seed`);
  }
  for (const path of [
    'packages/prototypes/desktop/shell/src/theme.ts',
    'packages/prototypes/desktop/shell/src/Settings.tsx',
    'packages/prototypes/desktop/shell/src/Notifications.tsx',
    'packages/prototypes/desktop/features/social-chat/src/theme.ts',
    'packages/prototypes/desktop/features/social-chat/src/components/ContactsBook.tsx',
    'packages/prototypes/desktop/features/social-chat/src/components/Avatar.tsx',
    'packages/prototypes/desktop/features/social-chat/src/components/GroupAvatar.tsx',
  ]) {
    const source = await readFile(resolve(repoRoot, path), 'utf8');
    assert(!source.includes('#6b5bd6'), `${path} still contains the retired purple seed`);
  }
  return { brand: '#667eea', consumers: ['desktop-shell', 'desktop-social-chat', 'mobile-shell'] };
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

  const chatSearch = {
    hiddenByDefault: await device.getByPlaceholder(
      'Search people, chats, and messages',
      { exact: true },
    ).count() === 0,
  };
  await device.getByRole('button', { name: 'Search chats', exact: true }).click();
  const unifiedSearch = device.getByPlaceholder(
    'Search people, chats, and messages',
    { exact: true },
  );
  await unifiedSearch.fill('Alice');
  chatSearch.people = await device.locator('[data-chat-search-kind="people"]').count() === 1;
  chatSearch.conversations = await device.locator('[data-chat-search-kind="conversations"]').count() === 1;
  await device.locator('[data-chat-search-kind="people"] button').first().click();
  chatSearch.personOpensConversation = await device.locator('[data-prototype-page="messages"]').count() === 1;
  await device.getByRole('button', { name: 'Back', exact: true }).click();
  chatSearch.returnedQuery = await unifiedSearch.inputValue() === 'Alice';
  await unifiedSearch.fill('meetup');
  chatSearch.messages = await device.locator('[data-chat-search-kind="messages"]').count() === 1;
  await device.getByRole('button', { name: 'Close search', exact: true }).click();
  chatSearch.hiddenAfterClose = await unifiedSearch.count() === 0;

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
  social.workflows = await verifySocialInteractions(page, device);
  await device.getByRole('button', { name: 'Public', exact: true }).click();
  social.publicPosts = await device.locator('[data-social-post]').count();
  social.publicAudienceOnly = await device.locator('[data-social-post] .mp-moment-audience').evaluateAll(
    (elements) => elements.every((element) => element.textContent?.trim() === 'Public'),
  );
  await device.getByRole('button', { name: 'Home', exact: true }).click();
  social.inlineComments = await verifyInlineComments(page, device);
  await device.getByRole('button', { name: 'Open post by Carol Li', exact: true }).click();
  social.detailCount = await device.locator('[data-prototype-page="social-detail"]').count();
  social.commentComposer = await device.getByPlaceholder('Write a comment...', { exact: true }).count();
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
  const renderedCapabilities = {};
  for (const row of settingRows) {
    await device.locator(`[data-setting-id="${row.id}"]`).click();
    const detail = device.locator(`[data-setting-detail="${row.id}"]`);
    assert.equal(await detail.count(), 1, `Mobile setting ${row.id} has no detail route`);
    assert.equal(await detail.getByText(/Configure your .* preferences here\./).count(), 0,
      `Mobile setting ${row.id} uses a generic placeholder`);
    assert(await detail.locator('.mp-setting-section, .mp-account-identity, .mp-about-hero').count() > 0,
      `Mobile setting ${row.id} has no meaningful content section`);
    renderedCapabilities[row.id] = await detail.locator('[data-capability-id]').evaluateAll(
      (elements) => [...new Set(elements.map((element) => element.getAttribute('data-capability-id')).filter(Boolean))],
    );
    await detail.getByRole('button', { name: 'Back', exact: true }).click();
  }

  return {
    auth,
    chatSearch,
    contactCommands,
    group,
    social,
    settings: {
      groups: mobileGroups,
      sections: settingLabels,
      rows: settingRows,
      capabilities: renderedCapabilities,
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
  const desktopSettings = await readDesktopSettings();
  const themeContract = await readCrossClientThemeContract();
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
  assert(Object.values(mobile.chatSearch).every(Boolean), 'Chat search must cover people, conversations, and messages');

  assert.deepEqual(mobile.settings.groups, groups);
  assert.deepEqual(mobile.settings.sections, desktopSettings);
  assert.equal(mobile.settings.rows.length, 19);
  for (const section of settingsCatalog.groups.flatMap((group) => group.sections)) {
    assert(
      mobile.settings.capabilities[section.id]?.length > 0,
      `Mobile setting ${section.id} exposes no capability owners`,
    );
  }
  assert(mobile.settings.rows.every((row) => row.height >= 56), 'Every Mobile setting row must remain touch-safe');
  assert(mobile.settings.rows.every((row) => row.width <= row.ownerWidth + 1), 'Settings rows must not overflow their group');
  assert.equal(mobile.settings.overflow, false);

  assert.deepEqual(mobile.social.scopes, socialScopes);
  assert(mobile.social.homePosts >= 5);
  assert(mobile.social.publicPosts >= 1 && mobile.social.publicAudienceOnly);
  assert.equal(mobile.social.detailCount, 1);
  assert.equal(mobile.social.commentComposer, 1);
  assert(mobile.social.detailTabbarHidden);
  assert(Object.values(mobile.social.inlineComments).every(Boolean));
  assert(Object.values(mobile.social.workflows).every(Boolean));

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
    theme: themeContract,
    desktop: { auth: desktopAuth, settings: desktopSettings },
    mobile,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
