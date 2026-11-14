#!/usr/bin/env node
/**
 * Mobile presentation-boundary guard (north-star realignment).
 *
 * Enforces the architectural invariants from
 * docs/architecture/platform/client/mobile/northstar-realignment/design.md:
 *
 *  G2 presentation-free cores: src/{runtimes,services,storage} must not import
 *     @peers-touch/ui or any stylesheet. Presentation stays in pages/components/
 *     features/app.
 *  G1 shrinking antd/lobehub residual: the number of web source files importing
 *     `antd` or `@lobehub/ui` may only decrease as surfaces migrate. The
 *     baseline is the count when peers-ui was introduced; it is lowered per
 *     slice and driven to zero at program delivery.
 *  G3 shrinking private --brand-* palette: north-star allows exactly one color
 *     source (--pt-*). The private blue-purple --brand-* tokens may only
 *     decrease, in both the legacy stylesheet consumers and inline component
 *     usage. Driven to zero by Slice 6.
 *  G4 no native template chrome: the generated Android host must not keep the
 *     stock Material purple_* colors (the source of the unbranded status bar).
 *     Baseline is lowered as the native theme is aligned to north-star.
 *  G5 north-star provider wiring: the single UIProvider must mount with
 *     northStarVariables so --pt-* tokens are actually supplied to the tree.
 *
 * Baselines are lowered per slice, never raised. Exit non-zero on violation.
 * No args.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const srcRoot = path.join(appRoot, 'src');
const providerPath = path.join(
  srcRoot,
  'app',
  'MobileNorthStarProvider.tsx',
);
const skinPath = path.join(srcRoot, 'app', 'mobile-northstar.css');
const androidResRoot = path.join(
  appRoot,
  'src-tauri',
  'gen',
  'android',
  'app',
  'src',
  'main',
  'res',
);

// Lowered per slice; never raised. See functional-coverage / plan.
const BASELINE_ANTD_LOBEHUB_FILES = 0;
// Lowered as the realignment lands: native template purple reached zero in
// the first foundation pass; the stylesheet brand count dropped when the body
// canvas moved to the neutral north-star value.
const BASELINE_BRAND_CSS_REFS = 0;
const BASELINE_BRAND_INLINE_REFS = 0;
const BASELINE_NATIVE_PURPLE_REFS = 0;

const PRESENTATION_FREE_DIRS = new Set(['runtimes', 'services', 'storage']);
const SOURCE_RE = /\.(ts|tsx)$/;
const UI_IMPORT_RE = /from\s*['"]@peers-touch\/ui['"]/;
const CSS_IMPORT_RE = /import\s+['"][^'"]+\.css['"]/;
const ANTD_IMPORT_RE = /from\s+['"]antd['"]|from\s+['"]@lobehub\/ui['"]/;
// Count both definitions/aliases and consumers, across every presentation file.
const BRAND_VAR_RE = /--brand-[a-z-]+/g;
const NATIVE_PURPLE_RE = /purple_(200|500|700)/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SOURCE_RE.test(entry.name)) out.push(full);
  }
  return out;
}

function countMatches(re, text) {
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

function walkFiles(dir, re) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, re));
    else if (re.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(srcRoot);
const boundaryViolations = [];
let antdLobehubFiles = 0;
let brandInlineRefs = 0;

for (const file of files) {
  const rel = path.relative(srcRoot, file);
  const top = rel.split(path.sep)[0];
  const source = fs.readFileSync(file, 'utf8');

  if (ANTD_IMPORT_RE.test(source)) antdLobehubFiles += 1;
  brandInlineRefs += countMatches(BRAND_VAR_RE, source);

  if (PRESENTATION_FREE_DIRS.has(top) && (UI_IMPORT_RE.test(source) || CSS_IMPORT_RE.test(source))) {
    boundaryViolations.push(rel);
  }
}

// G3: every stylesheet is covered; a page-local CSS import cannot hide debt.
const brandCssRefs = walkFiles(srcRoot, /\.css$/).reduce(
  (total, file) => total + countMatches(BRAND_VAR_RE, fs.readFileSync(file, 'utf8')), 0,
);

// G4: stock Material purple in the generated Android resources.
const nativeXmlFiles = walkFiles(androidResRoot, /\.xml$/);
let nativePurpleRefs = 0;
for (const file of nativeXmlFiles) {
  nativePurpleRefs += countMatches(
    NATIVE_PURPLE_RE,
    fs.readFileSync(file, 'utf8'),
  );
}

// G5: the north-star provider must actually inject the token set.
let providerWired = false;
if (fs.existsSync(providerPath)) {
  const provider = fs.readFileSync(providerPath, 'utf8');
  providerWired =
    UI_IMPORT_RE.test(provider) &&
    provider.includes('northStarVariables') &&
    provider.includes('<UIProvider');
}
const skinPresent = fs.existsSync(skinPath);

const errors = [];
if (boundaryViolations.length > 0) {
  errors.push(
    `presentation-free core imports UI/CSS (must stay in pages/components/features/app):\n  - ${boundaryViolations.join('\n  - ')}`,
  );
}
if (antdLobehubFiles > BASELINE_ANTD_LOBEHUB_FILES) {
  errors.push(
    `antd/@lobehub/ui residual grew: ${antdLobehubFiles} files > baseline ${BASELINE_ANTD_LOBEHUB_FILES}`,
  );
}
if (brandCssRefs > BASELINE_BRAND_CSS_REFS) {
  errors.push(
    `--brand-* stylesheet consumers grew: ${brandCssRefs} > baseline ${BASELINE_BRAND_CSS_REFS}`,
  );
}
if (brandInlineRefs > BASELINE_BRAND_INLINE_REFS) {
  errors.push(
    `inline --brand-* usage grew: ${brandInlineRefs} > baseline ${BASELINE_BRAND_INLINE_REFS}`,
  );
}
if (nativePurpleRefs > BASELINE_NATIVE_PURPLE_REFS) {
  errors.push(
    `native Android template purple refs grew: ${nativePurpleRefs} > baseline ${BASELINE_NATIVE_PURPLE_REFS}`,
  );
}
if (!providerWired) {
  errors.push(
    'north-star UIProvider is not wired with northStarVariables (--pt-* tokens would be unreachable)',
  );
}
if (!skinPresent) {
  errors.push('mobile north-star skin stylesheet is missing');
}

console.log(
  `presentation-boundaries: antd/lobehub files = ${antdLobehubFiles} (baseline ${BASELINE_ANTD_LOBEHUB_FILES}, must not grow)`,
);
console.log(
  `presentation-boundaries: --brand-* css refs = ${brandCssRefs} (baseline ${BASELINE_BRAND_CSS_REFS}), inline refs = ${brandInlineRefs} (baseline ${BASELINE_BRAND_INLINE_REFS})`,
);
console.log(
  `presentation-boundaries: native purple refs = ${nativePurpleRefs} (baseline ${BASELINE_NATIVE_PURPLE_REFS})`,
);
console.log(
  `presentation-boundaries: provider wired = ${providerWired}, skin present = ${skinPresent}, presentation-free violations = ${boundaryViolations.length}`,
);

if (errors.length > 0) {
  console.error(`\npresentation-boundaries: FAIL\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
console.log('presentation-boundaries: PASS');
