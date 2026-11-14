/**
 * Long-list evidence on the ONE product surface.
 *
 * The old harness virtual-window contract (data-window-*) is retired with its
 * duplicate skin. Volume/filter/continuity is now evidence on the product
 * lists themselves via the `long-lists` injected AppState: 240 conversations,
 * 240 contacts and a 480-message thread, all rendered by MobileApp.
 *
 * Run: PROTOTYPE_URL=http://localhost:3108 node scripts/check-long-lists.mjs
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const url = process.env.PROTOTYPE_URL ?? 'http://localhost:3108';
const output = resolve(repoRoot, 'apps/mobile/src-tauri/target/prototype-long-lists');
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const reports = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1100 }]) {
    const page = await browser.newPage({ viewport, colorScheme: 'light' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const device = page.getByRole('region', { name: 'Mobile device preview' });
    await page.goto(`${url}/?scenario=long-lists`);
    await device.waitFor();
    await page.waitForTimeout(600);

    const convRows = device.locator('.ma-conv-item');
    assert.equal(await convRows.count(), 240, '240 conversations seeded');

    // In-place rail filter narrows the list live; clearing restores volume.
    await device.locator('.ma-rail-header button[aria-label="搜索"]').click();
    await page.waitForTimeout(200);
    await device.locator('.ma-rail-header input').fill('240');
    await page.waitForTimeout(200);
    assert.equal(await convRows.count(), 1, 'filter 240 → one conversation');
    await device.locator('.ma-rail-header input').fill('no-such-row-zzz');
    await page.waitForTimeout(150);
    assert.equal(await convRows.count(), 0, 'no match → empty');
    await device.locator("[data-action-id='ma.rail-search-close']").click();
    await page.waitForTimeout(200);
    assert.equal(await convRows.count(), 240, 'clear restores 240');

    // Open the 480-message thread: tail reached, no horizontal overflow.
    await convRows.first().click();
    await device.locator('.ma-messages').waitFor();
    await page.waitForTimeout(300);
    const bubbles = await device.locator('.ma-messages .ma-bubble').count();
    assert.ok(bubbles >= 478, `expected ~480 seeded messages, got ${bubbles}`);
    const overflow = await device.locator('.ma-messages').evaluate(
      el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false, 'thread never overflows horizontally');

    // Sending appends to the live tail.
    const before = await device.locator('.ma-messages .ma-bubble').count();
    await device.getByRole('textbox', { name: '消息' }).fill('local-long-list-check');
    await device.getByRole('button', { name: '发送' }).click();
    await page.waitForTimeout(200);
    assert.equal(await device.locator('.ma-messages .ma-bubble').count(), before + 1, 'send appends one bubble');

    // Contacts segment carries the 240 people.
    await device.getByRole('button', { name: '返回' }).click();
    await page.waitForTimeout(200);
    await device.locator('[data-action-id="segment.contacts"]').click();
    await page.waitForTimeout(300);
    // 240 people + 80 generated groups = 320 contact rows.
    assert.equal(await device.locator('.ma-contact-row').count(), 320, '240 people + 80 groups');
    assert.equal(await device.locator('.ma-contact-friend .ma-contact-row').count(), 240, '240 people');

    // Device never scrolls horizontally.
    const deviceOverflow = await device.evaluate(
      el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(deviceOverflow, false, 'device horizontal overflow');

    await device.screenshot({ path: resolve(output, `${viewport.width}-long-lists.png`) });
    reports.push({ viewport, conversations: 240, contacts: 320, threadMessages: bubbles, errors: [...errors] });
    assert.deepEqual(errors, [], `runtime errors at ${viewport.width}`);
    await page.close();
  }
} finally {
  await browser.close();
}
process.stdout.write(`${JSON.stringify({ evidenceType: 'prototype-sample-only', reports }, null, 2)}\n`);
