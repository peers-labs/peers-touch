#!/usr/bin/env node
// Advisory-only dead code/unused export report backed by knip.
//
// This step NEVER fails the review: dead code is a signal for the semantic
// structure decision, not a hard rule. It degrades to SKIP when knip or its
// install is unavailable (offline checkout, partial install) so local and CI
// review do not depend on the advisory toolchain.
//
// knip 5.x JSON reporter shape:
//   { files: string[], issues: IssueEntry[] }
// where each IssueEntry carries per-file arrays (exports, types,
// dependencies, devDependencies, unlisted, binaries, duplicates, ...).
//
// Usage: node dead-code-advisory.mjs [--max-list N]

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const MAX_LIST = Number(process.argv.includes('--max-list')
  ? process.argv[process.argv.indexOf('--max-list') + 1]
  : 30);

function skip(reason) {
  console.log(`dead-code-advisory: SKIP (${reason})`);
  process.exit(0);
}

const result = spawnSync('pnpm', ['exec', 'knip', '--reporter', 'json', '--no-progress'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (result.error?.code === 'ENOENT') {
  skip('pnpm/knip unavailable');
}
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  skip('knip did not return parseable output');
}
if (!Array.isArray(report.files) || !Array.isArray(report.issues)) {
  skip('knip returned an unsupported report shape');
}

// knip arrays that name an unused/unlisted item; enumMembers is an object map.
const ARRAY_COUNTERS = [
  ['exports', 'unused exports'],
  ['types', 'unused exported types'],
  ['duplicates', 'duplicate exports'],
  ['dependencies', 'unused dependencies'],
  ['devDependencies', 'unused devDependencies'],
  ['optionalPeerDependencies', 'unused optional peer dependencies'],
  ['unlisted', 'used-but-unlisted dependencies'],
  ['binaries', 'used-but-unlisted binaries'],
  ['unresolved', 'unresolved imports'],
];

const counts = new Map(ARRAY_COUNTERS.map(([, label]) => [label, 0]));
let enumMemberCount = 0;
for (const entry of report.issues) {
  for (const [key, label] of ARRAY_COUNTERS) {
    if (Array.isArray(entry[key])) {
      counts.set(label, counts.get(label) + entry[key].length);
    }
  }
  if (entry.enumMembers && typeof entry.enumMembers === 'object') {
    for (const members of Object.values(entry.enumMembers)) {
      if (Array.isArray(members)) {
        enumMemberCount += members.length;
      }
    }
  }
}
const symbolSignals = [...counts.entries()]
  .filter(([, count]) => count > 0)
  .map(([label, count]) => `${label}=${count}`);
if (enumMemberCount > 0) {
  symbolSignals.push(`unused enum members=${enumMemberCount}`);
}

console.log('== Dead code advisory (knip; non-blocking) ==');
console.log(`unused files: ${report.files.length}`);
console.log(`unused symbols: ${
  symbolSignals.length ? symbolSignals.join(', ') : '0'
}`);

const listed = report.files.slice(0, MAX_LIST);
for (const file of listed) {
  console.log(`  unused-file ${file}`);
}
if (report.files.length > listed.length) {
  console.log(`  ... ${report.files.length - listed.length} more unused files omitted`);
}
console.log('dead-code-advisory: reported (contextual review input; never blocks and requires no structure-decision disposition)');
