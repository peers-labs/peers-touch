#!/usr/bin/env node
/**
 * prototype-import-guard — the machine half of the self-training constitution.
 *
 * Prototype feature surfaces must compose @peers-touch/ui primitives; they must
 * not hand-roll native interactive elements (<button>/<input>/<textarea>/
 * <select>). Historical debt (sk-* controls, antd mobile) is recorded in
 * prototype-import-baseline.json and may only SHRINK: a new file with raw
 * elements, or an increased count in an existing file, fails the gate.
 *
 * Usage:
 *   node prototype-import-guard.mjs                 # gate (CI)
 *   node prototype-import-guard.mjs --write-baseline # re-baseline (manual,
 *                                                    # needs human justification)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const BASELINE = path.join(here, 'prototype-import-baseline.json');

const SCAN_DIRS = [
  'packages/prototypes/shared/ui-system/chat',
  'packages/prototypes/shared/ui-system/moments',
  'packages/prototypes/shared/ui-system/settings',
  'packages/prototypes/shared/ui-system/search',
  'packages/prototypes/desktop',
  'packages/prototypes/mobile',
];
// Training/board surfaces must be clean NOW; they demonstrate the rule.
const CLEAN_DIRS = [
  'packages/prototypes/shared/ui-system/FoundationBoard.tsx',
  'packages/prototypes/shared/ui-system/SpecimenBoard.tsx',
  'packages/prototypes/shared/ui-system/KitBoard.tsx',
  'packages/prototypes/shared/ui-system/PhilosophyView.tsx',
  'packages/prototypes/shared/ui-system/MobileFrame.tsx',
];
const RAW_TAGS = ['button', 'input', 'textarea', 'select'];
const TAG_RE = (tag) => new RegExp(`<${tag}\\b`, 'g');

function walk(dir, out = []) {
  if (!fs.existsSync(path.join(repoRoot, dir))) return out;
  for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(rel, out);
    } else if (entry.isFile() && rel.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

function countTags(file) {
  const src = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const counts = {};
  for (const tag of RAW_TAGS) {
    const n = src.match(TAG_RE(tag))?.length ?? 0;
    if (n) counts[tag] = n;
  }
  return counts;
}

const files = [...new Set([
  ...SCAN_DIRS.flatMap(d => fs.statSync(path.join(repoRoot, d)).isDirectory() ? walk(d) : [d]),
  ...CLEAN_DIRS,
])];
const observed = {};
for (const file of files) {
  const counts = countTags(file);
  if (Object.keys(counts).length) observed[file] = counts;
}

const write = process.argv.includes('--write-baseline');
if (write) {
  fs.writeFileSync(BASELINE, `${JSON.stringify(observed, null, 2)}\n`);
  const total = Object.values(observed).reduce((sum, c) =>
    sum + Object.values(c).reduce((a, b) => a + b, 0), 0);
  console.log(`baseline written: ${Object.keys(observed).length} files, ${total} raw elements`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const failures = [];

for (const file of files) {
  const counts = observed[file] ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (CLEAN_DIRS.includes(file) && total > 0) {
    failures.push(`${file}: training/board surface must compose peers-ui only (${JSON.stringify(counts)})`);
    continue;
  }
  const base = baseline[file];
  if (!base) {
    if (total > 0) failures.push(`${file}: new feature file hand-rolls ${JSON.stringify(counts)} — promote a peers-ui component first`);
    continue;
  }
  for (const tag of RAW_TAGS) {
    const n = counts[tag] ?? 0;
    const b = base[tag] ?? 0;
    if (n > b) failures.push(`${file}: <${tag}> ${b} -> ${n} (baseline may only shrink)`);
  }
}
// Baseline files that disappeared or reached zero are reported as progress.
let debt = 0;
for (const [file, counts] of Object.entries(baseline)) {
  for (const tag of RAW_TAGS) debt += counts[tag] ?? 0;
  if (!observed[file]) console.log(`debt cleared: ${file} removed`);
  else {
    const now = observed[file];
    for (const tag of RAW_TAGS) {
      const b = counts[tag] ?? 0;
      const n = now[tag] ?? 0;
      if (b && n < b) console.log(`debt reduced: ${file} <${tag}> ${b} -> ${n}`);
    }
  }
}

if (failures.length) {
  console.error(`prototype-import-guard FAIL\n${failures.map(f => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
const current = Object.values(observed).reduce((sum, c) =>
  sum + Object.values(c).reduce((a, b) => a + b, 0), 0);
console.log(`prototype-import-guard OK · current raw elements: ${current} · baseline debt: ${debt}`);
