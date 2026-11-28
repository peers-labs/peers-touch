#!/usr/bin/env node
/**
 * composite-layer-guard — enforce the @peers-touch/ui-composite boundary.
 *
 * Two invariants from the composite-promotion pilot
 * (docs/architecture/platform/client/ui-system/composite-promotion):
 *
 *   1. Dependency closure (CMP-D01 / hard boundary §4.1): the composite
 *      package may import only react/react-dom, @peers-touch/ui and relative
 *      modules. It MUST NOT reach antd, @lobehub, react-i18next, lucide-react,
 *      zustand, any apps/* code, or prototype seed/store/runtime.
 *
 *   2. Style ownership (CMP-D04): the `.ptc-*` class namespace is owned solely
 *      by packages/ui/composite. Application/prototype layers consume the
 *      component and inject their own legacy classes via SurfaceHooks; they
 *      must never define `.ptc-*` appearance rules themselves.
 *
 * Exit non-zero on the first violation class found. No baseline: both rules
 * are zero-tolerance from the pilot's first component.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifySurfaceStyles } from '../review/ui-surface-styles.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const COMPOSITE_SRC = path.join(repoRoot, 'packages/ui/composite/src');

/** Import specifiers the composite package is forbidden from depending on. */
const FORBIDDEN_IMPORT_PATTERNS = [
  /^antd/,
  /^@ant-design\//,
  /^@lobehub\//,
  /^react-i18next/,
  /^lucide-react/,
  /^zustand/,
  /^@peers-touch\/(?!ui$)/, // only @peers-touch/ui is allowed among workspace pkgs
];

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.local', 'coverage']);

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = file => path.relative(repoRoot, file);

/** Extract module specifiers from static import/export-from statements. */
const IMPORT_RE = /(?:import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?|export\s+(?:type\s+)?[^'"]*?\s+from\s+)['"]([^'"]+)['"]/g;

function checkDependencyClosure() {
  const failures = [];
  const files = walk(COMPOSITE_SRC).filter(f => CODE_EXT.has(path.extname(f)));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(source)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        if (pattern.test(specifier)) {
          failures.push(`${rel(file)}: forbidden import '${specifier}'`);
          break;
        }
      }
    }
  }
  return failures;
}

function checkStyleOwnership() {
  try {
    verifySurfaceStyles(repoRoot, [{ protectedClasses: ['ptc-'] }]);
    return [];
  } catch (error) {
    if (!error.code?.startsWith('UI_SURFACE_')) throw error;
    return [error.message];
  }
}

function main() {
  const failures = [
    ...checkDependencyClosure().map(f => `[dependency] ${f}`),
    ...checkStyleOwnership().map(f => `[style-ownership] ${f}`),
  ];
  if (failures.length) {
    console.error('composite-layer-guard: FAIL');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  process.stdout.write('composite-layer-guard: PASS (dependency closure + .ptc-* style ownership)\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
