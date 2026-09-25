import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium, expect } = require('@playwright/test');
const copy = require(resolve(repoRoot, 'packages/locales/en/common.json'));
const output = resolve(repoRoot, 'apps/mobile/src-tauri/target/prototype-residual-parity');
const url = new URL(process.env.PROTOTYPE_URL ?? 'http://localhost:3262');
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Use the local Make Portal');
assert.equal(url.pathname, '/', 'Use the Portal root, not a service endpoint');
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  assert(response.ok, `Portal HTTP ${response.status}`);
} catch (error) {
  throw new Error('Make Portal unavailable. Integrator must start make run-prototype; this check never starts a server.', { cause: error });
}
await mkdir(output, { recursive: true });

const viewports = [{ width: 390, height: 844 }, { width: 1440, height: 1100 }];
const reports = [];
const captures = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, colorScheme: 'light', serviceWorkers: 'block' });
    const blockedTraffic = [];
    await context.route('**/*', (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if (target.origin !== url.origin || request.method() !== 'GET'
        || /^\/(?:api|device|conversation|messaging|station|app-meta)(?:\/|$)/.test(target.pathname)) {
        blockedTraffic.push({ method: request.method(), url: request.url() });
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    await context.routeWebSocket('**/*', (route) => {
      const target = new URL(route.url());
      if (target.host !== url.host) {
        blockedTraffic.push({ websocket: route.url() });
        route.close();
      } else {
        route.connectToServer();
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    const passed = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const device = page.getByRole('region', { name: 'Mobile device preview', exact: true });
    const list = (prefix) => device.locator(`[data-window-surface^="${prefix}:"]`);
    const rows = (window) => window.locator('[data-scroll-anchor-id]');
    const back = () => device.getByRole('button', { name: copy['common.action.back'], exact: true }).click();
    const contactQuery = () => device.getByPlaceholder(copy['mobile.contacts.searchPlaceholder'], { exact: true });
    const memberQuery = () => device.getByRole('textbox', { name: copy['mobile.group.members'], exact: true });
    const search = () => device.locator('[data-prototype-page="history-search"]');
    const searchQuery = () => search().getByRole('searchbox', { name: copy['mobile.chat.searchMessagesPlaceholder'], exact: true });
    const submit = () => search().getByRole('button', { name: copy['mobile.contacts.search'], exact: true }).click();
    const outcome = (name) => page.getByRole('button', { name, exact: true }).click();
    const searchStatus = (status) => expect(search()).toHaveAttribute('data-demo-search-status', status);

    async function open(scenario) {
      const target = new URL(url);
      target.searchParams.set('scenario', scenario);
      await page.goto(target.href);
      await page.getByRole('button', { name: 'mobile Mobile Prototypes', exact: true }).click();
      await page.getByText('Live Preview', { exact: true }).waitFor();
      await expect(page.getByText('Live Preview', { exact: true }).locator('..')
        .getByText('Mobile Shell', { exact: true })).toBeVisible();
      await device.waitFor();
    }
    async function capture(state) {
      await device.scrollIntoViewIfNeeded();
      const filename = `${viewport.width}-${state}.png`;
      await device.screenshot({ path: resolve(output, filename), animations: 'disabled' });
      const geometry = await device.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        overflow: element.scrollWidth > element.clientWidth,
        portalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      }));
      assert(geometry.width >= 320 && !geometry.overflow && !geometry.portalOverflow, JSON.stringify(geometry));
      captures.push({ state, viewport, filename, theme: 'light-only', geometry });
    }
    async function windowState(window) {
      return window.evaluate((element) => ({
        start: Number(element.dataset.windowStart),
        total: Number(element.dataset.windowTotal),
        size: Number(element.dataset.windowSize),
        keys: [...element.querySelectorAll('[data-scroll-anchor-id]')].map((row) => row.dataset.scrollAnchorId),
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
    async function reachable(row) {
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeInViewport();
      const bounds = await row.evaluate((element) => {
        let owner = element.parentElement;
        while (owner && !/auto|scroll/.test(getComputedStyle(owner).overflowY)) owner = owner.parentElement;
        if (!owner) throw new Error('Missing scroll owner');
        const rect = element.getBoundingClientRect();
        const outer = owner.getBoundingClientRect();
        return { top: rect.top - outer.top, bottom: rect.bottom - outer.top, height: outer.height };
      });
      assert(bounds.top >= -2 && bounds.bottom <= bounds.height + 2, JSON.stringify(bounds));
    }
    async function move(window, direction) {
      const before = await windowState(window);
      const control = window.getByRole('button', {
        name: copy[direction < 0 ? 'mobile.list.previous' : 'mobile.list.next'], exact: true,
      });
      await control.scrollIntoViewIfNeeded();
      const key = direction < 0 ? before.keys[0] : before.keys.at(-1);
      const retained = window.locator(`[data-scroll-anchor-id="${key}"]`);
      const previousOffset = await offset(retained);
      await control.click();
      const expected = Math.max(0, Math.min(before.total - before.size, before.start + direction * 50));
      await expect(window).toHaveAttribute('data-window-start', String(expected));
      await expect.poll(async () => Math.abs(await offset(retained) - previousOffset)).toBeLessThanOrEqual(2);
      const after = await windowState(window);
      assert(after.keys.length <= 100, 'At most 100 mounted rows');
      assert(after.keys.filter((key) => before.keys.includes(key)).length >= 50, 'Overlapping window');
    }
    async function traverse(window, prefix, total, label) {
      await reachable(window.locator(`[data-scroll-anchor-id="${prefix}-001"]`));
      await capture(`${label}-first`);
      const visited = new Set();
      let maximumMounted = 0;
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const state = await windowState(window);
        assert.equal(state.total, total);
        assert.equal(state.size, 100);
        assert(state.keys.length <= 100);
        maximumMounted = Math.max(maximumMounted, state.keys.length);
        state.keys.forEach((key) => visited.add(key));
        if (state.start + state.keys.length === total) break;
        await move(window, 1);
      }
      assert.deepEqual([...visited].sort(), Array.from({ length: total }, (_, index) =>
        `${prefix}-${String(index + 1).padStart(3, '0')}`).sort(), 'Every distinct logical row reached');
      await reachable(window.locator(`[data-scroll-anchor-id="${prefix}-${total}"]`));
      await capture(`${label}-last`);
      await move(window, -1);
      return { distinct: visited.size, maximumMounted };
    }
    async function retainAnchor(window, leave, returnToList) {
      const target = rows(window).nth(30);
      await reachable(target);
      const key = await target.getAttribute('data-scroll-anchor-id');
      const before = await offset(target);
      const start = await window.getAttribute('data-window-start');
      await leave(target);
      await expect(window).toHaveCount(0);
      await returnToList();
      await expect(window).toHaveAttribute('data-window-start', start);
      await expect.poll(async () => Math.abs(await offset(
        window.locator(`[data-scroll-anchor-id="${key}"]`),
      ) - before)).toBeLessThanOrEqual(2);
    }
    async function openHistory() {
      await device.getByRole('button', { name: 'More', exact: true }).click();
      await device.getByRole('button', { name: 'Search Chat History', exact: true }).click();
      await expect(list('messages')).toHaveCount(0);
      await expect(searchQuery()).toBeFocused();
    }

    await open('long-lists');
    await expect(list('conversations')).toHaveAttribute('data-window-total', '240');
    await expect(rows(list('conversations'))).toHaveCount(100);
    await rows(list('conversations')).first().click();
    await expect(list('messages')).toHaveAttribute('data-window-total', '480');
    await expect(rows(list('messages'))).toHaveCount(200);
    await openHistory();
    await searchQuery().fill(copy['mobile.chat.threadReplyPlaceholder']);
    await submit();
    await searchStatus('results');
    await expect(list('history-search')).toHaveAttribute('data-window-total', '480');
    await expect(rows(list('history-search'))).toHaveCount(100);
    await expect(page.getByRole('region', { name: 'Controlled search demo transitions', exact: true })).toHaveCount(0);
    await rows(list('history-search')).first().click();
    await expect(list('messages').locator('[data-scroll-anchor-id="long-message-480"]')).toBeFocused();
    passed.push('baseline: long-lists retains immediate bounded search and target materialization');
    await openHistory();
    await expect(searchQuery()).toHaveValue(copy['mobile.chat.threadReplyPlaceholder']);
    await searchStatus('results');
    await searchQuery().fill('no-sample-message');
    await submit();
    await expect(rows(list('history-search'))).toHaveCount(0);
    await expect(search().getByText(copy['mobile.chat.noMessageResults'], { exact: true })).toBeVisible();
    await back();
    await back();
    await back();
    passed.push('baseline: long-lists retains submitted query, immediate empty and back navigation');

    await device.getByRole('button', { name: copy['mobile.contacts.title'], exact: true }).click();
    await contactQuery().fill('R');
    const requests = list('requests');
    const requestTraversal = await traverse(requests, 'long-request', 240, 'requests');
    passed.push('requests: 240 distinct, first/last, <=100 mounted, overlapping previous/next');
    const requestSemantics = await rows(requests).evaluateAll((elements) => elements.map((element) => ({
      direction: element.dataset.demoRequestDirection,
      status: element.dataset.demoRequestStatus,
      text: element.textContent,
      actions: element.querySelectorAll('button').length,
    })));
    assert.deepEqual([...new Set(requestSemantics.map((row) => row.direction))].sort(), ['incoming', 'outgoing']);
    assert(requestSemantics.every((row) => row.status === 'pending' && row.actions === 0
      && row.text.includes(copy['mobile.contacts.requestPending']) && row.text.includes('\u2192')));
    passed.push('requests: explicit incoming/outgoing pending, no fabricated command actions');
    await retainAnchor(requests,
      () => device.getByRole('button', { name: 'Me', exact: true }).click(),
      () => device.getByRole('button', { name: copy['mobile.contacts.title'], exact: true }).click());
    await expect(contactQuery()).toHaveValue('R');
    passed.push('requests: tab unmount/remount retains query, window and anchor');
    await capture('requests-restored');
    await contactQuery().fill('R240');
    await expect(rows(requests)).toHaveCount(1);
    await expect(rows(requests).first()).toHaveAttribute('data-scroll-anchor-id', 'long-request-240');
    await contactQuery().fill('no-sample-request');
    await expect(rows(requests)).toHaveCount(0);
    await expect(device.getByText(copy['mobile.contacts.noFriendRequests'], { exact: true })).toBeVisible();
    passed.push('requests: query filters last row and empty sample');

    await contactQuery().fill('');
    const openGroup = () => device.locator('.mp-group-item').first().click();
    await openGroup();
    const members = list('members');
    await expect(device.locator('[data-prototype-page]')).toHaveCount(1);
    await expect(device.locator('.mp-tabbar')).toHaveCount(0);
    await expect(device.getByRole('button', { name: copy['mobile.group.leaveGroup'], exact: true })).toBeDisabled();
    await memberQuery().fill(copy['mobile.group.roleMember']);
    const memberTraversal = await traverse(members, 'long-member', 240, 'members');
    passed.push('members: 240 distinct, first/last, <=100 mounted, overlapping previous/next');
    await retainAnchor(members, (target) => target.click(), back);
    await expect(memberQuery()).toHaveValue(copy['mobile.group.roleMember']);
    passed.push('members: existing Contact detail/back retains query and anchor');
    await capture('members-restored');
    await retainAnchor(members, back, async () => {
      await device.getByRole('button', { name: 'Me', exact: true }).click();
      await device.getByRole('button', { name: copy['mobile.contacts.title'], exact: true }).click();
      await openGroup();
    });
    await expect(memberQuery()).toHaveValue(copy['mobile.group.roleMember']);
    passed.push('members: group back and tab remount retain query and anchor');
    await memberQuery().fill('240');
    await expect(rows(members)).toHaveCount(1);
    await expect(rows(members).first()).toHaveAttribute('data-scroll-anchor-id', 'long-member-240');
    await rows(members).first().click();
    await expect(device.getByRole('button', { name: copy['mobile.contacts.openChat'], exact: true })).toBeDisabled();
    await back();
    await expect(memberQuery()).toHaveValue('240');
    await memberQuery().fill('no-sample-member');
    await expect(rows(members)).toHaveCount(0);
    await expect(device.getByText(copy['mobile.group.noMembers'], { exact: true })).toBeVisible();
    passed.push('members: query, empty, selected-only detail, unavailable mutations');

    await open('search-controlled');
    await rows(list('conversations')).first().click();
    await openHistory();
    await searchStatus('idle');
    await capture('search-idle');
    const query = copy['mobile.chat.threadReplyPlaceholder'];
    await searchQuery().fill(query);
    await submit();
    await searchStatus('loading');
    await expect(search().getByText(copy['common.state.loading'], { exact: true })).toBeVisible();
    await expect(rows(list('history-search'))).toHaveCount(0);
    await capture('search-loading');
    passed.push('search: explicit submit/loading without premature results');
    await outcome('Search fails');
    await searchStatus('error');
    await expect(search().getByRole('alert')).toHaveText(new RegExp(copy['mobile.chat.searchFailed'].replaceAll('.', '\\.')));
    await expect(searchQuery()).toHaveValue(query);
    await expect(search().getByText(copy['mobile.chat.noMessageResults'], { exact: true })).toHaveCount(0);
    await capture('search-error');
    passed.push('search: failure distinct from empty, query retained');
    await search().getByRole('button', { name: copy['common.action.retry'], exact: true }).click();
    await searchStatus('loading');
    await expect(searchQuery()).toHaveValue(query);
    await capture('search-retry');
    await outcome('Search results');
    await searchStatus('results');
    await expect(list('history-search')).toHaveAttribute('data-window-total', '480');
    await expect(rows(list('history-search'))).toHaveCount(100);
    passed.push('search: same-query retry, explicit success with bounded results');
    await capture('search-results');
    await move(list('history-search'), 1);
    await retainAnchor(list('history-search'), (target) => target.click(), async () => {
      await expect(list('messages')).toHaveCount(1);
      await openHistory();
      await searchStatus('idle');
      await expect(searchQuery()).toHaveValue(query);
      await submit();
      await outcome('Search results');
    });
    passed.push('search: result selection materializes history, explicit resubmit restores result anchor');

    await submit();
    await outcome('Search empty');
    await searchStatus('empty');
    await expect(rows(list('history-search'))).toHaveCount(0);
    await expect(searchQuery()).toHaveValue(query);
    await expect(search().getByText(copy['mobile.chat.noMessageResults'], { exact: true })).toBeVisible();
    await capture('search-empty');
    passed.push('search: explicit empty outcome preserves query');

    await submit();
    await searchQuery().fill('240');
    await searchStatus('idle');
    await submit();
    await outcome('Discarded search results');
    await searchStatus('loading');
    await expect(rows(list('history-search'))).toHaveCount(0);
    await expect(searchQuery()).toHaveValue('240');
    await outcome('Search results');
    await expect(rows(list('history-search'))).toHaveCount(1);
    await expect(rows(list('history-search')).first()).toHaveAttribute('data-scroll-anchor-id', 'long-message-240');
    passed.push('search: old query completion rejected while new query is pending');

    await submit();
    await searchQuery().fill('');
    await outcome('Discarded search results');
    await searchStatus('idle');
    await expect(rows(list('history-search'))).toHaveCount(0);
    passed.push('search: clear discards pending completion');

    await searchQuery().fill(query);
    await submit();
    await back();
    await expect(search()).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Search results', exact: true })).toBeDisabled();
    await outcome('Discarded search results');
    await expect(search()).toHaveCount(0);
    await device.getByRole('button', { name: 'Search Chat History', exact: true }).click();
    await searchStatus('idle');
    await expect(searchQuery()).toHaveValue(query);
    await submit();
    await outcome('Discarded search results');
    await searchStatus('loading');
    await outcome('Search empty');
    await capture('search-close-discard');
    passed.push('search: close and remount fence old completion, query retained');

    await submit();
    await back();
    await back();
    await back();
    await device.getByRole('button', { name: 'Me', exact: true }).click();
    await device.locator('.mp-tabbar-item').filter({ hasText: copy['mobile.chat.title'] }).click();
    await rows(list('conversations')).first().click();
    await openHistory();
    await expect(searchQuery()).toHaveValue(query);
    await searchStatus('idle');
    await submit();
    await outcome('Discarded search results');
    await searchStatus('loading');
    await outcome('Search results');
    await expect(list('history-search')).toHaveAttribute('data-window-total', '480');
    passed.push('search: thread/tab remount rejects prior instance, retains query');

    assert.deepEqual(errors, [], 'No browser errors');
    assert.deepEqual(blockedTraffic, [], 'No Station, API, native or external requests attempted');
    passed.push('browser: no errors or prohibited traffic');
    reports.push({ viewport, passed, requestTraversal, memberTraversal, errors, blockedTraffic });
    await context.close();
  }
  const result = {
    evidenceType: 'prototype-only', serverStarted: false, retainedPortal: url.origin,
    checksPassed: reports.reduce((count, report) => count + report.passed.length, 0),
    screenshots: captures.length, reports, captures,
    unproven: ['native/product proof', 'Owner confirmation', 'full pixel parity', 'request mutation and durable recovery', 'production memory and timing'],
  };
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
