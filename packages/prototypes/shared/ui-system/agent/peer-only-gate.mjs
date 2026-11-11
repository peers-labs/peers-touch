#!/usr/bin/env node
/**
 * peer-only-gate — the completeness gate for the Agent prototype.
 *
 * The module exists to prove peers-ui can fully own the Agent surface, so
 * every element must be a peers-ui primitive. This gate fails on:
 *   1. imports from foreign component libraries (antd / lobehub / lucide /
 *      react-layout-kit);
 *   2. hand-rolled interactive HTML (<button>, <input>, <select>, <textarea>);
 *   3. raw style values that bypass the token system (hex/rgb in tsx/css).
 *
 * Domain CSS is allowed, but only through --pt-* design tokens.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const SOURCE_EXT = new Set(['.ts', '.tsx']);

const FORBIDDEN_IMPORT = /from\s+['"](antd|@lobehub\/[^'"]+|lucide-react|react-layout-kit)['"]/;
const FORBIDDEN_JSX = /<(button|input|select|textarea)\b/;
// Hand-rolled interactive roles on layout tags are still non-peers-ui controls.
const FORBIDDEN_ROLE = /role=["'](button|menuitem|checkbox|switch|tab)["']/;
// A color token sits in a code position (quote / punctuation after the hex),
// so prose like "PR #182" is not mistaken for a raw color value.
const RAW_COLOR = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?=['",;)])|rgba?\(/;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (SOURCE_EXT.has(extname(entry)) || entry.endsWith('.css')) files.push(full);
  }
  return files;
}

const failures = [];
for (const file of walk(ROOT)) {
  const source = readFileSync(file, 'utf8');
  const rel = file.replace(ROOT, '');
  if (FORBIDDEN_IMPORT.test(source)) {
    failures.push(`${rel}: forbidden foreign-library import`);
  }
  if (file.endsWith('.tsx') && FORBIDDEN_JSX.test(source)) {
    failures.push(`${rel}: hand-rolled interactive HTML element (use a peers-ui primitive)`);
  }
  if (file.endsWith('.tsx') && FORBIDDEN_ROLE.test(source)) {
    failures.push(`${rel}: hand-rolled interactive role (use a peers-ui primitive)`);
  }
  if (RAW_COLOR.test(source)) {
    failures.push(`${rel}: raw color value outside the --pt-* token system`);
  }
}

if (failures.length) {
  console.error('peer-only-gate FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('peer-only-gate OK: agents prototype is peers-ui only.');
