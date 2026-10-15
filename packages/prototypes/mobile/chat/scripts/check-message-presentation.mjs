import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyInlineComments } from './verify-inline-comments.mjs';
import {
  verifyChatInteractions,
  verifyMobileTransientLayers,
} from './verify-chat-interactions.mjs';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(root, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const url = process.env.PROTOTYPE_URL ?? 'http://localhost:3210';
const output = resolve(root, process.env.PROTOTYPE_EVIDENCE_DIR ?? 'reports/chat-message-presentation-20261014');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
const errors = [];
const longName = 'Emma Wang · International Product Architecture Working Group';
const fixture = [
  { id: 'peer-a', sender: 'user-1', text: 'The release notes are ready.', minute: 0 },
  { id: 'peer-a2', sender: 'user-1', text: 'I will share them after review.', minute: 1 },
  { id: 'peer-b', sender: 'user-3', text: 'I am reviewing the final changes.', minute: 2 },
  { id: 'own-a', sender: 'user-self', text: 'Thanks. Keep the gate closed.', minute: 3 },
  { id: 'own-a2', sender: 'user-self', text: 'I will confirm once recovery is verified.', minute: 4 },
  { id: 'event', sender: 'system', text: 'Today', minute: 5 },
  { id: 'peer-b2', sender: 'user-3', text: 'The follow-up review is complete.', minute: 6 },
  { id: 'peer-gap', sender: 'user-3', text: 'A later update starts a new cluster.', minute: 12 },
  { id: 'peer-gap2', sender: 'user-3', text: 'This update belongs to the same cluster.', minute: 13 },
  { id: 'unknown-a', sender: '', text: 'An unresolved author must stay unresolved.', minute: 14 },
  { id: 'unknown-b', sender: '', text: 'Unresolved authors must not be merged.', minute: 15 },
];
const sender = (id) => id === 'user-1'
  ? { id, name: 'Sarah Kim', avatar: 'SK' }
  : id === 'user-3' ? { id, name: longName, avatar: 'EW' } : undefined;

// Fixtures enter at the public prototype data module, before the UI mounts.
// No framework internals, callbacks, or DOM modifications are used.
async function withFixtures(page, platform) {
  const path = platform === 'mobile' ? '**/mobile/chat/src/data.ts*' : '**/social-chat/src/mock.ts*';
  await page.route(path, async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    if (platform === 'mobile') {
      const messages = fixture.map((item) => ({
        id: item.id, mine: item.sender === 'user-self', sender: sender(item.sender),
        text: item.text, time: `10:${String(item.minute).padStart(2, '0')}`, status: 'read',
        ...(item.sender === 'system' ? { dateLabel: item.text } : {}),
      }));
      body += `\ndemoMessages.splice(0, demoMessages.length, ...${JSON.stringify(messages)});`;
      body += `\ndirectDemoMessages.splice(0, directDemoMessages.length, ...${JSON.stringify(messages)});`;
    } else {
      const base = new Date(2026, 9, 14, 10).getTime();
      const messages = fixture.map((item) => ({
        id: item.id, senderId: item.sender, content: item.text,
        timestamp: base + item.minute * 60_000, status: 'read',
        type: item.sender === 'system' ? 'system' : 'text',
      }));
      body += `\nUSERS['user-3'].name = ${JSON.stringify(longName)};`;
      body += `\nMESSAGES['conv-1'] = ${JSON.stringify(messages)};`;
      const direct = messages.map((message) => message.type !== 'system' && message.senderId !== 'user-self'
        ? { ...message, senderId: 'user-1' } : message);
      body += `\nMESSAGES['conv-2'] = ${JSON.stringify(direct)};`;
    }
    await route.fulfill({ response, body });
  });
}

async function open(page, platform, fixtureMode = false) {
  page.setDefaultTimeout(8000);
  await page.goto(`${url}/?scenario=${platform === 'mobile' && !fixtureMode ? 'chat-delivery-recovery' : 'chat-default'}`);
  await page.getByRole('button', { name: `${platform} ${platform === 'mobile' ? 'Mobile' : 'Desktop'} Prototypes`, exact: true }).click();
  if (platform === 'desktop') {
    await page.getByRole('button', { name: '聊天', exact: true }).click();
    await page.locator('[data-chat-composer-bar]').waitFor();
  } else {
    const device = page.getByRole('region', { name: 'Mobile device preview' });
    if (fixtureMode) await device.getByText('Release Room', { exact: true }).click();
    await device.locator('.mp-thread-messages').waitFor();
  }
}

async function verifyClusters(page, group) {
  const starts = group
    ? ['peer-a', 'peer-b', 'own-a', 'peer-b2', 'peer-gap', 'unknown-a', 'unknown-b']
    : ['peer-a', 'own-a', 'peer-b2', 'peer-gap'];
  const continuations = group ? ['peer-a2', 'own-a2', 'peer-gap2']
    : ['peer-a2', 'peer-b', 'own-a2', 'peer-gap2', 'unknown-a', 'unknown-b'];
  for (const id of [...starts, ...continuations]) {
    const row = page.locator(`[data-chat-message-id="${id}"]`);
    assert.equal(await row.getAttribute('data-chat-cluster-start'), String(starts.includes(id)), `${id}: cluster boundary`);
    assert.equal(await row.locator('[data-chat-sender]').count(), 0, `${id}: sender visibility`);
  }
  if (group) {
    assert.equal(await page.locator('[data-chat-message-id="peer-a"] [data-chat-author]').getAttribute('aria-label'), 'View Sarah Kim');
    assert.equal(await page.locator('[data-chat-message-id="peer-b"] [data-chat-author]').getAttribute('aria-label'), `View ${longName}`);
    assert.match(await page.locator('[data-chat-message-id="unknown-a"] [data-chat-author]').getAttribute('aria-label'), /Unknown/);
  } else assert.equal(await page.locator('[data-chat-sender]').count(), 0, 'Private chat has no sender labels');
  for (const id of continuations) {
    const row = page.locator(`[data-chat-message-id="${id}"]`);
    const bubble = row.locator('.mp-bubble, .msg-bubble');
    const radii = await bubble.evaluate((element) => {
      const s = getComputedStyle(element);
      return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].map(parseFloat);
    });
    assert(radii.every((value) => value === 12), `${id}: continuation corners`);
  }
  const aligned = await page.locator('[data-chat-message-id="peer-a"], [data-chat-message-id="peer-a2"]').evaluateAll((rows) =>
    rows.map((row) => row.querySelector('.mp-bubble, .msg-bubble').getBoundingClientRect().left));
  assert(Math.abs(aligned[0] - aligned[1]) <= 1, 'Collapsed identity must preserve the content track');
}

async function verifyReactions(page, platform) {
  const row = platform === 'mobile'
    ? page.locator('[data-chat-message-id="m7"]')
    : page.locator('[data-chat-message-id="m2"]');
  if (platform === 'desktop') {
    await row.hover();
    await row.getByRole('button', { name: 'React to message', exact: true }).click();
    await row.locator('[data-chat-reaction="❤️"]').click();
  }
  const heart = row.locator('[data-chat-message-reaction="❤️"]');
  assert.equal(await heart.getAttribute('aria-pressed'), 'true');
  const before = await heart.locator('.prototype-reaction-chip-count').innerText();
  await heart.click();
  if (platform === 'mobile') {
    assert.equal(await heart.getAttribute('aria-pressed'), 'false');
    assert.equal(await heart.locator('.prototype-reaction-chip-count').innerText(), String(Number(before) - 1));
    await heart.press('Enter');
  } else {
    assert.equal(await heart.count(), 0);
    await row.hover();
    await row.getByRole('button', { name: 'React to message', exact: true }).click();
    await row.locator('[data-chat-reaction="❤️"]').click();
  }
  assert.equal(await heart.getAttribute('aria-pressed'), 'true');
  const bounds = await row.locator('[data-chat-reaction-target]').evaluateAll((targets) =>
    targets.map((target) => {
      const t = target.getBoundingClientRect();
      const tag = target.querySelector('[data-reaction-visual]');
      const v = tag.getBoundingClientRect();
      return { left: t.left, right: t.right, top: t.top, bottom: t.bottom,
        width: t.width, height: t.height, visualHeight: v.height,
        radius: parseFloat(getComputedStyle(tag).borderTopLeftRadius) };
    }));
  for (const bound of bounds) {
    assert.equal(bound.visualHeight, 28);
    assert(
      bound.radius >= bound.visualHeight / 2,
      `Reaction tag must remain a capsule: ${JSON.stringify(bound)}`,
    );
    if (platform === 'mobile') assert(bound.height >= 44 && bound.width >= 44, 'Mobile hit target remains 44px');
  }
  for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
    const a = bounds[i], b = bounds[j];
    assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'Reaction hit targets must not overlap');
  }
  await row.getByRole('button', { name: 'Add reaction', exact: true }).click();
  if (platform === 'mobile') {
    const picker = page.locator('[data-reaction-picker]');
    await picker.waitFor();
    assert.equal(await picker.locator('[data-reaction-picker-item]').count(), 5);
    const like = picker.locator('[data-reaction-picker-item="like"]');
    const beforeLike = await like.getAttribute('aria-pressed');
    await like.click();
    assert.equal(
      await like.getAttribute('aria-pressed'),
      beforeLike === 'true' ? 'false' : 'true',
    );
    assert(await picker.isVisible(), 'Multi-select picker stays open after one reaction');
    await page.locator('.mp-action-sheet-backdrop').click({ position: { x: 4, y: 4 } });
  } else {
    await row.locator('[data-chat-reaction="👍"]').waitFor();
    await page.keyboard.press('Escape');
  }
  return bounds;
}

async function verifyNegativeControls() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await withFixtures(page, 'mobile');
  await page.route('**/shared/MessageAuthor.tsx*', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      '"data-chat-author": true',
      '"data-chat-author": true, "data-chat-sender": true',
    );
    assert(body.includes('"data-chat-sender": true'), 'Negative control must inject a timeline sender');
    await route.fulfill({ response, body });
  });
  await open(page, 'mobile', true);
  const device = page.getByRole('region', { name: 'Mobile device preview' });
  await device.getByRole('button', { name: 'Back', exact: true }).click();
  await device.getByText('Alice Chen', { exact: true }).click();
  await assert.rejects(() => verifyClusters(page, false), /sender visibility|sender labels/);
  await page.close();

  const groupPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await withFixtures(groupPage, 'mobile');
  await groupPage.route('**/mobile/chat/src/messagePresentation.ts*', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('const sender = message.sender;',
      'const sender = { id: conversation.key, name: conversation.name, avatar: conversation.avatar };');
    assert(body.includes('name: conversation.name, avatar: conversation.avatar'), 'Negative control must change actor projection');
    await route.fulfill({ response, body });
  });
  await open(groupPage, 'mobile', true);
  await assert.rejects(() => verifyClusters(groupPage, true), /cluster boundary|Sarah Kim/);
  await groupPage.close();

  const reactionPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await open(reactionPage, 'mobile');
  await reactionPage.addStyleTag({ content: '.prototype-reaction-chip-visual { height: 44px !important; border-radius: 6px !important; }' });
  await assert.rejects(() => verifyReactions(reactionPage, 'mobile'), /44 !== 28/);
  await reactionPage.close();
  return ['repeated-private-senders', 'group-title-as-actor', 'oversized-reaction-tags'];
}

async function verifySourceIdentity(page, platform) {
  const row = page.locator(`[data-chat-message-id="${platform === 'mobile' ? 'm7' : 'm2'}"]`);
  const name = platform === 'mobile' ? 'Alice Chen' : 'Sarah Kim';
  if (platform === 'mobile') {
    await row.locator('.mp-bubble').click({ button: 'right' });
    await page.getByRole('button', { name: 'Forward', exact: true }).click();
  } else {
    await row.hover();
    await row.getByRole('button', { name: 'Forward message', exact: true }).click();
  }
  assert.equal(await page.locator('[data-chat-forward-sender]').innerText(), name);
  await page.getByRole('button', { name: platform === 'mobile' ? 'Cancel' : 'Close forward', exact: true }).click();
  if (platform === 'mobile') {
    await row.locator('.mp-bubble').click({ button: 'right' });
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await page.locator('.mp-composer-input').fill('Reply with source identity preserved');
    await page.getByRole('region', { name: 'Mobile device preview' }).getByRole('button', { name: 'Send', exact: true }).click();
    assert.equal(await page.locator('.mp-reply-name').last().innerText(), name);
    assert.notEqual(await page.locator('.mp-reply-name').last().evaluate((element) => getComputedStyle(element).color),
      'rgba(255, 255, 255, 0.85)', 'Quoted identity must remain readable outside the own bubble');
    await page.getByRole('region', { name: 'Mobile device preview' }).getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Search Chat History', exact: true }).click();
    await page.locator('.mp-details-search-input').fill('Love this view');
    await page.locator('.mp-details-search-input').press('Enter');
    assert.equal(await page.locator('.mp-details-search-result-sender').innerText(), name);
  } else {
    await row.hover();
    await row.getByRole('button', { name: 'Reply to message', exact: true }).click();
    await page.locator('[data-chat-composer-field] textarea').fill('Reply with source identity preserved');
    await page.locator('[data-chat-send]').click();
    assert.equal(await page.locator('[data-chat-quote-sender]').last().innerText(), name);
  }
  return { quote: true, forwardPreview: true, search: platform === 'mobile' ? true : 'unchanged' };
}

async function verifyLongMessageActions() {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  await page.route('**/social-chat/src/mock.ts*', async (route) => {
    const response = await route.fetch();
    const message = { id: 'long-action', senderId: 'user-1', content: 'Long review notes need an accessible reaction picker. '.repeat(100),
      timestamp: Date.now(), status: 'read', type: 'text' };
    await route.fulfill({ response, body: `${await response.text()}\nMESSAGES['conv-1'] = ${JSON.stringify([message])};` });
  });
  await open(page, 'desktop');
  const row = page.locator('[data-chat-message-id="long-action"]');
  await row.hover();
  await row.getByRole('button', { name: 'React to message', exact: true }).click();
  const popup = row.locator('[data-chat-inline-popover]');
  await popup.waitFor();
  await popup.scrollIntoViewIfNeeded();
  const geometry = await popup.evaluate((element) => {
    const popup = element.getBoundingClientRect();
    const bubble = element.closest('[data-chat-message-id]').querySelector('.msg-bubble').getBoundingClientRect();
    const viewport = element.closest('[data-chat-message-viewport]').getBoundingClientRect();
    return { outsideBody: popup.top >= bubble.bottom, inViewport: popup.top >= viewport.top && popup.bottom <= viewport.bottom };
  });
  assert(geometry.outsideBody && geometry.inViewport, 'A large message needs an accessible picker outside its body');
  await popup.locator('[data-chat-reaction="❤️"]').click();
  assert.equal(await row.locator('[data-chat-message-reaction="❤️"]').getAttribute('aria-pressed'), 'true');
  await page.close();
  return geometry;
}

try {
  for (const platform of ['desktop', 'mobile']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await open(page, platform);
    const reactions = await verifyReactions(page, platform);
    if (platform === 'mobile') {
      await page.locator('[data-chat-message-id="m7"]').scrollIntoViewIfNeeded();
      await page.getByRole('region', { name: 'Mobile device preview' }).screenshot({ path: resolve(output, 'mobile-reactions-light.png') });
      await page.getByText('Dark', { exact: true }).click();
      await verifyReactions(page, platform);
      await page.getByRole('region', { name: 'Mobile device preview' }).screenshot({ path: resolve(output, 'mobile-reactions-dark.png') });
    } else {
      await page.mouse.move(0, 0);
      await page.getByText('Live Preview', { exact: true }).locator('../..')
        .screenshot({ path: resolve(output, 'desktop-reactions-light.png') });
    }
    results.push({ platform, reactions });
    results.push({ platform, sourceIdentity: await verifySourceIdentity(page, platform) });
    await page.close();

    const fixturePage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    fixturePage.on('pageerror', (error) => errors.push(error.message));
    await withFixtures(fixturePage, platform);
    await open(fixturePage, platform, true);
    await verifyClusters(fixturePage, true);
    const surface = platform === 'mobile' ? fixturePage.locator('.mp-device')
      : fixturePage.getByText('Live Preview', { exact: true }).locator('../..');
    await surface.screenshot({ path: resolve(output, `${platform}-group-clusters.png`) });
    if (platform === 'mobile') {
      await fixturePage.getByText('Dark', { exact: true }).click();
      await verifyClusters(fixturePage, true);
      await fixturePage.setViewportSize({ width: 390, height: 844 });
      await fixturePage.getByRole('region', { name: 'Mobile device preview' }).screenshot({ path: resolve(output, 'mobile-group-dark-narrow.png') });
      await fixturePage.getByRole('region', { name: 'Mobile device preview' }).getByRole('button', { name: 'Back', exact: true }).click();
      await fixturePage.getByRole('region', { name: 'Mobile device preview' }).getByText('Alice Chen', { exact: true }).click();
    } else {
      await fixturePage.getByText('Sarah Kim', { exact: true }).first().click();
    }
    await verifyClusters(fixturePage, false);
    await fixturePage.screenshot({ path: resolve(output, `${platform}-private-no-names.png`) });
    results.push({ platform, clusters: 'passed', private: 'passed' });
    await fixturePage.close();
  }
  const comments = await browser.newPage({ viewport: { width: 430, height: 932 } });
  await open(comments, 'mobile');
  const device = comments.getByRole('region', { name: 'Mobile device preview' });
  await device.getByRole('button', { name: 'Back', exact: true }).click();
  await device.getByRole('button', { name: 'Moments', exact: true }).click();
  results.push({ comments: await verifyInlineComments(comments, device) });
  await comments.close();
  results.push({ longMessageActions: await verifyLongMessageActions() });
  for (const platform of ['desktop', 'mobile']) {
    results.push({ platform, chatInteractions: await verifyChatInteractions({ browser, open, platform, output }) });
  }
  results.push({ mobileTransientLayers: await verifyMobileTransientLayers({ browser, open }) });
  results.push({ negativeControls: await verifyNegativeControls() });
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ status: 'passed', results, errors }, null, 2));
  process.stdout.write(`${JSON.stringify({ status: 'passed', results, output }, null, 2)}\n`);
} catch (error) {
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ status: 'failed', results, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
