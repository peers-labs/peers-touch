#!/usr/bin/env node
/**
 * primitive-layer-guard — enforce the invariant
 * docs/knowledge/invariants/app-layer-must-not-restyle-primitives.md
 *
 * The app/page/prototype layer composes peers-ui; it must never define the
 * appearance or state machinery of a primitive.
 *
 * Detected in application layers (everything except packages/ui):
 *   CSS  — selectors targeting peers-ui classes (.pt-*).
 *   JS   — visual DOM mutation: el.style.<visualProp>,
 *          classList.add/remove/toggle, setAttribute('class'|'style').
 *
 * Pre-existing violations are registered in primitive-layer.baseline.json.
 * The baseline may only shrink: any match it does not cover fails the run.
 * Exempt files must be listed with a reason in the baseline; no inline
 * ignore comments in source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const baselinePath = path.join(repoRoot, 'tooling/scripts/review/primitive-layer.baseline.json');

/** Directories whose own visual language is the product, not an app layer. */
const LIBRARY_ROOTS = ['packages/ui'];
/** Enforcement starts in the UI workbench where shape is trained. Production
    app surfaces are expansion targets (--all); they are not scanned until
    their primitives carry the promoted variants, otherwise their large
    inherited debt would either block trivially or be silently grandfathered. */
const DEFAULT_SCAN_DIRS = ['packages/prototypes'];
const ALL_SCAN_DIRS = [...DEFAULT_SCAN_DIRS, 'apps/desktop/src/pages', 'apps/desktop/src/components', 'apps/mobile/src'];
const CSS_EXT = new Set(['.css']);
const JS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.local', 'coverage']);

/** style.* properties that control a primitive's visual chrome. Layout-only
    writes (width/height of page regions) still need a primitive prop when
    they target a `.pt-*` node; textarea auto-grow is the known exception. */
const VISUAL_STYLE_PROPS = new Set([
  'background', 'backgroundColor', 'border', 'borderRadius', 'boxShadow', 'color',
  'opacity', 'outline', 'padding', 'margin', 'fontSize', 'fontWeight', 'lineHeight',
  'transform', 'transition', 'animation', 'width', 'height', 'overflow', 'overflowY', 'overflowX',
]);

export function walk(dir, out = []) {
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

function isLibraryFile(file) {
  const r = rel(file);
  return LIBRARY_ROOTS.some(root => r === root || r.startsWith(root + path.sep));
}

/** Returns the .pt-* class selectors found on a CSS line (selector lists). */
function cssPrimitiveSelectors(line) {
  const hits = [];
  const re = /\.pt-[a-zA-Z][a-zA-Z0-9-]*/g;
  let m;
  while ((m = re.exec(line))) hits.push(m[0]);
  return hits;
}

function jsViolations(line) {
  const v = [];
  const styleRe = /\.style\.([a-zA-Z]+)\s*=/g;
  let m;
  while ((m = styleRe.exec(line))) {
    const prop = m[1];
    if (VISUAL_STYLE_PROPS.has(prop)) v.push(`style.${prop}`);
  }
  if (/classList\.(add|remove|toggle)\s*\(/.test(line)) v.push('classList');
  if (/setAttribute\(\s*['"](?:class|style)['"]/.test(line)) v.push('setAttribute-class/style');
  return v;
}

/** Build a per-file multiset (token -> occurrence count) of primitive-layer
    debt. Identity is the selector/mutation token, NOT the line number: a pure
    edit that shifts lines must not read as new debt, and a same-token move
    inside one file neither grows nor shrinks the debt. Adding a token is new
    debt; removing one is genuine shrinkage. A file is single-channel: .css
    carries selector debt, .ts/.tsx/.js/.jsx carries visual-mutation debt. */
export function scan(files) {
  const byFile = new Map();
  const totals = { css: 0, js: 0 };
  const firstLine = new Map();
  for (const file of files) {
    if (isLibraryFile(file)) continue;
    const ext = path.extname(file);
    if (!CSS_EXT.has(ext) && !JS_EXT.has(ext)) continue;
    const channel = CSS_EXT.has(ext) ? 'css' : 'js';
    const r = rel(file);
    const bag = new Map();
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const add = (token, i) => {
      bag.set(token, (bag.get(token) ?? 0) + 1);
      totals[channel] += 1;
      if (!firstLine.has(`${channel}:${r}:${token}`)) firstLine.set(`${channel}:${r}:${token}`, i + 1);
    };
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) return;
      const tokens = channel === 'css' ? cssPrimitiveSelectors(line) : jsViolations(line);
      tokens.forEach(token => add(token, i));
    });
    if (bag.size) byFile.set(r, { channel, bag });
  }
  return { byFile, totals, firstLine };
}

function toMultiset(entries) {
  const bag = new Map();
  for (const token of entries ?? []) bag.set(token, (bag.get(token) ?? 0) + 1);
  return bag;
}

function channelOf(file) {
  return CSS_EXT.has(path.extname(file)) ? 'css' : 'js';
}

function diffMultisets(channel, file, current, base, firstLine) {
  const added = [], removed = [];
  for (const token of new Set([...current.keys(), ...base.keys()])) {
    const c = current.get(token) ?? 0, b = base.get(token) ?? 0;
    if (c > b) added.push({ file, channel, token, delta: c - b, line: firstLine.get(`${channel}:${file}:${token}`) });
    else if (b > c) removed.push({ file, channel, token, delta: b - c });
  }
  return { added, removed };
}

function main() {
  const update = process.argv.includes('--update');
  let baseline = { css: {}, js: {} };
  if (fs.existsSync(baselinePath)) baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

  const scanDirs = process.argv.includes('--all') ? ALL_SCAN_DIRS : DEFAULT_SCAN_DIRS;
  const files = scanDirs.flatMap(d => walk(path.join(repoRoot, d)));
  const { byFile, totals, firstLine } = scan(files);

  const allFiles = new Set([
    ...byFile.keys(),
    ...Object.keys(baseline.css ?? {}),
    ...Object.keys(baseline.js ?? {}),
  ]);
  const newViolations = [], staleEntries = [];
  for (const file of allFiles) {
    const channel = byFile.get(file)?.channel ?? channelOf(file);
    const current = byFile.get(file)?.bag ?? new Map();
    const base = toMultiset(baseline[channel]?.[file]);
    const { added, removed } = diffMultisets(channel, file, current, base, firstLine);
    newViolations.push(...added);
    staleEntries.push(...removed);
  }

  if (update) {
    const next = { css: {}, js: {} };
    for (const [file, { channel, bag }] of byFile) {
      const tokens = [];
      for (const [token, count] of bag) for (let i = 0; i < count; i++) tokens.push(token);
      next[channel][file] = tokens.sort();
    }
    fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`primitive-layer-guard: baseline rewritten (css=${totals.css}, js=${totals.js})`);
    return;
  }

  if (newViolations.length || staleEntries.length) {
    console.error('primitive-layer-guard: FAIL');
    for (const v of newViolations) {
      console.error(`  NEW [${v.channel}] ${v.file}:${v.line ?? '?'} — ${v.token} x${v.delta}`);
    }
    for (const b of staleEntries) {
      console.error(`  SHRUNK/STALE BASELINE (run --update to record) [${b.channel}] ${b.file} — ${b.token} x${b.delta}`);
    }
    console.error(`\nApp-layer .pt-* debt present now: css=${totals.css}, js=${totals.js}`);
    process.exit(1);
  }
  console.log(`primitive-layer-guard: PASS (baselined debt css=${totals.css}, js=${totals.js}; zero new)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
