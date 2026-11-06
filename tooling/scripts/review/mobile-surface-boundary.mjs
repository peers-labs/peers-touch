/**
 * mobile-surface-boundary.mjs — enforces the deliberate seam between the two
 * mobile surfaces in packages/prototypes/mobile/chat.
 *
 * Why this guard exists (long-term contract, not preference):
 *  - PRODUCT surface  : src/app/** + MobileApp.tsx
 *      reducer-driven Chinese product UI, ma-* DOM, asserted by boards.suite.
 *  - EVIDENCE harness : MobilePrototype/MobileShell/socialDemo/callPrototype/
 *      pages/components … scenario-injected acceptance rig, mp-* DOM, English
 *      controls, asserted by scripts/check-layout.mjs and check-call-states.py.
 *
 * The two have different locked contracts (state vocabularies, touch geometry,
 * language, scenario injection). Reusing one surface's VIEW inside the other
 * forces a mode/language/dual-DOM prop explosion, so view cross-imports are
 * forbidden. The intended reuse seam is @peers-touch/ui primitives/tokens and,
 * if genuinely headless domain is later shared, the pure entities in
 * src/app/model (no React, no UI). Widening this allowance is a deliberate
 * decision, never an accidental import.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MOBILE_SRC = path.join(repoRoot, 'packages/prototypes/mobile/chat/src');
const APP_DIR = path.join(MOBILE_SRC, 'app');

/** Evidence harness module basenames at src root (the scenario/acceptance rig). */
const EVIDENCE_ROOT_MODULES = new Set([
  'MobilePrototype', 'MobileShell', 'socialDemo', 'searchDemo', 'callPrototype',
  'longListDemo', 'listPresentation', 'data', 'i18n', 'types', 'viewport', 'main',
]);
/** Product VIEW modules the evidence rig must not couple to (model is allowed). */
const PRODUCT_VIEW_MODULES = new Set(['state', 'screens', 'primitives', 'CallScreen', 'MobileAppView']);

const violations = [];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function importsOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const specifiers = [];
  for (const m of text.matchAll(/(?:from\s+|import\s+|require\()\s*['"]([^'"]+)['"]/g)) {
    specifiers.push(m[1]);
  }
  return specifiers;
}

function resolveSpec(spec, fromFile) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return fs.existsSync(base) ? base : null;
}

function rel(p) { return path.relative(repoRoot, p).replaceAll(path.sep, '/'); }

const files = walk(MOBILE_SRC);
for (const file of files) {
  const inApp = file.startsWith(APP_DIR + path.sep);
  const isMobileAppEntry = file === path.join(MOBILE_SRC, 'MobileApp.tsx');
  const productSide = inApp || isMobileAppEntry;
  const relFromSrc = path.relative(MOBILE_SRC, file).replaceAll(path.sep, '/');
  const evidenceRootModule = !inApp && EVIDENCE_ROOT_MODULES.has(path.basename(file).replace(/\.(ts|tsx)$/, ''));
  const inEvidenceTree = !inApp && (relFromSrc.startsWith('pages/') || relFromSrc.startsWith('components/'));
  const evidenceSide = evidenceRootModule || inEvidenceTree;

  for (const spec of importsOf(file)) {
    const resolved = resolveSpec(spec, file);
    if (!resolved) continue;
    const targetRel = path.relative(MOBILE_SRC, resolved).replaceAll(path.sep, '/');
    const targetInApp = resolved.startsWith(APP_DIR + path.sep);
    const targetBase = path.basename(resolved).replace(/\.(ts|tsx)$/, '');

    // Product surface must never depend on the evidence harness.
    if (productSide && !targetInApp) {
      if (EVIDENCE_ROOT_MODULES.has(targetBase) || targetRel.startsWith('pages/') || targetRel.startsWith('components/')) {
        violations.push(`${rel(file)}: product surface imports evidence harness '${spec}'`);
      }
    }

    // Evidence harness may take only the pure domain (app/model); product
    // views/state are off-limits.
    if (evidenceSide && targetInApp && PRODUCT_VIEW_MODULES.has(targetBase)) {
      violations.push(`${rel(file)}: evidence harness imports product view/state '${spec}' (share via app/model or @peers-touch/ui, not views)`);
    }
  }
}

if (violations.length) {
  console.error('mobile-surface-boundary: FAIL');
  for (const v of violations) console.error(`  ${v}`);
  console.error('\nAllowed sharing: @peers-touch/ui primitives/tokens and pure entities in src/app/model.');
  process.exit(1);
}
console.log('mobile-surface-boundary: PASS (product app/ and evidence harness views are decoupled)');
