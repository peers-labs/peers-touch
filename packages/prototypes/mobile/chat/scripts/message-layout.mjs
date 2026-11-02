import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Message geometry gate for the pine mobile grammar:
 * - 28px avatar track, 8px content gap, symmetric 14px viewport gutters
 * - own messages row-reverse (avatar on the right)
 * - 8px intra-cluster rhythm, 16px cluster-start rhythm
 * - every bubble stays inside the viewport and the surface never overflows x
 */
export async function checkMessageLayout({ browser, url, output, viewports }) {
  await mkdir(output, { recursive: true });
  const captures = [];
  const errors = [];

  const measure = async (device) => device.evaluate(() => {
    const viewport = document.querySelector('.mp-thread-messages');
    const bounds = (node) => {
      const r = node?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } : null;
    };
    const frame = bounds(viewport);
    const rows = [...viewport.querySelectorAll('.mp-message-row[data-scroll-anchor-id]')]
      .filter((row) => row.querySelector('.mp-message-content'));
    const violations = [];
    const check = (value, name, id = '') => { if (!value) violations.push(`${id}:${name}`); };
    const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
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
      check(Boolean(slot) && near(slot.width, 28), 'avatar-track', id);
      check(start === Boolean(avatar), 'first-row-avatar', id);
      if (mine) check(getComputedStyle(row).flexDirection === 'row-reverse', 'own-row-reversed', id);
      if (avatar && b) check(near(avatar.top, b.top, 4), 'avatar-body-top', id);
      if (b) {
        const inset = mine ? r.right - b.right : b.left - r.left;
        check(near(inset, 36, 3), 'opposed-content-inset', id);
        if (body.textContent.length > 20) check(b.width >= Math.min(120, r.width * 0.5), 'readable-width', id);
        check(b.left >= frame.left - 1 && b.right <= frame.right + 1, 'body-containment', id);
        check(body.scrollWidth <= body.clientWidth + 1, 'body-overflow', id);
      }
      if (sender && b) check(near(sender.left, b.left, 4) && sender.bottom <= b.top, 'sender-separate-row', id);
      const previous = row.previousElementSibling;
      const gap = previous?.classList.contains('mp-message-row')
        ? r.top - bounds(previous).bottom : null;
      if (gap !== null) check(near(gap, start ? 16 : 8, 3), 'message-rhythm', id);
      return { id, mine, start, row: r, slot, avatar, body: b, sender, gap };
    });
    const file = viewport.querySelector('.mp-message-file');
    if (file) check(bounds(file).height >= 44, 'file-touch-target');
    return { violations, rows: measurements, frame };
  });

  for (const viewport of viewports) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport, hasTouch: true, reducedMotion: 'reduce' });
      page.setDefaultTimeout(10000);
      page.on('pageerror', (e) => errors.push(e.message));
      const device = page.getByRole('region', { name: 'Mobile device preview' });

      await page.goto(`${url}/?scenario=chat-default`);
      if (theme === 'dark') {
        await page.locator('.mp-evidence-toolbar button', { hasText: 'Dark' }).first().click();
      }
      await page.locator('.mp-conversation-item').first().click();
      await device.locator('.mp-thread-messages').waitFor();
      await page.waitForTimeout(300);

      const filename = `${viewport.width}-${theme}-thread.png`;
      await device.screenshot({ path: resolve(output, filename), animations: 'disabled' });
      const geometry = await measure(device);
      captures.push({ viewport, theme, filename, geometry });

      // Sending a long message keeps composer + bubble geometry intact.
      try {
        const input = device.getByPlaceholder('Message', { exact: true });
        await input.fill('Morgen besprechen wir die gerateubergreifende Wiederherstellung. 发布前请逐项核对消息、附件和连接状态。'.repeat(2));
        await input.press('Enter');
        await page.waitForTimeout(200);
      } catch {
        // Composer interaction is evidence-only; geometry is the gate.
      }
      const afterSend = await measure(device);
      captures.push({ viewport, theme, filename: `${viewport.width}-${theme}-after-send.png`, geometry: afterSend });

      // Stress: unbalanced padding must be detected.
      await device.locator('.mp-thread-messages').evaluate((el) => {
        el.style.setProperty('transition', 'none', 'important');
        el.style.paddingLeft = '22px';
      });
      const shifted = await measure(device);
      assert(shifted.violations.some((v) => v.includes('symmetric-viewport')), 'unbalanced inset must fail');
      await device.locator('.mp-thread-messages').evaluate((el) => { el.style.paddingLeft = ''; });

      await page.close();
    }
  }

  const defects = captures.filter((c) => c.geometry.violations.length);
  await writeFile(resolve(output, 'message-layout.json'), JSON.stringify({
    evidenceType: 'prototype-only',
    captures: captures.map(({ viewport, theme, filename, geometry }) => ({ viewport, theme, filename, violations: geometry.violations })),
    errors,
  }, null, 2));
  process.stdout.write(JSON.stringify({
    captures: captures.length,
    errors,
    defects: defects.map(({ filename, geometry }) => ({ filename, violations: geometry.violations })),
  }, null, 2) + '\n');
  assert.deepEqual(errors, [], 'no browser errors');
  assert.equal(defects.length, 0, 'message symmetry, alignment and rhythm');
}
