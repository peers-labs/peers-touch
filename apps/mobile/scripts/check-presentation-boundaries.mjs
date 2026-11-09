#!/usr/bin/env node
/**
 * Mobile presentation-boundary guard (north-star realignment).
 *
 * Enforces two architectural invariants from
 * docs/architecture/platform/client/mobile/northstar-realignment/design.md:
 *
 *  G2 presentation-free cores: src/{runtimes,services,storage} must not import
 *     @peers-touch/ui or any stylesheet. Presentation stays in pages/components/
 *     features/app.
 *  G1 shrinking antd/lobehub residual: the number of web source files importing
 *     `antd` or `@lobehub/ui` may only decrease as surfaces migrate. The
 *     baseline is the count when peers-ui was introduced; it is lowered per
 *     slice and driven to zero at program delivery.
 *
 * Exit non-zero on violation. No args.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const srcRoot = path.join(appRoot, 'src');

// Lowered per slice; never raised. See functional-coverage / plan.
const BASELINE_ANTD_LOBEHUB_FILES = 40;

const PRESENTATION_FREE_DIRS = new Set(['runtimes', 'services', 'storage']);
const SOURCE_RE = /\.(ts|tsx)$/;
const UI_IMPORT_RE = /from\s+['"]@peers-touch\/ui['"]/;
const CSS_IMPORT_RE = /import\s+['"][^'"]+\.css['"]/;
const ANTD_IMPORT_RE = /from\s+['"]antd['"]|from\s+['"]@lobehub\/ui['"]/;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SOURCE_RE.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(srcRoot);
const boundaryViolations = [];
let antdLobehubFiles = 0;

for (const file of files) {
  const rel = path.relative(srcRoot, file);
  const top = rel.split(path.sep)[0];
  const source = fs.readFileSync(file, 'utf8');

  if (ANTD_IMPORT_RE.test(source)) antdLobehubFiles += 1;

  if (PRESENTATION_FREE_DIRS.has(top) && (UI_IMPORT_RE.test(source) || CSS_IMPORT_RE.test(source))) {
    boundaryViolations.push(rel);
  }
}

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

console.log(`presentation-boundaries: antd/lobehub files = ${antdLobehubFiles} (baseline ${BASELINE_ANTD_LOBEHUB_FILES}, must not grow)`);
console.log(`presentation-boundaries: presentation-free violations = ${boundaryViolations.length}`);

if (errors.length > 0) {
  console.error(`\npresentation-boundaries: FAIL\n${errors.map(e => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
console.log('presentation-boundaries: PASS');
