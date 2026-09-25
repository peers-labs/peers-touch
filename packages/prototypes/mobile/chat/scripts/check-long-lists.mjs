import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium, expect } = require('@playwright/test');
const copy = require(resolve(repoRoot, 'packages/locales/en/common.json'));
const output = resolve(repoRoot, 'apps/mobile/src-tauri/target/prototype-long-lists');
await mkdir(output, { recursive: true });
const url = new URL(process.env.PROTOTYPE_URL ?? 'http://localhost:3262');
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Use the local Make Portal');
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert(response.ok, `Portal HTTP ${response.status}`);
} catch (error) {
  throw new Error('Make Portal unavailable. Ask the integrator to start make run-prototype; this check never starts a server.', { cause: error });
}

const viewports = [
  { width: 1440, height: 1100 },
  { width: 554, height: 954 },
  { width: 390, height: 844 },
];
const reports = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport, colorScheme: 'light' });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const device = page.getByRole('region', { name: 'Mobile device preview', exact: true });
    const rows = (window) => window.locator('[data-scroll-anchor-id]');
    const list = (prefix) => device.locator(`[data-window-surface^="${prefix}:"]`);
    const messages = () => list('messages');
    const scroller = () => device.locator('.mp-thread-messages');

    async function open(scenario) {
      const target = new URL(url);
      target.searchParams.set('scenario', scenario);
      await page.goto(target.href);
      await page.getByRole('button', { name: 'mobile Mobile Prototypes', exact: true }).click();
      await page.getByText('Live Preview', { exact: true }).waitFor();
      await device.waitFor();
    }
    async function windowState(window) {
      return window.evaluate((element) => ({
        start: Number(element.dataset.windowStart),
        total: Number(element.dataset.windowTotal),
        size: Number(element.dataset.windowSize),
        keys: [...element.querySelectorAll('[data-scroll-anchor-id]')]
          .map((row) => row.dataset.scrollAnchorId),
      }));
    }
    async function offset(row) {
      return row.evaluate((element) => {
        let owner = element.parentElement;
        while (owner && !/auto|scroll/.test(getComputedStyle(owner).overflowY)) owner = owner.parentElement;
        if (!owner) throw new Error('Missing scroll owner');
        return element.getBoundingClientRect().top - owner.getBoundingClientRect().top;
      });
    }
    async function move(window, direction) {
      const before = await windowState(window);
      const label = copy[direction < 0 ? 'mobile.list.previous' : 'mobile.list.next'];
      const control = window.getByRole('button', { name: label, exact: true });
      await control.scrollIntoViewIfNeeded();
      const key = direction < 0 ? before.keys[0] : before.keys.at(-1);
      const retained = window.locator(`[data-scroll-anchor-id="${key}"]`);
      const previousOffset = await offset(retained);
      await control.click();
      const expectedStart = Math.max(0, Math.min(before.total - before.size,
        before.start + direction * Math.floor(before.size / 2)));
      await expect(window).toHaveAttribute('data-window-start', String(expectedStart));
      await expect.poll(async () => Math.abs(await offset(retained) - previousOffset)).toBeLessThanOrEqual(2);
      const after = await windowState(window);
      assert(after.keys.length <= before.size, 'Mounted row bound');
      assert(after.keys.filter((id) => before.keys.includes(id)).length >= Math.floor(before.size / 2),
        'Half-window overlap');
    }
    async function traverse(window, total, size) {
      const visited = new Set();
      for (let iteration = 0; iteration < 30; iteration += 1) {
        const state = await windowState(window);
        assert.equal(state.total, total);
        assert.equal(state.size, size);
        assert(state.keys.length <= size);
        state.keys.forEach((id) => visited.add(id));
        if (state.start + state.keys.length === total) break;
        await move(window, 1);
      }
      assert.equal(visited.size, total, 'Every logical row reachable');
      return visited.size;
    }
    async function returnAnchor(window, enter, leave) {
      const target = rows(window).nth(30);
      await target.scrollIntoViewIfNeeded();
      const key = await target.getAttribute('data-scroll-anchor-id');
      const before = await offset(target);
      const start = await window.getAttribute('data-window-start');
      await enter(target);
      await expect(window).toHaveCount(0);
      await leave();
      await expect(window).toHaveAttribute('data-window-start', start);
      await expect.poll(async () => Math.abs(await offset(
        window.locator(`[data-scroll-anchor-id="${key}"]`),
      ) - before)).toBeLessThanOrEqual(2);
    }
    async function searchHistory(query) {
      await device.getByRole('button', { name: 'More', exact: true }).click();
      await device.getByRole('button', { name: 'Search Chat History', exact: true }).click();
      await expect(messages()).toHaveCount(0);
      await device.getByRole('searchbox', { name: copy['mobile.chat.searchMessagesPlaceholder'], exact: true }).fill(query);
      await device.getByRole('button', { name: copy['mobile.contacts.search'], exact: true }).click();
    }
    async function atTail() {
      await expect.poll(() => scroller().evaluate((element) =>
        Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight))).toBeLessThanOrEqual(2);
    }

    await open('long-lists');
    await expect(page.getByText('Long lists / sample data only', { exact: true })).toBeVisible();
    await expect(device.locator('[data-prototype-page]')).toHaveCount(1);
    await device.screenshot({ path: resolve(output, `${viewport.width}-conversations.png`) });
    const conversations = list('conversations');
    const conversationCount = await traverse(conversations, 240, 100);
    await move(conversations, -1);
    await returnAnchor(conversations, (target) => target.click(), () =>
      device.getByRole('button', { name: 'Back', exact: true }).click());
    await returnAnchor(conversations,
      () => device.getByRole('button', { name: 'Me', exact: true }).click(),
      () => device.locator('.mp-tabbar-item').filter({ hasText: copy['mobile.chat.title'] }).click());

    const chatSearch = device.getByPlaceholder('Search conversations', { exact: true });
    await chatSearch.fill(copy['mobile.chat.thread']);
    assert.equal(await traverse(conversations, 240, 100), 240);
    await chatSearch.fill('240');
    await expect(rows(conversations)).toHaveCount(1);
    await rows(conversations).first().click();
    await expect(messages()).toHaveAttribute('data-window-total', '480');
    await expect(rows(messages())).toHaveCount(200);
    await expect(device.locator('.mp-tabbar')).toHaveCount(0);
    await atTail();

    // Start at the live tail, traverse every older window, then return forward.
    while (Number(await messages().getAttribute('data-window-start')) > 0) await move(messages(), -1);
    const messageCount = await traverse(messages(), 480, 200);
    await move(messages(), -1);
    await messages().getByRole('button', { name: copy['mobile.chat.latestMessage'], exact: true }).click();
    await expect(messages()).toHaveAttribute('data-window-start', '280');
    await atTail();

    await searchHistory(copy['mobile.chat.threadReplyPlaceholder']);
    const search = list('history-search');
    await device.screenshot({ path: resolve(output, `${viewport.width}-search.png`) });
    const searchCount = await traverse(search, 480, 100);
    await move(search, -1);
    await move(search, 1);
    await search.locator('[data-scroll-anchor-id="long-message-001"]').click();
    await expect(search).toHaveCount(0);
    const older = messages().locator('[data-scroll-anchor-id="long-message-001"]');
    await expect(older).toBeFocused();
    await expect(messages()).toHaveAttribute('data-window-start', '0');
    assert(await offset(older) >= 0, 'Older search target visible');
    await device.screenshot({ path: resolve(output, `${viewport.width}-older-target.png`) });

    // Reply-thread detail must unmount the message window and restore its reader.
    const olderOffset = await offset(older);
    await older.getByRole('button', { name: copy['mobile.chat.threadReplyCount'].replace('{{count}}', '3'), exact: true }).click();
    await expect(messages()).toHaveCount(0);
    await expect(device.locator('.mp-thread-view')).toHaveCount(1);
    await device.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(device.locator('.mp-thread-view')).toHaveCount(0);
    await expect.poll(async () => Math.abs(await offset(older) - olderOffset)).toBeLessThanOrEqual(2);

    // Sending at the bottom of an older window must not turn it into the live tail.
    const next = messages().getByRole('button', { name: copy['mobile.list.next'], exact: true });
    await next.scrollIntoViewIfNeeded();
    const retained = messages().locator('[data-scroll-anchor-id="long-message-200"]');
    const retainedOffset = await offset(retained);
    await device.getByPlaceholder('Message', { exact: true }).fill('local-long-list-check');
    await device.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(messages()).toHaveAttribute('data-window-total', '481');
    await expect(messages()).toHaveAttribute('data-window-start', '0');
    await expect.poll(async () => Math.abs(await offset(retained) - retainedOffset)).toBeLessThanOrEqual(2);
    await messages().getByRole('button', { name: copy['mobile.chat.latestMessage'], exact: true }).click();
    await atTail();
    await device.getByPlaceholder('Message', { exact: true }).fill('local-live-tail-check');
    await device.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(messages()).toHaveAttribute('data-window-start', '282');
    await atTail();

    await searchHistory('no-sample-matches-this-query');
    await expect(device.getByText(copy['mobile.chat.noMessageResults'], { exact: true })).toBeVisible();
    await expect(rows(list('history-search'))).toHaveCount(0);
    await device.getByRole('button', { name: 'Back', exact: true }).click();
    await device.getByRole('button', { name: 'Back', exact: true }).click();
    await move(messages(), -1);
    const threadWindow = await messages().getAttribute('data-window-start');
    const threadRow = rows(messages()).nth(40);
    await threadRow.scrollIntoViewIfNeeded();
    const threadKey = await threadRow.getAttribute('data-scroll-anchor-id');
    const threadOffset = await offset(threadRow);
    await device.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(chatSearch).toHaveValue('240');
    await rows(conversations).first().click();
    await expect(messages()).toHaveAttribute('data-window-start', threadWindow);
    await expect.poll(async () => Math.abs(await offset(
      messages().locator(`[data-scroll-anchor-id="${threadKey}"]`),
    ) - threadOffset)).toBeLessThanOrEqual(2);
    await device.getByRole('button', { name: 'Back', exact: true }).click();

    await device.getByRole('button', { name: 'Contacts', exact: true }).click();
    await expect(conversations).toHaveCount(0);
    const contacts = list('contacts');
    const contactCount = await traverse(contacts, 240, 100);
    await move(contacts, -1);
    await returnAnchor(contacts, (target) => target.click(), () =>
      device.getByRole('button', { name: 'Back', exact: true }).click());
    await returnAnchor(contacts,
      () => device.getByRole('button', { name: 'Me', exact: true }).click(),
      () => device.getByRole('button', { name: 'Contacts', exact: true }).click());
    const contactSearch = device.getByPlaceholder(copy['mobile.contacts.searchPlaceholder'], { exact: true });
    await contactSearch.fill(copy['mobile.contacts.profile']);
    assert.equal(await traverse(contacts, 240, 100), 240);
    await contactSearch.fill('240');
    await expect(rows(contacts)).toHaveCount(1);
    await rows(contacts).first().click();
    await expect(device.getByRole('button', { name: copy['mobile.contacts.openChat'], exact: true })).toBeDisabled();
    await expect(device.getByText(copy['mobile.launch.unavailable'], { exact: true })).toBeVisible();
    await expect(device.getByText(copy['mobile.contacts.federationRequired'], { exact: true })).toHaveCount(0);
    await device.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(contactSearch).toHaveValue('240');
    await contactSearch.fill('no-sample-matches-this-query');
    await expect(device.getByText(copy['mobile.contacts.noSearchResults'], { exact: true })).toBeVisible();
    await expect(device.locator('[data-prototype-page]')).toHaveCount(1);
    await device.screenshot({ path: resolve(output, `${viewport.width}-empty.png`) });
    const geometry = await device.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      overflowing: element.scrollWidth > element.clientWidth,
      portalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    assert(geometry.width >= 320 && !geometry.overflowing && !geometry.portalOverflow);

    // Retain the prior recovery/Social samples, without using them as business proof.
    await open('social-unavailable');
    await device.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: 'Retry fails', exact: true }).click();
    await expect(device.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await open('find-people-no-membership');
    await expect(page.getByRole('dialog', { name: 'Find People', exact: true })
      .getByRole('button', { name: 'Send Request', exact: true })).toBeDisabled();
    await open('contact-direct');
    await device.getByRole('button', { name: /Frank/ }).click();
    await device.getByRole('button', { name: copy['mobile.contacts.openChat'], exact: true }).click();
    await expect(device.locator('[data-demo-direct-status="preparing"]')).toBeVisible();
    await page.getByRole('button', { name: 'Direct fails', exact: true }).click();
    await device.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: 'Direct ready', exact: true }).click();
    await expect(device.getByText(copy['mobile.chat.emptyThread'], { exact: true })).toBeVisible();
    await expect(rows(messages())).toHaveCount(0);
    await open('request-unknown');
    const intent = (await page.locator('.mp-evidence-intent').innerText()).split(' / ').slice(0, 2);
    await page.getByRole('dialog', { name: 'Find People', exact: true })
      .getByRole('button', { name: /^Check Status \(\d+\)$/ }).click();
    assert.deepEqual((await page.locator('.mp-evidence-intent').innerText()).split(' / ').slice(0, 2), intent);
    await page.getByRole('button', { name: 'Request confirmed pending', exact: true }).click();
    await page.getByRole('button', { name: 'Relationship accepted', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Find People', exact: true })
      .getByRole('button', { name: 'Friends', exact: true })).toBeDisabled();
    await open('draft-restored');
    await expect(device.locator('.mp-shell')).toHaveCount(1);
    assert.deepEqual(errors, []);
    reports.push({ viewport, conversationCount, contactCount, messageCount, searchCount, geometry });
    await page.close();
  }
  process.stdout.write(`${JSON.stringify({
    evidenceType: 'prototype-sample-only',
    serverStarted: false,
    reports,
    unproven: ['Owner confirmation', 'pixel parity', 'native behavior', 'Station data', 'production memory and timing'],
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
