#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stationAppDir = path.join(repoRoot, 'apps', 'station', 'app');
const [command, ...rawArgs] = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`FAIL ${message}\n`);
  process.exit(1);
}

if (!command) {
  fail('usage: pnpm applet:<publish|install|revoke> ...');
}

const args = normalizeArgs(command, rawArgs);
const result = spawnSync(
  'go',
  ['run', './subserver/applet_store/cmd/store_cli', '--repo-root', repoRoot, command, ...args],
  {
    cwd: stationAppDir,
    stdio: 'inherit',
  },
);

if (result.error) {
  fail(result.error.message);
}
process.exit(result.status ?? 1);

function normalizeArgs(action, args) {
  if (action !== 'publish') {
    return reorderOptions(args);
  }
  const normalized = [...args];
  const firstPackageArg = firstPositionalIndex(normalized);
  if (firstPackageArg >= 0) {
    normalized[firstPackageArg] = path.resolve(repoRoot, normalized[firstPackageArg]);
  }
  return reorderOptions(normalized);
}

function reorderOptions(args) {
  const options = [];
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    options.push(arg);
    const next = args[index + 1];
    if (next && !next.startsWith('-')) {
      options.push(next);
      index += 1;
    }
  }
  return [...options, ...positionals];
}

function firstPositionalIndex(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('-')) {
      const next = args[index + 1];
      if (next && !next.startsWith('-')) {
        index += 1;
      }
      continue;
    }
    return index;
  }
  return -1;
}
