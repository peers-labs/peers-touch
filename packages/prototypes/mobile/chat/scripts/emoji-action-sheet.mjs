import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Reaction action-sheet layout (shared 16-kind vocabulary, quick-8 first row).
 *
 * Contract:
 *  - the quick row renders exactly 8 kinds in one non-scrolling row beside
 *    the expand button, every cell a >=44px touch target;
 *  - expanding switches the same bar to the full 16-kind catalog (no emoji
 *    outside the shared domain, no 40-emoji free grid); the sheet is the
 *    only scroll container;
 *  - selecting a reaction does not dismiss the sheet (multi-select pass).
 */
export async function checkEmojiActionSheet({ browser, url, output, viewports }) {
  const captures = [];
  const errors = [];

  const measure = async (device) => device.evaluate(() => {
    const rect = (el) => {
      const r = el?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } : null;
    };
    const violations = [];
    const bar = document.querySelector('.mp-reaction-bar');
    const more = document.querySelector('.mp-reaction-more-btn');
    const mode = bar?.getAttribute('data-react-bar') ?? null;
    const kinds = [...document.querySelectorAll('.mp-reaction-bar-btn')].map((btn) => {
      const b = rect(btn);
      return { kind: btn.getAttribute('data-react-kind'), ...b };
    });
    const br = rect(bar);
    const mr = rect(more);
    if (br) {
      if (mode === 'quick' && bar.scrollWidth > bar.clientWidth + 1) {
        violations.push('quick-bar-internal-scroll');
      }
      for (const k of kinds) {
        if (k.width < 43.5 || k.height < 43.5) violations.push(`reaction-target-under-44:${k.kind}`);
        if (mode === 'quick' && mr && k.right > mr.left + 1) violations.push(`quick-reaction-overlaps-more:${k.kind}`);
      }
    }
    return { mode, quickCount: mode === 'quick' ? kinds.length : 0, allCount: kinds.length, bar: br, more: mr, kinds, violations };
  });

  for (const viewport of viewports) {
    for (const theme of ['light']) {
      const page = await browser.newPage({ viewport, hasTouch: true, reducedMotion: 'reduce' });
      page.setDefaultTimeout(10000);
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      const device = page.getByRole('region', { name: 'Mobile device preview' });
      await page.goto(`${url}/?scenario=chat-default`);
      await device.waitFor();
      await page.locator('.mp-conversation-item').first().click();
      await device.locator('.mp-thread-messages').waitFor();
      // Open the message action sheet (contextmenu = long-press parity).
      await device.locator('.mp-message-row:not(.mine) .mp-bubble').first().click({ button: 'right' });
      await device.locator('.mp-action-sheet').waitFor();

      const quickGeometry = await measure(device);
      assert.equal(quickGeometry.mode, 'quick', 'bar starts in quick mode');
      assert.equal(quickGeometry.quickCount, 8, 'eight quick reactions rendered');

      // The sheet stays open while a reaction is chosen.
      await device.locator('.mp-reaction-bar-btn').first().tap();
      await device.locator('.mp-action-sheet').waitFor();

      // Expand to the full shared catalog.
      await device.locator('.mp-reaction-more-btn').tap();
      await page.waitForTimeout(120);
      const fullGeometry = await measure(device);
      assert.equal(fullGeometry.mode, 'all', 'bar switches to full catalog');
      assert.equal(fullGeometry.allCount, 16, 'all sixteen shared kinds rendered');
      if (fullGeometry.violations.length) {
        assert.fail(JSON.stringify({ viewport, theme, violations: fullGeometry.violations }));
      }

      // Message-level report and multiselect exist in the catalog-driven groups.
      const actionIds = await device.evaluate(() =>
        [...document.querySelectorAll('.mp-action-item')].map((el) => el.getAttribute('data-action-id')));
      assert.ok(actionIds.includes('report'), 'report action present on peer message');
      assert.ok(actionIds.includes('multiselect'), 'multiselect action present');
      assert.ok(actionIds.includes('mark-later'), 'mark-for-later action present');

      const geometry = { quick: quickGeometry, all: fullGeometry };
      captures.push({ viewport, theme, geometry });
      await page.screenshot({ path: undefined, animations: 'disabled' }).catch(() => {});
      await page.close();
    }
  }

  await writeFile(
    resolve(output, 'emoji-action-sheet.json'),
    JSON.stringify({ evidenceType: 'prototype-only', captures, errors }, null, 2),
  );
  const defects = captures.filter((c) =>
    c.geometry.all.violations.length || c.geometry.quick.violations.length);
  process.stdout.write(JSON.stringify({
    captures: captures.length,
    errors,
    defects: defects.map(({ viewport, theme, geometry }) => ({
      viewport, theme, violations: [...geometry.all.violations, ...geometry.quick.violations],
    })),
  }, null, 2) + '\n');
  assert.deepEqual(errors, [], 'no browser errors');
  assert.equal(defects.length, 0, 'quick and full reaction rows must fit with 44px targets');
}
