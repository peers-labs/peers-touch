#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  appletArtifactRoot,
  appletEvidenceRoot,
  appletFixtureRoot,
  repoRoot,
} from './lib/applet-readiness-paths.mjs';

const failures = [];

function repositoryFiles(root) {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', path.relative(repoRoot, root)],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.split('\n').filter(Boolean);
}

const legacyRoot = ['applet', 'readiness', 'evidence'].join('-');
const legacy = spawnSync(
  'git',
  [
    'grep',
    '--untracked',
    '--exclude-standard',
    '-n',
    legacyRoot,
    '--',
    ':!docs/architecture/applet-runtime/decisions.md',
    ':!docs/architecture/applet-runtime/integration.md',
    ':!docs/architecture/applet-runtime/execution-plans/2026-08-08-applet-evidence-layout-cutover.md',
  ],
  { cwd: repoRoot, encoding: 'utf8' },
);
if (legacy.status === 0 && legacy.stdout.trim()) failures.push(legacy.stdout.trim());
if (legacy.status !== 0 && legacy.status !== 1) failures.push(legacy.stderr.trim());
if (existsSync(path.join(repoRoot, legacyRoot))) {
  failures.push(`legacy evidence root still exists: ${legacyRoot}`);
}

for (const file of repositoryFiles(appletEvidenceRoot)) {
  const absolutePath = path.join(repoRoot, file);
  if (lstatSync(absolutePath).isSymbolicLink()) {
    failures.push(`symlink in reviewed evidence tree: ${file}`);
    continue;
  }
  if (!file.endsWith('.json') && !file.endsWith('.md')) {
    failures.push(`forbidden reviewed evidence type: ${file}`);
    continue;
  }
  if (/\/Users\/|\/private\/tmp\/|[A-Za-z]:\\Users\\/.test(readFileSync(absolutePath, 'utf8'))) {
    failures.push(`machine-specific path in reviewed evidence: ${file}`);
  }
}

for (const file of repositoryFiles(appletFixtureRoot)) {
  const absolutePath = path.join(repoRoot, file);
  if (lstatSync(absolutePath).isSymbolicLink()) {
    failures.push(`symlink in fixture tree: ${file}`);
    continue;
  }
  if (/\.(lynx\.bundle|sqlite|db)$/.test(file) || file.includes('/dist/') || file.includes('/node_modules/')) {
    failures.push(`generated artifact in fixture tree: ${file}`);
  }
  if (/\/Users\/|\/private\/tmp\/|[A-Za-z]:\\Users\\/.test(readFileSync(absolutePath, 'utf8'))) {
    failures.push(`machine-specific path in fixture tree: ${file}`);
  }
}

for (const file of repositoryFiles(appletArtifactRoot)) {
  failures.push(`tracked or unignored artifact: ${file}`);
}

if (failures.length) {
  process.stderr.write(`FAIL applet evidence layout\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('PASS applet evidence layout\n');
