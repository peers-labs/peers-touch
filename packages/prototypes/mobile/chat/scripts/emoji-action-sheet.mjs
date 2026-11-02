import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Reaction action-sheet emoji layout (increment 36).
 *
 * Regression this guards: the quick reaction row used fixed 40px cells inside
 * a hidden horizontal scroll, so the last emojis were pushed under the more
 * (···) button / off-sheet, and the full grid's internal 200px scroll cap hid
 * rows. Contract: all 8 quick reactions stay fully visible beside a fixed
 * more button at every device width (cells flex, no internal scroll), and
 * the full grid lays out all 40 emojis in 8 columns without clipping — the
 * sheet itself is the only scroll container.
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
    const quick = [...document.querySelectorAll('.mp-reaction-bar-btn')].map((btn) => {
      const b = rect(btn);
      return { emoji: btn.textContent, ...b };
    });
    const br = rect(bar);
    const mr = rect(more);
    if (br) {
      if (bar.scrollWidth > bar.clientWidth + 1) violations.push('quick-bar-internal-scroll');
      for (const q of quick) {
        if (mr && q.right > mr.left + 1) violations.push(`quick-emoji-overlaps-more:${q.emoji}`);
        if (q.width < 24) violations.push(`quick-emoji-target-under-24:${q.emoji}`);
      }
    }
    const grid = document.querySelector('.mp-emoji-grid');
    const gridState = grid
      ? {
          count: grid.querySelectorAll('button').length,
          columns: new Set([...grid.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().x))).size,
          internalScroll: grid.scrollHeight > grid.clientHeight + 1,
          cellsInside: [...grid.querySelectorAll('button')].every((b) => {
            const r = b.getBoundingClientRect();
            const g = grid.getBoundingClientRect();
            return r.top >= g.top - 1 && r.bottom <= g.bottom + 1 && r.width > 0;
          }),
        }
      : null;
    return { quickCount: quick.length, bar: br, more: mr, quick, grid: gridState, violations };
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
      assert.equal(quickGeometry.quickCount, 8, 'eight quick reactions rendered');
      // Expand the full emoji grid.
      await device.locator('.mp-reaction-more-btn').tap();
      await device.locator('.mp-emoji-grid').waitFor();
      const fullGeometry = await measure(device);
      assert.ok(fullGeometry.grid, 'full grid rendered');
      assert.equal(fullGeometry.grid.count, 40, 'forty emojis in full grid');
      assert.equal(fullGeometry.grid.columns, 8, 'eight columns');
      assert.equal(fullGeometry.grid.internalScroll, false, 'grid must not scroll internally');
      assert.equal(fullGeometry.grid.cellsInside, true, 'all grid cells inside grid bounds');
      const geometry = { ...quickGeometry, grid: fullGeometry.grid };
      captures.push({ viewport, theme, geometry });
      if (geometry.violations.length) {
        assert.fail(JSON.stringify({ viewport, theme, violations: geometry.violations }));
      }
      await page.screenshot({ path: undefined, animations: 'disabled' }).catch(() => {});
      await page.close();
    }
  }

  await writeFile(
    resolve(output, 'emoji-action-sheet.json'),
    JSON.stringify({ evidenceType: 'prototype-only', captures, errors }, null, 2),
  );
  const defects = captures.filter((c) => c.geometry.violations.length);
  process.stdout.write(JSON.stringify({
    captures: captures.length,
    errors,
    defects: defects.map(({ viewport, theme, geometry }) => ({ viewport, theme, violations: geometry.violations })),
  }, null, 2) + '\n');
  assert.deepEqual(errors, [], 'no browser errors');
  assert.equal(defects.length, 0, 'quick reactions and full grid must fit without clipping');
}
