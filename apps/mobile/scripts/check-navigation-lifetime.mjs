import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(resolve(root, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const output = resolve(process.env.MOBILE_NAVIGATION_EVIDENCE_DIR
  ?? resolve(root, 'apps/mobile/src-tauri/target/navigation-lifetime-browser'));
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false, root: resolve(root, 'apps/mobile'),
  esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'navigation-lifetime-component-entry',
    configureServer(instance) {
      instance.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0];
        const fixture = pathname === '/__navigation-lifetime-test__' ? 'navigation-lifetime'
          : pathname === '/__search-picker-lifetime-test__' ? 'search-picker-lifetime'
            : pathname === '/__station-layout-test__' ? 'station-layout'
              : pathname === '/__debug-panel-test__' ? 'debug-panel'
                : pathname === '/__input-activation-test__' ? 'input-activation'
                  : pathname === '/__mobile-tab-swipe-test__' ? 'mobile-tab-swipe' : null;
        if (!fixture) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/scripts/fixtures/${fixture}.tsx"></script></body></html>`);
      });
    },
  }],
  server: { host: '127.0.0.1', port: 3265, strictPort: true },
});
let browser;
let page;
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:3265/__navigation-lifetime-test__');
  const a = page.locator('[data-test-page="A"]');
  await a.waitFor();
  await page.getByLabel('A draft', { exact: true }).fill('retained draft');
  await a.evaluate(node => { node.scrollTop = 287; });
  assert.equal(await a.evaluate(node => node.scrollTop), 287, 'fixture did not establish a scrolled page');
  await page.evaluate(() => {
    window.savedNavigationNodes = {
      page: document.querySelector('[data-test-page="A"]'),
      header: document.querySelector('[data-test-header]'),
    };
  });
  const click = async name => {
    const before = await page.evaluate(() => window.navigationLifetimeFixture.samples.length);
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForFunction(old => window.navigationLifetimeFixture.samples.length > old, before);
  };
  const observed = name => page.evaluate(key => window.navigationLifetimeFixture.observations[key], name);
  await click('Tab B');
  assert.equal((await observed('A')).subscriptions, 0, 'nested hidden page kept its subscription');
  assert.equal((await observed('A')).disposals, 0, 'hiding disposed a retained asset');
  assert(await page.evaluate(() => window.savedNavigationNodes.page.isConnected), 'hidden page was removed');
  await click('Tab A');
  assert(await page.evaluate(() => window.savedNavigationNodes.page === document.querySelector('[data-test-page="A"]')),
    'return remounted the page');
  assert(await page.evaluate(() => window.savedNavigationNodes.header === document.querySelector('[data-test-header]')),
    'return rebuilt the header');
  assert.equal(await page.getByLabel('A draft', { exact: true }).inputValue(), 'retained draft');
  assert.equal(await a.evaluate(node => node.scrollTop), 287, 'return displaced the scroll position');
  assert.equal(await page.getByLabel('A draft', { exact: true }).evaluate(node => node === document.activeElement), false,
    'page return automatically activated the retained input');
  assert.equal((await observed('A')).allocations, 1);
  assert.equal((await observed('A')).subscriptions, 1);
  const first = await page.evaluate(() => window.navigationLifetimeFixture.samples.at(-1));
  assert.equal(first.top, 287, 'first painted frame jumped before restoration');
  assert.equal(first.draft, 'retained draft');
  await click('Pane A2');
  const a2 = page.locator('[data-test-page="A2"]');
  await a2.evaluate(node => { node.scrollTop = 449; });
  await click('Pane A');
  assert.equal(await a.evaluate(node => node.scrollTop), 287,
    'compound frame overwrote the previous pane scroll');
  assert.equal((await page.evaluate(() => window.navigationLifetimeFixture.samples.at(-1))).top, 287,
    'pane return jumped on the first painted frame');
  assert.equal((await observed('A2')).subscriptions, 0);
  await click('Pane A2');
  assert.equal(await a2.evaluate(node => node.scrollTop), 449, 'second pane lost its independent position');
  assert.equal((await observed('A2')).allocations, 1);
  await click('Pane A');
  await click('Push');
  await page.getByLabel('D1 draft', { exact: true }).fill('detail draft');
  await click('Push');
  assert.equal((await observed('D1')).subscriptions, 0);
  await click('Back');
  assert.equal(await page.getByLabel('D1 draft', { exact: true }).inputValue(), 'detail draft');
  assert.equal(await page.getByLabel('D1 draft', { exact: true }).evaluate(node => node === document.activeElement), false,
    'detail return reopened editing focus');
  assert.equal((await observed('D2')).disposals, 1);
  for (let index = 0; index < 4; index += 1) await click('Push');
  assert.equal((await observed('D1')).disposals, 1, 'evicted detail assets were not released');
  assert.equal(await page.locator('[data-navigation-frame^="detail:"]').count(), 4, 'detail cache exceeded its bound');
  for (let index = 0; index < 5; index += 1) await click('Back');
  assert.equal(await page.getByLabel('A draft', { exact: true }).inputValue(), 'retained draft');
  await click('Tab B');
  await click('Tab C');
  await click('Replace identity');
  assert.equal((await observed('A')).disposals, 1, 'identity replacement did not release nested retained assets');
  assert.equal((await observed('A2')).disposals, 1, 'identity replacement leaked an inactive pane');
  assert.equal((await observed('B')).disposals, 1, 'identity replacement leaked an inactive root');
  assert.equal((await observed('C')).disposals, 1, 'visible identity replacement failed to release assets');
  assert(await page.evaluate(() => !window.savedNavigationNodes.page.isConnected), 'old identity DOM survived');
  assert.deepEqual(errors, []);
  const result = await page.evaluate(() => window.navigationLifetimeFixture);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({
    evidence: 'component-only', assertions: 'DOM identity, first-paint scroll/draft, hidden subscriptions, nested asset lifetime, detail bound, scope disposal', ...result,
  }, null, 2));
  await page.screenshot({ path: resolve(output, 'identity-replaced.png') });
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('http://127.0.0.1:3265/__search-picker-lifetime-test__');
  const circleInput = page.locator('[data-acceptance-id="social-circle-member-search"]');
  const audienceInput = page.locator('[data-acceptance-id="social-audience-people-search"]');
  await circleInput.fill('bob');
  await page.locator('[data-action-id="social-circle-member-search-run"]').click();
  await audienceInput.fill('bob');
  const circleRow = page.locator('[data-acceptance-id="social-circle-member-candidate"]');
  const audienceRow = page.locator('[data-acceptance-id="social-audience-actor"]');
  await circleRow.waitFor();
  await audienceRow.waitFor();
  await circleRow.click();
  await audienceRow.click();
  const beforeHide = await page.evaluate(() => ({ ...window.searchPickerLifetimeFixture.stats }));
  await page.getByRole('button', { name: 'Hide pickers', exact: true }).click();
  const hidden = await page.evaluate(() => ({ ...window.searchPickerLifetimeFixture.stats }));
  assert.equal(hidden.circleClears, beforeHide.circleClears, 'hiding cleared Circle picker results');
  assert.equal(hidden.peopleClears, beforeHide.peopleClears, 'hiding cleared audience picker results');
  const sampleCount = await page.evaluate(() => window.searchPickerLifetimeFixture.samples.length);
  await page.getByRole('button', { name: 'Show pickers', exact: true }).click();
  await page.waitForFunction(old => window.searchPickerLifetimeFixture.samples.length > old, sampleCount);
  const returned = await page.evaluate(() => window.searchPickerLifetimeFixture);
  assert.equal(returned.samples.at(-1).circleRows, 1, 'Circle results disappeared on first return frame');
  assert.equal(returned.samples.at(-1).audienceRows, 1, 'audience results disappeared on first return frame');
  assert.equal(returned.stats.peopleSearches, beforeHide.peopleSearches, 'revealing restarted a settled audience search');
  assert.equal(await circleInput.inputValue(), 'bob');
  assert.equal(await audienceInput.inputValue(), 'bob');
  assert.equal(await circleRow.locator('input').isChecked(), true, 'Circle selection was lost');
  assert.equal(await audienceRow.getAttribute('aria-pressed'), 'true', 'audience selection was lost');
  await page.getByRole('button', { name: 'Hide pickers', exact: true }).click();
  await page.getByRole('button', { name: 'Exit pickers', exact: true }).click();
  const exited = await page.evaluate(() => window.searchPickerLifetimeFixture);
  assert.equal(exited.stats.circleClears, beforeHide.circleClears + 1, 'hidden Circle exit did not release results once');
  assert.equal(exited.stats.peopleClears, beforeHide.peopleClears + 1, 'hidden audience exit did not release results once');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'search-picker-results.json'), JSON.stringify({
    evidence: 'component-only', beforeHide, exited,
  }, null, 2));
  const stationLayouts = [];
  for (const viewport of [
    { width: 320, height: 568 }, { width: 393, height: 852 },
    { width: 852, height: 393 },
  ]) {
    await page.setViewportSize(viewport);
    for (const longLabel of [false, true]) {
      await page.goto(`http://127.0.0.1:3265/__station-layout-test__${longLabel ? '?long' : ''}`);
      await page.locator('.station-entry-main').waitFor();
      for (const scale of [1, 1.35]) {
        await page.evaluate(multiplier => {
          document.querySelectorAll('.station-entry-copy > *,.station-entry-status')
            .forEach(node => {
              const baseline = node.dataset.originalFontSize
                ?? getComputedStyle(node).fontSize;
              node.dataset.originalFontSize = baseline;
              node.style.fontSize = `${parseFloat(baseline) * multiplier}px`;
            });
        }, scale);
        const rows = await page.evaluate(() => Array.from(
          document.querySelectorAll('.station-entry-main,.station-suggestion'),
          button => {
            const rect = node => {
              const { left, right, width, height } = node.getBoundingClientRect();
              return { left, right, width, height };
            };
            return {
              button: rect(button),
              label: rect(button.querySelector('.station-entry-copy')),
              status: rect(button.querySelector('.station-entry-status')),
              icon: rect(button.querySelector('svg')),
            };
          },
        ));
        for (const row of rows) {
          assert(row.label.width >= 44,
            `Station identity collapsed: ${JSON.stringify({ viewport, longLabel, scale, row })}`);
          assert(row.label.left >= row.button.left && row.label.right <= row.button.right,
            'Station label escaped its control');
          assert(row.status.left >= row.label.right - 1 && row.status.right <= row.button.right,
            'Station status overlaps the identity or escapes its control');
          assert(row.button.width >= 44 && row.button.height >= 44, 'Station action lost its touch target');
          assert(row.icon.width >= 17, 'Station icon shrank to fit the label');
          assert(row.button.left >= 0 && row.button.right <= viewport.width,
            'Station row escaped the viewport');
        }
        stationLayouts.push({ viewport, longLabel, scale, rows });
      }
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'station-layout-results.json'), JSON.stringify({
    evidence: 'component-only', stationLayouts,
  }, null, 2));
  await page.screenshot({ path: resolve(output, 'station-layout.png') });
  const debugPage = await browser.newPage({ isMobile: true, hasTouch: true });
  page = debugPage;
  const debugTouch = await debugPage.context().newCDPSession(debugPage);
  debugPage.on('pageerror', error => errors.push(error.message));
  const debugLayouts = [];
  for (const viewport of [
    { width: 320, height: 568 }, { width: 393, height: 852 },
    { width: 852, height: 393 },
  ]) {
    await debugPage.setViewportSize(viewport);
    await debugPage.goto('http://127.0.0.1:3265/__debug-panel-test__');
    await debugPage.evaluate(() => {
      document.documentElement.style.setProperty('--safe-area-top', '47px');
      document.documentElement.style.setProperty('--safe-area-bottom', '34px');
    });
    const trigger = debugPage.locator('[data-acceptance-debug-toggle]');
    const close = debugPage.locator('[data-acceptance-debug-close]');
    const panel = debugPage.locator('[data-acceptance-debug-panel]');
    const underlying = debugPage.locator('[data-test-debug-underlying]');
    await trigger.waitFor();
    await underlying.evaluate(node => { node.scrollTop = 203; });
    const normal = debugPage.locator('[data-action-id="debug.fixture.normal-action"]');
    const triggerBox = await trigger.boundingBox();
    const normalBox = await normal.boundingBox();
    assert(triggerBox.y + triggerBox.height <= normalBox.y, 'Debug covers normal bottom actions');
    await trigger.tap();
    await panel.waitFor();
    await close.tap();
    await panel.waitFor({ state: 'hidden', timeout: 2000 });
    await trigger.tap();
    await panel.waitFor();
    await debugPage.locator('[data-acceptance-debug-timestamp]').waitFor();
    await debugPage.locator('.mobile-debug-drawer').evaluate(node => (
      Promise.all(node.getAnimations().map(animation => animation.finished))
    ));
    const scroll = debugPage.locator('.mobile-debug-drawer .pt-dialog-body');
    const before = await scroll.evaluate(node => ({
      top: node.scrollTop, height: node.clientHeight, total: node.scrollHeight,
    }));
    assert(before.total > before.height, 'Debug fixture must exercise overflowing diagnostic content');
    const header = debugPage.locator('.mobile-debug-drawer [data-action-id="drawer.close"]');
    const headerBox = await header.boundingBox();
    assert(headerBox.y >= 47 && headerBox.width >= 44 && headerBox.height >= 44,
      'Debug close is outside the safe area or lacks a touch target');
    const scrollBox = await scroll.boundingBox();
    const x = scrollBox.x + scrollBox.width / 2;
    const startY = scrollBox.y + scrollBox.height * 0.8;
    const endY = scrollBox.y + scrollBox.height * 0.2;
    await debugTouch.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x, y: startY }],
    });
    for (let step = 1; step <= 8; step += 1) {
      await debugTouch.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x, y: startY + (endY - startY) * step / 8 }],
      });
      await debugPage.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(resolveFrame)));
    }
    await debugTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await debugPage.waitForFunction(() => (
      document.querySelector('.mobile-debug-drawer .pt-dialog-body')?.scrollTop > 0
    ));
    const after = await scroll.evaluate(node => node.scrollTop);
    assert.deepEqual(await header.boundingBox(), headerBox, 'Debug close scrolls away with diagnostics');
    await header.tap();
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await underlying.evaluate(node => node.scrollTop), 203, 'Debug changed underlying scroll');
    await normal.tap();
    await debugPage.getByRole('button', { name: 'Normal action 1', exact: true }).waitFor();
    await trigger.tap();
    await panel.waitFor();
    await debugPage.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    await trigger.tap();
    await panel.waitFor();
    await debugPage.locator('.pt-drawer-layer').tap({ position: { x: 10, y: 52 } });
    await panel.waitFor({ state: 'hidden' });
    debugLayouts.push({ viewport, before, after, headerBox });
    await debugPage.screenshot({ path: resolve(output, `debug-closed-${viewport.width}.png`) });
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'debug-panel-results.json'), JSON.stringify({
    evidence: 'component-only', debugLayouts,
  }, null, 2));
  await debugPage.close();
  const inputPage = await browser.newPage({ isMobile: true, hasTouch: true, viewport: { width: 393, height: 852 } });
  page = inputPage;
  inputPage.on('pageerror', error => errors.push(error.message));
  const inputChecks = [];
  const assertNoEditing = async stage => {
    await inputPage.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    const active = await inputPage.evaluate(() => ({
      tag: document.activeElement?.tagName,
      editable: document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'),
    }));
    assert.equal(active.editable, false, `${stage} automatically activated an input: ${JSON.stringify(active)}`);
    inputChecks.push({ stage, active });
  };
  await inputPage.goto('http://127.0.0.1:3265/__input-activation-test__');
  await inputPage.locator('[data-action-id="moments.search.open"]').waitFor();
  await assertNoEditing('page entry');
  await inputPage.locator('[data-action-id="moments.search.open"]').tap();
  await assertNoEditing('reveal search');
  const search = inputPage.locator('[data-focus-id="moments.search.feed"]');
  await search.tap();
  assert(await search.evaluate(node => document.activeElement === node), 'real input tap did not activate search');
  await search.fill('kept query');
  await inputPage.locator('[data-action-id="fixture.circle"]').tap();
  await inputPage.locator('[data-acceptance-id="social-circle-create-name"]').waitFor();
  await assertNoEditing('create circle');
  await inputPage.locator('[data-action-id="social-circle-create-cancel"]').tap();
  await assertNoEditing('close circle');
  assert.equal(await search.inputValue(), 'kept query');
  const message = inputPage.getByRole('textbox', { name: 'Write message', exact: true });
  await message.tap();
  assert(await message.evaluate(node => document.activeElement === node), 'real composer tap did not activate input');
  await inputPage.locator('[data-action-id="fixture.reply"]').tap();
  await assertNoEditing('reply');
  assert.equal(await message.inputValue(), 'kept draft');
  await inputPage.locator('[data-action-id="fixture.edit"]').tap();
  await assertNoEditing('edit');
  assert.equal(await message.inputValue(), 'edit text');
  await message.tap();
  await inputPage.locator('[data-action-id="chat.composer.emoji"]').tap();
  await assertNoEditing('open emoji');
  await inputPage.locator('.emoji-panel button').first().tap();
  await assertNoEditing('insert emoji');
  assert.equal(await message.inputValue(), 'edit text😀');
  await inputPage.locator('[data-action-id="chat.send-message"]').tap();
  await assertNoEditing('send');
  await inputPage.locator('[data-action-id="fixture.dialog"]').tap();
  await inputPage.getByRole('dialog', { name: 'Write a name' }).waitFor();
  await assertNoEditing('dialog entry with autofocus fields');
  await inputPage.keyboard.press('Tab');
  // The close button precedes editable fields in the dialog tab order.
  await inputPage.keyboard.press('Tab');
  assert(await inputPage.getByRole('textbox', { name: 'Dialog input', exact: true }).evaluate(node => node === document.activeElement),
    'hardware Tab did not reach the dialog input');
  await inputPage.keyboard.press('Escape');
  await inputPage.getByRole('dialog', { name: 'Write a name' }).waitFor({ state: 'hidden' });
  await assertNoEditing('dialog dismiss');
  // Recovery can appear while an input is active, without a clicked trigger.
  await message.tap();
  await inputPage.locator('[data-action-id="fixture.recovery"]').evaluate(node => node.click());
  await inputPage.locator('[data-acceptance-id="recovery-scope-exit"]').waitFor();
  await inputPage.locator('[data-acceptance-id="recovery-scope-exit-cancel"]').tap();
  await assertNoEditing('recovery dismiss');
  await inputPage.locator('[data-action-id="inline.edit"]').tap();
  await assertNoEditing('inline edit entry');
  await inputPage.locator('[data-action-id="fixture.boundary"]').tap();
  await assertNoEditing('focus boundary entry');
  await inputPage.locator('[data-action-id="fixture.boundary.close"]').tap();
  await inputPage.getByRole('button', { name: 'Validate', exact: true }).tap();
  await inputPage.getByText('Name required', { exact: true }).waitFor();
  await assertNoEditing('asynchronous form validation');
  await inputPage.goto('http://127.0.0.1:3265/__input-activation-test__?automatic');
  await inputPage.locator('[data-action-id="fixture.dialog"]').tap();
  await inputPage.getByRole('dialog', { name: 'Write a name' }).waitFor();
  assert(await inputPage.getByRole('textbox', { name: 'Dialog input', exact: true }).evaluate(node => node === document.activeElement),
    'automatic Desktop policy lost initial input focus');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'input-activation-results.json'), JSON.stringify({
    evidence: 'component-only', inputChecks, directInputTap: true, hardwareTab: true, automaticPolicy: true,
  }, null, 2));
  await inputPage.close();
  const swipePage = await browser.newPage({ isMobile: true, hasTouch: true, viewport: { width: 393, height: 852 } });
  page = swipePage;
  swipePage.on('pageerror', error => errors.push(error.message));
  const swipeTouch = await swipePage.context().newCDPSession(swipePage);
  const swipe = async (x, y, dx, dy = 0, cancel = false, multiple = false, durationMs = 0, holdMs = 0) => {
    const points = (px, py) => [{ x: px, y: py, id: 1 },
      ...(multiple ? [{ x: px + 20, y: py + 20, id: 2 }] : [])];
    await swipeTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(x, y) });
    if (holdMs) await swipePage.waitForTimeout(holdMs);
    for (let step = 1; step <= 8; step += 1) {
      if (durationMs) await swipePage.waitForTimeout(durationMs / 8);
      await swipeTouch.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: points(x + dx * step / 8, y + dy * step / 8),
      });
    }
    await swipeTouch.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    await swipePage.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  };
  const swipeRoute = () => swipePage.locator('[data-swipe-root]').getAttribute('data-route');
  const swipeChecks = [];
  for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 852, height: 393 }]) {
    await swipePage.setViewportSize(viewport);
    await swipePage.goto('http://127.0.0.1:3265/__mobile-tab-swipe-test__');
    const chatPage = swipePage.locator('[data-swipe-page="tab:chat"]');
    await chatPage.waitFor();
    await swipePage.getByLabel('tab:chat query', { exact: true }).fill('kept query');
    await chatPage.evaluate(node => { node.scrollTop = 287; });
    await swipePage.evaluate(() => {
      window.savedSwipePage = document.querySelector('[data-swipe-page="tab:chat"]');
    });
    const rootBox = await swipePage.locator('[data-swipe-root]').boundingBox();
    const y = Math.min(rootBox.y + 240, viewport.height - 40);
    const left = viewport.width * 0.2, right = viewport.width * 0.8;
    await swipe(right, y, left - right);
    assert.equal(await swipeRoute(), 'tab:moments', 'left swipe did not switch to Moments');
    await swipe(right, y, left - right);
    assert.equal(await swipeRoute(), 'tab:settings', 'left swipe did not switch to Me');
    await swipe(right, y, left - right);
    assert.equal(await swipeRoute(), 'tab:settings', 'last tab wrapped to the beginning');
    await swipe(left, y, right - left);
    assert.equal(await swipeRoute(), 'tab:moments', 'right swipe did not switch back');
    await swipe(left, y, right - left);
    assert.equal(await swipeRoute(), 'tab:chat');
    assert(await chatPage.evaluate(node => node === window.savedSwipePage), 'swipe remounted the returning page');
    assert.equal(await chatPage.evaluate(node => node.scrollTop), 287, 'swipe return lost scroll');
    assert.equal(await swipePage.getByLabel('tab:chat query', { exact: true }).inputValue(), 'kept query');
    assert.equal(await swipePage.evaluate(() => document.activeElement?.matches('input,textarea')), false,
      'swipe return automatically activated editing');
    assert.equal(await swipePage.evaluate(() => window.mobileSwipeFixture.rowClicks), 0, 'swipe activated a conversation row');
    // Match the measured iOS gesture: 250ms initial press plus 480ms drag.
    await swipe(right, y, left - right, 0, false, false, 480, 250);
    assert.equal(await swipeRoute(), 'tab:moments', 'slow established horizontal pan was cancelled');
    await swipe(left, y, right - left);
    assert.equal(await swipeRoute(), 'tab:chat');
    await swipe(right, y, left - right, 0, false, false, 0, 550);
    assert.equal(await swipeRoute(), 'tab:chat', 'stationary long press became module navigation');
    const beforeScroll = await chatPage.evaluate(node => node.scrollTop);
    await swipe(viewport.width * 0.5, y, 3, -110);
    assert.equal(await swipeRoute(), 'tab:chat', 'vertical scroll switched modules');
    assert((await chatPage.evaluate(node => node.scrollTop)) > beforeScroll, 'vertical scrolling was blocked');
    await swipe(right, y, -18);
    assert.equal(await swipeRoute(), 'tab:chat', 'small movement switched modules');
    await swipe(right, y, left - right, 0, true);
    assert.equal(await swipeRoute(), 'tab:chat', 'cancelled swipe switched modules');
    await swipe(right, y, left - right, 0, false, true);
    assert.equal(await swipeRoute(), 'tab:chat', 'multi-touch switched modules');
    await chatPage.evaluate(node => { node.scrollTop = 0; });
    const inputBox = await swipePage.getByLabel('tab:chat query', { exact: true }).boundingBox();
    await swipe(inputBox.x + inputBox.width * 0.8, inputBox.y + inputBox.height / 2, -90);
    assert.equal(await swipeRoute(), 'tab:chat', 'editing gesture switched modules');
    const rail = swipePage.locator('[data-swipe-page="tab:chat"] [data-horizontal-scroll]');
    const railBox = await rail.boundingBox();
    await swipe(right, railBox.y + 30, left - right);
    assert.equal(await swipeRoute(), 'tab:chat', 'horizontal media rail switched modules');
    assert((await rail.evaluate(node => node.scrollLeft)) > 0, 'horizontal media scrolling was blocked');
    const excluded = await swipePage.locator('[data-swipe-page="tab:chat"] [data-mobile-swipe="exclude"]').boundingBox();
    await swipe(right, excluded.y + 30, left - right);
    assert.equal(await swipeRoute(), 'tab:chat', 'owned media gesture switched modules');
    await swipePage.getByRole('button', { name: 'Toggle detail', exact: true }).tap();
    await swipe(right, y, left - right);
    assert.equal(await swipeRoute(), 'tab:chat', 'detail view switched primary modules');
    await swipePage.getByRole('button', { name: 'Toggle detail', exact: true }).tap();
    await swipePage.getByRole('button', { name: 'Toggle exit guard', exact: true }).tap();
    await swipe(right, y, left - right);
    assert.equal(await swipeRoute(), 'tab:chat', 'swipe bypassed the existing exit guard');
    assert.equal(await swipePage.evaluate(() => window.mobileSwipeFixture.blockedExits), 1);
    swipeChecks.push({ viewport, navigation: true, retainedPage: true, retainedScroll: true,
      retainedQuery: true, verticalScroll: true, mediaRail: true, exitGuard: true,
      slowHorizontalPan: true, stationaryLongPress: true });
  }
  await swipePage.setViewportSize({ width: 393, height: 852 });
  await swipePage.goto('http://127.0.0.1:3265/__mobile-tab-swipe-test__?prototype');
  await swipePage.locator('.ma-root[data-tab="chats"]').waitFor();
  const prototypeBox = await swipePage.locator('.ma-body').boundingBox();
  const prototypeY = prototypeBox.y + Math.min(prototypeBox.height * 0.55, 300);
  await swipe(310, prototypeY, -220);
  await swipePage.locator('.ma-root[data-tab="moments"]').waitFor();
  await swipe(310, prototypeY, -220);
  await swipePage.locator('.ma-root[data-tab="settings"]').waitFor();
  await swipe(80, prototypeY, 220);
  await swipePage.locator('.ma-root[data-tab="moments"]').waitFor();
  await swipe(80, prototypeY, 220);
  await swipePage.locator('.ma-root[data-tab="chats"]').waitFor();
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'mobile-tab-swipe-results.json'), JSON.stringify({
    evidence: 'component-only', swipeChecks, actualPrototypeSwipes: true,
  }, null, 2));
  await swipePage.close();
  const chatPage = await browser.newPage({ isMobile: true, hasTouch: true, viewport: { width: 393, height: 852 } });
  page = chatPage;
  chatPage.on('pageerror', error => errors.push(error.message));
  const chatTouch = await chatPage.context().newCDPSession(chatPage);
  const chatSheetChecks = [];
  for (const viewport of [{ width: 320, height: 568 }, { width: 402, height: 874 }, { width: 874, height: 402 }]) {
    await chatPage.setViewportSize(viewport);
    await chatPage.goto('http://127.0.0.1:3265/__input-activation-test__?chat-surfaces');
    await chatPage.locator('[data-product-surface="chat.list-empty"]').waitFor();
    for (const surface of ['chat.message-actions', 'chat.group-management', 'chat.group-role-denied']) {
      await chatPage.evaluate(next => window.selectChatSurface(next), surface);
      const sheet = chatPage.getByRole('dialog');
      await sheet.waitFor();
      await sheet.evaluate(node => Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished)));
      assert.equal(await sheet.count(), 1, 'retained Chat page portaled a second modal');
      const marker = surface === 'chat.group-management'
        ? chatPage.locator('[data-acceptance-id="group-management"]')
        : chatPage.locator(`[data-product-surface="${surface}"]`);
      assert(await marker.evaluate(node => node.getAttribute('role') === 'dialog'),
        'surface marker measures scroll content instead of the bounded sheet');
      const box = await sheet.boundingBox();
      assert(box.y >= -1 && box.y + box.height <= viewport.height + 1, 'sheet escaped the viewport');
      assert(await sheet.evaluate(node => {
        const body = node.querySelector('.pt-sheet-body').getBoundingClientRect();
        const controls = [...node.querySelectorAll('button,input,textarea')].filter(control => {
          const rect = control.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top >= body.top - 1 && rect.bottom <= body.bottom + 1;
        });
        return controls.length > 0 && controls.every(control => {
          const rect = control.getBoundingClientRect();
          const boundary = control.closest('.pt-field-frame,.pt-switch') ?? control;
          return boundary.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        });
      }), `visible ${surface} controls are occluded`);
      const body = sheet.locator('.pt-sheet-body');
      const scrollBox = await body.boundingBox();
      const startY = Math.min(viewport.height - 42, scrollBox.y + scrollBox.height - 24);
      const endY = scrollBox.y + 24;
      for (let gesture = 0; gesture < 14 && !(await body.evaluate(node =>
        node.scrollTop + node.clientHeight >= node.scrollHeight - 2)); gesture += 1) {
        const x = scrollBox.x + scrollBox.width / 2;
        await chatTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY, id: 1 }] });
        for (let step = 1; step <= 8; step += 1) {
          await chatTouch.send('Input.dispatchTouchEvent', { type: 'touchMove',
            touchPoints: [{ x, y: startY + (endY - startY) * step / 8, id: 1 }] });
        }
        await chatTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await chatPage.waitForFunction(() => {
          const scroller = document.querySelector('.pt-sheet-body');
          return scroller && scroller.scrollTop > 0;
        });
        await chatPage.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
      }
      const last = sheet.locator('button').last();
      assert(await last.evaluate(node => {
        const rect = node.getBoundingClientRect(), parent = node.closest('.pt-sheet-body').getBoundingClientRect();
        return rect.top >= parent.top - 1 && rect.bottom <= parent.bottom + 1
          && node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), 'final Chat action is unreachable or occluded after touch scrolling');
      assert.equal(await chatPage.evaluate(() => document.activeElement?.matches('input,textarea')), false,
        'sheet automatically activated an input');
      if (surface === 'chat.message-actions') await sheet.locator('[data-action-id="chat.message-actions.close"]').tap();
      else await chatPage.locator('.pt-modal-layer').tap({ position: { x: 3, y: 3 } });
      await sheet.waitFor({ state: 'hidden' });
      assert.equal(await chatPage.locator('.pt-ui-content[inert]').count(), 0, 'dismissal kept the page inert');
      chatSheetChecks.push({ viewport, surface, oneModal: true, bounded: true, lastActionReachable: true, dismissal: true });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'chat-sheet-results.json'), JSON.stringify({
    evidence: 'component-only', chatSheetChecks,
  }, null, 2));
  await chatPage.close();
  console.log(`PASS component-only navigation lifetime; ${output}`);
} catch (error) {
  await page?.screenshot({ path: resolve(output, 'failure.png') });
  console.error(JSON.stringify(errors));
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
