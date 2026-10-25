import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function checkMessageLayout({ browser, url, output, viewports }) {
  const captures = [];
  const errors = [];
  const scaffoldErrors = [];
  const interactions = [];
  const measure = async (device) => device.evaluate((root) => {
    const viewport = root.querySelector('.mp-thread-messages');
    const bounds = (node) => {
      const r = node?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } : null;
    };
    const frame = bounds(viewport);
    const rows = [...viewport.querySelectorAll('.mp-message-row[data-scroll-anchor-id]')]
      .filter((row) => row.querySelector('.mp-message-content'));
    const violations = [];
    const check = (value, name, id = '') => { if (!value) violations.push(`${id}:${name}`); };
    const near = (a, b) => Math.abs(a - b) <= 1;
    const style = getComputedStyle(viewport);
    check(near(parseFloat(style.paddingLeft), parseFloat(style.paddingRight)), 'symmetric-viewport');
    check(viewport.scrollWidth <= viewport.clientWidth, 'viewport-overflow');
    const measurements = rows.map((row) => {
      const id = row.dataset.scrollAnchorId;
      const mine = row.classList.contains('mine');
      const start = row.classList.contains('cluster-start');
      const r = bounds(row);
      const slot = bounds(row.querySelector('.mp-message-avatar-slot'));
      const avatar = bounds(row.querySelector('.mp-identity-avatar'));
      const content = row.querySelector('.mp-message-content');
      const body = content.querySelector(':scope > .mp-reply-quote, :scope > .mp-message-image, :scope > .mp-message-file, :scope > .mp-bubble');
      const b = bounds(body);
      const sender = bounds(row.querySelector('.mp-message-sender'));
      check(Boolean(slot) && near(slot.width, 34), 'avatar-track', id);
      check(start === Boolean(avatar), 'first-row-avatar', id);
      if (avatar && b) check(near(avatar.top, b.top), 'avatar-body-top', id);
      if (b) {
        const inset = mine ? r.right - b.right : b.left - r.left;
        check(near(inset, 42), 'opposed-content-inset', id);
        if (body.textContent.length > 20) check(b.width >= Math.min(120, r.width * 0.5), 'readable-width', id);
        check(b.left >= frame.left && b.right <= frame.right, 'body-containment', id);
        if (sender) check(near(sender.left, b.left) && sender.bottom < b.top, 'sender-separate-row', id);
        check(body.scrollWidth <= body.clientWidth + 1, 'body-overflow', id);
      }
      const previous = row.previousElementSibling;
      const gap = previous?.classList.contains('mp-message-row')
        ? r.top - bounds(previous).bottom : null;
      if (gap !== null) check(near(gap, start ? 16 : 8), 'message-rhythm', id);
      return { id, mine, start, row: r, slot, avatar, body: b, sender, gap };
    });
    const file = viewport.querySelector('.mp-message-file');
    if (file) {
      const s = getComputedStyle(file);
      check(parseFloat(s.borderTopWidth) === 0 && parseFloat(s.borderRightWidth) === 0, 'native-file-border');
      check(bounds(file).height >= 44, 'file-touch-target');
    }
    const composer = bounds(root.querySelector('.mp-composer'));
    check(near(composer.top, frame.bottom), 'composer-boundary');
    return { violations, rows: measurements, frame, composer };
  });
  for (const viewport of viewports) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport, hasTouch: true, reducedMotion: 'reduce' });
      page.setDefaultTimeout(10000);
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const entry = { message: m.text(), url: m.location().url };
        if (entry.url.endsWith('/favicon.ico') && /404/.test(entry.message)) scaffoldErrors.push(entry);
        else errors.push(entry);
      });
      const device = page.getByRole('region', { name: 'Mobile device preview' });
      async function open(scenario) {
        await page.goto(`${url}/?site=mobile&scenario=${scenario}`);
        await device.waitFor();
        await device.locator('.mp-thread-messages').waitFor();
        if (theme === 'dark') await page.locator('.ant-segmented-item-label').getByText('Dark', { exact: true }).click();
      }
      async function capture(state) {
        const filename = `${viewport.width}-${theme}-${state}.png`;
        const fullscreen = page.getByRole('button', { name: '全屏预览', exact: true });
        if (await fullscreen.count()) await fullscreen.click();
        await device.scrollIntoViewIfNeeded();
        await device.screenshot({ path: resolve(output, filename), animations: 'disabled' });
        const geometry = await measure(device);
        captures.push({ state, viewport, theme, filename, geometry });
        return geometry;
      }
      await open('chat-delivery-recovery');
      const initial = await capture('recovery');
      await device.locator('[data-scroll-anchor-id="m8"]').scrollIntoViewIfNeeded();
      await capture('file-context');
      // Geometry must pass before the dynamic checks can establish usable layout.
      if (initial.violations.length === 0) {
        const card = device.locator('.mp-message-file').first();
        await card.tap();
        await device.locator('[data-chat-file-detail]').waitFor();
        assert.equal(await device.getByRole('dialog').count(), 1);
        await device.getByRole('button', { name: 'Cancel download', exact: true }).click();
        await device.getByRole('button', { name: 'Retry download', exact: true }).click();
        await device.getByRole('button', { name: 'Save a copy', exact: true }).waitFor({ state: 'visible' });
        await device.getByRole('button', { name: 'Save a copy', exact: true }).click({ timeout: 10000 });
        await page.keyboard.press('Escape');
        await device.locator('[data-chat-file-detail]').waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.activeElement?.classList.contains('mp-message-file'));
        assert.equal(await card.evaluate((el) => el === document.activeElement), true);
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await card.evaluate((el) => el.matches(':focus-visible')), true);
        assert.equal(await card.evaluate((el) => getComputedStyle(el).outlineWidth), '2px');
        await page.keyboard.press('Enter');
        await device.locator('[data-chat-file-detail]').waitFor();
        await page.keyboard.press('Escape');
        await device.locator('[data-chat-file-detail]').waitFor({ state: 'detached' });
        await device.locator('[data-scroll-anchor-id="release-hold-001"]').scrollIntoViewIfNeeded();
        const retry = device.locator('.mp-message-retry').first();
        await retry.tap();
        await device.locator('[data-scroll-anchor-id="release-hold-mobile-ack"]').waitFor();
        assert.equal(await device.locator('.mp-message-retry').count(), 0);
        await capture('recovered');
        interactions.push({ viewport, theme, fileTouch: true, downloadCancelRetry: true, keyboardOpenClose: true, focusRestored: true, deliveryRetry: true });
      }
      await open('chat-unknown-outcome');
      await capture('unknown');
      if (initial.violations.length === 0) {
        await device.getByRole('button', { name: 'Check status', exact: true }).tap();
        await device.locator('[data-scroll-anchor-id="release-hold-mobile-ack"]').waitFor();
        await capture('status-resolved');
      }
      await open('chat-delivery-recovery');
      const input = device.getByPlaceholder('Message', { exact: true });
      await input.fill('Morgen besprechen wir die geräteübergreifende Wiederherstellung. 发布前请逐项核对消息、附件和连接状态。'.repeat(3));
      await input.press('Enter');
      await capture('long-message');
      // CSS stress case: mutate only the label, not mock message state or actions.
      await device.locator('.mp-file-name').first().evaluate((el) => {
        el.textContent = '发布协同_InternationalProductArchitecture_gerätübergreifende_Wiederherstellung_2026.pdf';
      });
      await device.locator('.mp-message-file').first().scrollIntoViewIfNeeded();
      await capture('long-file-css-stress');
      if (initial.violations.length === 0) {
        const row = device.locator('.mp-message-content').first();
        await row.scrollIntoViewIfNeeded();
        const shiftedId = await row.evaluate((el) => {
          el.style.setProperty('transition', 'none', 'important');
          el.style.transform = 'translateX(4px)';
          return el.parentElement.dataset.scrollAnchorId;
        });
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const shifted = await measure(device);
        assert(shifted.violations.some((v) => v.includes('opposed-content-inset')), JSON.stringify({ assertion: 'shifted body must fail', shiftedId, firstRow: shifted.rows[0], violations: shifted.violations }));
        await row.evaluate((el) => { el.style.transform = ''; el.style.removeProperty('transition'); });
        const scroller = device.locator('.mp-thread-messages');
        await scroller.evaluate((el) => { el.style.setProperty('transition', 'none', 'important'); el.style.paddingLeft = '18px'; });
        assert((await measure(device)).violations.some((v) => v.includes('symmetric-viewport')), 'unbalanced inset must fail');
        await scroller.evaluate((el) => { el.style.paddingLeft = ''; el.style.removeProperty('transition'); });
      }
      await page.close();
    }
  }
  const defects = captures.filter((c) => c.geometry.violations.length);
  await writeFile(resolve(output, 'message-layout.json'), JSON.stringify({ evidenceType: 'prototype-only', captures, interactions, errors, scaffoldErrors, defects }, null, 2));
  console.log(JSON.stringify({ captures: captures.length, interactions: interactions.length, errors, defects: defects.map(({ filename, geometry }) => ({ filename, violations: geometry.violations })) }, null, 2));
  assert.deepEqual(errors, [], 'no browser errors');
  assert.equal(defects.length, 0, 'message symmetry, alignment and rhythm');
}
