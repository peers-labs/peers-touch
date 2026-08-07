#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const rootDir = process.cwd();
const evidenceDir = path.resolve('.artifacts/applet-readiness/checks');
const outputPath = path.join(evidenceDir, 'platform-check-output.txt');

mkdirSync(evidenceDir, { recursive: true });

const checks = [
  {
    label: 'Applet SDK typecheck',
    command: 'pnpm',
    args: ['--filter', '@peers-touch/applet-sdk', 'run', 'check'],
  },
  {
    label: 'Desktop app typecheck and boundary checks',
    command: 'pnpm',
    args: ['--filter', '@peers-touch/app-desktop', 'run', 'check'],
  },
  {
    label: 'Desktop Rust Gateway cargo check',
    command: 'cargo',
    args: ['check', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml'],
  },
  {
    label: 'Mobile web/native check',
    command: 'pnpm',
    args: ['mobile:check'],
  },
];

function runCheck(check) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(check.command, check.args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    ...check,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

const results = [];
for (const check of checks) {
  process.stdout.write(`[platform-check] ${check.label}\n`);
  const result = runCheck(check);
  results.push(result);
  if (result.status !== 0) break;
}

const failed = results.find((result) => result.status !== 0);
const lines = [
  `${failed ? 'FAIL' : 'PASS'} Applet platform check gate`,
  'Scope: SDK check, Desktop TypeScript boundary/type checks, Desktop Rust Gateway cargo check, and Mobile web/native check.',
  '',
  ...results.flatMap((result) => [
    `Step: ${result.label}`,
    `Command: ${result.command} ${result.args.join(' ')}`,
    `Started: ${result.startedAt}`,
    `Finished: ${result.finishedAt}`,
    `Status: ${result.status === 0 ? 'PASS' : 'FAIL'}`,
    result.status === 0 ? '' : `stdout:\n${result.stdout.trim()}`,
    result.status === 0 ? '' : `stderr:\n${result.stderr.trim()}`,
    '',
  ]),
];

writeFileSync(outputPath, `${lines.filter((line) => line !== undefined).join('\n').trim()}\n`);
process.stdout.write(`${failed ? 'FAIL' : 'PASS'} applet platform check gate. Evidence: ${outputPath}\n`);

if (failed) {
  process.exit(failed.status);
}
