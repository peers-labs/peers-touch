#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { repoRoot } from '../../../scripts/lib/machine-dev-paths.mjs';

const MAX_FAILURE_OUTPUT = 16 * 1024;

function testFiles(directory, predicate = () => true) {
  return readdirSync(path.join(repoRoot, directory), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.test.mjs') &&
        predicate(entry.name),
    )
    .map((entry) => path.posix.join(directory, entry.name))
    .sort();
}

const workflowTests = [
  'tooling/scripts/plan/planctl.test.mjs',
  'tooling/scripts/plan/workspace-plan-binding.test.mjs',
  'tooling/scripts/local-dev/dev-work.test.mjs',
  'tooling/scripts/local-dev/dev-session.test.mjs',
  'tooling/scripts/local-dev/completion-review.test.mjs',
  ...testFiles(
    'tooling/scripts/local-dev',
    (name) => name.startsWith('workflow-'),
  ),
  'tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs',
  ...testFiles('apps/dev/server'),
];

const checks = [
  {
    id: 'workflow-source-suite',
    command: 'node',
    args: ['--test', ...workflowTests],
  },
  {
    id: 'installed-integration-isolation',
    command: 'python3',
    args: [
      '-m',
      'unittest',
      'tooling/scripts/agent-integration-audit-test.py',
    ],
  },
  {
    id: 'desktop-and-narrow-browser',
    command: 'node',
    args: ['tooling/acceptance/gates/dev/dev-ui-browser-e2e.mjs'],
  },
];

function tail(value) {
  if (!value) return '';
  return value.length <= MAX_FAILURE_OUTPUT
    ? value
    : value.slice(value.length - MAX_FAILURE_OUTPUT);
}

function runCheck(check) {
  const started = Date.now();
  const result = spawnSync(check.command, check.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const durationMs = Date.now() - started;
  if (result.error || result.status !== 0) {
    return {
      id: check.id,
      status: 'FAIL',
      exitCode: result.status,
      durationMs,
      output: tail(`${result.stdout ?? ''}${result.stderr ?? ''}`),
      error: result.error?.code ?? null,
    };
  }
  return {
    id: check.id,
    status: 'PASS',
    exitCode: 0,
    durationMs,
  };
}

const results = [];
for (const check of checks) {
  const result = runCheck(check);
  results.push(result);
  if (result.status !== 'PASS') break;
}

const status =
  results.length === checks.length &&
  results.every((result) => result.status === 'PASS')
    ? 'PASS'
    : 'FAIL';
const report = {
  schemaVersion: 1,
  kind: 'peers-dev-product-gate-report',
  status,
  checks: results,
};

const output = `${JSON.stringify(report, null, 2)}\n`;
if (status === 'PASS') {
  process.stdout.write(output);
} else {
  process.stderr.write(output);
  process.exitCode = 1;
}
