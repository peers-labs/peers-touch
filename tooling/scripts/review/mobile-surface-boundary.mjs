/**
 * mobile-surface-boundary.mjs — enforces the ONE mobile product surface.
 *
 * Current contract (the historical two-skin seam is retired):
 *  - Product UI : src/app/** + MobileApp.tsx — the only rendered mobile UI,
 *    ma-* layout + @peers-touch/ui, shared data with the desktop prototype.
 *  - Evidence host : MobilePrototype.tsx — a thin scenario host that renders
 *    <MobileApp scenario=…/>; it injects AppState, it never owns views.
 *
 * Guard rules:
 *  1. the deleted duplicate skin (MobileShell, pages/*, components/*, English
 *     demo seeds) must never reappear;
 *  2. there is no second view layer — outside src/app only MobilePrototype
 *     exists and it may only mount MobileApp / read app/model (scenario
 *     vocabulary), never define its own screens.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PKG = path.join(repoRoot, 'packages/prototypes/mobile/chat');
const SRC = path.join(PKG, 'src');

const FORBIDDEN = [
  'src/MobileShell.tsx',
  'src/pages',
  'src/components',
  'src/data.ts',
  'src/longListDemo.ts',
  'src/socialDemo.ts',
  'src/searchDemo.ts',
  'src/callPrototype.ts',
  'src/listPresentation.ts',
  'src/types.ts',
  'src/i18n.ts',
];

const violations = [];
for (const rel of FORBIDDEN) {
  if (fs.existsSync(path.join(PKG, rel))) violations.push(`deleted duplicate skin path reappeared: ${rel}`);
}

// The only src-root product-touching module is the thin host; it must mount
// the product entry and must not import any local view other than app/*.
const host = path.join(SRC, 'MobilePrototype.tsx');
const hostText = fs.readFileSync(host, 'utf8');
if (!/from '\.\/MobileApp'/.test(hostText)) {
  violations.push('MobilePrototype must render the product via ./MobileApp');
}
for (const m of hostText.matchAll(/from\s+'(\.[^']+)'/g)) {
  const spec = m[1];
  if (spec.startsWith('./pages') || spec.startsWith('./components') || /MobileShell|\bdata\b|socialDemo|callPrototype/.test(spec)) {
    violations.push(`MobilePrototype imports a parallel skin module: ${spec}`);
  }
}

// Everything under src/app is the product; no stray root view files allowed.
const allowedRootFiles = new Set([
  'main.tsx', 'MobileApp.tsx', 'MobilePrototype.tsx', 'viewport.ts',
  'mobile-app.css', 'mobilePrototype.css',
]);
for (const entry of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!allowedRootFiles.has(entry.name)) {
    violations.push(`unexpected src-root file (only the thin host is allowed): ${entry.name}`);
  }
}

if (violations.length) {
  console.error('mobile-surface-boundary: FAIL');
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log('mobile-surface-boundary: PASS (one product UI; evidence host only injects state)');
