#!/usr/bin/env node
/**
 * craft-gate.mjs — standalone runnable geometry craft gate (machine part of
 * gate ④ in the UI review pipeline).
 *
 *   node tooling/scripts/ui-system/craft-gate.mjs \
 *     [--url http://127.0.0.1:3291/?site=frontend-eles&eles=consumer] \
 *     [--root .cf-review] [--out <dir>]
 *
 * Exit 0 = battery clean; non-zero = geometry/native-leakage offenders.
 * Taste, Peers signature and product meaning are NOT judged here; they stay
 * an independent human verdict (see craft-quality.md §4/§10). This gate exists
 * so the class of defects a screenshot used to catch alone — raw OS controls,
 * stretched compact controls, corner collisions, frame escape — cannot merge.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runCraftBattery } from './craft-battery.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const requireFromRoot = createRequire(path.join(repoRoot, 'package.json'));
const { chromium } = requireFromRoot('.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs');

function parseArgs(argv) {
  const args = { base: 'http://127.0.0.1:3291', root: '.cf-review', out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--out') args.out = argv[++i];
  }
  args.url = args.url || `${args.base}/?site=frontend-eles&eles=consumer`;
  return args;
}

const args = parseArgs(process.argv);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));
try {
  await page.goto(args.url, { waitUntil: 'networkidle' });
  const fsBtn = page.getByRole('button', { name: /全屏|Exit fullscreen/ });
  if (await fsBtn.count()) {
    if (await fsBtn.first().isVisible()) await fsBtn.first().click();
  }
  await page.locator(args.root).waitFor({ state: 'visible' });
  const battery = await runCraftBattery(page, args.root);
  const result = {
    kind: 'peers-ui-craft-geometry-gate',
    runAt: new Date().toISOString(),
    url: args.url,
    root: args.root,
    pass: battery.pass && consoleErrors.length === 0,
    battery,
    consoleErrors: consoleErrors.slice(0, 10),
  };
  if (args.out) {
    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, 'craft-gate.json'), JSON.stringify(result, null, 2));
  }
  process.stdout.write(JSON.stringify({ pass: result.pass, offenders: battery.offenders, consoleErrors: result.consoleErrors }, null, 2) + '\n');
  process.exitCode = result.pass ? 0 : 1;
} finally {
  await browser.close();
}
