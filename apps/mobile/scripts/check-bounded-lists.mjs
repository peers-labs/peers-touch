import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(resolve(root, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const output = resolve(root, 'apps/mobile/src-tauri/target/list-history-browser');
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: resolve(root, 'apps/mobile'),
  esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'bounded-list-test-entry',
    configureServer(instance) {
      instance.middlewares.use((req, res, next) => {
        if (req.url !== '/__bounded-list-test__') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/bounded-list.tsx"></script></body></html>');
      });
    },
  }],
  server: { host: '127.0.0.1', port: 3264, strictPort: true },
});
let browser;
let activePage;
const browserErrors = [];
const results = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 900 }]) {
    const page = await browser.newPage({ viewport, locale: 'en-US' });
    page.setDefaultTimeout(10000);
    activePage = page;
    const errors = [];
    page.on('pageerror', (error) => { errors.push(error.message); browserErrors.push(error.message); });
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    await page.goto('http://127.0.0.1:3264/__bounded-list-test__');
    const rows = page.locator('[data-fixture-row]');
    await rows.first().waitFor();
    assert.equal(await rows.count(), 100);
    const seen = new Set();
    while (true) {
      for (const id of await rows.evaluateAll((nodes) => nodes.map((node) => node.dataset.fixtureRow))) seen.add(id);
      const next = page.getByRole('button', { name: 'Next', exact: true });
      if (!await next.count()) break;
      const start = await page.locator('[data-window-start]').getAttribute('data-window-start');
      await next.click();
      await page.waitForFunction((old) =>
        document.querySelector('[data-window-start]')?.getAttribute('data-window-start') !== old, start);
      assert.equal(await rows.count(), 100);
    }
    assert.equal(seen.size, 1250);
    await page.getByRole('button', { name: 'Find 17', exact: true }).click();
    await page.locator('[data-fixture-row="17"]').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-fixture-row') === '17');
    const anchor = page.locator('[data-fixture-row="17"]');
    const before = await anchor.boundingBox();
    await page.getByRole('button', { name: 'Prepend', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-window-total]')?.getAttribute('data-window-total') === '1251');
    const after = await anchor.boundingBox();
    assert(Math.abs(before.y - after.y) <= 1, `prepend displaced anchor ${before.y} -> ${after.y}`);
    await page.getByRole('button', { name: 'Detail', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await anchor.waitFor();
    assert(Math.abs((await anchor.boundingBox()).y - after.y) <= 1, 'detail return displaced anchor');
    await page.screenshot({ path: resolve(output, `${viewport.width}-restored.png`) });

    await page.getByRole('button', { name: 'Mode', exact: true }).click();
    await page.locator('[data-fixture-row="1249"]').waitFor();
    await page.waitForFunction(() => {
      const owner = document.querySelector('.page-container');
      return owner.scrollHeight - owner.scrollTop - owner.clientHeight < 2;
    });
    await page.getByRole('button', { name: 'Append', exact: true }).click();
    await page.locator('[data-fixture-row="1250"]').waitFor();
    const atBottom = await page.locator('.page-container').evaluate(
      (owner) => owner.scrollHeight - owner.scrollTop - owner.clientHeight < 2);
    assert(atBottom, 'new message did not follow the bottom reader');
    const previous = page.getByRole('button', { name: 'Previous', exact: true });
    await previous.scrollIntoViewIfNeeded();
    const overlap = await rows.first().getAttribute('data-fixture-row');
    const overlapBefore = await rows.first().boundingBox();
    await previous.click();
    await page.waitForFunction((id) => document.activeElement?.getAttribute('data-fixture-row') === id, overlap);
    assert(Math.abs((await page.locator(`[data-fixture-row="${overlap}"]`).boundingBox()).y - overlapBefore.y) <= 1,
      'older history changed the overlapping row offset');
    const historyStart = await page.locator('[data-window-start]').getAttribute('data-window-start');
    await page.locator('.page-container').evaluate((owner) => { owner.scrollTop = owner.scrollHeight; });
    await page.waitForTimeout(50);
    await page.getByRole('button', { name: 'Append', exact: true }).click();
    assert.equal(await page.locator('[data-window-start]').getAttribute('data-window-start'), historyStart,
      'end of an older window was mistaken for live tail');
    await page.getByRole('button', { name: 'Find 17', exact: true }).click();
    await anchor.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-fixture-row') === '17');
    const reading = await anchor.boundingBox();
    await page.getByRole('button', { name: 'Append', exact: true }).click();
    assert(Math.abs((await anchor.boundingBox()).y - reading.y) <= 1, 'new message displaced history reader');
    await page.getByRole('button', { name: 'Latest message', exact: true }).click();
    await page.locator('[data-fixture-row="1252"]').waitFor();
    await page.screenshot({ path: resolve(output, `${viewport.width}-latest.png`) });
    assert.equal(await rows.count(), 100);
    assert.deepEqual(errors, []);
    results.push({ viewport, visited: seen.size, maxMounted: 100, anchorStable: true, errors });
    await page.close();
  }
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ evidence: 'component-only', results }, null, 2));
  process.stdout.write(`${JSON.stringify(results)}\n`);
} catch (error) {
  await activePage?.screenshot({ path: resolve(output, 'failure.png') });
  process.stderr.write(`${JSON.stringify(browserErrors)}\n`);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
