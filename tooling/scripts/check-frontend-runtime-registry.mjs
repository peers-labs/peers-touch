#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fail(message, status = 1) {
  process.stderr.write(`frontend runtime registry: ${message}\n`);
  process.exit(status);
}

function git(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function parseArguments(argv) {
  const options = { range: undefined, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--range') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        fail('missing --range value', 2);
      }
      options.range = value;
      index += 1;
    } else if (argument === '--strict') {
      options.strict = true;
    } else if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        'Usage: check-frontend-runtime-registry.mjs [--range <git-range>] [--strict]\n',
      );
      process.exit(0);
    } else {
      fail(`unknown argument: ${argument}`, 2);
    }
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const root = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
const registry = 'docs/client/common/ui-identity/frontend-component-tree-registry.md';
const requiredFiles = [
  registry,
  'docs/architecture/frontend-runtime/README.md',
  'docs/architecture/frontend-runtime/data-model.md',
  'apps/desktop/src/kernel/frontendRuntimeProfiler.ts',
  'apps/desktop/src/kernel/SectionHost.tsx',
  'apps/desktop/src/applet/AppletContainerShell.tsx',
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    fail(`missing required file: ${file}`);
  }
}

const content = fs.readFileSync(path.join(root, registry), 'utf8');
const requiredHeaders = [
  'Feature / Surface',
  'Owner Layer',
  'Alive Category',
  'Cache Policy',
  'Runtime / Store Owner',
  'Status',
  'Evidence',
  'Review Owner',
];
for (const header of requiredHeaders) {
  if (!content.includes(header)) {
    fail(`missing header: ${header}`);
  }
}

const allowedAlive = [
  '`eager + forever`',
  '`idle + forever`',
  '`on-visit + lru`',
  '`on-visit + none`',
  '`lazy section`',
  '`virtualized content`',
];
const allowedStatuses = new Set([
  'alive',
  'lazy',
  'lru',
  'not alive',
  'needs audit',
  'deprecated',
]);
const rowErrors = [];
for (const line of content.split(/\r?\n/u)) {
  if (!line.startsWith('|') || /^\|\s*-+\s*\|/u.test(line)) {
    continue;
  }
  const columns = line.split('|').slice(1, -1).map((value) => value.trim());
  if (columns.length < 9 || columns[0] === 'Feature / Surface') {
    continue;
  }
  const [
    feature,
    owner,
    alive,
    trigger,
    cache,
    runtime,
    status,
    evidence,
    reviewOwner,
  ] = columns;
  if (
    [feature, owner, trigger, cache, runtime, status, evidence, reviewOwner]
      .some((value) => !value)
  ) {
    rowErrors.push(`row has empty required field: ${line}`);
  }
  if (!allowedAlive.some((value) => alive.includes(value))) {
    rowErrors.push(`invalid alive category for ${feature}: ${alive}`);
  }
  if (!allowedStatuses.has(status)) {
    rowErrors.push(`invalid status for ${feature}: ${status}`);
  }
  if (
    status === 'needs audit'
    && !/audit|verify|target|not yet|unproven|needs|must|should/iu.test(evidence)
  ) {
    rowErrors.push(`needs audit row lacks revisit/evidence wording: ${feature}`);
  }
}
if (rowErrors.length > 0) {
  fail(rowErrors.join('\nfrontend runtime registry: '));
}

if (options.range) {
  const changed = new Set(
    git(['diff', '--name-only', options.range, '--'], root)
      .split(/\r?\n/u)
      .filter(Boolean),
  );
  for (
    const file of git(['ls-files', '--others', '--exclude-standard'], root)
      .split(/\r?\n/u)
      .filter(Boolean)
  ) {
    changed.add(file);
  }
  const files = [...changed];
  const runtimeChanged = files.some((file) =>
    /^(apps\/desktop\/src\/(kernel|pages|components\/settings|applet|runtimes|services)\/|apps\/mobile\/src\/)/u
      .test(file));
  const registryChanged = files.some((file) =>
    file === registry || file.startsWith('docs/architecture/frontend-runtime/'));
  if (runtimeChanged && !registryChanged) {
    const message =
      'UI runtime files changed without registry/runtime architecture doc update';
    if (options.strict) {
      fail(message);
    }
    process.stderr.write(`warning: frontend runtime registry: ${message}\n`);
  }
}

process.stdout.write('Frontend runtime registry OK.\n');
