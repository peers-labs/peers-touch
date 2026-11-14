/**
 * Single-skin residue guard.
 *
 * The mobile package renders ONE product UI (src/app, ma-* layout + peers-ui
 * primitives). The historical second harness skin (MobileShell, pages/*,
 * English demo seeds, mp-* product chrome) is deleted; this gate fails if it
 * reappears — both in the source tree and at runtime.
 *
 * Run: PROTOTYPE_URL=http://localhost:3108 node scripts/check-residual-parity.mjs
 */
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const pkg = resolve(repoRoot, 'packages/prototypes/mobile/chat');
const exists = async p => access(p).then(() => true, () => false);

// ── Source tree: duplicate skin must stay deleted ──
const deleted = [
  'src/MobileShell.tsx',
  'src/pages/ChatPage.tsx',
  'src/pages/MomentsPage.tsx',
  'src/pages/LaunchScreen.tsx',
  'src/data.ts',
  'src/longListDemo.ts',
  'src/socialDemo.ts',
  'src/types.ts',
];
for (const rel of deleted) {
  assert.equal(await exists(resolve(pkg, rel)), false, `deleted harness skin file reappeared: ${rel}`);
}
assert.equal(await exists(resolve(pkg, 'src/pages')), false, 'src/pages duplicate product tree must stay removed');

// The harness CSS styles ONLY the workbench/device frame, never a product skin.
const harnessCss = await readFile(resolve(pkg, 'src/mobilePrototype.css'), 'utf8');
for (const banned of ['.mp-shell', '.mp-tabbar', '.mp-conversation-item', '.mp-social-moment', '.mp-thread']) {
  assert.ok(!harnessCss.includes(banned), `harness css must not style product skin class ${banned}`);
}

// ── Runtime: no antd, no mp-* product nodes, no English demo seeds ──
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const url = process.env.PTOTOTYPE_URL ?? process.env.PROTOTYPE_URL ?? 'http://localhost:3108';
const browser = await chromium.launch({ headless: true });
const reports = [];
try {
  for (const scenario of ['default', 'long-lists']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${url}/?scenario=${scenario}`);
    await page.getByRole('region', { name: 'Mobile device preview' }).waitFor();
    await page.waitForTimeout(500);
    const found = await page.evaluate(() => ({
      ant: document.querySelectorAll('[class*="ant-"]').length,
      mpSkin: document.querySelectorAll('.mp-shell,.mp-tabbar,.mp-conversation-item,.mp-social-moment,.mp-launch-screen').length,
      // English harness demo names must not render anywhere.
      englishSeeds: (document.body.innerText.match(/Alice Chen|Release Room|David Wu/g) || []).length,
      productTabs: document.querySelectorAll('.pt-mobile-tabbar button').length,
    }));
    reports.push({ scenario, ...found, errors });
    await page.close();
  }
} finally {
  await browser.close();
}

for (const r of reports) {
  assert.equal(r.ant, 0, `${r.scenario}: antd residue`);
  assert.equal(r.mpSkin, 0, `${r.scenario}: duplicate mp-* skin rendered`);
  assert.equal(r.englishSeeds, 0, `${r.scenario}: English demo seeds rendered`);
  assert.equal(r.productTabs, 3, `${r.scenario}: expected exactly 3 product tabs`);
  assert.deepEqual(r.errors, [], `${r.scenario}: runtime errors`);
}
process.stdout.write(`${JSON.stringify({ status: 'passed', reports }, null, 2)}\n`);
