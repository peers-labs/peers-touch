#!/usr/bin/env node
// Prints retired-reference registry entries as tab-separated rows for
// hard-rules.sh:
//   code <TAB> pattern <TAB> message <TAB> scopes <TAB> ignores
// - scopes: comma-joined subset of "paths,content".
// - ignores: unit-separator (0x1f) joined ERE patterns; may be empty.
//
// Usage: node retired-refs.mjs
//
// The registry is the single maintained list of identifiers that must not
// reappear in tracked paths or content. Adding a retired product/API requires
// one registry entry instead of hard-coding another branch in hard-rules.sh.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(here, 'retired-refs.json');

let registry;
try {
  registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
} catch (error) {
  process.stderr.write(`retired-refs: invalid registry: ${error.message}\n`);
  process.exit(1);
}

if (!Array.isArray(registry.references)) {
  process.stderr.write('retired-refs: registry requires a references array\n');
  process.exit(1);
}

for (const entry of registry.references) {
  if (
    typeof entry.code !== 'string'
    || typeof entry.pattern !== 'string'
    || typeof entry.message !== 'string'
    || typeof entry.paths !== 'boolean'
    || typeof entry.content !== 'boolean'
    || !Array.isArray(entry.ignore)
    || entry.ignore.some((pattern) => typeof pattern !== 'string')
  ) {
    process.stderr.write('retired-refs: each entry needs code, pattern, message, paths, content, ignore[]\n');
    process.exit(1);
  }
  if (!entry.paths && !entry.content) {
    process.stderr.write(`retired-refs: entry ${entry.code} enables neither paths nor content\n`);
    process.exit(1);
  }
  if (entry.pattern.includes('\t') || entry.ignore.some((pattern) => pattern.includes('\t'))) {
    process.stderr.write(`retired-refs: entry ${entry.code} contains a tab in a pattern\n`);
    process.exit(1);
  }
  const scopes = [
    ...(entry.paths ? ['paths'] : []),
    ...(entry.content ? ['content'] : []),
  ].join(',');
  const ignores = entry.ignore.join('\x1f');
  process.stdout.write(`${entry.code}\t${entry.pattern}\t${entry.message}\t${scopes}\t${ignores}\n`);
}
